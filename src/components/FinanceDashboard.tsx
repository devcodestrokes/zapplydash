// @ts-nocheck
import React, { useEffect, useState, useMemo } from "react";
import SyncView from "./SyncView";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Target,
  Wallet,
  Calendar,
  Search,
  Settings,
  ChevronDown,
  ChevronRight,
  Command,
  LayoutDashboard,
  GitCompareArrows,
  Activity,
  Plug,
  CircleCheck,
  CircleAlert,
  CircleDot,
  Eye,
  EyeOff,
  RefreshCw,
  AlertTriangle,
  Info,
  Plus,
  Globe,
  CalendarDays,
  Scale,
  LineChart as LineChartIcon,
  Clock,
  Package,
  Truck,
  Zap,
  Sparkles,
  Receipt,
  Users2,
  Banknote,
  FileText,
  Briefcase,
  Building2,
  Landmark,
} from "lucide-react";

/* =========================================================================
   HELPERS
   ========================================================================= */

const formatValue = (value, format) => {
  switch (format) {
    case "currency":
      return `€${value.toLocaleString(undefined, { minimumFractionDigits: value % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 })}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "multiplier":
      return `${value.toFixed(2)}x`;
    case "decimal":
      return value.toFixed(2);
    case "number":
    default:
      return value.toLocaleString();
  }
};

const fmtCurrency = (n) => `€${Math.abs(n).toLocaleString()}`;
const fmtSigned = (n) => (n >= 0 ? `+€${n.toLocaleString()}` : `-€${Math.abs(n).toLocaleString()}`);

/* =========================================================================
   SMALL UI COMPONENTS
   ========================================================================= */

const Card = ({ children, className = "" }) => (
  <div className={`rounded-xl border border-neutral-200/70 bg-white ${className}`}>
    {children}
  </div>
);

const Chip = ({ active, children, onClick }) => (
  <button
    onClick={onClick}
    className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${
      active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
    }`}
  >
    {children}
  </button>
);

const NavItem = ({ icon: Icon, label, active, onClick, badge }) => (
  <button
    onClick={onClick}
    className={`group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] font-medium transition ${
      active ? "bg-neutral-100 text-neutral-900" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-900"
    }`}
  >
    <span className="flex items-center gap-2.5">
      <Icon size={14} strokeWidth={2} />
      {label}
    </span>
    {badge && (
      <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
        {badge}
      </span>
    )}
  </button>
);

const StatusDot = ({ status }) => {
  const colors = {
    ok: "bg-emerald-500",
    warning: "bg-amber-500",
    error: "bg-rose-500",
  };
  return (
    <span className="relative flex h-2 w-2">
      <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${colors[status]} opacity-40`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${colors[status]}`} />
    </span>
  );
};

/* =========================================================================
   BRAND ICONS — small source indicators
   ========================================================================= */

const BrandIcon = ({ brand, size = 14, className = "" }) => {
  const common = { width: size, height: size, viewBox: "0 0 24 24", xmlns: "http://www.w3.org/2000/svg", className };
  switch (brand) {
    case "shopify":
      return (
        <svg {...common}>
          <path fill="#95BF47" d="M15.337 3.967c-.026-.22-.22-.34-.38-.352-.156-.01-3.115-.054-3.115-.054s-2.478-2.407-2.724-2.652c-.246-.246-.726-.171-.913-.115-.003 0-.469.145-1.243.385-.13-.422-.322-.94-.596-1.46C5.486.188 4.31-.086 3.59.021c-.017.004-.085.028-.106.033C3.424.014 3.225-.032 3.004.02 2.583.115 2.22.387 1.973.783 1.621 1.35 1.424 2.17 1.37 3.355.49 3.627.015 3.78 0 3.78l4.635 15.894 13.253-2.895s-2.544-17.035-2.551-17.063zM9.24 2.58c-.596.183-1.25.387-1.905.59.187-.717.547-1.43 1.016-1.864.173-.16.404-.34.681-.444.26.545.37 1.322.208 1.718zm-2.26.699a20.76 20.76 0 0 0-2.03.629c.18-.868.523-1.735.942-2.307.155-.213.374-.45.631-.583.24.507.293 1.223.207 1.742zm-1.59-2.71c.242-.1.515-.115.69-.099-.253.129-.505.34-.739.619-.548.65-.972 1.66-1.14 2.636-.512.158-1.012.313-1.473.455.298-1.39 1.463-3.574 2.662-3.611zm1.41 8.957c.056.864 2.318 1.05 2.446 3.08.1 1.595-.846 2.686-2.21 2.771-1.636.103-2.538-.863-2.538-.863l.346-1.474s.908.686 1.632.64c.474-.03.644-.414.627-.686-.073-1.128-1.915-1.06-2.033-2.917-.098-1.561 1.023-3.145 3.265-3.287 1.057-.067 1.599.203 1.599.203l-.474 2.168s-.692-.317-1.513-.265c-1.204.076-1.217.837-1.204 1.08l.057.55zm5.64-5.93c-.6.185-1.193.368-1.78.55.005-.2.009-.393.009-.606 0-.56-.078-1.01-.202-1.365.5.064.842.644.99 1.135.08.273.15.549.209.826.148.047.293.094.437.14-.168-.19-.33-.393-.482-.613.282.07.56.15.834.226-.004.007-.01.012-.015.02-.237-.086-.48-.16-.725-.22.17.243.325.484.464.713zM19.32 2.1s-.85-.015-1.31-.018c.075.054.137.12.21.183l2.33 2.19c-.41.125-.826.252-1.23.375l-.245-1.66c-.015-.086-.105-.146-.165-.15-.12-.015-.7-.022-.725-.022-.045 0-.06.015-.09.045l-.265.09s.42-.135 1.49-.75z"/>
          <path fill="#5E8E3E" d="M15.337 3.967c-.026-.22-.22-.34-.38-.352-.156-.01-3.115-.054-3.115-.054l-.008 15.912 6.5-1.42-2.997-14.086z"/>
        </svg>
      );
    case "loop":
      return (
        <svg {...common} viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="7" fill="#7C3AED"/>
          <path d="M9 13.5c0 1.933 1.567 3.5 3.5 3.5s3.5-1.567 3.5-3.5M16 13.5c0 1.933 1.567 3.5 3.5 3.5S23 15.433 23 13.5s-1.567-3.5-3.5-3.5-3.5 1.567-3.5 3.5zM9 13.5c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5v5.5c0 1.38-1.12 2.5-2.5 2.5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
      );
    case "triplewhale":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="5" fill="#1a1a2e"/>
          <path d="M5 10 L8 14 L12 8 L16 14 L19 10" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      );
    case "ing":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="3" fill="#FF6200"/>
          <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="Arial">ING</text>
        </svg>
      );
    case "revolut":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="3" fill="#000"/>
          <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="Georgia, serif" fontStyle="italic">R</text>
        </svg>
      );
    case "mollie":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="5" fill="#000"/>
          <circle cx="9" cy="12" r="2.5" fill="#fff"/>
          <circle cx="15" cy="12" r="2.5" fill="#fff"/>
        </svg>
      );
    case "paypal":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="3" fill="#fff" stroke="#e5e5e5" strokeWidth="0.5"/>
          <path d="M9.5 7h4c2 0 3 1 2.7 2.7-.4 2.2-2 3.3-4.3 3.3h-1.2l-.5 3.2a.5.5 0 0 1-.5.4H8.5a.3.3 0 0 1-.3-.4L9.5 7z" fill="#003087"/>
          <path d="M10.8 8.5h3c1.3 0 2 .7 1.8 1.9-.3 1.5-1.3 2.3-3 2.3h-1L11 15c0 .2-.2.3-.3.3H9.5a.3.3 0 0 1-.3-.4l1.6-6.4z" fill="#009CDE"/>
        </svg>
      );
    case "jortt":
      return (
        <svg {...common} viewBox="0 0 24 24" fill="none">
          <rect width="24" height="24" rx="4" fill="#00A6A6"/>
          <text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff" fontFamily="Arial">J</text>
        </svg>
      );
    default:
      return null;
  }
};

/* =========================================================================
   VIEW: OVERVIEW
   ========================================================================= */

const OverviewView = ({ range, setRange, data = [], totals, liveMarkets = null, twData = [], loopData = null }) => {
  const xAxisInterval = data.length > 0 ? Math.floor(data.length / 5) : 0;
  const [chartsReady, setChartsReady] = useState(false);

  useEffect(() => {
    setChartsReady(true);
  }, []);

  // Aggregate live metrics across all markets
  const liveRevenueMTD  = liveMarkets?.filter(m => m.live).reduce((s, m) => s + (m.revenue ?? 0), 0) ?? null;
  const liveOrdersMTD   = liveMarkets?.filter(m => m.live).reduce((s, m) => s + (m.orders ?? 0), 0) ?? null;
  const liveAOV         = liveRevenueMTD && liveOrdersMTD ? liveRevenueMTD / liveOrdersMTD : null;
  const liveTWNL        = twData?.find(t => t.market === "NL" && t.live);
  const liveAdSpend     = twData?.filter(t => t.live).reduce((s, t) => s + (t.adSpend ?? 0), 0) || null;
  const liveROAS        = liveTWNL?.roas ?? (liveAdSpend && liveRevenueMTD ? liveRevenueMTD / liveAdSpend : null);
  const liveMER         = liveTWNL?.mer ?? null;
  const liveNCPA        = liveTWNL?.ncpa ?? null;
  const liveLtvCpa      = liveTWNL?.ltvCpa ?? null;
  const liveLoop        = (Array.isArray(loopData) ? loopData : []).find((l: any) => l?.live) ?? null;
  const liveMRR         = liveLoop?.mrr ?? null;
  return (<>
    <div className="flex items-end justify-between">
      <div>
        <div className="text-[12px] font-medium text-neutral-400">Overview</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Live revenue from Shopify, ad performance from Triple Whale, reconciled nightly against Jortt.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5">
          <Chip active={range === "7d"} onClick={() => setRange("7d")}>7D</Chip>
          <Chip active={range === "30d"} onClick={() => setRange("30d")}>30D</Chip>
          <Chip active={range === "90d"} onClick={() => setRange("90d")}>90D</Chip>
        </div>
        <button className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50">
          <Calendar size={13} />
          Custom
        </button>
      </div>
    </div>

    {/* Revenue hero */}
    <section className="mt-3">
      <Card className="p-6 transition hover:border-neutral-300">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-500">
              <BrandIcon brand="shopify" size={14} />
              <span>Revenue</span>
              <span className="text-[11px] text-neutral-400">· selected period</span>
            </div>
            <div className="mt-3 flex items-baseline gap-4">
              {liveRevenueMTD !== null ? (
                <>
                  <span className="text-[44px] font-semibold tracking-tight tabular-nums leading-none">
                    €{liveRevenueMTD.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>Live</span>
                </>
              ) : (
                <span className="text-[44px] font-semibold tracking-tight tabular-nums leading-none text-neutral-300">—</span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-neutral-400">{liveRevenueMTD ? "MTD · all stores · Shopify live" : "Shopify not connected"}</div>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">Orders</div>
              <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{liveOrdersMTD !== null ? liveOrdersMTD.toLocaleString() : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">AOV</div>
              <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{liveAOV !== null ? `€${liveAOV.toFixed(2)}` : "—"}</div>
            </div>
          </div>
        </div>
      </Card>
    </section>

    {/* Profit row — contribution margin, opex, EBITDA — only show if live data available */}
    {liveRevenueMTD !== null && (
    <section className="mt-3 grid grid-cols-3 gap-3">
      {[
        {
          icon: Sparkles,
          label: "Contribution margin",
          value: `€${Math.round(liveRevenueMTD * 0.42).toLocaleString()}`,
          delta: null,
          positive: true,
          sub: `~42% of revenue · est. pending Jortt/Xero OpEx`,
        },
        {
          icon: Wallet,
          label: "OpEx",
          value: `€${Math.round(liveRevenueMTD * 0.18).toLocaleString()}`,
          delta: null,
          positive: false,
          sub: `~18% of revenue · est. — enable Jortt purchase scope`,
        },
        {
          icon: TrendingUp,
          label: "EBITDA",
          value: `€${Math.round(liveRevenueMTD * 0.25).toLocaleString()}`,
          delta: null,
          positive: true,
          sub: `~25% margin · est. pending real OpEx data`,
        },
      ].map((s) => (
        <Card key={s.label} className="p-5 transition hover:border-neutral-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-500">
              <s.icon size={14} />
              <span>{s.label}</span>
            </div>
            {s.delta && (
              <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${s.positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {s.positive ? <ArrowUpRight size={11} strokeWidth={2.5} /> : <ArrowDownRight size={11} strokeWidth={2.5} />}
                {s.delta}
              </span>
            )}
          </div>
          <div className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">{s.value}</div>
          <div className="mt-1 text-[12px] text-neutral-400">{s.sub}</div>
        </Card>
      ))}
    </section>
    )}

    {/* Customer economics row */}
    <section className="mt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <BrandIcon brand="triplewhale" size={12} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Customer economics</span>
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-[10px] text-neutral-400">Triple Whale · per acquired customer</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "NCPA",
            fullLabel: "New Customer Acquisition Cost",
            value: liveNCPA !== null ? `€${liveNCPA.toFixed(2)}` : "—",
            delta: null,
            positive: false,
            sub: liveNCPA !== null ? "Triple Whale · NL store live" : "Triple Whale not connected",
            icon: Target,
            live: liveNCPA !== null,
          },
          {
            label: "LTV:CPA",
            fullLabel: "Lifetime value to CPA ratio",
            value: liveLtvCpa !== null ? `${liveLtvCpa.toFixed(2)}×` : "—",
            delta: null,
            positive: true,
            sub: liveLtvCpa !== null ? "Triple Whale · NL store" : "Triple Whale not connected",
            icon: TrendingUp,
            live: liveLtvCpa !== null,
          },
          {
            label: "MER",
            fullLabel: "Marketing Efficiency Ratio",
            value: liveMER !== null ? `${liveMER.toFixed(2)}×` : "—",
            delta: null,
            positive: true,
            sub: liveMER !== null ? "Triple Whale · blended" : "Triple Whale not connected",
            icon: Sparkles,
            live: liveMER !== null,
          },
        ].map((s) => (
          <Card key={s.label} className="p-4 transition hover:border-neutral-300">
            <div className="flex items-start justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-neutral-500">
                <s.icon size={13} className="shrink-0" />
                <span className="truncate">{s.label}</span>
              </div>
              {s.delta && (
                <span className={`inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${s.positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                  {s.positive ? <ArrowUpRight size={10} strokeWidth={2.5} /> : <ArrowDownRight size={10} strokeWidth={2.5} />}
                  {s.delta}
                </span>
              )}
            </div>
            <div className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[10px] text-neutral-400 truncate">{s.fullLabel}</div>
            <div className="text-[11px] text-neutral-400">{s.sub}</div>
          </Card>
        ))}
      </div>
    </section>

    {/* Marketing efficiency row */}
    <section className="mt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <BrandIcon brand="triplewhale" size={12} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Marketing efficiency</span>
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-[10px] text-neutral-400">Source: Triple Whale</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            icon: Target,
            label: "Ad spend",
            value: liveAdSpend !== null ? `€${Math.round(liveAdSpend).toLocaleString()}` : "—",
            delta: "3.2%",
            positive: false,
            sub: liveAdSpend !== null ? "Triple Whale · all markets live" : "Triple Whale not connected",
            live: liveAdSpend !== null,
          },
          {
            icon: Activity,
            label: "Blended ROAS",
            value: liveROAS !== null ? `${liveROAS.toFixed(2)}x` : "—",
            delta: "0.4x",
            positive: true,
            sub: liveROAS !== null ? "Triple Whale blended" : "Triple Whale not connected",
            live: liveROAS !== null,
          },
        ].map((s) => (
          <Card key={s.label} className={`p-4 transition ${s.live ? 'hover:border-neutral-300' : 'opacity-60'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500">
                <s.icon size={13} />
                <span>{s.label}</span>
              </div>
              <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${s.positive ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {s.positive ? <ArrowUpRight size={10} strokeWidth={2.5} /> : <ArrowDownRight size={10} strokeWidth={2.5} />}
                {s.delta}
              </span>
            </div>
            <div className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{s.sub}</div>
          </Card>
        ))}
      </div>
    </section>

    {/* Subscriptions — Loop API */}
    {liveMRR !== null ? (
      <Card className="mt-3 p-5">
        <div className="flex items-center gap-2 mb-3">
          <BrandIcon brand="loop" size={16} />
          <div className="text-[13px] font-semibold">Subscriptions</div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">MRR</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">€{liveMRR.toLocaleString()}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">Loop Subscriptions</div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Active Subs</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{liveLoop?.activeSubs?.toLocaleString() ?? "—"}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">of {liveLoop?.totalFetched?.toLocaleString() ?? "—"} fetched</div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">ARPU</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{liveLoop?.arpu != null ? `€${liveLoop.arpu.toFixed(2)}` : "—"}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">per active subscriber</div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">New MTD</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{liveLoop?.newThisMonth ?? "—"}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">
              {liveLoop?.churnedThisMonth != null ? `${liveLoop.churnedThisMonth} churned · ` : ""}{liveLoop?.churnRate != null ? `${liveLoop.churnRate}% churn rate` : ""}
            </div>
          </div>
        </div>
      </Card>
    ) : (
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center text-[13px] text-neutral-500">
        <strong>Subscription data not available</strong> — set <code className="text-[11px]">LOOP_UK_API_KEY</code> in .env.local to connect Loop Subscriptions.
      </div>
    )}
  </>);
};

/* =========================================================================
   VIEW: METRICS (20 Triple Whale metrics with toggle)
   ========================================================================= */

const MetricsView = ({ twData = [] }) => {
  const liveTW = twData.filter(t => t.live);

  if (liveTW.length === 0) {
    return (
      <>
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Triple Whale</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Metrics</h1>
        </div>
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <BrandIcon brand="triplewhale" size={32} />
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">No Triple Whale data</div>
          <div className="mt-1 text-[13px] text-neutral-400">Add TRIPLE_WHALE_API_KEY to .env.local</div>
        </div>
      </>
    );
  }

  const total = liveTW.reduce((acc, t) => ({
    revenue:        (acc.revenue        ?? 0) + (t.revenue        ?? 0),
    netRevenue:     (acc.netRevenue     ?? 0) + (t.netRevenue     ?? 0),
    adSpend:        (acc.adSpend        ?? 0) + (t.adSpend        ?? 0),
    orders:         (acc.orders         ?? 0) + (t.orders         ?? 0),
    grossProfit:    (acc.grossProfit    ?? 0) + (t.grossProfit    ?? 0),
    netProfit:      (acc.netProfit      ?? 0) + (t.netProfit      ?? 0),
    cogs:           (acc.cogs           ?? 0) + (t.cogs           ?? 0),
    uniqueCustomers:(acc.uniqueCustomers?? 0) + (t.uniqueCustomers?? 0),
  }), {});
  const nlTW = liveTW.find(t => t.market === "NL") ?? liveTW[0];

  const fmtM = (v, fmt) => {
    if (v === null || v === undefined) return "—";
    if (fmt === "€") return `€${Math.round(v).toLocaleString()}`;
    if (fmt === "%") return `${v.toFixed(1)}%`;
    if (fmt === "x") return `${v.toFixed(2)}×`;
    return Math.round(v).toLocaleString();
  };

  const groups = [
    { label: "Revenue & Sales", metrics: [
      { label: "Gross Revenue",      value: total.revenue,         fmt: "€" },
      { label: "Net Revenue",        value: total.netRevenue,      fmt: "€" },
      { label: "Orders",             value: total.orders,          fmt: "n" },
      { label: "Avg Order Value",    value: total.orders > 0 ? total.revenue / total.orders : null, fmt: "€" },
      { label: "Unique Customers",   value: total.uniqueCustomers, fmt: "n" },
      { label: "New Customer %",     value: nlTW?.newCustomersPct, fmt: "%" },
    ]},
    { label: "Profitability", metrics: [
      { label: "Gross Profit",       value: total.grossProfit,     fmt: "€" },
      { label: "Net Profit",         value: total.netProfit,       fmt: "€" },
      { label: "COGS",               value: total.cogs,            fmt: "€" },
      { label: "Gross Margin",       value: total.revenue > 0 ? (total.grossProfit / total.revenue) * 100 : null, fmt: "%" },
    ]},
    { label: "Marketing", metrics: [
      { label: "Total Ad Spend",     value: total.adSpend,         fmt: "€" },
      { label: "Blended ROAS",       value: nlTW?.roas,            fmt: "x" },
      { label: "NC ROAS",            value: nlTW?.ncRoas,          fmt: "x" },
      { label: "MER",                value: nlTW?.mer,             fmt: "x" },
      { label: "NCPA",               value: nlTW?.ncpa,            fmt: "€" },
      { label: "LTV:CPA",            value: nlTW?.ltvCpa,          fmt: "x" },
    ]},
  ];

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Triple Whale</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Metrics</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Live · MTD · {liveTW.length} market{liveTW.length !== 1 ? "s" : ""} connected
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {liveTW.map(t => (
            <span key={t.market} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              <span className="h-1 w-1 rounded-full bg-emerald-500" />{t.flag} {t.market}
            </span>
          ))}
        </div>
      </div>

      {/* Per-market table */}
      <Card className="mt-6 p-5">
        <div className="mb-4 text-[13px] font-semibold">By market — MTD</div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-neutral-100 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                <th className="pb-2 pr-4">Market</th>
                <th className="pb-2 pr-4 text-right">Revenue</th>
                <th className="pb-2 pr-4 text-right">Ad Spend</th>
                <th className="pb-2 pr-4 text-right">ROAS</th>
                <th className="pb-2 pr-4 text-right">MER</th>
                <th className="pb-2 pr-4 text-right">Orders</th>
                <th className="pb-2 pr-4 text-right">Gross Profit</th>
                <th className="pb-2 text-right">Net Profit</th>
              </tr>
            </thead>
            <tbody>
              {liveTW.map((t, i) => (
                <tr key={t.market} className={i < liveTW.length - 1 ? "border-b border-neutral-50" : ""}>
                  <td className="py-2.5 pr-4 font-medium">{t.flag} {t.market}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.revenue, "€")}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.adSpend, "€")}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.roas, "x")}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.mer, "x")}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.orders, "n")}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums">{fmtM(t.grossProfit, "€")}</td>
                  <td className="py-2.5 text-right tabular-nums">{fmtM(t.netProfit, "€")}</td>
                </tr>
              ))}
              {liveTW.length > 1 && (
                <tr className="border-t border-neutral-200 font-semibold">
                  <td className="pt-2.5 pr-4">Total</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">{fmtM(total.revenue, "€")}</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">{fmtM(total.adSpend, "€")}</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">—</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">—</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">{fmtM(total.orders, "n")}</td>
                  <td className="pt-2.5 pr-4 text-right tabular-nums">{fmtM(total.grossProfit, "€")}</td>
                  <td className="pt-2.5 text-right tabular-nums">{fmtM(total.netProfit, "€")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Metric grid */}
      {groups.map(group => (
        <section key={group.label} className="mt-6">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">{group.label}</h2>
            <div className="h-px flex-1 bg-neutral-200" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {group.metrics.map(m => (
              <Card key={m.label} className="p-4">
                <div className="text-[11px] font-medium text-neutral-500">{m.label}</div>
                <div className={`mt-2 text-[20px] font-semibold tracking-tight tabular-nums ${m.value == null ? "text-neutral-300" : ""}`}>
                  {fmtM(m.value, m.fmt)}
                </div>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </>
  );
};

/* =========================================================================
   VIEW: RECONCILIATION (Waterfall + Variance)
   ========================================================================= */

const ReconciliationView = ({ shopifyMarkets = null, jorttData = null }) => {
  const shopifyTotal = Array.isArray(shopifyMarkets) ? shopifyMarkets.filter((m: any) => m?.live).reduce((s: number, m: any) => s + (m.revenue ?? 0), 0) : null;
  const jorttRevenue = jorttData?.revenueByMonth
    ? Object.values(jorttData.revenueByMonth).reduce((s, v) => s + v, 0)
    : null;
  const variance = shopifyTotal !== null && jorttRevenue !== null ? shopifyTotal - jorttRevenue : null;
  const hasData = shopifyTotal !== null || jorttRevenue !== null;

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Reconciliation</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Revenue Reconciliation</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Shopify gross revenue vs Jortt invoices · MTD
          </p>
        </div>
      </div>

      {/* Xero migration banner */}
      <div className="mt-4 flex items-start gap-3 rounded-lg border border-neutral-200 bg-gradient-to-r from-neutral-50 to-[#13B5EA]/5 p-4">
        <div className="mt-0.5 rounded-md bg-[#13B5EA]/10 p-1.5 text-[#13B5EA]"><Info size={14} /></div>
        <div className="flex-1 text-[12px]">
          <div className="font-semibold text-neutral-900">Bridge mode — Xero migration in progress</div>
          <div className="mt-0.5 text-neutral-600">Full journal-entry drilldown activates once Xero is connected. Current view shows Shopify gross revenue vs Jortt invoice totals.</div>
        </div>
      </div>

      {!hasData ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">No data available</div>
          <div className="mt-1 text-[13px] text-neutral-400">Connect Shopify and Jortt to see reconciliation.</div>
        </div>
      ) : (
        <>
          <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <BrandIcon brand="shopify" size={14} /> Shopify revenue (MTD)
              </div>
              <div className="text-[28px] font-semibold tabular-nums">
                {shopifyTotal !== null ? `€${Math.round(shopifyTotal).toLocaleString()}` : "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">Gross · all markets</div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <BrandIcon brand="jortt" size={14} /> Jortt invoices (MTD)
              </div>
              <div className="text-[28px] font-semibold tabular-nums">
                {jorttRevenue !== null ? `€${Math.round(jorttRevenue).toLocaleString()}` : "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">{jorttData?.invoiceCount ?? 0} invoices · excl. credit notes</div>
            </Card>
            <Card className={`p-5 ${variance !== null ? (Math.abs(variance) < 500 ? "border-emerald-200 bg-emerald-50/20" : "border-amber-200 bg-amber-50/20") : ""}`}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <AlertTriangle size={14} /> Variance
              </div>
              <div className={`text-[28px] font-semibold tabular-nums ${variance !== null && variance < 0 ? "text-rose-600" : variance !== null && variance > 0 ? "text-amber-600" : "text-neutral-300"}`}>
                {variance !== null ? `${variance > 0 ? "+" : ""}€${Math.round(variance).toLocaleString()}` : "—"}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">
                {variance !== null ? (Math.abs(variance) < 500 ? "Within tolerance" : "Review timing differences") : "Connect both sources"}
              </div>
            </Card>
          </section>

          {jorttData?.revenueByMonth && Object.keys(jorttData.revenueByMonth).length > 0 && (
            <Card className="mt-3 p-5">
              <div className="mb-4 text-[13px] font-semibold">Jortt invoice revenue by month</div>
              <div className="space-y-2">
                {Object.entries(jorttData.revenueByMonth)
                  .sort(([a], [b]) => new Date("1 " + a.replace("'", "20")).getTime() - new Date("1 " + b.replace("'", "20")).getTime())
                  .map(([month, rev]) => (
                    <div key={month} className="flex items-center justify-between text-[13px]">
                      <span className="text-neutral-600">{month}</span>
                      <span className="tabular-nums font-medium">€{Math.round(rev).toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/* =========================================================================
   VIEW: PILLAR 1 — DAILY P&L
   ========================================================================= */

const DailyPnLView = ({ hourlyData = [], liveMarkets = null, twData = [], jorttData = null } = {}) => {
  const activeHours = hourlyData?.filter(Boolean) ?? [];
  const totalRevenue = activeHours.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  const totalOrders = activeHours.reduce((sum, row) => sum + (row.orders ?? 0), 0);
  const totalRefunds = activeHours.reduce((sum, row) => sum + (row.refunds ?? 0), 0);
  const totalDiscounts = activeHours.reduce((sum, row) => sum + (row.discounts ?? 0), 0);
  const adSpend = twData?.filter(t => t.live).reduce((sum, row) => sum + (row.adSpend ?? 0), 0) ?? 0;
  const grossProfit = twData?.filter(t => t.live).reduce((sum, row) => sum + (row.grossProfit ?? 0), 0) ?? 0;
  const estCogs = totalRevenue > 0 && grossProfit > 0
    ? Math.max(totalRevenue - grossProfit, 0)
    : totalRevenue * 0.32;
  const estNetProfit = totalRevenue - totalRefunds - totalDiscounts - adSpend - estCogs;
  const latestActiveHour = [...activeHours].reverse().find(row => (row.revenue ?? 0) > 0 || (row.orders ?? 0) > 0) ?? activeHours[activeHours.length - 1] ?? null;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const hasData = activeHours.some(row => (row.revenue ?? 0) > 0 || (row.orders ?? 0) > 0);

  if (!hasData) {
    return (
      <>
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 1</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Daily P&L Tracker</h1>
          <p className="mt-1 text-[13px] text-neutral-500">Today&apos;s Shopify revenue and estimated contribution margin.</p>
        </div>
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <Clock size={32} className="text-neutral-300" />
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">No orders yet today</div>
          <div className="mt-2 max-w-sm text-[13px] text-neutral-400">
            Shopify is connected, but there are no paid orders for today yet.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 1</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Daily P&amp;L Tracker</h1>
          <p className="mt-1 text-[13px] text-neutral-500">Today&apos;s Shopify revenue and estimated contribution margin.</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-right">
          <div className="text-[10px] uppercase tracking-wider text-neutral-400">Latest active hour</div>
          <div className="mt-1 text-[16px] font-semibold tabular-nums text-neutral-900">{latestActiveHour?.hour ?? "—"} UTC</div>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Revenue", value: `€${Math.round(totalRevenue).toLocaleString()}`, sub: `${totalOrders.toLocaleString()} orders` , icon: DollarSign },
          { label: "AOV", value: totalOrders > 0 ? `€${aov.toFixed(2)}` : "—", sub: "Average order value", icon: Package },
          { label: "Ad spend", value: `€${Math.round(adSpend).toLocaleString()}`, sub: twData.length > 0 ? "Triple Whale blended" : "Estimated as 0", icon: Target },
          { label: "Est. net profit", value: `${estNetProfit >= 0 ? "+" : "-"}€${Math.round(Math.abs(estNetProfit)).toLocaleString()}`, sub: "Revenue − refunds − discounts − ads − COGS", icon: TrendingUp },
        ].map((item) => (
          <Card key={item.label} className="p-5">
            <div className="flex items-center justify-between text-[12px] font-medium text-neutral-500">
              <span>{item.label}</span>
              <item.icon size={14} />
            </div>
            <div className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">{item.value}</div>
            <div className="mt-1 text-[11px] text-neutral-400">{item.sub}</div>
          </Card>
        ))}
      </section>

      <Card className="mt-3 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[13px] font-semibold">Hourly revenue today</div>
            <div className="text-[12px] text-neutral-400">Aggregated across all connected Shopify stores</div>
          </div>
          <div className="text-right text-[11px] text-neutral-400">
            <div>{liveMarkets?.filter(m => m.live).length ?? 0} live market(s)</div>
            <div>{jorttData?.invoiceCount ? `${jorttData.invoiceCount} Jortt invoices loaded` : "Jortt optional"}</div>
          </div>
        </div>
        <div className="space-y-3">
          {activeHours.map((row) => {
            const maxRevenue = Math.max(...activeHours.map((item) => item.revenue ?? 0), 1);
            const width = `${Math.max(((row.revenue ?? 0) / maxRevenue) * 100, row.revenue > 0 ? 6 : 0)}%`;
            return (
              <div key={row.hour} className="grid grid-cols-[64px_minmax(0,1fr)_88px_72px] items-center gap-3">
                <div className="text-[12px] font-medium text-neutral-500">{row.hour}</div>
                <div className="h-8 overflow-hidden rounded-md bg-neutral-100">
                  <div className="flex h-full items-center rounded-md bg-neutral-900 px-3 text-[11px] font-medium text-white transition-all" style={{ width }}>
                    {(row.revenue ?? 0) > 0 ? `€${Math.round(row.revenue).toLocaleString()}` : ""}
                  </div>
                </div>
                <div className="text-right text-[12px] tabular-nums text-neutral-700">{row.orders ?? 0} orders</div>
                <div className="text-right text-[12px] tabular-nums text-neutral-400">€{Math.round(row.refunds ?? 0)}</div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

/* =========================================================================
   VIEW: PILLAR 2 — MARGIN PER MARKET
   ========================================================================= */

export const MarketsView = ({ liveMarkets = null, twData = [] }: any = {}) => {
  const [sortBy, setSortBy] = useState("revenue");
  const [allocation, setAllocation] = useState("revenue-weighted");

  // Total ad spend across all markets (used for "revenue-weighted" reallocation)
  const totalTwRevenue = (twData ?? []).filter((t: any) => t?.live).reduce((s: number, t: any) => s + (t.revenue ?? 0), 0);
  const totalAdSpend = (twData ?? []).filter((t: any) => t?.live).reduce((s: number, t: any) => s + (t.adSpend ?? 0), 0);

  const baseMarkets = (liveMarkets ?? [])
    .filter((m: any) => m.live)
    .map((m: any) => {
      const tw = twData.find((t: any) => t.market === m.code && t.live);
      // Shopify revenue is canonical for cards/table (matches Shopify Markets)
      const revenue = m.revenue ?? 0;
      const twRevenue = tw?.revenue ?? null;
      const grossProfit = tw?.grossProfit ?? null;
      // Gross margin % must use TW revenue (its own denominator), not Shopify revenue
      const grossMarginPct = grossProfit != null && twRevenue != null && twRevenue > 0
        ? +((grossProfit / twRevenue) * 100).toFixed(1) : null;
      return {
        ...m,
        twRevenue,
        grossProfit,
        grossMargin: grossMarginPct,
        twAdSpend: tw?.adSpend ?? null,
        twNetProfit: tw?.netProfit ?? null,
        roas: tw?.roas ?? null,
        ncpa: tw?.ncpa ?? null,
      };
    });

  // Apply allocation method to derive ad spend, CAC, contribution margin
  const activeMarkets = baseMarkets.map((m: any) => {
    let adSpend: number | null;
    if (allocation === "revenue-weighted") {
      // Reallocate total ad spend proportionally to each market's TW revenue share
      adSpend = totalTwRevenue > 0 && m.twRevenue != null
        ? +((m.twRevenue / totalTwRevenue) * totalAdSpend).toFixed(2)
        : null;
    } else if (allocation === "attribution") {
      // TW's attributed spend per market (same as direct in this dataset)
      adSpend = m.twAdSpend;
    } else {
      // "direct" — platform-direct targeting (TW per-market spend)
      adSpend = m.twAdSpend;
    }
    const cac = adSpend != null && m.newCustomers > 0 ? +(adSpend / m.newCustomers).toFixed(2) : null;
    const contributionMarginPct = m.grossProfit != null && adSpend != null && m.twRevenue != null && m.twRevenue > 0
      ? +(((m.grossProfit - adSpend) / m.twRevenue) * 100).toFixed(1) : null;
    return { ...m, adSpend, cac, contributionMargin: contributionMarginPct };
  });

  if (activeMarkets.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center text-[13px] text-neutral-500">
        No market data available — connect Shopify to see margin per market.
      </div>
    );
  }

  const sorted = [...activeMarkets].sort((a: any, b: any) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  const maxRev = sorted[0]?.revenue ?? 1;

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 2</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Margin per Market</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Geographic breakdown following Shopify Markets · last 30 days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={allocation}
            onChange={(e) => setAllocation(e.target.value)}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700"
          >
            <option value="direct">Direct targeting</option>
            <option value="revenue-weighted">Revenue-weighted</option>
            <option value="attribution">TW attribution</option>
          </select>
        </div>
      </div>

      {/* Market cards */}
      <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {sorted.map(m => {
          const cm = m.contributionMargin;
          const cmClass = cm == null
            ? "text-neutral-400"
            : cm >= 30 ? "text-emerald-600"
            : cm >= 20 ? "text-neutral-600"
            : "text-amber-600";
          return (
            <Card key={m.code} className="p-5">
              <div className="flex items-start justify-between">
                <div className="text-[15px] font-semibold tracking-tight">{m.code}</div>
                <span className={`text-[11px] font-medium tabular-nums ${cmClass}`}>
                  {cm != null ? `${cm}%` : "—"}
                </span>
              </div>
              <div className="mt-2 text-[12px] text-neutral-500">{m.name ?? m.code}</div>
              <div className="mt-2 text-[20px] font-semibold tabular-nums tracking-tight">
                €{(m.revenue / 1000).toFixed(1)}k
              </div>
            </Card>
          );
        })}
      </section>

      {/* Main markets table */}
      <Card className="mt-3">
        <div className="border-b border-neutral-100 px-5 py-4">
          <div className="text-[13px] font-semibold">Full market breakdown</div>
          <div className="text-[12px] text-neutral-400">
            Ad spend allocation method:{" "}
            <span className="font-medium">
              {allocation === "revenue-weighted" ? "Revenue-Weighted" : allocation === "direct" ? "Direct targeting" : "TW attribution"}
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                <th className="px-5 py-2.5 font-medium">Market</th>
                <th className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-neutral-900" onClick={() => setSortBy("revenue")}>Revenue</th>
                <th className="px-3 py-2.5 font-medium text-right">Orders</th>
                <th className="px-3 py-2.5 font-medium text-right">AOV</th>
                <th className="px-3 py-2.5 font-medium text-right">Ad spend</th>
                <th className="px-3 py-2.5 font-medium text-right">CAC</th>
                <th className="px-3 py-2.5 font-medium text-right">Gross M%</th>
                <th className="px-3 py-2.5 font-medium text-right cursor-pointer hover:text-neutral-900" onClick={() => setSortBy("contributionMargin")}>Contrib M%</th>
                <th className="px-5 py-2.5 font-medium">Share</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((m, i) => {
                const pct = (m.revenue / maxRev) * 100;
                return (
                  <tr key={m.code} className={i !== sorted.length - 1 ? "border-b border-neutral-50 hover:bg-neutral-50/50" : "hover:bg-neutral-50/50"}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[4px] bg-neutral-100 px-1 text-[9px] font-semibold uppercase tracking-wider text-neutral-500">
                          {m.code}
                        </span>
                        <span className="font-medium text-neutral-900">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums font-medium">€{Math.round(m.revenue).toLocaleString()}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-neutral-600">{m.orders}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-neutral-600">€{m.orders > 0 ? Math.round(m.revenue / m.orders).toLocaleString() : "—"}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-neutral-600">{m.adSpend != null ? `€${Math.round(m.adSpend).toLocaleString()}` : "—"}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums">
                      {m.cac != null ? (
                        <span className={m.cac > 40 ? "text-rose-600 font-medium" : m.cac > 30 ? "text-amber-600" : "text-neutral-900"}>
                          €{m.cac.toFixed(2)}
                        </span>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-3.5 text-right tabular-nums text-neutral-600">{m.grossMargin != null ? `${m.grossMargin}%` : "—"}</td>
                    <td className="px-3 py-3.5 text-right tabular-nums">
                      {m.contributionMargin != null ? (
                        <span className={m.contributionMargin >= 30 ? "text-emerald-600 font-medium" : m.contributionMargin >= 20 ? "text-neutral-900" : "text-amber-600 font-medium"}>
                          {m.contributionMargin}%
                        </span>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="h-[3px] w-32 overflow-hidden rounded-full bg-neutral-100">
                        <div className="h-full rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Alert on underperforming markets — dynamic */}
      {sorted.filter(m => m.contributionMargin != null && m.contributionMargin < 20).map(m => (
        <div key={m.code} className="mt-3 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/40 p-4">
          <div className="mt-0.5 rounded-md bg-amber-100 p-1.5 text-amber-700">
            <AlertTriangle size={14} />
          </div>
          <div className="flex-1 text-[13px]">
            <div className="font-semibold text-neutral-900">{m.flag} {m.name} contribution margin below target</div>
            <div className="mt-0.5 text-neutral-600">
              Contribution margin of {m.contributionMargin}% is below the 20% threshold. Review ad spend efficiency (ROAS: {m.roas != null ? `${m.roas.toFixed(2)}×` : "—"}) and consider optimising campaigns.
            </div>
          </div>
        </div>
      ))}
    </>
  );
};

/* =========================================================================
   VIEW: PILLAR 3 — MONTHLY OVERVIEW
   ========================================================================= */

/* ============================= OPEX BREAKDOWN (used in MonthlyView) ============================= */

const OpExBreakdownSection = ({ opexByMonth: data = null, opexDetail: detail = null, jorttLive = false, deniedScopes = [] } = {}) => {
  const [activeCategory, setActiveCategory] = useState("team");
  if (!data || data.length === 0) {
    const missingExpensesScope = Array.isArray(deniedScopes) && deniedScopes.includes("expenses:read");
    return (
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center text-[13px] text-neutral-500">
        <strong>OpEx breakdown not available</strong> — {missingExpensesScope ? "Jortt is connected, but expenses:read is not granted." : "no Jortt expense rows were returned yet."}
      </div>
    );
  }
  const current = data[data.length - 1];
  const prev = data[data.length - 2] ?? data[data.length - 1];
  const totalCurrent = current.team + current.agencies + current.content + current.software + current.other;
  const totalPrev = prev.team + prev.agencies + prev.content + prev.software + prev.other;
  const totalDelta = ((totalCurrent - totalPrev) / totalPrev * 100);

  const categories = [
    { key: "team", label: "Team", color: "#171717" },
    { key: "agencies", label: "Agencies", color: "#6366f1" },
    { key: "content", label: "Content samenwerkingen", color: "#f59e0b" },
    { key: "software", label: "Software", color: "#10b981" },
    { key: "other", label: "Other costs", color: "#6b7280" },
  ];

  const donutData = categories.map(c => ({
    name: c.label,
    value: current[c.key],
    color: c.color,
    key: c.key,
  }));

  const activeDetail = detail[activeCategory] ?? { label: activeCategory, items: [] };
  const activeTotal = (activeDetail.items ?? []).reduce((s, i) => s + i.amount, 0);

  return (
    <Card className="mt-3 overflow-hidden">
      {/* Header */}
      <div className="border-b border-neutral-100 p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[13px] font-semibold">OpEx breakdown — April '26</div>
            <div className="mt-0.5 text-[12px] text-neutral-400">
              Indirect costs by category · source: Jortt OPEX overview
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">Total OpEx</div>
            <div className="mt-0.5 text-[22px] font-semibold tabular-nums">€{totalCurrent.toLocaleString()}</div>
            <div className={`text-[11px] font-medium ${totalDelta >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
              {totalDelta >= 0 ? "+" : ""}{totalDelta.toFixed(1)}% MoM
            </div>
          </div>
        </div>
      </div>

      {/* Category cards */}
      <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-5">
        {categories.map(cat => {
          const value = current[cat.key];
          const prevValue = prev[cat.key];
          const delta = ((value - prevValue) / prevValue * 100);
          const share = (value / totalCurrent * 100);
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              className={`rounded-lg border p-3 text-left transition ${
                isActive
                  ? "border-neutral-900 bg-neutral-50"
                  : "border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50/50"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
                <span className="text-[11px] font-medium text-neutral-500">{cat.label}</span>
              </div>
              <div className="mt-1.5 text-[17px] font-semibold tabular-nums">
                €{value.toLocaleString()}
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10px]">
                <span className="text-neutral-400">{share.toFixed(1)}% of OpEx</span>
                <span className={`font-medium ${delta >= 0 ? "text-rose-600" : "text-emerald-600"}`}>
                  {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Two-column: donut + trend */}
      <div className="grid grid-cols-1 gap-4 border-t border-neutral-100 p-5 lg:grid-cols-5">
        {/* Donut */}
        <div className="lg:col-span-2">
          <div className="text-[12px] font-medium text-neutral-500">Cost mix — April '26</div>
          <div className="relative mt-2 h-[220px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={2}
                  stroke="none"
                >
                  {donutData.map((entry) => (
                    <Cell
                      key={entry.key}
                      fill={entry.color}
                      opacity={activeCategory === entry.key ? 1 : 0.35}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => `€${v.toLocaleString()}`}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">
                {activeDetail.label}
              </div>
              <div className="mt-0.5 text-[18px] font-semibold tabular-nums">
                €{current[activeCategory]?.toLocaleString()}
              </div>
              <div className="text-[10px] text-neutral-400">
                {((current[activeCategory] / totalCurrent) * 100).toFixed(1)}% share
              </div>
            </div>
          </div>
        </div>

        {/* Trend: stacked bar across 6 months */}
        <div className="lg:col-span-3">
          <div className="text-[12px] font-medium text-neutral-500">Trend — trailing 6 months</div>
          <div className="mt-2 h-[220px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={220}>
              <BarChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v / 1000}k`} />
                <Tooltip
                  contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                  formatter={(v) => `€${v.toLocaleString()}`}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" iconSize={8} />
                {categories.map(cat => (
                  <Bar
                    key={cat.key}
                    dataKey={cat.key}
                    name={cat.label}
                    stackId="opex"
                    fill={cat.color}
                    opacity={activeCategory === cat.key ? 1 : 0.55}
                    maxBarSize={48}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Line items for active category */}
      <div className="border-t border-neutral-100 bg-neutral-50/40 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: activeDetail.color }} />
            <div>
              <div className="text-[13px] font-semibold">{activeDetail.label} — line items</div>
              <div className="text-[11px] text-neutral-400">{activeDetail.description}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">Category total</div>
            <div className="text-[15px] font-semibold tabular-nums">€{activeTotal.toLocaleString()}</div>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[10px] font-medium uppercase tracking-wider text-neutral-500">
                <th className="px-3 py-2">Line item</th>
                <th className="px-3 py-2">Team / source</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">% of category</th>
              </tr>
            </thead>
            <tbody>
              {activeDetail.items
                .slice()
                .sort((a, b) => b.amount - a.amount)
                .map((item, idx) => {
                  const pct = (item.amount / activeTotal * 100);
                  return (
                    <tr key={idx} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/50">
                      <td className="px-3 py-2 font-medium text-neutral-800">{item.name}</td>
                      <td className="px-3 py-2 text-neutral-500">{item.source}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">€{item.amount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${Math.min(100, pct)}%`, background: activeDetail.color, opacity: 0.6 }}
                            />
                          </div>
                          <span className="w-10 text-right tabular-nums text-neutral-500">{pct.toFixed(1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-neutral-400">
          <Info size={11} />
          Click a category above to see its breakdown. Data shown for April '26 (MTD).
        </div>
      </div>
    </Card>
  );
};

/* =========================================================================
   VIEW: PILLAR 3 — MONTHLY OVERVIEW
   ========================================================================= */

export const MonthlyView = ({ opexByMonth: liveOpexByMonth, opexDetail: liveOpexDetail, jorttLive, deniedScopes = [], shopifyMonthly, twData = [] }: any = {}) => {
  const nlTW = twData.find(t => t.market === "NL" && t.live);
  const activeMonths = useMemo(() => {
    if (!shopifyMonthly?.length) return [];
    return shopifyMonthly.map(({ month, revenue, refunds = 0 }) => {
      const net = revenue - refunds;
      return {
        month,
        revenue: Math.round(revenue),
        grossProfit: Math.round(net * 0.54),
        adSpend: Math.round(net * 0.26),
        contributionMargin: Math.round(net * 0.26),
        netProfit: Math.round(net * 0.12),
      };
    });
  }, [shopifyMonthly]);
  if (activeMonths.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center text-[13px] text-neutral-500">
        No monthly data available — Shopify monthly data has not loaded yet.
      </div>
    );
  }
  const current = activeMonths[activeMonths.length - 1];
  const prev = activeMonths[activeMonths.length - 2] ?? activeMonths[0];
  const activeOpexByMonth = liveOpexByMonth ?? null;
  const activeOpexDetail = liveOpexDetail ?? null;

  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 3</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Monthly Overview</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Management rollup · trailing 6 months
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
            April: In progress
          </span>
        </div>
      </div>

      {/* Hero summary */}
      <Card className="mt-6 p-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {[
            { label: "Revenue MTD", value: current.revenue, prev: prev.revenue, format: "€" },
            { label: "Gross profit MTD", value: current.grossProfit, prev: prev.grossProfit, format: "€" },
            { label: "Contribution margin", value: current.contributionMargin, prev: prev.contributionMargin, format: "€" },
            { label: "Net profit MTD", value: current.netProfit, prev: prev.netProfit, format: "€" },
          ].map(m => {
            const delta = ((m.value - m.prev) / m.prev * 100).toFixed(1);
            const positive = delta > 0;
            return (
              <div key={m.label}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{m.label}</div>
                <div className="mt-1 text-[24px] font-semibold tabular-nums">€{m.value.toLocaleString()}</div>
                <div className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${positive ? "text-emerald-600" : "text-rose-600"}`}>
                  {positive ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                  {delta}% MoM
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Trend chart */}
      <Card className="mt-3 p-5">
        <div className="mb-4">
          <div className="text-[13px] font-semibold">Revenue, profit & ad spend — trailing 6 months</div>
          <div className="text-[12px] text-neutral-400">April is MTD and will update as month progresses</div>
        </div>
        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={280}>
            <ComposedChart data={activeMonths} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `€${v / 1000}k`} />
              <Tooltip
                contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                formatter={(v) => `€${v.toLocaleString()}`}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} iconType="circle" />
              <Bar dataKey="revenue" name="Revenue" fill="#171717" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Bar dataKey="adSpend" name="Ad spend" fill="#d4d4d8" radius={[4, 4, 0, 0]} maxBarSize={40} />
              <Line type="monotone" dataKey="netProfit" name="Net profit" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* KPI strip — live Triple Whale data */}
      <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "NCPA", value: nlTW?.ncpa != null ? `€${nlTW.ncpa.toFixed(0)}` : "—", sub: nlTW ? "Triple Whale · NL" : "TW not connected" },
          { label: "LTV:CPA", value: nlTW?.ltvCpa != null ? `${nlTW.ltvCpa.toFixed(2)}×` : "—", sub: nlTW ? "Triple Whale · NL" : "TW not connected" },
          { label: "MER", value: nlTW?.mer != null ? `${nlTW.mer.toFixed(2)}×` : "—", sub: nlTW ? "Triple Whale · NL" : "TW not connected" },
          { label: "Blended ROAS", value: nlTW?.roas != null ? `${nlTW.roas.toFixed(2)}×` : "—", sub: nlTW ? "Triple Whale · NL" : "TW not connected" },
        ].map(kpi => (
          <Card key={kpi.label} className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{kpi.label}</div>
            <div className="mt-1 text-[20px] font-semibold tabular-nums">{kpi.value}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{kpi.sub}</div>
          </Card>
        ))}
      </section>

      {/* OpEx breakdown — 5 categories */}
      <OpExBreakdownSection opexByMonth={activeOpexByMonth} opexDetail={activeOpexDetail} jorttLive={jorttLive} deniedScopes={deniedScopes} />

      {/* Month close status */}
      <Card className="mt-3 p-5">
        <div className="text-[13px] font-semibold">Month close status</div>
        <div className="mt-3 flex items-center gap-3 overflow-x-auto">
          {activeMonths.map((m, i) => {
            const isOpen = i === activeMonths.length - 1;
            return (
              <div key={m.month} className={`shrink-0 rounded-lg border px-4 py-3 ${isOpen ? "border-amber-200 bg-amber-50/40" : "border-emerald-200 bg-emerald-50/30"}`}>
                <div className="text-[11px] font-medium text-neutral-500">{m.month}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  {isOpen ? <Clock size={12} className="text-amber-600" /> : <CircleCheck size={12} className="text-emerald-600" />}
                  <span className={`text-[11px] font-medium ${isOpen ? "text-amber-700" : "text-emerald-700"}`}>
                    {isOpen ? "Open" : "Closed"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
};

/* =========================================================================
   VIEW: PILLAR 4 — BALANCE SHEET
   ========================================================================= */

const BalanceView = ({ jorttData = null } = {}) => {
  const hasJortt = !!jorttData?.live;

  // Derive YTD figures from Jortt data
  const parseMonth = (s) => {
    const [m, y] = s.split(" '");
    return new Date(`${m} 1, 20${y}`);
  };

  const currentYear = new Date().getFullYear();
  const currentMonthKey = new Date()
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" })
    .replace(" ", " '");

  const revenueByMonth = jorttData?.revenueByMonth ?? {};
  const opexByMonth = jorttData?.opexByMonth ?? [];

  let ytdRevenue = 0;
  let mtdRevenue = 0;
  for (const [mk, val] of Object.entries(revenueByMonth)) {
    const d = parseMonth(mk);
    if (d.getFullYear() === currentYear) ytdRevenue += val;
    if (mk === currentMonthKey) mtdRevenue += val;
  }

  let ytdOpex = 0;
  let mtdOpex = 0;
  for (const row of opexByMonth) {
    const d = parseMonth(row.month);
    if (d.getFullYear() === currentYear) ytdOpex += row.total;
    if (row.month === currentMonthKey) mtdOpex += row.total;
  }

  const ytdNet = ytdRevenue - ytdOpex;
  const mtdNet = mtdRevenue - mtdOpex;

  const fmt = (n) => `€${Math.round(n).toLocaleString()}`;

  const expensesScopeMissing = hasJortt && (!jorttData?.expenseCount || jorttData.expenseCount === 0);

  return (
    <>
      <div>
        <div className="text-[12px] font-medium text-neutral-400">Pillar 4</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Balance Sheet</h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Financial position · derived from Jortt invoices &amp; expenses.
        </p>
      </div>

      {!hasJortt ? (
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <Scale size={32} className="text-neutral-300" />
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">Jortt not connected</div>
          <div className="mt-2 max-w-sm text-[13px] text-neutral-400">
            Connect Jortt to unlock revenue, OpEx, and derived equity rollup. Full asset/liability detail requires Xero or Jortt with the purchase-invoice scope.
          </div>
        </div>
      ) : (
        <>
          {/* Bridge notice */}
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <Scale size={16} className="mt-0.5 flex-shrink-0 text-amber-700" />
            <div className="flex-1 text-[12px]">
              <div className="font-semibold text-neutral-900">Derived view — Jortt bridge mode</div>
              <div className="mt-0.5 text-neutral-600">
                Showing YTD revenue and OpEx from Jortt. Full balance sheet (cash, AR, AP, VAT) requires
                Xero or the Jortt <code className="rounded bg-neutral-100 px-1">purchase_invoices:read</code> scope.
              </div>
            </div>
          </div>

          {/* KPI strip */}
          <section className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <BrandIcon brand="jortt" size={14} /> Revenue YTD
              </div>
              <div className="text-[28px] font-semibold tabular-nums">{fmt(ytdRevenue)}</div>
              <div className="mt-1 text-[11px] text-neutral-400">
                {jorttData?.invoiceCount ?? 0} invoices · {currentYear}
              </div>
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <BrandIcon brand="jortt" size={14} /> OpEx YTD
              </div>
              <div className="text-[28px] font-semibold tabular-nums">
                {expensesScopeMissing ? "—" : fmt(ytdOpex)}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">
                {expensesScopeMissing
                  ? "expenses:read scope not granted"
                  : `${jorttData?.expenseCount ?? 0} expenses · ${currentYear}`}
              </div>
            </Card>
            <Card className={`p-5 ${ytdNet >= 0 ? "border-emerald-200 bg-emerald-50/20" : "border-rose-200 bg-rose-50/20"}`}>
              <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500 mb-2">
                <Scale size={14} /> Net retained (YTD)
              </div>
              <div className={`text-[28px] font-semibold tabular-nums ${ytdNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {expensesScopeMissing ? "—" : fmt(ytdNet)}
              </div>
              <div className="mt-1 text-[11px] text-neutral-400">Revenue − OpEx (Jortt-derived)</div>
            </Card>
          </section>

          {/* MTD snapshot */}
          <section className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <Card className="p-5">
              <div className="text-[12px] font-medium text-neutral-500 mb-2">Revenue MTD</div>
              <div className="text-[22px] font-semibold tabular-nums">{fmt(mtdRevenue)}</div>
            </Card>
            <Card className="p-5">
              <div className="text-[12px] font-medium text-neutral-500 mb-2">OpEx MTD</div>
              <div className="text-[22px] font-semibold tabular-nums">
                {expensesScopeMissing ? "—" : fmt(mtdOpex)}
              </div>
            </Card>
            <Card className="p-5">
              <div className="text-[12px] font-medium text-neutral-500 mb-2">Net MTD</div>
              <div className={`text-[22px] font-semibold tabular-nums ${mtdNet >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {expensesScopeMissing ? "—" : fmt(mtdNet)}
              </div>
            </Card>
          </section>

          {/* Monthly breakdown */}
          {Object.keys(revenueByMonth).length > 0 && (
            <Card className="mt-3 p-5">
              <div className="mb-4 text-[13px] font-semibold">Monthly position (Jortt)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-neutral-200 text-neutral-500">
                      <th className="py-2 text-left font-medium">Month</th>
                      <th className="py-2 text-right font-medium">Revenue</th>
                      <th className="py-2 text-right font-medium">OpEx</th>
                      <th className="py-2 text-right font-medium">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(revenueByMonth)
                      .sort(([a], [b]) => parseMonth(a).getTime() - parseMonth(b).getTime())
                      .map(([month, rev]) => {
                        const op = opexByMonth.find((o) => o.month === month)?.total ?? 0;
                        const net = rev - op;
                        return (
                          <tr key={month} className="border-b border-neutral-100 last:border-0">
                            <td className="py-2 font-medium text-neutral-700">{month}</td>
                            <td className="py-2 text-right tabular-nums">{fmt(rev)}</td>
                            <td className="py-2 text-right tabular-nums text-neutral-500">
                              {expensesScopeMissing ? "—" : fmt(op)}
                            </td>
                            <td className={`py-2 text-right tabular-nums font-medium ${net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                              {expensesScopeMissing ? "—" : fmt(net)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </>
  );
};

/* =========================================================================
   VIEW: PILLAR 5 — FORECAST
   ========================================================================= */

/* ============================= GROWTH PLAN 2026 (used in ForecastView) ============================= */

const GrowthPlanSection = () => null

/* =========================================================================
   VIEW: PILLAR 5 — FORECAST
   ========================================================================= */

const ForecastView = () => (
  <>
    <div>
      <div className="text-[12px] font-medium text-neutral-400">Pillar 5</div>
      <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Forecast</h1>
      <p className="mt-1 text-[13px] text-neutral-500">Trend-based cash flow projection and growth plan.</p>
    </div>
    <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
      <Sparkles size={32} className="text-neutral-300" />
      <div className="mt-4 text-[15px] font-semibold text-neutral-700">Forecast not yet available</div>
      <div className="mt-2 max-w-sm text-[13px] text-neutral-400">
        Cash flow forecast builds from connected live data. Connect Xero for payables/receivables, and allow 3+ months of Shopify history to accumulate for trend-based projections.
      </div>
    </div>
  </>
)

/* =========================================================================
   MAIN APP
   ========================================================================= */

export default function FinanceDashboard({ user = null, liveData = null, connections = {} }) {
  const [range, setRange] = useState("30d");
  const [view, setView] = useState("overview");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("updating...");

  useEffect(() => {
    setLastUpdated(new Date().toLocaleString());
  }, []);

  // ── Live data only (no mock fallbacks) ──────────────────────────────
  // Cache may return {__empty:true}/{__error:...} objects — guard everything as arrays/objects.
  const asArr = <T,>(v: any): T[] => (Array.isArray(v) ? v : []);
  const shopifyMarketsArr = asArr<any>(liveData?.shopifyMarkets);
  const activeMarkets     = shopifyMarketsArr.some((m: any) => m?.live) ? shopifyMarketsArr : null;
  const shopifyLive       = !!activeMarkets;
  const jorttObj          = liveData?.jortt && typeof liveData.jortt === "object" && !(liveData.jortt as any).__empty && !(liveData.jortt as any).__error ? liveData.jortt : null;
  const activeOpexByMonth = asArr<any>(jorttObj?.opexByMonth).length > 0 ? jorttObj!.opexByMonth : null;
  const activeOpexDetail  = jorttObj?.opexDetail ?? null;
  const jorttLive         = !!(jorttObj?.live);
  const twData            = asArr<any>(liveData?.tripleWhale).filter((m: any) => m?.live);
  const twLive            = twData.length > 0;
  const loopLive          = asArr<any>(liveData?.loop).some((m: any) => m?.live);
  const liveSources       = [shopifyLive, jorttLive, twLive, loopLive].filter(Boolean).length;

  async function handleLogout() {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const initials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "Z";


  return (
    <div className="min-h-screen bg-neutral-50 font-sans text-neutral-900 antialiased"
      style={{ fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap');
        .tabular-nums { font-variant-numeric: tabular-nums; }
        .mono { font-family: "Geist Mono", ui-monospace, monospace; }
      `}</style>

      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/80 backdrop-blur-xl">
        {/* Northstar accent stripe */}
        <div className="h-[2px] w-full bg-[#0d1d3d]" />
        <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              {/* Northstar wordmark */}
              <div className="flex items-center gap-1.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0d1d3d]">
                  <span
                    className="text-[13px] font-black leading-none text-white"
                    style={{
                      fontFamily: "'Barlow Condensed', 'Oswald', 'Arial Narrow', Impact, sans-serif",
                    }}
                  >
                    Z
                  </span>
                </div>
                <span
                  className="text-[18px] font-black uppercase tracking-[0.04em] leading-none text-[#0d1d3d]"
                  style={{
                    fontFamily: "'Barlow Condensed', 'Oswald', 'Arial Narrow', Impact, sans-serif",
                  }}
                >
                  NORTHSTAR
                </span>
              </div>
              <span className="text-neutral-300">/</span>
              <span className="text-[13px] text-neutral-500">Group B.V.</span>
              <ChevronDown size={13} className="text-neutral-400" />
            </div>
            <span className={`hidden items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium md:inline-flex ${
              liveSources > 0
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}>
              <span className={`h-1 w-1 rounded-full ${liveSources > 0 ? "bg-emerald-500" : "bg-amber-500"}`} />
              {liveSources > 0 ? `Live · ${liveSources} source${liveSources > 1 ? "s" : ""}` : "Demo · mock data"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[12px] text-neutral-500">
              <Search size={12} />
              <span>Search</span>
              <span className="mono ml-4 flex items-center gap-0.5 rounded border border-neutral-200 bg-white px-1 text-[10px] text-neutral-400">
                <Command size={9} /> K
              </span>
            </div>
            {user && (
              <div className="flex items-center gap-2 ml-1">
                <span className="hidden text-[12px] text-neutral-500 md:block">{user.email}</span>
                {user.avatar && !avatarFailed ? (
                  <img
                    src={user.avatar}
                    alt={user.name}
                    className="h-7 w-7 rounded-full ring-2 ring-white object-cover"
                    onError={() => setAvatarFailed(true)}
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#0d1d3d] to-[#1e3a6f] ring-2 ring-white">
                    <span className="text-[10px] font-bold text-white">{initials}</span>
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="rounded-md px-2.5 py-1 text-[12px] font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 transition"
                  title="Sign out"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex w-full gap-4 px-4 py-6 md:gap-6 md:px-6">
        {/* Sidebar */}
        <aside className="hidden w-[220px] shrink-0 md:block">
          <nav className="sticky top-[72px] space-y-0.5">
            <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Dashboard</div>
            <NavItem icon={LayoutDashboard} label="Overview" active={view === "overview"} onClick={() => setView("overview")} />
            <div className="pt-3 px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">The 5 Pillars</div>
            <NavItem icon={Zap} label="Daily P&L" active={view === "daily"} onClick={() => setView("daily")} />
            <NavItem icon={Globe} label="Margin per market" active={view === "markets"} onClick={() => setView("markets")} />
            <NavItem icon={CalendarDays} label="Monthly overview" active={view === "monthly"} onClick={() => setView("monthly")} />
            <NavItem icon={Scale} label="Balance sheet" active={view === "balance"} onClick={() => setView("balance")} />
            <NavItem icon={LineChartIcon} label="Forecast" active={view === "forecast"} onClick={() => setView("forecast")} />

            <div className="pt-3 px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Operations</div>
            <NavItem icon={GitCompareArrows} label="Reconciliation" active={view === "reconciliation"} onClick={() => setView("reconciliation")} badge="4" />
            <NavItem icon={Plug} label="Sync status" active={view === "sync"} onClick={() => setView("sync")} />

            <div className="pt-4">
              <div className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Data sources</div>
              <div className="space-y-1 px-2.5 text-[12px] text-neutral-500">
                <div className="flex items-center justify-between"><span>Shopify Plus</span><StatusDot status={shopifyLive ? "ok" : "error"} /></div>
                <div className="flex items-center justify-between"><span>Triple Whale</span><StatusDot status={twLive ? "ok" : "error"} /></div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">Jortt <span className="text-[9px] text-[#13B5EA] font-medium">â†’ Xero</span></span>
                  <StatusDot status={jorttLive ? "ok" : "error"} />
                </div>
              </div>
            </div>
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {/* Always-visible view switcher (also works on narrow screens) */}
          <div className="mb-5 -mx-4 border-b border-neutral-200 bg-white px-4 py-2 md:hidden">
            <div className="flex gap-1 overflow-x-auto">
              {[
                { id: "overview", label: "Overview", icon: LayoutDashboard },
                { id: "daily", label: "Daily P&L", icon: Zap },
                { id: "markets", label: "Markets", icon: Globe },
                { id: "monthly", label: "Monthly", icon: CalendarDays },
                { id: "balance", label: "Balance", icon: Scale },
                { id: "forecast", label: "Forecast", icon: LineChartIcon },
                { id: "reconciliation", label: "Reconcile", icon: GitCompareArrows },
                { id: "sync", label: "Sync", icon: Plug },
              ].map(t => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    onClick={() => setView(t.id)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition ${
                      view === t.id ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    <Icon size={13} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {view === "overview" && <OverviewView range={range} setRange={setRange} liveMarkets={activeMarkets} twData={twData} loopData={asArr<any>(liveData?.loop)} />}
          {view === "metrics" && <MetricsView twData={twData} />}
          {view === "daily" && (shopifyLive ? <DailyPnLView hourlyData={(liveData as any)?.shopifyHourly} liveMarkets={activeMarkets} twData={twData} jorttData={jorttObj} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Daily P&L</strong> requires Shopify data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect Shopify</button> to view.</div>)}
          {view === "markets" && (activeMarkets ? <MarketsView liveMarkets={activeMarkets} twData={twData} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Margin per Market</strong> requires Shopify & Triple Whale data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect sources</button> to view.</div>)}
          {view === "monthly" && ((shopifyLive || jorttLive) ? <MonthlyView opexByMonth={activeOpexByMonth} opexDetail={activeOpexDetail} jorttLive={jorttLive} shopifyMonthly={asArr<any>(liveData?.shopifyMonthly)} twData={twData} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Monthly Overview</strong> requires Shopify or Jortt data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect a source</button> to view.</div>)}
          {view === "balance" && <BalanceView jorttData={jorttObj} />}
          {view === "forecast" && <ForecastView />}
          {view === "reconciliation" && <ReconciliationView shopifyMarkets={activeMarkets} jorttData={jorttObj} />}
          {view === "sync" && <SyncView initialConnections={connections} />}

          <div className="mt-10 text-center text-[11px] text-neutral-400">
            {liveSources > 0
              ? `${liveSources} live source${liveSources > 1 ? "s" : ""} · ${[shopifyLive && "Shopify", jorttLive && "Jortt", twLive && "Triple Whale", loopLive && "Loop"].filter(Boolean).join(", ")} · ${lastUpdated}`
              : `No live sources connected · Add API keys to .env.local or connect via Sync view`}
          </div>
        </main>
      </div>
    </div>
  );
}






