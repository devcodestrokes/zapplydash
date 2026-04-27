// @ts-nocheck
import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
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
   DATE RANGE HELPERS
   ========================================================================= */

function drStartOfMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}
function drToday() {
  return new Date().toISOString().split("T")[0];
}
function drLastMonthStart() {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return drStartOfMonth(d);
}
function drLastMonthEnd() {
  const d = new Date(); d.setDate(0); // last day of previous month
  return d.toISOString().split("T")[0];
}
function drMonthsAgo(n) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n);
  return drStartOfMonth(d);
}
function drFormatLabel(from, to) {
  const som = drStartOfMonth(), tod = drToday();
  if (from === som && to === tod) return "This month";
  if (from === drLastMonthStart() && to === drLastMonthEnd()) return "Last month";
  const fmt = (s) => {
    const d = new Date(s + "T12:00:00");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  };
  return `${fmt(from)} – ${fmt(to)}`;
}
function monthInRange(monthKey, from, to) {
  if (!monthKey) return false;
  const d = new Date("1 " + monthKey.replace("'", "20"));
  if (isNaN(d.getTime())) return false;
  const ms = new Date(d.getFullYear(), d.getMonth(), 1);
  const me = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return ms <= new Date(to + "T23:59:59") && me >= new Date(from + "T00:00:00");
}

/* =========================================================================
   DATE RANGE PICKER — inline calendar
   ========================================================================= */

const CalendarPicker = ({ from, to, onSelect }) => {
  const todayStr = drToday();
  const initD    = from ? new Date(from + "T12:00:00") : new Date();
  const [vy, setVy] = useState(initD.getFullYear());
  const [vm, setVm] = useState(initD.getMonth());
  const [anchor,  setAnchor]  = useState(null);
  const [hovered, setHovered] = useState(null);

  // Reset picking state when external from/to changes (preset applied)
  useEffect(() => { setAnchor(null); setHovered(null); }, [from, to]);

  // Calendar math helpers
  const ds   = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const dim  = (y, m)    => new Date(y, m + 1, 0).getDate();
  const fdow = (y, m)    => { const d = new Date(y, m, 1).getDay(); return d === 0 ? 6 : d - 1; };

  const prevMonth = () => { const d = new Date(vy, vm - 1, 1); setVy(d.getFullYear()); setVm(d.getMonth()); };
  const nextMonth = () => {
    const d = new Date(vy, vm + 1, 1);
    if (ds(d.getFullYear(), d.getMonth(), 1) <= todayStr) { setVy(d.getFullYear()); setVm(d.getMonth()); }
  };
  const canNext = new Date(vy, vm + 1, 1) <= new Date();

  const handleDay = (dateStr) => {
    if (!anchor) {
      setAnchor(dateStr);
    } else {
      const [s, e] = dateStr < anchor ? [dateStr, anchor] : [anchor, dateStr];
      onSelect(s, e);
      setAnchor(null); setHovered(null);
    }
  };

  // Display range: while picking, preview anchor→hover; otherwise show committed from/to
  const dFrom = anchor ? (hovered && hovered < anchor ? hovered : anchor) : from;
  const dTo   = anchor ? (hovered && hovered > anchor ? hovered : anchor) : to;

  const numDays = dim(vy, vm);
  const offset  = fdow(vy, vm);
  const monthLabel = new Date(vy, vm, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const cells = [...Array(offset).fill(null), ...Array.from({ length: numDays }, (_, i) => ds(vy, vm, i + 1))];

  return (
    <div className="select-none">
      {/* Month navigation */}
      <div className="mb-2 flex items-center justify-between px-0.5">
        <button onClick={prevMonth} className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100">
          <ChevronDown size={13} className="rotate-90" />
        </button>
        <span className="text-[12px] font-semibold text-neutral-800">{monthLabel}</span>
        <button onClick={nextMonth} disabled={!canNext} className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition hover:bg-neutral-100 disabled:opacity-25 disabled:cursor-default">
          <ChevronDown size={13} className="-rotate-90" />
        </button>
      </div>

      {/* Weekday headers */}
      <div className="mb-0.5 grid grid-cols-7">
        {DAYS.map(d => <div key={d} className="py-0.5 text-center text-[10px] font-medium text-neutral-400">{d}</div>)}
      </div>

      {/* Day cells */}
      <div className="grid grid-cols-7">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={`_${i}`} className="h-8" />;

          const future   = dateStr > todayStr;
          const isToday  = dateStr === todayStr;
          const isStart  = dateStr === dFrom;
          const isEnd    = dateStr === dTo;
          const inRange  = dFrom && dTo && dFrom !== dTo && dateStr > dFrom && dateStr < dTo;
          const isEdge   = isStart || isEnd;
          const bothEdge = isStart && isEnd;
          const dayNum   = +dateStr.slice(8);

          return (
            <div
              key={dateStr}
              className={[
                "relative flex h-8 items-center justify-center",
                inRange                        ? "bg-neutral-100"    : "",
                isStart && dTo && !bothEdge    ? "rounded-l-full"   : "",
                isEnd   && dFrom && !bothEdge  ? "rounded-r-full"   : "",
              ].join(" ")}
            >
              <button
                onClick={() => !future && handleDay(dateStr)}
                onMouseEnter={() => anchor && !future && setHovered(dateStr)}
                onMouseLeave={() => anchor && setHovered(null)}
                disabled={future}
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-medium transition",
                  future   ? "cursor-default text-neutral-200"                             : "",
                  isEdge   ? "bg-neutral-900 text-white"                                   : "",
                  isToday && !isEdge ? "ring-1 ring-inset ring-neutral-400 text-neutral-700" : "",
                  !isEdge && !future ? "text-neutral-700 hover:bg-neutral-200"             : "",
                ].join(" ")}
              >
                {dayNum}
              </button>
            </div>
          );
        })}
      </div>

      {/* Hint line */}
      <p className="mt-2 text-center text-[10px] text-neutral-400">
        {anchor ? "Now click to select end date" : "Click a date to start selection"}
      </p>
    </div>
  );
};

const DateRangePicker = ({ from, to, onApply, loading = false }) => {
  const [open, setOpen]           = useState(false);
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo,   setPendingTo]   = useState(to);
  const ref = useRef(null);

  // Keep pending in sync if parent resets committed range externally
  useEffect(() => { setPendingFrom(from); setPendingTo(to); }, [from, to]);

  useEffect(() => {
    function outside(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, []);

  const PRESETS = [
    { label: "This month",    from: drStartOfMonth(),  to: drToday() },
    { label: "Last month",    from: drLastMonthStart(), to: drLastMonthEnd() },
    { label: "Last 3 months", from: drMonthsAgo(3),     to: drToday() },
    { label: "Last 6 months", from: drMonthsAgo(6),     to: drToday() },
  ];

  const handleApply = () => {
    if (!pendingFrom || !pendingTo) return;
    onApply(pendingFrom, pendingTo);
    setOpen(false);
  };

  const pendingChanged = pendingFrom !== from || pendingTo !== to;

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60"
        disabled={loading}
      >
        {loading
          ? <RefreshCw size={13} className="text-neutral-400 animate-spin" />
          : <Calendar size={13} className="text-neutral-400" />
        }
        {drFormatLabel(from, to)}
        <ChevronDown size={12} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-[268px] rounded-xl border border-neutral-200 bg-white p-3 shadow-xl shadow-neutral-200/60">
          {/* Presets */}
          <div className="mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Quick select</div>
          <div className="mb-3 grid grid-cols-2 gap-1">
            {PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => { setPendingFrom(p.from); setPendingTo(p.to); }}
                className={`rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition ${
                  p.from === pendingFrom && p.to === pendingTo
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendar */}
          <div className="border-t border-neutral-100 pt-3">
            <div className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Custom range</div>
            <CalendarPicker
              from={pendingFrom}
              to={pendingTo}
              onSelect={(f, t) => { setPendingFrom(f); setPendingTo(t); }}
            />
          </div>

          {/* Pending range preview */}
          {pendingFrom && pendingTo && (
            <div className="mt-2 flex items-center justify-between rounded-md bg-neutral-50 px-2.5 py-1.5">
              <span className="text-[11px] text-neutral-500">{drFormatLabel(pendingFrom, pendingTo)}</span>
            </div>
          )}

          {/* Apply button */}
          <button
            onClick={handleApply}
            disabled={!pendingFrom || !pendingTo}
            className={`mt-2 w-full rounded-lg px-3 py-2 text-[12px] font-semibold transition ${
              pendingChanged
                ? "bg-neutral-900 text-white hover:bg-neutral-700"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            }`}
          >
            {pendingChanged ? "Apply & sync" : "Apply"}
          </button>
        </div>
      )}
    </div>
  );
};

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

const OverviewView = ({ dateRange, onDateChange, liveMarkets = null, twData = [], subData = [], shopifyMonthly = null, jorttData = null, rangeData = null, rangeSyncing = false }) => {
  const [chartsReady, setChartsReady] = useState(false);
  useEffect(() => { setChartsReady(true); }, []);

  // When a custom-range sync has returned data, use it in place of the live props
  const effectiveMarkets = Array.isArray(rangeData?.shopifyMarkets) ? rangeData.shopifyMarkets : liveMarkets;
  const effectiveTWData  = rangeData?.tripleWhale
    ? rangeData.tripleWhale.filter(m => m.live)
    : twData;

  // Is the selected range the current month?
  const isCurrentMonth = useMemo(() => {
    if (rangeData) return false; // always treat synced custom-range data as historical
    const som = drStartOfMonth(), tod = drToday();
    return dateRange.from === som && dateRange.to === tod;
  }, [dateRange, rangeData]);

  // Shopify monthly rows that fall within the selected date range
  const rangeShopifyMonths = useMemo(() =>
    (shopifyMonthly ?? []).filter(m => monthInRange(m.month, dateRange.from, dateRange.to)),
    [shopifyMonthly, dateRange]);

  // Jortt months in range
  const rangeJorttRevenue = useMemo(() => {
    if (!jorttData?.revenueByMonth) return null;
    const total = Object.entries(jorttData.revenueByMonth)
      .filter(([mk]) => monthInRange(mk, dateRange.from, dateRange.to))
      .reduce((s, [, v]) => s + v, 0);
    return total > 0 ? total : null;
  }, [jorttData, dateRange]);

  const rangeJorttExpenses = useMemo(() => {
    if (!jorttData?.expensesByMonth) return null;
    const total = Object.entries(jorttData.expensesByMonth)
      .filter(([mk]) => monthInRange(mk, dateRange.from, dateRange.to))
      .reduce((s, [, v]) => s + v, 0);
    return total > 0 ? total : null;
  }, [jorttData, dateRange]);

  // Revenue: rangeData (fresh sync) > current-month live > monthly cache > Jortt
  const liveRevenueMTD  = effectiveMarkets?.filter(m => m.live).reduce((s, m) => s + (m.revenue ?? 0), 0) ?? null;
  const liveOrdersMTD   = effectiveMarkets?.filter(m => m.live).reduce((s, m) => s + (m.orders ?? 0), 0) ?? null;
  const rangeRevenue = rangeData
    ? liveRevenueMTD   // effectiveMarkets is rangeData.shopifyMarkets — fresh Shopify data
    : isCurrentMonth
      ? liveRevenueMTD
      : rangeShopifyMonths.length > 0
        ? rangeShopifyMonths.reduce((s, m) => s + ((m.revenue ?? 0) - (m.refunds ?? 0)), 0)
        : (rangeJorttRevenue ?? null);
  const rangeOrders = rangeData
    ? liveOrdersMTD
    : isCurrentMonth
      ? liveOrdersMTD
      : rangeShopifyMonths.length > 0 ? rangeShopifyMonths.reduce((s, m) => s + (m.orders ?? 0), 0) : null;
  const rangeAOV = rangeRevenue && rangeOrders ? rangeRevenue / rangeOrders : null;

  // Revenue source label
  const revenueSourceLabel = rangeData
    ? `${drFormatLabel(dateRange.from, dateRange.to)} · all stores · synced`
    : isCurrentMonth
      ? "MTD · all stores · Shopify live"
      : rangeShopifyMonths.length > 0
        ? `${rangeShopifyMonths.length} month${rangeShopifyMonths.length > 1 ? "s" : ""} · Shopify NL · historical`
        : rangeJorttRevenue ? "Jortt invoices · historical" : "No Shopify data for this range";

  const liveAOV = isCurrentMonth ? (liveRevenueMTD && liveOrdersMTD ? liveRevenueMTD / liveOrdersMTD : null) : rangeAOV;
  const liveTWNL        = effectiveTWData?.find(t => t.market === "NL" && t.live);
  // Ad spend: NL only (EUR). Other markets use GBP/USD — summing currencies gives wrong totals.
  const liveAdSpendNL   = liveTWNL?.adSpend ?? null;
  const liveAdSpend     = liveAdSpendNL;   // shown as NL (EUR) ad spend
  // ROAS: use TW NL's blended ROAS directly (it accounts for all channels for that store)
  const liveROAS        = liveTWNL?.roas ?? null;
  // MER: compute from TW NL's own revenue and ad spend to stay in one currency
  const liveMER         = (liveTWNL?.revenue && liveTWNL?.adSpend && liveTWNL.adSpend > 0)
    ? +(liveTWNL.revenue / liveTWNL.adSpend).toFixed(2)
    : null;
  const liveNCPA        = liveTWNL?.ncpa ?? null;
  const liveLtvCpa      = liveTWNL?.ltvCpa ?? null;
  // Real P&L from TW NL (these are real figures, not estimates)
  const liveGrossProfit = liveTWNL?.grossProfit ?? null;
  const liveCOGS        = liveTWNL?.cogs ?? null;
  const liveNetProfit   = liveTWNL?.netProfit ?? null;
  // Sum gross profit across all live TW markets that have it
  const twTotalGrossProfit = effectiveTWData?.filter(t => t.live && t.grossProfit != null).reduce((s, t) => s + (t.grossProfit ?? 0), 0) || null;
  const twTotalNetProfit   = effectiveTWData?.filter(t => t.live && t.netProfit   != null).reduce((s, t) => s + (t.netProfit   ?? 0), 0) || null;
  const twTotalAdSpend     = effectiveTWData?.filter(t => t.live && t.adSpend     != null).reduce((s, t) => s + (t.adSpend     ?? 0), 0) || null;
  const liveLoop        = subData.find(s => s.market === "UK") ?? null;
  const liveJuo         = subData.find(s => s.market === "NL") ?? null;
  const liveMRR         = subData.length > 0 ? subData.reduce((s, m) => s + (m.mrr ?? 0), 0) : null;
  return (<>
    <div className="flex items-end justify-between">
      <div>
        <div className="text-[12px] font-medium text-neutral-400">Overview</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Finance</h1>
        <p className="mt-1 text-[13px] text-neutral-500">
          Live revenue from Shopify, ad performance from Triple Whale, reconciled nightly against Jortt.
        </p>
      </div>
      <DateRangePicker from={dateRange.from} to={dateRange.to} onApply={onDateChange} loading={rangeSyncing} />
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
              {rangeRevenue !== null ? (
                <>
                  <span className="text-[44px] font-semibold tracking-tight tabular-nums leading-none">
                    €{Math.round(rangeRevenue).toLocaleString()}
                  </span>
                  {isCurrentMonth
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>Live</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium text-neutral-500">Historical</span>
                  }
                </>
              ) : (
                <span className="text-[44px] font-semibold tracking-tight tabular-nums leading-none text-neutral-300">—</span>
              )}
            </div>
            <div className="mt-1 text-[12px] text-neutral-400">{rangeRevenue !== null ? revenueSourceLabel : "Shopify not connected"}</div>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">Orders</div>
              <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{rangeOrders !== null ? rangeOrders.toLocaleString() : "—"}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-medium uppercase tracking-wider text-neutral-400">AOV</div>
              <div className="mt-0.5 text-[16px] font-semibold tabular-nums">{rangeAOV !== null ? `€${rangeAOV.toFixed(2)}` : liveAOV !== null ? `€${liveAOV.toFixed(2)}` : "—"}</div>
            </div>
          </div>
        </div>
      </Card>
    </section>

    {/* Profit row — real TW figures (current month) or Jortt (historical) */}
    {rangeRevenue !== null && (
    <section className="mt-3 grid grid-cols-3 gap-3">
      {(() => {
        const rev = rangeRevenue ?? 0;
        // For historical ranges, fall back to Jortt data
        const grossP = isCurrentMonth ? twTotalGrossProfit : (rangeJorttRevenue && rangeJorttExpenses ? rangeJorttRevenue - rangeJorttExpenses : twTotalGrossProfit);
        const costs  = isCurrentMonth ? liveCOGS : (rangeJorttExpenses ?? liveCOGS);
        const netP   = isCurrentMonth ? twTotalNetProfit : (grossP != null ? grossP : twTotalNetProfit);
        const src    = isCurrentMonth ? "Triple Whale" : (rangeJorttRevenue ? "Jortt · historical" : "Triple Whale (MTD)");
        return [
          {
            icon: Sparkles,
            label: "Gross profit",
            value: grossP != null ? `€${Math.round(grossP).toLocaleString()}` : "—",
            pct: grossP != null && rev > 0 ? `${((grossP / rev) * 100).toFixed(1)}% margin` : null,
            sub: grossP != null ? src : "Connect Triple Whale",
            live: grossP != null,
          },
          {
            icon: Wallet,
            label: isCurrentMonth ? "COGS" : "Expenses",
            value: costs != null ? `€${Math.round(costs).toLocaleString()}` : "—",
            pct: costs != null && rev > 0 ? `${((costs / rev) * 100).toFixed(1)}% of revenue` : null,
            sub: costs != null ? src : "Connect Triple Whale",
            live: costs != null,
          },
          {
            icon: TrendingUp,
            label: "Net profit",
            value: netP != null ? `€${Math.round(netP).toLocaleString()}` : "—",
            pct: netP != null && rev > 0 ? `${((netP / rev) * 100).toFixed(1)}% margin` : null,
            sub: netP != null ? src : "Connect Triple Whale",
            live: netP != null,
          },
        ];
      })().map((s) => (
        <Card key={s.label} className={`p-5 transition hover:border-neutral-300 ${!s.live ? "opacity-50" : ""}`}>
          <div className="flex items-center gap-2 text-[13px] font-medium text-neutral-500">
            <s.icon size={14} />
            <span>{s.label}</span>
          </div>
          <div className="mt-3 text-[28px] font-semibold tracking-tight tabular-nums">{s.value}</div>
          {s.pct && <div className="mt-0.5 text-[11px] font-medium text-neutral-500">{s.pct}</div>}
          <div className="mt-1 text-[12px] text-neutral-400">{s.sub}</div>
        </Card>
      ))}
    </section>
    )}

    {/* Syncing overlay */}
    {rangeSyncing && (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-[12px] text-blue-700">
        <RefreshCw size={13} className="shrink-0 animate-spin" />
        Fetching data for selected period from Shopify &amp; Triple Whale…
      </div>
    )}

    {/* Historical range notice for TW metrics */}
    {!isCurrentMonth && !rangeData && !rangeSyncing && (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-700">
        <Info size={13} className="shrink-0" />
        Triple Whale metrics show <strong>current month to date</strong>. Select a range and click <strong>Apply &amp; sync</strong> to load accurate data for any period.
        {rangeJorttRevenue && (
          <span className="ml-1">Jortt shows <strong>€{Math.round(rangeJorttRevenue).toLocaleString()}</strong> revenue for this range{rangeJorttExpenses ? ` · €${Math.round(rangeJorttExpenses).toLocaleString()} expenses` : ""}.</span>
        )}
      </div>
    )}

    {/* Synced-range confirmation banner */}
    {rangeData && !rangeSyncing && (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2.5 text-[12px] text-emerald-700">
        <CircleCheck size={13} className="shrink-0" />
        Showing Shopify &amp; Triple Whale data for <strong>{drFormatLabel(dateRange.from, dateRange.to)}</strong>. All metrics reflect this exact period.
      </div>
    )}

    {/* Customer economics row */}
    <section className="mt-3">
      <div className="mb-2 flex items-center gap-2 px-1">
        <BrandIcon brand="triplewhale" size={12} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Customer economics</span>
        <div className="h-px flex-1 bg-neutral-200" />
        <span className="text-[10px] text-neutral-400">Triple Whale · {isCurrentMonth ? "per acquired customer" : "current MTD only"}</span>
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
            sub: liveMER !== null ? "Revenue ÷ ad spend · NL" : "Triple Whale not connected",
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
            delta: null,
            positive: false,
            sub: liveAdSpend !== null ? "Triple Whale · NL store (EUR)" : "Triple Whale not connected",
            live: liveAdSpend !== null,
          },
          {
            icon: Activity,
            label: "Blended ROAS",
            value: liveROAS !== null ? `${liveROAS.toFixed(2)}x` : "—",
            delta: null,
            positive: true,
            sub: liveROAS !== null ? "Triple Whale · NL store" : "Triple Whale not connected",
            live: liveROAS !== null,
          },
        ].map((s) => (
          <Card key={s.label} className={`p-4 transition ${s.live ? 'hover:border-neutral-300' : 'opacity-60'}`}>
            <div className="flex items-center gap-2 text-[12px] font-medium text-neutral-500">
              <s.icon size={13} />
              <span>{s.label}</span>
            </div>
            <div className="mt-2 text-[22px] font-semibold tracking-tight tabular-nums">{s.value}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{s.sub}</div>
          </Card>
        ))}
      </div>
      {/* Per-market ad spend breakdown — each in its own currency */}
      {effectiveTWData.filter(t => t.live && t.adSpend != null).length > 0 && (
        <div className="mt-3 rounded-lg border border-neutral-100 bg-neutral-50 p-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Ad spend by market · own currency</div>
          <div className="flex flex-wrap gap-4">
            {effectiveTWData.filter(t => t.live && t.adSpend != null).map(t => {
              const sym = t.market === "UK" ? "£" : t.market === "US" ? "$" : "€";
              return (
                <div key={t.market}>
                  <span className="text-[11px] text-neutral-500">{t.flag} {t.market}</span>
                  <span className="ml-1.5 text-[13px] font-semibold tabular-nums">{sym}{Math.round(t.adSpend).toLocaleString()}</span>
                  {t.roas != null && <span className="ml-1 text-[11px] text-neutral-400">· {t.roas.toFixed(2)}x ROAS</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>

    {/* Subscriptions — Juo (NL) + Loop (UK/US/EU) */}
    {liveMRR !== null ? (
      <Card className="mt-3 p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="text-[13px] font-semibold">Subscriptions</div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>
          <div className="ml-auto text-[11px] text-neutral-400">
            Combined MRR: <span className="font-semibold text-neutral-700">€{Math.round(liveMRR).toLocaleString()}</span>
          </div>
        </div>

        {/* Per-market rows */}
        <div className="space-y-4">
          {subData.map(m => {
            const sym = m.currency === "GBP" ? "£" : m.currency === "USD" ? "$" : "€";
            const platformLabel = m.platform === "juo" ? "Juo" : "Loop";
            return (
              <div key={m.market} className="rounded-lg border border-neutral-100 bg-neutral-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-[13px]">{m.flag}</span>
                  <span className="text-[12px] font-semibold text-neutral-700">{m.market}</span>
                  <span className="text-[10px] text-neutral-400">{platformLabel}</span>
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">Live</span>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">MRR</div>
                    <div className="mt-1 text-[20px] font-semibold tabular-nums">{sym}{Math.round(m.mrr ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Active</div>
                    <div className="mt-1 text-[20px] font-semibold tabular-nums">{(m.activeSubs ?? 0).toLocaleString()}</div>
                    <div className="mt-0.5 text-[10px] text-neutral-400">{m.totalFetched ? `of ${m.totalFetched.toLocaleString()} fetched` : ""}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">ARPU</div>
                    <div className="mt-1 text-[20px] font-semibold tabular-nums">{m.arpu != null ? `${sym}${m.arpu.toFixed(2)}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">New MTD</div>
                    <div className="mt-1 text-[20px] font-semibold tabular-nums">{m.newThisMonth ?? "—"}</div>
                    <div className="mt-0.5 text-[10px] text-neutral-400">
                      {m.churnedThisMonth != null ? `${m.churnedThisMonth} churned` : ""}
                      {m.churnRate != null ? ` · ${m.churnRate}% rate` : ""}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    ) : (
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center text-[13px] text-neutral-500">
        <strong>Subscription data not available</strong> — set <code className="text-[11px]">JUO_NL_API_KEY</code> or <code className="text-[11px]">LOOP_UK_API_KEY</code> in .env.local.
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
  const shopifyTotal = Array.isArray(shopifyMarkets) ? shopifyMarkets.filter(m => m?.live).reduce((s, m) => s + (m.revenue ?? 0), 0) : null;
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

const DailyPnLView = ({ dailyData = null, twData = [] }) => {
  const todayLabel = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const currentHour = (new Date().getUTCHours() + 2) % 24; // Amsterdam CEST

  const liveMarkets = dailyData?.markets?.filter(m => m.live) ?? [];
  const nlMarket    = liveMarkets.find(m => m.code === "NL");
  const ukMarket    = liveMarkets.find(m => m.code === "UK");

  // NL hourly chart data — only show hours up to current + 1
  const nlHourly = nlMarket?.hourly?.slice(0, currentHour + 1) ?? [];
  const chartData = nlHourly.map(h => ({
    hour: `${String(h.hour).padStart(2, "0")}:00`,
    revenue: h.revenue,
    orders: h.orders,
  }));

  // Total orders across all markets today
  const totalOrders   = liveMarkets.reduce((s, m) => s + (m.orders ?? 0), 0);
  const totalRevenueTip = liveMarkets.map(m => `${m.flag} ${m.currency === "GBP" ? "£" : m.currency === "USD" ? "$" : "€"}${Math.round(m.revenue ?? 0).toLocaleString()}`).join("  ·  ");

  // TW MTD ROAS for context
  const nlTW = twData.find(t => t.market === "NL" && t.live);
  const ukTW = twData.find(t => t.market === "UK" && t.live);

  if (!dailyData) {
    return (
      <>
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 1</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Daily P&L Tracker</h1>
          <p className="mt-1 text-[13px] text-neutral-500">Today's revenue by hour across all markets.</p>
        </div>
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <Clock size={32} className="text-neutral-300" />
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">Loading today's data...</div>
          <div className="mt-2 max-w-sm text-[13px] text-neutral-400">Fetching orders from Shopify. This may take a moment.</div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 1</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Daily P&L Tracker</h1>
          <p className="mt-1 text-[13px] text-neutral-500">{todayLabel}</p>
        </div>
        <div className="text-right text-[11px] text-neutral-400">
          <div className="font-medium">Live · {totalOrders.toLocaleString()} orders today</div>
          <div className="mt-0.5 text-neutral-300">{totalRevenueTip}</div>
        </div>
      </div>

      {/* Market cards */}
      <section className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {liveMarkets.map(m => {
          const tw = twData.find(t => t.market === m.code && t.live);
          const sym = m.currency === "GBP" ? "£" : m.currency === "USD" ? "$" : "€";
          return (
            <Card key={m.code} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-medium text-neutral-500">{m.flag} {m.name ?? m.code}</span>
                {tw?.roas != null && (
                  <span className="text-[10px] font-medium text-neutral-400">{tw.roas.toFixed(2)}× ROAS</span>
                )}
              </div>
              <div className="mt-2 text-[26px] font-semibold tabular-nums tracking-tight">
                {sym}{Math.round(m.revenue ?? 0).toLocaleString()}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-neutral-400">
                <span>{(m.orders ?? 0).toLocaleString()} orders</span>
                {m.aov > 0 && <span>AOV {sym}{m.aov.toFixed(0)}</span>}
              </div>
            </Card>
          );
        })}
      </section>

      {/* Hourly revenue chart — NL store */}
      {chartData.length > 0 && (
        <section className="mt-4">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold">Hourly revenue · NL</div>
                <div className="text-[11px] text-neutral-400">Amsterdam time (CEST) · paid orders only</div>
              </div>
              <div className="text-right">
                <div className="text-[20px] font-semibold tabular-nums">
                  €{Math.round(nlMarket?.revenue ?? 0).toLocaleString()}
                </div>
                <div className="text-[11px] text-neutral-400">today so far</div>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} margin={{ top: 4, right: 0, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} interval={1} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `€${(v/1000).toFixed(0)}k` : `€${v}`} />
                <Tooltip
                  formatter={(v, name) => name === "revenue" ? [`€${Number(v).toLocaleString()}`, "Revenue"] : [v, "Orders"]}
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
                />
                <Bar dataKey="revenue" fill="#0d1d3d" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </section>
      )}

      {/* UK row for context */}
      {ukMarket?.revenue > 0 && (
        <section className="mt-3 grid grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="text-[12px] font-medium text-neutral-400 uppercase tracking-wide">UK revenue today</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">£{Math.round(ukMarket.revenue).toLocaleString()}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{ukMarket.orders} orders · AOV £{ukMarket.aov?.toFixed(0)}</div>
          </Card>
          {ukTW?.roas != null && (
            <Card className="p-4">
              <div className="text-[12px] font-medium text-neutral-400 uppercase tracking-wide">UK ROAS (MTD)</div>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{ukTW.roas.toFixed(2)}×</div>
              <div className="mt-0.5 text-[11px] text-neutral-400">Ad spend £{Math.round(ukTW.adSpend ?? 0).toLocaleString()} MTD</div>
            </Card>
          )}
        </section>
      )}

      {/* NL TW context */}
      {nlTW && (
        <section className="mt-3 grid grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">NL Ad Spend (MTD)</div>
            <div className="mt-1 text-[18px] font-semibold tabular-nums">€{Math.round(nlTW.adSpend ?? 0).toLocaleString()}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">Triple Whale</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">NL ROAS (MTD)</div>
            <div className="mt-1 text-[18px] font-semibold tabular-nums">{nlTW.roas?.toFixed(2)}×</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">Triple Whale</div>
          </Card>
          <Card className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">NL Gross Profit (MTD)</div>
            <div className="mt-1 text-[18px] font-semibold tabular-nums">€{Math.round(nlTW.grossProfit ?? 0).toLocaleString()}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">Triple Whale</div>
          </Card>
        </section>
      )}
    </>
  );
};

/* =========================================================================
   VIEW: PILLAR 2 — MARGIN PER MARKET
   ========================================================================= */

const MarketsView = ({ liveMarkets = null, twData = [] } = {}) => {
  const [sortBy, setSortBy] = useState("revenue");
  const [allocation, setAllocation] = useState("revenue-weighted");

  const activeMarkets = (liveMarkets ?? [])
    .filter(m => m.live)
    .map(m => {
      const tw = twData.find(t => t.market === m.code && t.live);
      const revenue = m.revenue ?? 0;
      const adSpend = tw?.adSpend ?? null;
      const grossMarginPct = tw?.grossProfit != null && revenue > 0 ? +(tw.grossProfit / revenue * 100).toFixed(1) : null;
      const contributionMarginPct = tw?.grossProfit != null && adSpend != null && revenue > 0
        ? +((tw.grossProfit - adSpend) / revenue * 100).toFixed(1) : null;
      return { ...m, adSpend, grossMargin: grossMarginPct, contributionMargin: contributionMarginPct, roas: tw?.roas ?? null, cac: tw?.ncpa ?? null };
    });
  if (activeMarkets.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-8 text-center text-[13px] text-neutral-500">
        No market data available — connect Shopify to see margin per market.
      </div>
    );
  }

  const sorted = [...activeMarkets].sort((a, b) => b[sortBy] - a[sortBy]);
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
      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {sorted.map(m => (
          <Card key={m.code} className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[20px]">{m.flag ?? m.code}</span>
              <span className={`text-[10px] font-medium ${m.contributionMargin != null ? (m.contributionMargin >= 30 ? "text-emerald-600" : m.contributionMargin >= 20 ? "text-neutral-600" : "text-amber-600") : "text-neutral-400"}`}>
                {m.contributionMargin != null ? `${m.contributionMargin}%` : "—"}
              </span>
            </div>
            <div className="mt-2 text-[11px] font-medium text-neutral-500">{m.name ?? m.code}</div>
            <div className="mt-1 text-[16px] font-semibold tabular-nums">€{(m.revenue / 1000).toFixed(1)}k</div>
          </Card>
        ))}
      </section>

      {/* Main markets table */}
      <Card className="mt-3">
        <div className="border-b border-neutral-100 px-5 py-4">
          <div className="text-[13px] font-semibold">Full market breakdown</div>
          <div className="text-[12px] text-neutral-400">
            Ad spend allocation method: <span className="font-medium capitalize">{allocation}</span>
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
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span>{m.flag}</span>
                        <span className="font-medium">{m.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium">€{m.revenue.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">{m.orders}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">€{(m.revenue / m.orders).toFixed(0)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">{m.adSpend != null ? `€${m.adSpend.toLocaleString()}` : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {m.cac != null ? (
                        <span className={m.cac > 40 ? "text-rose-600 font-medium" : m.cac > 30 ? "text-amber-600" : "text-neutral-900"}>
                          €{m.cac.toFixed(2)}
                        </span>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-neutral-600">{m.grossMargin != null ? `${m.grossMargin}%` : "—"}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {m.contributionMargin != null ? (
                        <span className={m.contributionMargin >= 30 ? "text-emerald-600 font-medium" : m.contributionMargin >= 20 ? "text-neutral-900" : "text-amber-600 font-medium"}>
                          {m.contributionMargin}%
                        </span>
                      ) : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1 w-20 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-neutral-900" style={{ width: `${pct}%` }} />
                        </div>
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

const OpExBreakdownSection = ({ opexByMonth: data = null, opexDetail: detail = null, jorttLive = false } = {}) => {
  const [activeCategory, setActiveCategory] = useState("team");
  if (!data || data.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-center text-[13px] text-neutral-500">
        <strong>OpEx breakdown not available</strong> — requires Jortt with purchase invoice scope.
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

const MonthlyView = ({ opexByMonth: liveOpexByMonth, opexDetail: liveOpexDetail, jorttLive, shopifyMonthly, twData = [] } = {}) => {
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
      <OpExBreakdownSection opexByMonth={activeOpexByMonth} opexDetail={activeOpexDetail} jorttLive={jorttLive} />

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

const BalanceView = ({ jorttData = null, xeroData = null, shopifyMarkets = null, twData = [] }) => {
  // Xero is the primary source; Jortt is fallback
  const src       = xeroData?.live ? "xero" : jorttData?.live ? "jortt" : null;
  const hasData   = !!src;
  const srcLabel  = src === "xero" ? "Xero" : "Jortt";

  // ── Key figures — Xero first, Jortt fallback ──────────────────────────────
  const totalAssets       = xeroData?.totalAssets       ?? null;
  const currentAssets     = xeroData?.currentAssets     ?? null;
  const fixedAssets       = xeroData?.fixedAssets       ?? null;
  const totalLiabilities  = xeroData?.totalLiabilities  ?? null;
  const currentLiabilities = xeroData?.currentLiabilities ?? null;
  const equity            = xeroData?.equity            ?? null;
  const cash              = xeroData?.cashBalance        ?? jorttData?.cashBalance ?? null;
  const accountsReceivable = xeroData?.accountsReceivable ?? jorttData?.accountsReceivable ?? null;
  const overdueAmount     = xeroData?.overdueAmount      ?? null;
  const unpaidCount       = xeroData?.unpaidInvoiceCount ?? jorttData?.unpaidInvoiceCount ?? 0;

  // YTD P&L
  const ytdRevenue   = xeroData?.ytdRevenue   ?? null;
  const ytdExpenses  = xeroData?.ytdExpenses  ?? null;
  const ytdNetProfit = xeroData?.ytdNetProfit ?? null;

  // 12-month revenue totals for fallback (Jortt)
  const jorttRevTotal = jorttData?.revenueByMonth
    ? Object.values(jorttData.revenueByMonth).reduce((s, v) => s + v, 0) : 0;
  const jorttExpTotal = jorttData?.expensesByMonth
    ? Object.values(jorttData.expensesByMonth).reduce((s, v) => s + v, 0) : 0;

  // Revenue trend chart data — Xero first
  const revenueMonths = useMemo(() => {
    const byMonth = xeroData?.revenueByMonth ?? jorttData?.revenueByMonth ?? {};
    return Object.entries(byMonth)
      .filter(([k]) => k)
      .sort(([a], [b]) => parseMonthKey(a) - parseMonthKey(b))
      .map(([month, revenue]) => ({ month, revenue: Math.round(revenue) }));
  }, [xeroData, jorttData]);

  const nlTW = twData.find(t => t.market === "NL" && t.live);

  if (!hasData) {
    return (
      <>
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 4</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Balance Sheet</h1>
          <p className="mt-1 text-[13px] text-neutral-500">Financial position · assets, liabilities, equity.</p>
        </div>
        <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-neutral-200 bg-neutral-50 py-16 text-center">
          <Scale size={32} className="text-neutral-300" />
          <div className="mt-4 text-[15px] font-semibold text-neutral-700">No accounting data yet</div>
          <div className="mt-2 max-w-sm text-[13px] text-neutral-400">
            Click <strong>Sync</strong> to fetch data from Xero. Balance sheet will populate with assets, liabilities, equity, and cash positions from your accounting system.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 4</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Balance Sheet</h1>
          <p className="mt-1 text-[13px] text-neutral-500">Financial position · assets, liabilities, equity · via {srcLabel}</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
          {srcLabel} live
        </span>
      </div>

      {/* Assets, Liabilities, Equity */}
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* Assets */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50">
              <Wallet size={14} className="text-emerald-600" />
            </div>
            <div className="text-[13px] font-semibold">Assets</div>
          </div>
          <div className="space-y-3">
            {currentAssets != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">Current assets</span>
                <span className="text-[13px] font-medium tabular-nums">€{currentAssets.toLocaleString()}</span>
              </div>
            )}
            {fixedAssets != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">Fixed assets</span>
                <span className="text-[13px] font-medium tabular-nums">€{fixedAssets.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-500">Cash &amp; bank</span>
              <span className="text-[13px] font-medium tabular-nums">
                {cash != null ? `€${Math.round(cash).toLocaleString()}` : <span className="text-neutral-300 text-[11px]">—</span>}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-500">Accounts receivable</span>
              <span className="text-[13px] font-medium tabular-nums">
                {accountsReceivable != null ? `€${Math.round(accountsReceivable).toLocaleString()}` : <span className="text-neutral-400 text-[12px]">€0</span>}
              </span>
            </div>
            <div className="border-t border-neutral-100 pt-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-neutral-700">Total assets</span>
              <span className="text-[14px] font-bold tabular-nums text-emerald-700">
                {totalAssets != null
                  ? `€${totalAssets.toLocaleString()}`
                  : cash != null || accountsReceivable != null
                    ? `€${Math.round((cash ?? 0) + (accountsReceivable ?? 0)).toLocaleString()}`
                    : "—"}
              </span>
            </div>
          </div>
        </Card>

        {/* Liabilities */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-rose-50">
              <Scale size={14} className="text-rose-600" />
            </div>
            <div className="text-[13px] font-semibold">Liabilities</div>
          </div>
          <div className="space-y-3">
            {currentLiabilities != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">Current liabilities</span>
                <span className="text-[13px] font-medium tabular-nums text-rose-600">€{currentLiabilities.toLocaleString()}</span>
              </div>
            )}
            {ytdExpenses != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">Operating costs (YTD)</span>
                <span className="text-[13px] font-medium tabular-nums">€{ytdExpenses.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-neutral-500">Ad spend (TW · NL)</span>
              <span className="text-[13px] font-medium tabular-nums">
                {nlTW?.adSpend != null ? `€${Math.round(nlTW.adSpend).toLocaleString()}` : "—"}
              </span>
            </div>
            <div className="border-t border-neutral-100 pt-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-neutral-700">Total liabilities</span>
              <span className="text-[14px] font-bold tabular-nums text-rose-700">
                {totalLiabilities != null
                  ? `€${totalLiabilities.toLocaleString()}`
                  : currentLiabilities != null
                    ? `€${currentLiabilities.toLocaleString()}`
                    : ytdExpenses != null ? `€${ytdExpenses.toLocaleString()}` : "—"}
              </span>
            </div>
          </div>
        </Card>

        {/* Equity / Net position */}
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-violet-50">
              <TrendingUp size={14} className="text-violet-600" />
            </div>
            <div className="text-[13px] font-semibold">Equity &amp; P&amp;L</div>
          </div>
          <div className="space-y-3">
            {equity != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">Total equity</span>
                <span className={`text-[13px] font-medium tabular-nums ${equity >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                  {equity >= 0 ? "+" : "−"}€{Math.abs(equity).toLocaleString()}
                </span>
              </div>
            )}
            {ytdRevenue != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">YTD revenue</span>
                <span className="text-[13px] font-medium tabular-nums">€{ytdRevenue.toLocaleString()}</span>
              </div>
            )}
            {ytdExpenses != null && (
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-neutral-500">YTD expenses</span>
                <span className="text-[13px] font-medium tabular-nums text-rose-600">−€{ytdExpenses.toLocaleString()}</span>
              </div>
            )}
            {ytdRevenue == null && jorttRevTotal > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-neutral-500">Revenue (12mo)</span>
                  <span className="text-[13px] font-medium tabular-nums">€{Math.round(jorttRevTotal).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[12px] text-neutral-500">Costs (12mo)</span>
                  <span className="text-[13px] font-medium tabular-nums text-rose-600">
                    {jorttExpTotal > 0 ? `−€${Math.round(jorttExpTotal).toLocaleString()}` : "—"}
                  </span>
                </div>
              </>
            )}
            <div className="border-t border-neutral-100 pt-2 flex items-center justify-between">
              <span className="text-[12px] font-semibold text-neutral-700">Net profit (YTD)</span>
              <span className={`text-[14px] font-bold tabular-nums ${(ytdNetProfit ?? 0) >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {ytdNetProfit != null
                  ? `${ytdNetProfit >= 0 ? "+" : "−"}€${Math.abs(ytdNetProfit).toLocaleString()}`
                  : jorttRevTotal > 0 && jorttExpTotal > 0
                    ? `€${Math.round(jorttRevTotal - jorttExpTotal).toLocaleString()}`
                    : "—"}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Bank accounts (Xero only) */}
      {xeroData?.bankAccounts?.length > 0 && (
        <Card className="mt-3 p-5">
          <div className="mb-3 text-[13px] font-semibold">Bank accounts · Xero</div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {xeroData.bankAccounts.map(acc => (
              <div key={acc.name} className="rounded-lg bg-neutral-50 px-4 py-3">
                <div className="text-[11px] text-neutral-500 truncate">{acc.name}</div>
                <div className={`mt-1 text-[18px] font-semibold tabular-nums ${acc.balance < 0 ? "text-rose-600" : "text-neutral-900"}`}>
                  €{Math.round(Math.abs(acc.balance)).toLocaleString()}
                </div>
                {acc.balance < 0 && <div className="text-[10px] text-rose-400">overdrawn</div>}
              </div>
            ))}
          </div>
          {cash != null && (
            <div className="mt-3 border-t border-neutral-100 pt-3 flex items-center justify-between">
              <span className="text-[12px] font-medium text-neutral-500">Total cash position</span>
              <span className={`text-[15px] font-bold tabular-nums ${cash >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                €{Math.round(Math.abs(cash)).toLocaleString()}
              </span>
            </div>
          )}
        </Card>
      )}

      {/* Revenue trend chart */}
      {revenueMonths.length > 0 && (
        <Card className="mt-3 p-5">
          <div className="mb-4">
            <div className="text-[13px] font-semibold">Revenue trend · 12 months</div>
            <div className="text-[12px] text-neutral-400">{srcLabel} · accounting revenue</div>
          </div>
          <div className="h-[200px]">
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={200}>
              <BarChart data={revenueMonths} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: "#a3a3a3", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }} formatter={v => [`€${v.toLocaleString()}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#171717" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Key stats row */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Accounts receivable", value: accountsReceivable != null ? `€${Math.round(accountsReceivable).toLocaleString()}` : "€0", sub: `${unpaidCount} unpaid invoice${unpaidCount !== 1 ? "s" : ""}` },
          { label: "Overdue amount", value: overdueAmount != null ? `€${Math.round(overdueAmount).toLocaleString()}` : "€0", sub: xeroData?.overdueInvoiceCount > 0 ? `${xeroData.overdueInvoiceCount} overdue` : "All current" },
          { label: "Net margin (YTD)", value: ytdRevenue && ytdNetProfit != null ? `${((ytdNetProfit / ytdRevenue) * 100).toFixed(1)}%` : "—", sub: "Net profit ÷ revenue" },
          { label: "Equity", value: equity != null ? `€${Math.abs(equity).toLocaleString()}` : "—", sub: equity != null ? (equity >= 0 ? "Positive" : "Negative") : srcLabel },
        ].map(m => (
          <Card key={m.label} className="p-4">
            <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{m.label}</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{m.value}</div>
            <div className="mt-0.5 text-[11px] text-neutral-400">{m.sub}</div>
          </Card>
        ))}
      </div>
    </>
  );
};

/* =========================================================================
   VIEW: PILLAR 5 — FORECAST
   ========================================================================= */

/* =========================================================================
   VIEW: PILLAR 5 — FORECAST
   ========================================================================= */

function parseMonthKey(mk) {
  if (!mk) return new Date(0);
  return new Date("1 " + mk.replace("'", "20"));
}

const ForecastView = ({ jorttData = null, xeroData = null, shopifyMonthly = null }) => {
  // Xero is primary accounting source; fall back to Jortt then Shopify
  const hasData = !!(xeroData?.live || jorttData?.live || shopifyMonthly?.length > 0);
  const acctSrcLabel = xeroData?.live ? "Xero" : jorttData?.live ? "Jortt" : "Shopify";

  // Active accounting data (Xero first, Jortt fallback)
  const acctRevByMonth = xeroData?.revenueByMonth ?? jorttData?.revenueByMonth ?? {};
  const acctExpByMonth = xeroData?.expensesByMonth ?? jorttData?.expensesByMonth ?? {};
  const cashBalance    = xeroData?.cashBalance ?? jorttData?.cashBalance ?? null;

  // Build sorted historical monthly data merging accounting + Shopify
  const chartData = useMemo(() => {
    const allMonths = new Set([
      ...Object.keys(acctRevByMonth),
      ...Object.keys(acctExpByMonth),
      ...(shopifyMonthly?.map(m => m.month) ?? []),
    ]);
    allMonths.delete("");

    return Array.from(allMonths)
      .sort((a, b) => parseMonthKey(a) - parseMonthKey(b))
      .map(month => {
        const acctRev = acctRevByMonth[month] ?? 0;
        const shopRev = shopifyMonthly?.find(m => m.month === month)?.revenue ?? 0;
        // Prefer Xero/Jortt net profit by month if available
        const acctNet = xeroData?.netProfitByMonth?.[month] ?? null;
        const expenses = acctExpByMonth[month] ?? 0;
        const revenue  = acctRev > 0 ? acctRev : shopRev;
        return {
          month,
          revenue:   Math.round(revenue),
          expenses:  Math.round(expenses),
          netProfit: acctNet != null ? Math.round(acctNet) : Math.round(revenue - expenses),
        };
      })
      .filter(m => m.revenue > 0 || m.expenses > 0);
  }, [xeroData, jorttData, shopifyMonthly]);

  // Compute growth rate and 6-month projection
  const { allData, growthRatePct } = useMemo(() => {
    if (chartData.length < 2) return { allData: chartData, growthRatePct: 0 };

    const recent      = chartData.slice(-3);
    const avgRevenue  = recent.reduce((s, m) => s + m.revenue,  0) / recent.length;
    const avgExpenses = recent.reduce((s, m) => s + m.expenses, 0) / recent.length;

    const rates = [];
    for (let i = 1; i < recent.length; i++) {
      if (recent[i - 1].revenue > 0)
        rates.push((recent[i].revenue - recent[i - 1].revenue) / recent[i - 1].revenue);
    }
    const rawRate    = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
    const growthRate = Math.max(-0.15, Math.min(0.15, rawRate));

    const lastDate = parseMonthKey(chartData[chartData.length - 1].month);
    const projected = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(lastDate);
      d.setMonth(d.getMonth() + i + 1);
      const month    = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " '");
      const revenue  = Math.round(avgRevenue  * Math.pow(1 + growthRate, i + 1));
      const expenses = Math.round(avgExpenses * Math.pow(1.02, i + 1));
      return { month, projRevenue: revenue, projExpenses: expenses, projNetProfit: revenue - expenses };
    });

    // Merge: historical rows keep revenue/expenses/netProfit; projected rows have projRevenue etc.
    const combined = [
      ...chartData.map(m => ({ ...m, projRevenue: undefined, projExpenses: undefined, projNetProfit: undefined })),
      ...projected.map(m => ({ ...m, revenue: undefined, expenses: undefined, netProfit: undefined })),
    ];

    return { allData: combined, growthRatePct: +(rawRate * 100).toFixed(1) };
  }, [chartData]);

  const last         = chartData[chartData.length - 1];
  const runRate      = last?.revenue ?? 0;
  const projMonths   = allData.filter(m => m.projRevenue != null);
  const annualFwd    = projMonths.length === 6
    ? Math.round([...chartData.slice(-6), ...projMonths.map(m => ({ revenue: m.projRevenue }))].reduce((s, m) => s + (m.revenue ?? 0), 0))
    : runRate * 12;
  const recentMargin = (() => {
    const r3 = chartData.slice(-3).filter(m => m.revenue > 0);
    if (!r3.length) return null;
    return (r3.reduce((s, m) => s + m.netProfit / m.revenue, 0) / r3.length * 100).toFixed(1);
  })();

  if (!hasData) {
    return (
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
            Cash flow forecast builds from connected live data. Connect Xero or Jortt for revenue &amp; expenses, and allow 3+ months of history to accumulate for trend-based projections.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[12px] font-medium text-neutral-400">Pillar 5</div>
          <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Forecast</h1>
          <p className="mt-1 text-[13px] text-neutral-500">
            Trend-based projection · {chartData.length} months history · 6-month forward model
          </p>
        </div>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-700">
          {growthRatePct > 0 ? "+" : ""}{growthRatePct}% MoM trend
        </span>
      </div>

      {/* Key metric cards */}
      <Card className="mt-6 p-6">
        <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
          {[
            {
              label: "Current run rate",
              value: runRate > 0 ? `€${runRate.toLocaleString()}/mo` : "—",
              sub: last?.month ? `Last: ${last.month}` : "No data",
            },
            {
              label: "Annualized (run rate)",
              value: runRate > 0 ? `€${(runRate * 12).toLocaleString()}` : "—",
              sub: "Current month × 12",
            },
            {
              label: "12-month projected",
              value: annualFwd > 0 ? `€${annualFwd.toLocaleString()}` : "—",
              sub: projMonths.length > 0 ? "Trend-adjusted forward" : "Based on run rate",
            },
            {
              label: "Cash position",
              value: cashBalance != null ? `€${Math.round(cashBalance).toLocaleString()}` : "—",
              sub: cashBalance != null ? `${acctSrcLabel} cash & bank` : `Connect ${acctSrcLabel}`,
            },
          ].map(m => (
            <div key={m.label}>
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{m.label}</div>
              <div className="mt-1 text-[22px] font-semibold tabular-nums">{m.value}</div>
              <div className="mt-0.5 text-[11px] text-neutral-400">{m.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Revenue & expenses chart */}
      <Card className="mt-3 p-5">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-[13px] font-semibold">Revenue, expenses &amp; net profit</div>
            <div className="text-[12px] text-neutral-400">Solid = historical · Shaded = 6-month projection</div>
          </div>
          {recentMargin != null && (
            <div className="text-right">
              <div className="text-[11px] text-neutral-400">Avg net margin</div>
              <div className={`text-[15px] font-semibold tabular-nums ${parseFloat(recentMargin) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {recentMargin}%
              </div>
            </div>
          )}
        </div>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={300}>
            <ComposedChart data={allData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#a3a3a3", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#a3a3a3", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `€${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "white", border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [v != null ? `€${Math.round(v).toLocaleString()}` : "—", name]}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} iconType="circle" />
              {/* Historical */}
              <Bar dataKey="revenue"   name="Revenue"       fill="#171717" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Bar dataKey="expenses"  name="Expenses"      fill="#d4d4d8" radius={[3, 3, 0, 0]} maxBarSize={32} />
              <Line type="monotone" dataKey="netProfit" name="Net profit" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              {/* Projected */}
              <Bar dataKey="projRevenue"   name="Rev (proj)"  fill="#a78bfa" radius={[3, 3, 0, 0]} maxBarSize={32} opacity={0.55} />
              <Bar dataKey="projExpenses"  name="Exp (proj)"  fill="#c4b5fd" radius={[3, 3, 0, 0]} maxBarSize={32} opacity={0.45} />
              <Line type="monotone" dataKey="projNetProfit" name="Profit (proj)" stroke="#10b981" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Monthly P&L table */}
      <Card className="mt-3 overflow-hidden">
        <div className="border-b border-neutral-100 px-5 py-3">
          <div className="text-[13px] font-semibold">Monthly P&amp;L breakdown</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-neutral-100 bg-neutral-50">
                <th className="px-5 py-2.5 text-left font-medium text-neutral-400">Month</th>
                <th className="px-4 py-2.5 text-right font-medium text-neutral-400">Revenue</th>
                <th className="px-4 py-2.5 text-right font-medium text-neutral-400">Expenses</th>
                <th className="px-4 py-2.5 text-right font-medium text-neutral-400">Net profit</th>
                <th className="px-4 py-2.5 text-right font-medium text-neutral-400">Margin</th>
              </tr>
            </thead>
            <tbody>
              {allData.map((row, i) => {
                const isProj = row.projRevenue != null;
                const rev  = isProj ? row.projRevenue  : row.revenue;
                const exp  = isProj ? row.projExpenses : row.expenses;
                const net  = isProj ? row.projNetProfit : row.netProfit;
                const margin = rev > 0 ? ((net / rev) * 100).toFixed(1) : null;
                return (
                  <tr key={i} className={`border-b border-neutral-50 ${isProj ? "bg-violet-50/40" : "hover:bg-neutral-50"}`}>
                    <td className="px-5 py-2.5 font-medium text-neutral-700">
                      {row.month}
                      {isProj && <span className="ml-1.5 rounded bg-violet-100 px-1 py-0.5 text-[10px] text-violet-600">proj</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-700">€{(rev ?? 0).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">€{(exp ?? 0).toLocaleString()}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${(net ?? 0) >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {(net ?? 0) >= 0 ? "+" : ""}€{Math.abs(net ?? 0).toLocaleString()}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums text-[11px] ${margin != null && parseFloat(margin) >= 0 ? "text-emerald-600" : "text-rose-500"}`}>
                      {margin != null ? `${margin}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* P&L summary from Jortt */}
      {jorttData?.plSummary && (
        <Card className="mt-3 p-5">
          <div className="mb-3 text-[13px] font-semibold">P&amp;L summary · Jortt (YTD)</div>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "Revenue",      value: jorttData.plSummary.revenue,     color: "text-neutral-900" },
              { label: "Total costs",  value: jorttData.plSummary.costs,       color: "text-neutral-500" },
              { label: "Gross profit", value: jorttData.plSummary.grossProfit, color: jorttData.plSummary.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600" },
            ].map(m => (
              <div key={m.label}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{m.label}</div>
                <div className={`mt-1 text-[20px] font-semibold tabular-nums ${m.color}`}>
                  €{Math.round(m.value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
};

/* =========================================================================
   MAIN APP
   ========================================================================= */

export default function FinanceDashboard({ user = null, liveData = null, connections = {}, syncedAt = null, dataIsStale = false, hasAnyData = false }) {
  const router = useRouter();
  const [dateRange, setDateRange]   = useState({ from: drStartOfMonth(), to: drToday() });
  const [rangeData, setRangeData]   = useState(null);
  const [rangeSyncing, setRangeSyncing] = useState(false);

  const handleDateChange = useCallback(async (from, to) => {
    setDateRange({ from, to });
    const isCurrentMonth = from === drStartOfMonth() && to === drToday();
    if (isCurrentMonth) {
      setRangeData(null); // use live data
      return;
    }
    setRangeSyncing(true);
    setRangeData(null);
    try {
      const res  = await fetch(`/api/sync?from=${from}&to=${to}`, { method: "POST" });
      const json = await res.json();
      setRangeData(json.rangeData ?? null);
    } catch {
      setRangeData(null);
    } finally {
      setRangeSyncing(false);
    }
  }, []);
  const [view, setView] = useState("overview");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(null);

  const handleSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncError(null);
    try {
      // /api/sync now returns immediately (~50ms) and runs in the background.
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      // Poll the dashboard a few times so cards fill in as jobs complete.
      // Background jobs typically finish within 60s.
      const intervals = [3000, 8000, 15000, 30000, 60000];
      for (const delay of intervals) {
        await new Promise((r) => setTimeout(r, delay));
        try { await router.invalidate(); } catch { /* ignore */ }
      }
    } catch (err) {
      setSyncError(err.message);
    } finally {
      setSyncing(false);
    }
  }, [syncing, router]);

  // Auto-sync in background if data is stale or missing
  useEffect(() => {
    if (dataIsStale || !hasAnyData) {
      handleSync();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const syncLabel = (() => {
    if (!syncedAt) return "Never synced";
    const mins = Math.round((Date.now() - new Date(syncedAt).getTime()) / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
  })();

  // ── Live data only (no mock fallbacks) ────────────────────────────────
  const shopifyToday      = liveData?.shopifyToday ?? null;
  const activeMarkets     = Array.isArray(liveData?.shopifyMarkets) && liveData.shopifyMarkets.some(m => m?.live) ? liveData.shopifyMarkets : null;
  const shopifyLive       = !!activeMarkets;
  const activeOpexByMonth = liveData?.jortt?.opexByMonth?.length > 0 ? liveData.jortt.opexByMonth : null;
  const activeOpexDetail  = liveData?.jortt?.opexDetail ?? null;
  const jorttLive         = !!(liveData?.jortt?.live);
  const xeroLive          = !!(liveData?.xero?.live);
  const twData            = liveData?.tripleWhale?.filter(m => m.live) ?? [];
  const twLive            = twData.length > 0;
  const juoLive           = liveData?.juo?.some(m => m.live) ?? false;
  const loopLive          = liveData?.loop?.some(m => m.live) ?? false;
  const subLive           = juoLive || loopLive;
  // Combined subscription data: JUO (NL) + Loop (UK/US/EU)
  const allSubData        = [...(liveData?.juo ?? []), ...(liveData?.loop ?? [])].filter(m => m.live);
  const liveSources       = [shopifyLive, jorttLive || xeroLive, twLive, subLive].filter(Boolean).length;

  async function handleLogout() {
    await fetch("/auth/logout", { method: "POST" });
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
            {/* Sync button */}
            <button
              onClick={handleSync}
              disabled={syncing}
              className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition ${
                dataIsStale && !syncing
                  ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                  : "border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-neutral-100"
              } disabled:opacity-60`}
            >
              <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing…" : syncLabel}
            </button>
            {syncError && (
              <span className="text-[11px] text-rose-500">{syncError}</span>
            )}
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
                <div className="flex items-center justify-between"><span>Jortt</span><StatusDot status={jorttLive ? "ok" : "error"} /></div>
                <div className="flex items-center justify-between"><span>Xero</span><StatusDot status={xeroLive ? "ok" : "error"} /></div>
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

          {view === "overview" && <OverviewView dateRange={dateRange} onDateChange={handleDateChange} liveMarkets={activeMarkets} twData={twData} subData={allSubData} shopifyMonthly={liveData?.shopifyMonthly} jorttData={liveData?.jortt} rangeData={rangeData} rangeSyncing={rangeSyncing} />}
          {view === "metrics" && <MetricsView twData={twData} />}
          {view === "daily" && (shopifyLive ? <DailyPnLView dailyData={shopifyToday} twData={twData} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Daily P&L</strong> requires Shopify data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect Shopify</button> to view.</div>)}
          {view === "markets" && (activeMarkets ? <MarketsView liveMarkets={activeMarkets} twData={twData} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Margin per Market</strong> requires Shopify & Triple Whale data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect sources</button> to view.</div>)}
          {view === "monthly" && ((shopifyLive || jorttLive) ? <MonthlyView opexByMonth={activeOpexByMonth} opexDetail={activeOpexDetail} jorttLive={jorttLive} shopifyMonthly={liveData?.shopifyMonthly} twData={twData} /> : <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-[13px] text-amber-800"><strong>Monthly Overview</strong> requires Shopify or Jortt data. <button onClick={() => setView("sync")} className="underline text-amber-700 hover:text-amber-900">Connect a source</button> to view.</div>)}
          {view === "balance" && <BalanceView jorttData={liveData?.jortt} xeroData={liveData?.xero} shopifyMarkets={activeMarkets} twData={twData} />}
          {view === "forecast" && <ForecastView jorttData={liveData?.jortt} xeroData={liveData?.xero} shopifyMonthly={liveData?.shopifyMonthly} />}
          {view === "reconciliation" && <ReconciliationView shopifyMarkets={activeMarkets} jorttData={liveData?.jortt} />}
          {view === "sync" && <SyncView initialConnections={connections} />}

          <div className="mt-10 text-center text-[11px] text-neutral-400">
            {liveSources > 0
              ? `${liveSources} live source${liveSources > 1 ? "s" : ""} · ${[shopifyLive && "Shopify", jorttLive && "Jortt", twLive && "Triple Whale", juoLive && "Juo (NL)", loopLive && "Loop (UK)"].filter(Boolean).join(", ")} · synced ${syncLabel}`
              : `No live sources connected · Add API keys to .env.local or connect via Sync view`}
          </div>
        </main>
      </div>
    </div>
  );
}






