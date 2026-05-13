import { createFileRoute } from "@tanstack/react-router";
import { syncAllLoop, syncLoopStore } from "@/server/loop-sync.server";
import { verifyAllowedUser } from "@/server/user-auth.server";

// POST /api/sync-loop          → sync both markets
// POST /api/sync-loop?market=UK → sync one market
export const Route = createFileRoute("/api/sync-loop")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await verifyAllowedUser(request, { requireAdmin: true });
        if (denied) return denied;
        const { searchParams } = new URL(request.url);
        const market = searchParams.get("market");
        const startedAt = new Date().toISOString();
        try {
          if (market === "UK" || market === "US") {
            const result = await syncLoopStore(market);
            return Response.json({ ok: true, startedAt, result });
          }
          const results = await syncAllLoop();
          return Response.json({ ok: true, startedAt, results });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return Response.json({ ok: false, error: msg }, { status: 500 });
        }
      },
    },
  },
});
