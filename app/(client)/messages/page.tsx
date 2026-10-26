import Link from "next/link";
import { MessageThread, type ThreadMessage } from "@/components/message-thread";
import { ReplyForm } from "@/components/reply-form";
import { cardClass } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/server";

export default async function MessagesPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user!.id;

  // The person's own clients only (staff opening this page would otherwise see everything).
  const { data: memberships } = await supabase.from("client_contacts").select("client_id").eq("profile_id", me);
  const clientIds = (memberships ?? []).map((m) => m.client_id);

  const { data: jobs } = clientIds.length
    ? await supabase.from("jobs").select("id, title, client:clients(name)").in("client_id", clientIds)
    : { data: [] };
  const jobIds = (jobs ?? []).map((j) => j.id);

  const { data: messages } = jobIds.length
    ? await supabase
        .from("messages")
        .select("id, job_id, body, created_at, author_id, author:profiles!messages_author_id_fkey(is_staff)")
        .in("job_id", jobIds)
        .eq("internal", false)
        .order("created_at", { ascending: false })
        .limit(300)
    : { data: [] };

  // Newest conversation first; jobs with no messages yet go last.
  const threads = (jobs ?? [])
    .map((j) => {
      const mine = (messages ?? []).filter((m) => m.job_id === j.id);
      return { job: j, messages: mine, latest: mine[0]?.created_at ?? "" };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest));

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Messages</h1>
      {threads.length === 0 ? (
        <div className={cardClass}>
          <p className="text-lg">No messages yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {threads.map(({ job, messages: thread }) => (
            <section key={job.id} aria-label={job.title} className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">{job.title}</h2>
                <p className="text-sm text-text-muted">{job.client?.name}</p>
              </div>
              <ReplyForm jobId={job.id} />
              <MessageThread messages={thread.slice(0, 5) as unknown as ThreadMessage[]} me={me} />
              {thread.length > 5 ? (
                <Link href={`/jobs/${job.id}`} className="inline-flex min-h-11 items-center text-gold underline underline-offset-4">
                  See all {thread.length} messages
                </Link>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </>
  );
}
