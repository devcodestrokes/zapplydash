import { useState, useEffect, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Plug, CircleAlert, ChevronRight, LayoutDashboard, ExternalLink, Bug, CheckCircle2, AlertTriangle, XCircle, MinusCircle } from "lucide-react";
import { getSyncDebug } from "@/server/debug.functions";

const SHOPIFY_STORES = [
  { id: "shopify_zapply-nl",      name: "Shopify NL", flag: "🇳🇱", shop: "zapply-nl.myshopify.com",      desc: "Netherlands · orders, revenue" },
  { id: "shopify_zapplyde",       name: "Shopify UK", flag: "🇬🇧", shop: "zapplyde.myshopify.com",       desc: "United Kingdom · orders, revenue" },
  { id: "shopify_zapply-usa",     name: "Shopify US", flag: "🇺🇸", shop: "zapply-usa.myshopify.com",     desc: "United States · orders, revenue" },
  { id: "shopify_zapplygermany",  name: "Shopify EU", flag: "🇩🇪", shop: "zapplygermany.myshopify.com",  desc: "Germany / EU · orders, revenue" },
];

const API_KEY_SOURCES = [
  {
    id: "loop",
    name: "Loop Subscriptions",
    desc: "MRR, active subs, churn, repeat rates",
    api: "REST · LOOP_UK_API_KEY",
    color: "#7C3AED",
    docsUrl: "https://developers.loopreturns.com",
  },
  {
    id: "triplewhale",
    name: "Triple Whale",
    desc: "Ad spend, ROAS, NCPA, 90D/365D LTV",
    api: "REST v2 · TRIPLE_WHALE_API_KEY",
    color: "#6366f1",
    docsUrl: "https://developers.triplewhale.com",
  },
  {
    id: "jortt",
    name: "Jortt",
    desc: "Revenue reconciliation · invoice data",
    api: "client_credentials · JORTT_CLIENT_ID/SECRET",
    color: "#00A6A6",
    note: "Bridge connector · Xero replacing within ~1 month",
    docsUrl: "https://developer.jortt.nl",
  },
];

function StatusPill({ status }) {
  if (status === "connected")
    return (
      <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Connected
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500">
      <span className="h-1.5 w-1.5 rounded-full bg-neutral-400" />Not connected
    </span>
  );
}

export default function SyncView({ initialConnections = {} }) {
  const [connections, setConnections] = useState(initialConnections);
  const [syncing, setSyncing] = useState(false);

  const [xeroError, setXeroError] = useState(null);
  const [debug, setDebug] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);

  const fetchDebug = useServerFn(getSyncDebug);

  const refreshDebug = useCallback(async () => {
    setDebugLoading(true);
    try {
      const d = await fetchDebug();
      setDebug(d);
    } catch (err) {
      console.error("debug fetch failed", err);
    } finally {
      setDebugLoading(false);
    }
  }, [fetchDebug]);

  // Pick up ?connected= or ?error= from OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    if (connected) {
      setConnections((c) => ({ ...c, [connected]: "connected" }));
      window.history.replaceState({}, "", "/?view=sync");
    }
    if (params.get("error")) {
      window.history.replaceState({}, "", "/?view=sync");
    }
    // Xero-specific params
    if (params.get("xero_connected")) {
      setConnections((c) => ({ ...c, xero: "connected" }));
      window.history.replaceState({}, "", "/?view=sync");
    }
    if (params.get("xero_error")) {
      setXeroError(params.get("xero_error"));
      window.history.replaceState({}, "", "/?view=sync");
    }
    // Initial load
    void refreshDebug();
  }, [refreshDebug]);

  async function syncAll() {
    setSyncing(true);
    try {
      // Try /api/sync first; fall back to /api/public/sync (which is exposed
      // without auth in published builds).
      let res = await fetch("/api/sync", { method: "POST" }).catch(() => null);
      if (!res || !res.ok) {
        res = await fetch("/api/public/sync", { method: "POST" }).catch(() => null);
      }
    } finally {
      // Poll the debug endpoint a few times so the panel updates as
      // background jobs finish writing to the cache.
      for (const delay of [1500, 4000, 8000]) {
        setTimeout(() => void refreshDebug(), delay);
      }
      setTimeout(() => setSyncing(false), 1500);
    }
  }

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Connections</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Sync status</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Connect your data sources to replace mock data with live numbers.
          </p>
        </div>
        <button
          onClick={syncAll}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          Sync all now
        </button>
      </div>

      {/* Shopify stores */}
      <div className="mt-6">
        <div className="mb-2 text-[12px] font-semibold text-neutral-400 uppercase tracking-wide">Shopify stores</div>
        <div className="space-y-3">
          {SHOPIFY_STORES.map((src) => {
            const status = connections[src.id] ?? "disconnected";
            return (
              <div key={src.id} className="rounded-xl border border-neutral-200 bg-white p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: "#95BF4718" }}>
                      <span className="text-lg">{src.flag}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold">{src.name}</span>
                        <StatusPill status={status} />
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">{src.desc}</div>
                      <div className="mt-0.5 text-[11px] text-neutral-400 font-mono">{src.shop}</div>
                    </div>
                  </div>
                  <div className="shrink-0">
                    {status === "connected" ? (
                      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                        Live ✓
                      </span>
                    ) : (
                      <a
                        href={`/api/shopify/install?shop=${src.shop}`}
                        className="rounded-lg border border-[#95BF47] bg-[#95BF47] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#85af37]"
                      >
                        Connect store
                      </a>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* API-key based sources */}
      <div className="mt-6">
        <div className="mb-2 text-[12px] font-semibold text-neutral-400 uppercase tracking-wide">API key sources</div>
        <div className="space-y-3">
          {API_KEY_SOURCES.map((src) => {
            const status = connections[src.id] ?? "disconnected";
            return (
              <div key={src.id} className="rounded-xl border border-neutral-200 bg-white p-5">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: `${src.color}18` }}>
                      <Plug size={18} style={{ color: src.color }} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[14px] font-semibold">{src.name}</span>
                        <StatusPill status={status} />
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">{src.desc}</div>
                      <div className="mt-0.5 text-[11px] text-neutral-400">{src.api}</div>
                      {src.note && (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                          <CircleAlert size={11} />
                          {src.note}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {src.id === "jortt" ? (
                      status === "connected" ? (
                        <div className="flex flex-col items-end gap-1.5">
                          <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                            Live ✓
                          </span>
                          <a
                            href="/api/auth/jortt"
                            className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
                          >
                            Re-authorize
                          </a>
                        </div>
                      ) : (
                        <a
                          href="/api/auth/jortt"
                          className="rounded-lg border px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
                          style={{ backgroundColor: src.color, borderColor: src.color }}
                        >
                          Connect Jortt
                        </a>
                      )
                    ) : status === "connected" ? (
                      <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                        Live ✓
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[12px] font-medium text-neutral-500">
                          Add keys to .env.local
                        </span>
                        <a
                          href={src.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-medium text-neutral-600 hover:bg-neutral-50"
                        >
                          Docs <ExternalLink size={11} />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Xero accounting */}
      <div className="mt-6">
        <div className="mb-2 text-[12px] font-semibold text-neutral-400 uppercase tracking-wide">Accounting</div>
        <div className="rounded-xl border border-neutral-200 bg-white p-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: "#13B5EA18" }}>
                <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                  <circle cx="16" cy="16" r="16" fill="#13B5EA" />
                  <text x="16" y="21" textAnchor="middle" fill="white" fontSize="13" fontWeight="700" fontFamily="sans-serif">X</text>
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold">Xero</span>
                  <StatusPill status={connections["xero"] ?? "disconnected"} />
                </div>
                <div className="mt-0.5 text-[12px] text-neutral-500">P&amp;L, Balance Sheet, Bank accounts, Invoices</div>
                <div className="mt-0.5 text-[11px] text-neutral-400">OAuth 2.0 · accounting.reports.read · accounting.transactions</div>
                {xeroError && (
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-700">
                    <CircleAlert size={11} />
                    Auth error: {xeroError}
                  </div>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {connections["xero"] === "connected" ? (
                <div className="flex flex-col items-end gap-1.5">
                  <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700">
                    Live ✓
                  </span>
                  <a
                    href="/api/auth/xero"
                    className="rounded-md border border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-600 hover:bg-neutral-50"
                  >
                    Re-authorize
                  </a>
                </div>
              ) : (
                <a
                  href="/api/auth/xero"
                  className="rounded-lg border border-[#13B5EA] bg-[#13B5EA] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#0fa3d6]"
                >
                  Connect Xero
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Data flow diagram */}
      <div className="mt-6 rounded-xl border border-neutral-200 bg-white p-6">
        <div className="mb-4">
          <div className="text-[13px] font-semibold">Data flow</div>
          <div className="text-[12px] text-neutral-400">How data moves from source to dashboard.</div>
        </div>
        <div className="flex items-center justify-between gap-2 overflow-x-auto py-4">
          {[
            { label: "Shopify", color: "#95BF47", desc: "4 stores" },
            { label: "Triple Whale", color: "#6366f1", desc: "Ad metrics" },
            { label: "Loop", color: "#7C3AED", desc: "Subscriptions" },
            { label: "Jortt", color: "#00A6A6", desc: "Accounting" },
            { label: "Xero", color: "#13B5EA", desc: "Accounting" },
          ].map((s, i, arr) => (
            <div key={s.label} className="flex items-center gap-2 flex-1 min-w-0">
              <div className="flex flex-col items-center min-w-[90px]">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm" style={{ backgroundColor: `${s.color}15` }}>
                  <Plug size={18} style={{ color: s.color }} />
                </div>
                <div className="mt-1.5 text-[11px] font-semibold text-center">{s.label}</div>
                <div className="text-[10px] text-neutral-400 text-center">{s.desc}</div>
                {s.sublabel && <div className="text-[10px] text-[#13B5EA] font-medium">{s.sublabel}</div>}
              </div>
              {i < arr.length - 1 && (
                <div className="flex flex-1 items-center">
                  <div className="h-px flex-1 bg-neutral-200" />
                  <ChevronRight size={12} className="text-neutral-300" />
                </div>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center">
              <div className="h-px w-8 bg-neutral-200" />
              <ChevronRight size={12} className="text-neutral-300" />
            </div>
            <div className="flex flex-col items-center min-w-[90px]">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-sm">
                <LayoutDashboard size={18} />
              </div>
              <div className="mt-1.5 text-[11px] font-semibold">Dashboard</div>
              <div className="text-[10px] text-neutral-400">Reconciled</div>
            </div>
          </div>
        </div>
      </div>

      {/* Setup notes */}
      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-[12px] text-blue-700">
          <div className="font-semibold mb-1">Shopify OAuth setup</div>
          In your <strong>Shopify Partner Dashboard</strong>, register the redirect URI:
          <code className="ml-1 rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px]">http://localhost:3001/api/shopify/callback</code>.
          Then click <strong>Connect store</strong> above for each store.
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-[12px] text-blue-700">
          <div className="font-semibold mb-1">First-time database setup</div>
          Run <code className="rounded bg-blue-100 px-1 py-0.5 font-mono text-[11px]">supabase/migrations/001_integrations.sql</code> in your Supabase SQL editor to create the integrations table.
        </div>
        <div className="rounded-xl border border-[#13B5EA30] bg-[#13B5EA08] p-4 text-[12px] text-[#0e8fb5]">
          <div className="font-semibold mb-1">Xero OAuth setup</div>
          In your <strong>Xero Developer portal</strong>, add this redirect URI:
          <code className="ml-1 rounded bg-[#13B5EA15] px-1 py-0.5 font-mono text-[11px]">http://localhost:3001/api/auth/xero/callback</code>
          <br />Then click <strong>Connect Xero</strong> above. You will be redirected to Xero to authorize, and tokens will be saved automatically.
        </div>
      </div>
    </>
  );
}
