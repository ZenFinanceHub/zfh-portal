import { cardClass } from "@/components/ui/styles";
import { formatDate } from "@/lib/labels";

export type ThreadMessage = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
  author: { is_staff: boolean } | null;
};

// Clients can't see other clients' contacts' profiles, so anyone who isn't staff or you is "A colleague".
function authorLabel(m: ThreadMessage, me: string) {
  if (m.author_id === me) return "You";
  if (m.author?.is_staff) return "ZenFinanceHub";
  return "A colleague";
}

export function MessageThread({ messages, me }: { messages: ThreadMessage[]; me: string }) {
  if (messages.length === 0) return <p className="text-text-muted">No messages yet.</p>;
  return (
    <ul className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={`${cardClass} !p-4`} data-testid="message">
          <p className="whitespace-pre-wrap break-words">{m.body}</p>
          <p className="mt-1 text-sm text-text-muted">
            {authorLabel(m, me)} · {formatDate(m.created_at)}
          </p>
        </li>
      ))}
    </ul>
  );
}
