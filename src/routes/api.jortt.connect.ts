import { createFileRoute } from "@tanstack/react-router";

// Jortt uses client_credentials — no user-facing OAuth flow needed.
// This endpoint just redirects back to the dashboard with a success flag.
export const Route = createFileRoute("/api/jortt/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.redirect(`${origin}/?view=sync&connected=jortt`, 302);
      },
    },
  },
});
