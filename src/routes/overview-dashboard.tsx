import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  DollarSign,
  ShoppingCart,
  Receipt,
  TrendingUp,
  Wallet,
  Sparkles,
  Target,
  Megaphone,
  Package,
  ChevronDown,
  ChevronRight,
  CalendarIcon,
  Loader2,
  Check,
  Repeat,
  Users,
  UserPlus,
  UserMinus,
  CalendarClock,
  PieChart,
  TrendingDown,
} from "lucide-react";
import { getTripleWhaleRange, getTripleWhaleProgress } from "@/server/dashboard.functions";
import { DashboardShell } from "@/components/DashboardShell";
import { useDashboardSession } from "@/components/dashboard/useDashboardSession";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRESETS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "mtd",
  "last_month",
  "90d",
  "ytd",
  "custom",
] as const;

type SearchParams = { preset: Preset; from: string; to: string };

const searchSchema = z.object({
  preset: z.enum(PRESETS).catch("mtd").default("mtd"),
  from: z.string().catch("").default(""),
  to: z.string().catch("").default(""),
});

export const Route = createFileRoute("/overview-dashboard")({
  validateSearch: (input: Record<string, unknown>): SearchParams =>
    searchSchema.parse(input),
  head: () => ({
    meta: [
      { title: "Overview Dashboard — Zapply" },
      { name: "description", content: "Zapply Group B.V. — Overview Dashboard" },
    ],
  }),
  component: OverviewDashboardPage,
});

type Preset = (typeof PRESETS)[number];

type TWRow = {
  market: string;
  flag?: string;
  live?: boolean;
  revenue?: number | null;
  netRevenue?: number | null;
  orders?: number | null;
  grossProfit?: number | null;
  cogs?: number | null;
  netProfit?: number | null;
  adSpend?: number | null;
  facebookSpend?: number | null;
  googleSpend?: number | null;
  tiktokSpend?: number | null;
  snapchatSpend?: number | null;
  pinterestSpend?: number | null;
  bingSpend?: number | null;
  klaviyoSpend?: number | null;
  appleSpend?: number | null;
  amazonSpend?: number | null;
  linkedinSpend?: number | null;
  twitterSpend?: number | null;
  youtubeSpend?: number | null;
  redditSpend?: number | null;
  outbrainSpend?: number | null;
  taboolaSpend?: number | null;
  criteoSpend?: number | null;
  influencerSpend?: number | null;
  customSpend?: number | null;
  aov?: number | null;
  roas?: number | null;
  // Subscriptions
  subRevenue?: number | null;
  subOrders?: number | null;
  activeSubscribers?: number | null;
  newSubscribers?: number | null;
  cancelledSubs?: number | null;
  mrr?: number | null;
  churnRate?: number | null;
};

const CURRENCIES = [
  { code: "EUR", symbol: "€", flag: "🇪🇺" },
  { code: "USD", symbol: "$", flag: "🇺🇸" },
  { code: "GBP", symbol: "£", flag: "🇬🇧" },
  { code: "AUD", symbol: "A$", flag: "🇦🇺" },
  { code: "CAD", symbol: "C$", flag: "🇨🇦" },
  { code: "CHF", symbol: "CHF ", flag: "🇨🇭" },
  { code: "JPY", symbol: "¥", flag: "🇯🇵" },
  { code: "SEK", symbol: "kr ", flag: "🇸🇪" },
] as const;
type CurrencyCode = (typeof CURRENCIES)[number]["code"];

const makeFmtCurrency =
  (rate: number, symbol: string) => (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n)
      ? `${symbol}${Math.round(n * rate).toLocaleString()}`
      : "—";
const makeFmtCurrency2 =
  (rate: number, symbol: string) => (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n)
      ? `${symbol}${(n * rate).toFixed(2)}`
      : "—";
const fmtNumber = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? n.toLocaleString() : "—";
const fmtMultiplier = (n: number | null | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(2)}×` : "—";

const sumField = (rows: TWRow[], field: keyof TWRow): number | null => {
  const vals = rows
    .filter((r) => r.live)
    .map((r) => r[field])
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
};

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function resolveRange(
  preset: Preset,
  customFrom: string,
  customTo: string
): { from: string; to: string; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today), label: "Today" };
    case "yesterday": {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { from: iso(y), to: iso(y), label: "Yesterday" };
    }
    case "7d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 6);
      return { from: iso(f), to: iso(today), label: "Last 7 days" };
    }
    case "30d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 29);
      return { from: iso(f), to: iso(today), label: "Last 30 days" };
    }
    case "90d": {
      const f = new Date(today);
      f.setDate(f.getDate() - 89);
      return { from: iso(f), to: iso(today), label: "Last 90 days" };
    }
    case "mtd":
      return {
        from: iso(startOfMonth),
        to: iso(today),
        label: "Month to date",
      };
    case "last_month": {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: iso(f), to: iso(t), label: "Last month" };
    }
    case "ytd":
      return { from: iso(startOfYear), to: iso(today), label: "Year to date" };
    case "custom":
      return {
        from: customFrom || iso(startOfMonth),
        to: customTo || iso(today),
        label: "Custom range",
      };
  }
}

function OverviewDashboardPage() {
  const { user, loading } = useDashboardSession();
  const search = Route.useSearch();
  const range = useMemo(
    () => resolveRange(search.preset, search.from, search.to),
    [search.preset, search.from, search.to]
  );

  const [tw, setTw] = useState<TWRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [currency, setCurrency] = useState<CurrencyCode>("EUR");
  const [fxRate, setFxRate] = useState<number>(1);
  const [progress, setProgress] = useState<{
    total: number;
    fetched: number;
    remaining: number;
    stores: Array<{ market: string; flag: string; status: "pending" | "done" | "error" }>;
    done: boolean;
  } | null>(null);

  // Fetch EUR -> selected currency rate (server data is already EUR)
  useEffect(() => {
    if (currency === "EUR") {
      setFxRate(1);
      return;
    }
    let cancelled = false;
    fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${currency}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const rate = d?.rates?.[currency];
        if (typeof rate === "number" && Number.isFinite(rate)) setFxRate(rate);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currency]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoadingData(true);
    setErrorMsg(null);
    setProgress(null);

    // Poll progress every 600ms while the fetch is in flight
    const pollId = window.setInterval(() => {
      getTripleWhaleProgress({ data: { from: range.from, to: range.to } })
        .then((p) => {
          if (cancelled) return;
          if (p.total > 0) setProgress(p);
        })
        .catch(() => {});
    }, 600);

    getTripleWhaleRange({ data: { from: range.from, to: range.to } })
      .then((res) => {
        if (cancelled) return;
        setTw((res.rows ?? []) as TWRow[]);
        setErrorMsg(res.error);
      })
      .catch(() => {
        if (cancelled) return;
        setErrorMsg("Failed to load data");
        setTw([]);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingData(false);
          setProgress(null);
        }
        window.clearInterval(pollId);
      });
    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [user, range.from, range.to]);

  // Render the shell immediately — show skeletons inside instead of a blank page.
  // This avoids the "Loading dashboard…" blank screen while session/data resolve.
  const shellUser = user ?? {
    email: "",
    name: "Loading…",
    avatar: null,
  };

  const isRefreshing = loadingData && tw.length > 0;

  return (
    <DashboardShell user={shellUser} title="Overview Dashboard">
      <div className="p-6 space-y-6">
        <Header range={range} preset={search.preset} />
        <div className="flex items-center gap-3 flex-wrap">
          <DateRangeFilter
            preset={search.preset}
            from={range.from}
            to={range.to}
          />
          <CurrencySelect value={currency} onChange={setCurrency} />
          {isRefreshing && (
            <div className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing…
            </div>
          )}
          {loadingData && progress && progress.total > 0 && (
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              <span className="font-medium">
                Fetching stores: {progress.fetched} / {progress.total}
              </span>
              <span className="text-muted-foreground">
                ({progress.remaining} remaining)
              </span>
              <span className="flex items-center gap-1">
                {progress.stores.map((s) => (
                  <span
                    key={s.market}
                    title={`${s.market} — ${s.status}`}
                    className={
                      s.status === "done"
                        ? "opacity-100"
                        : s.status === "error"
                        ? "opacity-60 grayscale"
                        : "opacity-30 animate-pulse"
                    }
                  >
                    {s.flag}
                  </span>
                ))}
              </span>
            </div>
          )}
        </div>
        {errorMsg && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMsg}
          </div>
        )}
        <DashboardBody
          tw={tw}
          loading={loadingData || loading || !user}
          currency={currency}
          fxRate={fxRate}
        />
      </div>
    </DashboardShell>
  );
}

function Header({
  range,
  preset,
}: {
  range: { from: string; to: string; label: string };
  preset: Preset;
}) {
  return (
    <div>
      <div className="text-[12px] font-medium text-muted-foreground">
        Overview Dashboard
      </div>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight">
        All stores at a glance
      </h1>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Aggregated KPIs from Triple Whale across every connected store, with
        per-store breakdowns. Showing{" "}
        <span className="font-medium text-foreground">
          {range.label.toLowerCase()}
        </span>{" "}
        ({range.from} → {range.to}).
        {preset === "custom" ? "" : ""}
      </p>
    </div>
  );
}

const PRESET_BUTTONS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "mtd", label: "MTD" },
  { key: "last_month", label: "Last month" },
  { key: "90d", label: "90D" },
  { key: "ytd", label: "YTD" },
];

function DateRangeFilter({
  preset,
  from,
  to,
}: {
  preset: Preset;
  from: string;
  to: string;
}) {
  const navigate = useNavigate({ from: "/overview-dashboard" });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Draft state — selections do NOT trigger fetches until Apply is clicked
  const [draftPreset, setDraftPreset] = useState<Preset>(preset);
  const [draftFrom, setDraftFrom] = useState<Date | undefined>(
    from ? new Date(from) : undefined
  );
  const [draftTo, setDraftTo] = useState<Date | undefined>(
    to ? new Date(to) : undefined
  );

  // Sync drafts when URL changes externally (e.g. back/forward)
  useEffect(() => {
    setDraftPreset(preset);
    setDraftFrom(from ? new Date(from) : undefined);
    setDraftTo(to ? new Date(to) : undefined);
  }, [preset, from, to]);

  const dirty =
    draftPreset !== preset ||
    (draftPreset === "custom" &&
      (!draftFrom ||
        !draftTo ||
        iso(draftFrom) !== from ||
        iso(draftTo) !== to));

  const apply = () => {
    if (draftPreset === "custom") {
      if (!draftFrom || !draftTo) return;
      navigate({
        search: (prev: SearchParams) => ({
          ...prev,
          preset: "custom" as const,
          from: iso(draftFrom),
          to: iso(draftTo),
        }),
      });
    } else {
      navigate({
        search: (prev: SearchParams) => ({
          ...prev,
          preset: draftPreset,
          from: "",
          to: "",
        }),
      });
    }
    setPickerOpen(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {PRESET_BUTTONS.map((b) => (
          <button
            key={b.key}
            onClick={() => setDraftPreset(b.key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] font-medium transition",
              draftPreset === b.key
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            {b.label}
          </button>
        ))}
      </div>

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDraftPreset("custom")}
            className={cn(
              "h-8 gap-1.5 text-[12px]",
              draftPreset === "custom" && "border-foreground"
            )}
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {draftPreset === "custom" && draftFrom && draftTo
              ? `${iso(draftFrom)} → ${iso(draftTo)}`
              : "Custom range"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Select start & end date
            </div>
            <Calendar
              mode="range"
              selected={{ from: draftFrom, to: draftTo }}
              onSelect={(r: any) => {
                setDraftPreset("custom");
                setDraftFrom(r?.from);
                setDraftTo(r?.to);
              }}
              numberOfMonths={2}
              initialFocus
              className={cn("p-0 pointer-events-auto")}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPickerOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        size="sm"
        onClick={apply}
        disabled={
          !dirty || (draftPreset === "custom" && (!draftFrom || !draftTo))
        }
        className="h-8 gap-1.5 text-[12px]"
      >
        <Check className="h-3.5 w-3.5" />
        Apply
      </Button>
    </div>
  );
}

function CurrencySelect({
  value,
  onChange,
}: {
  value: CurrencyCode;
  onChange: (c: CurrencyCode) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = CURRENCIES.find((c) => c.code === value) ?? CURRENCIES[0];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
        >
          <span>{current.flag}</span>
          <span className="font-medium">{current.code}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        <ul className="max-h-72 overflow-auto">
          {CURRENCIES.map((c) => (
            <li key={c.code}>
              <button
                onClick={() => {
                  onChange(c.code);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent",
                  c.code === value && "bg-accent font-medium"
                )}
              >
                <span>{c.flag}</span>
                <span>{c.code}</span>
                <span className="ml-auto text-muted-foreground">
                  {c.symbol.trim()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function DashboardBody({
  tw,
  loading,
  currency,
  fxRate,
}: {
  tw: TWRow[];
  loading: boolean;
  currency: CurrencyCode;
  fxRate: number;
}) {
  const symbol =
    CURRENCIES.find((c) => c.code === currency)?.symbol ?? "€";
  const fmtCurrency = makeFmtCurrency(fxRate, symbol);
  const fmtCurrency2 = makeFmtCurrency2(fxRate, symbol);

  const liveRows = tw.filter((r) => r.live);
  const hasData = liveRows.length > 0;

  const totalRevenue = sumField(tw, "revenue");
  const totalNetRevenue = sumField(tw, "netRevenue");
  const totalOrders = sumField(tw, "orders");
  const totalGrossProfit = sumField(tw, "grossProfit");
  const totalCogs = sumField(tw, "cogs");
  const totalNetProfit = sumField(tw, "netProfit");
  const totalAdSpend = sumField(tw, "adSpend");
  const totalAov =
    totalRevenue && totalOrders ? totalRevenue / totalOrders : null;
  const blendedRoas =
    totalRevenue && totalAdSpend ? totalRevenue / totalAdSpend : null;

  const widgets = [
    {
      label: "Total sales",
      value: fmtCurrency(totalNetRevenue ?? totalRevenue),
      sub: "Net sales · after discounts & refunds",
      icon: Receipt,
      accent: "text-teal-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.netRevenue ?? r.revenue ?? null),
      })),
    },
    {
      label: "Revenue",
      value: fmtCurrency(totalRevenue),
      sub: "Gross · all stores · selected range",
      icon: DollarSign,
      accent: "text-emerald-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.revenue ?? null),
      })),
    },
    {
      label: "Orders",
      value: fmtNumber(totalOrders),
      sub: "All stores · selected range",
      icon: ShoppingCart,
      accent: "text-blue-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.orders ?? null),
      })),
    },
    {
      label: "Gross profit",
      value: fmtCurrency(totalGrossProfit),
      sub:
        totalRevenue && totalGrossProfit
          ? `${((totalGrossProfit / totalRevenue) * 100).toFixed(1)}% margin`
          : "Triple Whale",
      icon: TrendingUp,
      accent: "text-emerald-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.grossProfit ?? null),
      })),
    },
    {
      label: "COGS",
      value: fmtCurrency(totalCogs),
      sub:
        totalRevenue && totalCogs
          ? `${((totalCogs / totalRevenue) * 100).toFixed(1)}% of revenue`
          : "Triple Whale",
      icon: Package,
      accent: "text-amber-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.cogs ?? null),
      })),
    },
    {
      label: "Net profit",
      value: fmtCurrency(totalNetProfit),
      sub:
        totalRevenue && totalNetProfit
          ? `${((totalNetProfit / totalRevenue) * 100).toFixed(1)}% margin`
          : "Triple Whale",
      icon: Wallet,
      accent: "text-emerald-700",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.netProfit ?? null),
      })),
    },
    {
      label: "Ad spend",
      value: fmtCurrency(totalAdSpend),
      sub: "Blended · all channels",
      icon: Megaphone,
      accent: "text-rose-600",
      breakdown: liveRows.map((r) => {
        const platforms = [
          { key: "Meta", value: r.facebookSpend },
          { key: "Google", value: r.googleSpend },
          { key: "TikTok", value: r.tiktokSpend },
          { key: "Snapchat", value: r.snapchatSpend },
          { key: "Pinterest", value: r.pinterestSpend },
          { key: "Bing / Microsoft", value: r.bingSpend },
          { key: "Apple Search", value: r.appleSpend },
          { key: "Amazon", value: r.amazonSpend },
          { key: "LinkedIn", value: r.linkedinSpend },
          { key: "Twitter / X", value: r.twitterSpend },
          { key: "YouTube", value: r.youtubeSpend },
          { key: "Reddit", value: r.redditSpend },
          { key: "Outbrain", value: r.outbrainSpend },
          { key: "Taboola", value: r.taboolaSpend },
          { key: "Criteo", value: r.criteoSpend },
          { key: "Influencer", value: r.influencerSpend },
          { key: "Klaviyo", value: r.klaviyoSpend },
          { key: "Other / Custom", value: r.customSpend },
        ]
          .filter((p) => typeof p.value === "number" && Number.isFinite(p.value) && (p.value as number) > 0)
          .map((p) => ({ market: p.key, value: fmtCurrency(p.value ?? null) }));
        return {
          market: r.market,
          flag: r.flag,
          value: fmtCurrency(r.adSpend ?? null),
          children: platforms,
        };
      }),
    },
    {
      label: "AOV",
      value: fmtCurrency2(totalAov),
      sub: "Average order value",
      icon: Target,
      accent: "text-indigo-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency2(r.aov ?? null),
      })),
    },
    {
      label: "ROAS",
      value: fmtMultiplier(blendedRoas),
      sub: "Blended return on ad spend",
      icon: Sparkles,
      accent: "text-purple-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtMultiplier(r.roas ?? null),
      })),
    },
  ];

  // ---- Subscriptions ----
  const totalSubRevenue = sumField(tw, "subRevenue");
  const totalSubOrders = sumField(tw, "subOrders");
  const totalActiveSubs = sumField(tw, "activeSubscribers");
  const totalNewSubs = sumField(tw, "newSubscribers");
  const totalCancelledSubs = sumField(tw, "cancelledSubs");
  const totalMrr = sumField(tw, "mrr");
  // Average churn across stores that report it
  const churnVals = liveRows
    .map((r) => r.churnRate)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const avgChurn =
    churnVals.length > 0
      ? churnVals.reduce((a, b) => a + b, 0) / churnVals.length
      : null;
  const subShare =
    totalRevenue && totalSubRevenue ? (totalSubRevenue / totalRevenue) * 100 : null;

  const fmtPct = (n: number | null) =>
    typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1)}%` : "—";

  const subWidgets = [
    {
      label: "Subscription revenue",
      value: fmtCurrency(totalSubRevenue),
      sub:
        subShare != null
          ? `${subShare.toFixed(1)}% of total revenue`
          : "Recurring revenue",
      icon: Repeat,
      accent: "text-emerald-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.subRevenue ?? null),
      })),
    },
    {
      label: "Subscription orders",
      value: fmtNumber(totalSubOrders),
      sub: "Orders on a subscription",
      icon: ShoppingCart,
      accent: "text-blue-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.subOrders ?? null),
      })),
    },
    {
      label: "Active subscribers",
      value: fmtNumber(totalActiveSubs),
      sub: "Currently active contracts",
      icon: Users,
      accent: "text-indigo-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.activeSubscribers ?? null),
      })),
    },
    {
      label: "New subscribers",
      value: fmtNumber(totalNewSubs),
      sub: "Started in this period",
      icon: UserPlus,
      accent: "text-emerald-700",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.newSubscribers ?? null),
      })),
    },
    {
      label: "Cancelled subscribers",
      value: fmtNumber(totalCancelledSubs),
      sub: "Cancelled in this period",
      icon: UserMinus,
      accent: "text-rose-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtNumber(r.cancelledSubs ?? null),
      })),
    },
    {
      label: "MRR",
      value: fmtCurrency(totalMrr),
      sub: "Monthly recurring revenue",
      icon: CalendarClock,
      accent: "text-purple-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtCurrency(r.mrr ?? null),
      })),
    },
    {
      label: "Churn rate",
      value: fmtPct(avgChurn),
      sub: "Avg across stores",
      icon: TrendingDown,
      accent: "text-amber-600",
      breakdown: liveRows.map((r) => ({
        market: r.market,
        flag: r.flag,
        value: fmtPct(r.churnRate ?? null),
      })),
    },
    {
      label: "Subs % of revenue",
      value: fmtPct(subShare),
      sub: "Share of total revenue",
      icon: PieChart,
      accent: "text-cyan-600",
      breakdown: liveRows.map((r) => {
        const share =
          r.revenue && r.subRevenue ? (r.subRevenue / r.revenue) * 100 : null;
        return {
          market: r.market,
          flag: r.flag,
          value: fmtPct(share),
        };
      }),
    },
  ];

  if (loading && !hasData) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <div
            key={w.label}
            className="rounded-xl border border-border bg-card p-5 animate-pulse"
          >
            <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <w.icon size={14} className={w.accent} />
              <span>{w.label}</span>
            </div>
            <div className="mt-3 h-8 w-2/3 rounded bg-muted" />
            <div className="mt-2 h-3 w-1/2 rounded bg-muted/70" />
            <div className="mt-4 border-t border-border pt-3 space-y-2">
              <div className="h-3 w-full rounded bg-muted/60" />
              <div className="h-3 w-5/6 rounded bg-muted/60" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      {!hasData && !loading && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
          No live Triple Whale data available for this range.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {widgets.map((w) => (
          <KpiWidget key={w.label} widget={w} />
        ))}
      </div>
    </>
  );
}

function KpiWidget({
  widget,
}: {
  widget: {
    label: string;
    value: string;
    sub?: string;
    icon: any;
    accent: string;
    breakdown: Array<{ market: string; flag?: string; value: string; children?: Array<{ market: string; value: string }> }>;
  };
}) {
  const [open, setOpen] = useState(true);
  const Icon = widget.icon;

  return (
    <div className="rounded-xl border border-border bg-card p-5 transition hover:border-foreground/20">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Icon size={14} className={widget.accent} />
        <span>{widget.label}</span>
      </div>
      <div className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">
        {widget.value}
      </div>
      {widget.sub && (
        <div className="mt-1 text-[12px] text-muted-foreground">
          {widget.sub}
        </div>
      )}

      {widget.breakdown.length > 0 && (
        <div className="mt-4 border-t border-border pt-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            <span>By store</span>
            {open ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {widget.breakdown.map((b) => (
                <li key={b.market} className="text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <span>{b.flag}</span>
                      <span className="font-medium text-foreground">
                        {b.market}
                      </span>
                    </span>
                    <span className="tabular-nums">{b.value}</span>
                  </div>
                  {b.children && b.children.length > 0 && (
                    <ul className="mt-1 ml-6 space-y-1 border-l border-border pl-3">
                      {b.children.map((c) => (
                        <li
                          key={c.market}
                          className="flex items-center justify-between text-[12px] text-muted-foreground"
                        >
                          <span>{c.market}</span>
                          <span className="tabular-nums">{c.value}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
