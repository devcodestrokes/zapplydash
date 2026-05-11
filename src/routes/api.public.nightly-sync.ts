import { createFileRoute } from "@tanstack/react-router";
import { syncAllShopifyOrders, snapshotSubscriptions } from "@/server/order-sync.server";
import { runAll } from "@/server/sync.server";

// POST /api/public/nightly-sync
//   Public endpoint called by pg_cron every night. Does three things:
//     1. Pulls all NEW / updated Shopify orders into `shopify_orders`
//        (paginates by updated_at; first run backfills history).
//     2. Snapshots Loop + Juo subscription state into
//        `subscription_snapshots` so we keep a daily history.
//     3. Refreshes the rolled-up `data_cache` rows the dashboards read
//        from (Shopify markets, monthly, repeat funnel, Triple Whale, …).
//
//   Returns a short JSON summary so we can eyeball the cron history.
export const Route = createFileRoute("/api/public/nightly-sync")({
  server: {
    handlers: {
      POST: async () => {
        const startedAt = new Date().toISOString();
        const orders = await syncAllShopifyOrders();
        const subs = await snapshotSubscriptions();
        // Refresh the per-page caches in the background — don't block.
        runAll().catch((e) => console.error("[nightly-sync] runAll:", e));
        return Response.json({
          ok: true,
          startedAt,
          finishedAt: new Date().toISOString(),
          orders,
          subscriptions: subs,
        });
      },
      GET: async ({ request }) => {
        // Allow GET for easy manual smoke-test from a browser.
        return Response.json({
          hint: "POST to this URL to trigger the nightly sync.",
          url: new URL(request.url).toString(),
        });
      },
    },
  },
});
