# Source Repeat Purchase Funnel from Juo + Loop

## Problem

The Repeat purchase funnel on the overview dashboard is currently computed from raw Shopify order history (`fetchShopifyRepeatFunnel`). Because this business is ~100% subscription, those numbers don't match reality:

- Cohort size (62,121) counts every Shopify first-time buyer, including single non-subscription purchases.
- Repeat % values (30.5 / 13.1 / 6.9) reflect Shopify reorders, not subscription renewals.
- Date range (2021-05-10 – 2026-05-11) is fixed to Shopify order history, not subscription signup history.

You want the funnel built from the actual subscription platforms: **Juo (NL)** and **Loop (UK + US)**.

## Approach

Add a new server fetcher `fetchSubscriptionRepeatFunnel` that builds the funnel from Juo + Loop subscription data, and switch the dashboard card to prefer it over the Shopify one.

### Cohort definition
- Cohort month = month a subscription was **created** (`createdAt`).
- Cohort size = number of subscribers whose first subscription was created in that month, summed across Juo NL + Loop UK + Loop US.
- Repeat to Nth order = % of cohort whose subscription has completed ≥ N billing cycles (i.e. ≥ N successful orders).

### Data sources
- **Juo**: pull ALL subscriptions (`status=active`, `paused`, `canceled`) — current fetcher only pulls active, which would under-count past cohorts. Read cycle count from the first available field: `cyclesCompleted` / `completedCycles` / `totalCycles` / `currentCycleNumber` / `orderCycles`. Default to 1 if none present.
- **Loop**: already fetches ACTIVE + CANCELLED. Read cycles from: `totalSuccessOrders` / `completedCycles` / `cycleNumber` / `currentCycleNumber` / `totalOrders`. Default to 1.

### Output shape
Match the existing `shopifyRepeatFunnel` payload so the card needs minimal changes:

```text
{
  calcVersion: 6,
  cohortSize: <lifetime sum of all cohort sizes>,
  sourceStart: <earliest cohort month>,
  sourceEnd: <latest mature month>,
  funnel: [{ order, customers, rate, maturing }, … up to 7],
  monthlyCohorts: [{ month, size, second, third, fourth, avgOrders, maturing }, …]
}
```

A subscription cohort is considered "mature" for Nth-order checks if its month is ≥ N months ago (one billing cycle per month, with a safety buffer).

### Wiring
1. New fetcher exported from `src/server/fetchers.server.ts`.
2. Cache it under `subscription:repeat_funnel` in `dashboard.functions.ts` (same shape as the existing entry).
3. Expose as `subscriptionRepeatFunnel` on the dashboard payload.
4. In `FinanceDashboard.tsx`, the Repeat purchase funnel card reads `subscriptionRepeatFunnel ?? shopifyRepeatFunnel` and updates the subtitle/source label to "Juo NL + Loop UK + Loop US subscription cohorts" when the new one is used.
5. The "Cohort size" line uses the actual subscription-cohort total (no more 62,121 Shopify number).

## Technical Notes

- The Juo fetcher needs an extra pass to pull non-active subscriptions for cohort coverage; today it skips them deliberately for MRR accuracy. The new pass writes into a separate array used only by the funnel — MRR math is untouched.
- Cycle-count field names are not documented; the fetcher tries the candidates above and logs which one it found on first run so we can lock it in.
- "Avg orders" per cohort uses the mean cycles-completed of that cohort.
- The 2nd-order figure for a cohort created < 1 full month ago is shown as "still maturing".

## Out of Scope

- Shopify-only funnel stays in the code for non-subscription tenants; we just stop showing it on this dashboard.
- Loop EU / future Juo markets get included automatically when their keys exist.
