import { createServerFn } from "@tanstack/react-start";
import { readAllCache, ageMinutes, getWriteErrors } from "./cache.server";

export interface ProviderDebug {
  provider: string;
  key: string;
  id: string;
  status: "live" | "empty" | "error" | "missing";
  fetchedAt: string | null;
  ageMinutes: number | null;
  payloadSize: number;
  emptyMarker: boolean;
  errorMarker: boolean;
  errorMessage: string | null;
  writeError: { message: string; at: string } | null;
}

const TRACKED: Array<{ provider: string; key: string }> = [
  { provider: "shopify", key: "markets" },
  { provider: "shopify", key: "monthly" },
  { provider: "shopify", key: "today" },
  { provider: "triplewhale", key: "summary" },
  { provider: "loop", key: "subscriptions" },
  { provider: "juo", key: "subscriptions" },
  { provider: "jortt", key: "invoices" },
  { provider: "xero", key: "accounting" },
];

export const getSyncDebug = createServerFn({ method: "GET" }).handler(async () => {
  const cache = await readAllCache();
  const writeErrors = getWriteErrors();

  const providers: ProviderDebug[] = TRACKED.map(({ provider, key }) => {
    const id = `${provider}/${key}`;
    const entry = cache[id] ?? null;
    const payload: any = entry?.payload ?? null;
    const writeErr = writeErrors[id] ?? null;

    const emptyMarker = !!payload && payload.__empty === true;
    const errorMarker = !!payload && payload.__error === true;
    const errorMessage =
      errorMarker && typeof payload?.message === "string" ? payload.message : null;

    let status: ProviderDebug["status"];
    if (!entry) status = "missing";
    else if (errorMarker) status = "error";
    else if (emptyMarker) status = "empty";
    else status = "live";

    const payloadSize = entry ? JSON.stringify(payload ?? null).length : 0;

    return {
      provider,
      key,
      id,
      status,
      fetchedAt: entry?.fetchedAt ?? null,
      ageMinutes: entry ? Math.round(ageMinutes(entry.fetchedAt)) : null,
      payloadSize,
      emptyMarker,
      errorMarker,
      errorMessage,
      writeError: writeErr,
    };
  });

  // Most recent successful write across all providers.
  const successfulFetches = providers
    .filter((p) => p.fetchedAt && p.status === "live")
    .map((p) => p.fetchedAt as string);
  const lastSuccessAt =
    successfulFetches.length > 0
      ? successfulFetches.reduce((a, b) => (a > b ? a : b))
      : null;

  // Most recent write of any kind.
  const allFetches = providers.filter((p) => p.fetchedAt).map((p) => p.fetchedAt as string);
  const lastWriteAt =
    allFetches.length > 0 ? allFetches.reduce((a, b) => (a > b ? a : b)) : null;

  return {
    providers,
    lastSuccessAt,
    lastWriteAt,
    writeErrorCount: Object.keys(writeErrors).length,
    generatedAt: new Date().toISOString(),
  };
});
