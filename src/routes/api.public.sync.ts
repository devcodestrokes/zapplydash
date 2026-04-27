import { createFileRoute } from "@tanstack/react-router";
import { runAllInBackground } from "@/server/sync.server";

// POST /api/public/sync
//   Public-prefixed sync trigger. Bypasses auth on published deployments
//   so the dashboard's Sync button (and external schedulers) can call it.
//   Same fire-and-forget semantics as /api/sync.
export const Route = createFileRoute("/api/public/sync")({
  server: {
    handlers: {
      POST: async () => {
        runAllInBackground();
        return Response.json({
          ok: true,
          started: true,
          message:
            "Sync started in background. Refresh the dashboard in a moment to see new data.",
          startedAt: new Date().toISOString(),
        });
      },
      GET: async () => {
        // Convenience: allow GET so it can be hit from a browser or curl.
        runAllInBackground();
        return Response.json({
          ok: true,
          started: true,
          message: "Sync started in background.",
          startedAt: new Date().toISOString(),
        });
      },
    },
  },
});
