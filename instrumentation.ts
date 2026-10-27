import type { Instrumentation } from "next";

// Server errors are logged with what is needed to find them and nothing about the person: the page template (not
// the web address, which can hold ids), the kind of route, the method and the kind of error. Never the message,
// which could repeat something a person typed.
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  const digest = (error as { digest?: string } | null)?.digest;
  console.error(
    JSON.stringify({
      event: "server_error",
      route: context.routePath,
      routeType: context.routeType,
      method: request.method,
      error: name,
      ...(digest ? { digest } : {}),
    }),
  );
};
