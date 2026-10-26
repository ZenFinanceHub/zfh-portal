import { cardClass } from "@/components/ui/styles";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or has already been used. Enter your email to get a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? ERRORS[error] : undefined;

  return (
    <div className={cardClass}>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 mb-6 text-text-muted">
        Enter your email address and we&apos;ll send you a link to sign in. No password needed.
      </p>
      {message ? (
        <p role="alert" className="mb-4 rounded-lg border border-danger p-3 text-danger">
          {message}
        </p>
      ) : null}
      <LoginForm />
    </div>
  );
}
