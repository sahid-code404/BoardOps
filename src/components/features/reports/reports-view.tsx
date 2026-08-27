"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Utensils,
  ShoppingCart,
  AlertTriangle,
  Users,
  Download,
  IndianRupee,
  Receipt,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useAuthStore } from "@/stores/use-auth-store";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type ApiResponse<T> = { success: boolean; data: T };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Tab = "financial" | "meals" | "purchases" | "outstanding" | "residents";

const TABS: { key: Tab; label: string; icon: typeof BarChart3; exportType?: string }[] = [
  { key: "financial", label: "Financial", icon: IndianRupee, exportType: "bills" },
  { key: "meals", label: "Meals", icon: Utensils },
  { key: "purchases", label: "Purchases", icon: ShoppingCart, exportType: "purchases" },
  { key: "outstanding", label: "Outstanding", icon: AlertTriangle, exportType: "outstanding" },
  { key: "residents", label: "Residents", icon: Users, exportType: "residents" },
];

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function ReportsView() {
  const now = new Date();
  const [tab, setTab] = useState<Tab>("financial");
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const { token } = useAuthStore();

  const exportCsv = async (exportType: string) => {
    try {
      const res = await fetch(
        `/api/reports/export?type=${exportType}&month=${selectedMonth}&year=${selectedYear}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${exportType}-${MONTHS[selectedMonth]}-${selectedYear}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${exportType} report exported`);
    } catch {
      toast.error("Export failed");
    }
  };

  const prevMonth = () => {
    if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear((y) => y - 1); }
    else setSelectedMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear((y) => y + 1); }
    else setSelectedMonth((m) => m + 1);
  };

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Reports & Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Financial, meal, purchase, and resident reports with CSV export.
          </p>
        </div>
      </StaggerItem>

      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <GlassButton variant="ghost" size="sm" onClick={prevMonth}>←</GlassButton>
              <p className="font-semibold min-w-[120px] text-center">{MONTHS[selectedMonth]} {selectedYear}</p>
              <GlassButton variant="ghost" size="sm" onClick={nextMonth}>→</GlassButton>
            </div>
            <div className="flex gap-1 p-1 rounded-2xl glass-soft">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all",
                    tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>
          </div>
        </GlassCard>
      </StaggerItem>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
        >
          {tab === "financial" && <FinancialReport month={selectedMonth} year={selectedYear} onExport={() => exportCsv("bills")} />}
          {tab === "meals" && <MealReport month={selectedMonth} year={selectedYear} />}
          {tab === "purchases" && <PurchaseReport month={selectedMonth} year={selectedYear} onExport={() => exportCsv("purchases")} />}
          {tab === "outstanding" && <OutstandingReport month={selectedMonth} year={selectedYear} onExport={() => exportCsv("outstanding")} />}
          {tab === "residents" && <ResidentReport onExport={() => exportCsv("residents")} />}
        </motion.div>
      </AnimatePresence>
    </StaggerGroup>
  );
}

function KpiCard({ label, value, icon: Icon, color, change, sub }: { label: string; value: string; icon: typeof IndianRupee; color: string; change?: string; sub?: string }) {
  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <Icon className={cn("h-3.5 w-3.5", color)} />
        {label}
      </div>
      <p className={cn("text-xl font-bold tabular-nums", color)}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      {change && (
        <p className={cn("text-[10px] mt-0.5", change.startsWith("+") ? "text-success" : "text-destructive")}>
          {change} vs prev
        </p>
      )}
    </GlassCard>
  );
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <ShimmerSkeleton key={i} className="h-24 rounded-3xl" />
      ))}
    </div>
  );
}

// ─── Financial Report ───
function FinancialReport({ month, year, onExport }: { month: number; year: number; onExport: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "financial", { month, year }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        summary: Record<string, number>;
        expenseByCategory: { category: string; amount: number }[];
        billStatusBreakdown: Record<string, number>;
        comparison: { prevExpenses: number; prevDeposits: number; expenseChange: number; depositChange: number };
      }>>(`/reports/financial?month=${month}&year=${year}`);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return <SkeletonGrid count={6} />;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <GlassButton size="sm" variant="ghost" onClick={onExport}><Download className="h-3.5 w-3.5" />Export Bills CSV</GlassButton>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <KpiCard label="Total Expenses" value={formatINR(s.totalExpenses)} icon={TrendingDown} color="text-destructive" change={data.comparison.expenseChange !== 0 ? `${data.comparison.expenseChange > 0 ? "+" : ""}${formatINR(data.comparison.expenseChange)}` : undefined} />
        <KpiCard label="Total Deposits" value={formatINR(s.totalDeposits)} icon={TrendingUp} color="text-success" change={data.comparison.depositChange !== 0 ? `${data.comparison.depositChange > 0 ? "+" : ""}${formatINR(data.comparison.depositChange)}` : undefined} />
        <KpiCard label="Total Billed" value={formatINR(s.totalBills)} icon={Receipt} color="text-primary" />
        <KpiCard label="Total Collected" value={formatINR(s.totalCollected)} icon={IndianRupee} color="text-success" />
        <KpiCard label="Outstanding Due" value={formatINR(s.outstandingDue)} icon={AlertTriangle} color="text-warning" />
        <KpiCard label="Refund Total" value={formatINR(s.refundTotal)} icon={TrendingDown} color="text-info" />
        <KpiCard label="Net Position" value={formatINR(s.netPosition)} icon={TrendingUp} color={s.netPosition >= 0 ? "text-success" : "text-destructive"} />
        <KpiCard label="Purchases" value={formatINR(s.totalPurchases)} icon={ShoppingCart} color="text-primary" sub={`${s.purchaseCount} trips`} />
      </div>
      {data.expenseByCategory.length > 0 && (
        <GlassCard className="p-4" hover={false}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Expenses by Category</p>
          <div className="space-y-1.5">
            {data.expenseByCategory.map((c) => {
              const pct = s.totalExpenses > 0 ? (c.amount / s.totalExpenses) * 100 : 0;
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-sm font-medium w-32 truncate">{c.category}</span>
                  <div className="flex-1 h-6 rounded-lg bg-secondary overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-lg" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-sm font-bold tabular-nums w-20 text-right">{formatINR(c.amount)}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}
      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bill Status Breakdown</p>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(data.billStatusBreakdown).map(([status, count]) => (
            <div key={status} className="px-3 py-1.5 rounded-2xl glass-soft flex items-center gap-2">
              <span className="text-sm font-medium">{status}</span><span className="text-xs text-muted-foreground">{count}</span>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Meal Report ───
function MealReport({ month, year }: { month: number; year: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "meals", { month, year }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        summary: { totalMeals: number; totalGuests: number; totalOverrides: number; holidayCount: number; activeMealCount: number };
        perMeal: { mealId: string; mealName: string; displayName: string; on: number; off: number; overridden: number; guests: number; total: number; participation: number }[];
      }>>(`/reports/meals?month=${month}&year=${year}`);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return <SkeletonGrid count={4} />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KpiCard label="Total Meals" value={String(data.summary.totalMeals)} icon={Utensils} color="text-primary" />
        <KpiCard label="Guest Meals" value={String(data.summary.totalGuests)} icon={Users} color="text-info" />
        <KpiCard label="Overrides" value={String(data.summary.totalOverrides)} icon={AlertTriangle} color="text-warning" />
        <KpiCard label="Holidays" value={String(data.summary.holidayCount)} icon={BarChart3} color="text-destructive" />
        <KpiCard label="Active Meals" value={String(data.summary.activeMealCount)} icon={Utensils} color="text-success" />
      </div>
      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Per-Meal Breakdown</p>
        <div className="space-y-2">
          {data.perMeal.map((m) => (
            <div key={m.mealId} className="flex items-center gap-3 p-2.5 rounded-xl glass-soft">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{m.displayName}</p>
                <p className="text-[10px] text-muted-foreground">ON: {m.on} · OFF: {m.off} · Guests: {m.guests} · Overrides: {m.overridden}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-bold tabular-nums">{m.participation}%</p>
                <div className="w-16 h-1.5 rounded-full bg-secondary overflow-hidden mt-1"><div className="h-full bg-primary rounded-full" style={{ width: `${m.participation}%` }} /></div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Purchase Report ───
function PurchaseReport({ month, year, onExport }: { month: number; year: number; onExport: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "purchases", { month, year }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        summary: { totalSpend: number; purchaseCount: number; itemCount: number; avgPurchaseValue: number };
        topProducts: { name: string; quantity: number; spend: number; unit: string }[];
        topCategories: { category: string; amount: number }[];
        vendorBreakdown: { vendor: string; count: number; total: number }[];
      }>>(`/reports/purchases?month=${month}&year=${year}`);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return <SkeletonGrid count={4} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><GlassButton size="sm" variant="ghost" onClick={onExport}><Download className="h-3.5 w-3.5" />Export CSV</GlassButton></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Spend" value={formatINR(data.summary.totalSpend)} icon={TrendingDown} color="text-destructive" />
        <KpiCard label="Purchase Count" value={String(data.summary.purchaseCount)} icon={ShoppingCart} color="text-primary" />
        <KpiCard label="Items Bought" value={String(data.summary.itemCount)} icon={Receipt} color="text-info" />
        <KpiCard label="Avg Purchase" value={formatINR(data.summary.avgPurchaseValue)} icon={IndianRupee} color="text-warning" />
      </div>
      {data.topProducts.length > 0 && (
        <GlassCard className="p-4" hover={false}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Top Products by Spend</p>
          <div className="space-y-1.5">
            {data.topProducts.map((p, i) => (
              <div key={p.name} className="flex items-center gap-3 p-2 rounded-xl glass-soft">
                <span className="text-xs text-muted-foreground w-6">#{i + 1}</span>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[10px] text-muted-foreground">{p.quantity} {p.unit}</p></div>
                <span className="text-sm font-bold tabular-nums shrink-0">{formatINR(p.spend)}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassCard className="p-4" hover={false}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Categories</p>
          <div className="space-y-1.5">{data.topCategories.map((c) => (<div key={c.category} className="flex items-center justify-between p-2 rounded-xl glass-soft"><span className="text-sm font-medium">{c.category}</span><span className="text-sm font-bold tabular-nums">{formatINR(c.amount)}</span></div>))}</div>
        </GlassCard>
        <GlassCard className="p-4" hover={false}>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Vendors</p>
          <div className="space-y-1.5">{data.vendorBreakdown.map((v) => (<div key={v.vendor} className="flex items-center justify-between p-2 rounded-xl glass-soft"><div><p className="text-sm font-medium">{v.vendor}</p><p className="text-[10px] text-muted-foreground">{v.count} trip(s)</p></div><span className="text-sm font-bold tabular-nums">{formatINR(v.total)}</span></div>))}</div>
        </GlassCard>
      </div>
    </div>
  );
}

// ─── Outstanding Report ───
function OutstandingReport({ month, year, onExport }: { month: number; year: number; onExport: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "outstanding", { month, year }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        summary: { totalOutstanding: number; totalCurrentDue: number; totalPreviousDue: number; residentCount: number; billCount: number; avgDaysOutstanding: number };
        rows: { userId: string; userName: string; room: string | null; billNumber: string | null; period: string; currentBill: number; paidAmount: number; dueAmount: number; previousDue: number; totalOutstanding: number; daysOutstanding: number; status: string }[];
      }>>(`/reports/outstanding?month=${month}&year=${year}`);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return <SkeletonGrid count={3} />;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><GlassButton size="sm" variant="ghost" onClick={onExport}><Download className="h-3.5 w-3.5" />Export CSV</GlassButton></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Outstanding" value={formatINR(data.summary.totalOutstanding)} icon={AlertTriangle} color="text-destructive" />
        <KpiCard label="Current Due" value={formatINR(data.summary.totalCurrentDue)} icon={IndianRupee} color="text-warning" />
        <KpiCard label="Previous Due" value={formatINR(data.summary.totalPreviousDue)} icon={TrendingDown} color="text-destructive" />
        <KpiCard label="Avg Days Overdue" value={`${data.summary.avgDaysOutstanding}d`} icon={BarChart3} color="text-muted-foreground" />
      </div>
      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Outstanding Dues ({data.rows.length} bills, {data.summary.residentCount} residents)</p>
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {data.rows.map((r) => (
            <div key={r.userId + r.period} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{r.userName}</p><p className="text-[10px] text-muted-foreground">{r.billNumber || "—"} · {r.period} · {r.daysOutstanding}d overdue</p></div>
              <div className="text-right shrink-0"><p className="text-sm font-bold tabular-nums text-destructive">{formatINR(r.totalOutstanding)}</p>{r.previousDue > 0 && <p className="text-[10px] text-muted-foreground">incl. prev ₹{Math.round(r.previousDue)}</p>}</div>
            </div>
          ))}
          {data.rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No outstanding dues 🎉</p>}
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Resident Report ───
function ResidentReport({ onExport }: { onExport: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "residents"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        summary: { residentCount: number; totalBalance: number; totalDue: number; totalDeposited: number; totalBilled: number; healthyCount: number; lowBalanceCount: number; overdueCount: number; restrictedCount: number; exemptedCount: number };
        rows: { userId: string; userName: string; room: string | null; availableBalance: number; outstandingDue: number; financialStatus: string; totalDeposited: number; totalBilled: number }[];
      }>>(`/reports/residents`);
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) return <SkeletonGrid count={5} />;
  const s = data.summary;
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><GlassButton size="sm" variant="ghost" onClick={onExport}><Download className="h-3.5 w-3.5" />Export CSV</GlassButton></div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total Balance" value={formatINR(s.totalBalance)} icon={IndianRupee} color="text-success" />
        <KpiCard label="Total Due" value={formatINR(s.totalDue)} icon={AlertTriangle} color="text-destructive" />
        <KpiCard label="Total Deposited" value={formatINR(s.totalDeposited)} icon={TrendingUp} color="text-primary" />
        <KpiCard label="Total Billed" value={formatINR(s.totalBilled)} icon={Receipt} color="text-info" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Healthy", count: s.healthyCount, color: "text-success" },
          { label: "Low Balance", count: s.lowBalanceCount, color: "text-warning" },
          { label: "Overdue", count: s.overdueCount, color: "text-destructive" },
          { label: "Restricted", count: s.restrictedCount, color: "text-destructive" },
          { label: "Exempted", count: s.exemptedCount, color: "text-primary" },
        ].map((m) => (
          <GlassCard key={m.label} className="p-3 text-center" hover={false}>
            <p className={cn("text-xl font-bold tabular-nums", m.color)}>{m.count}</p>
            <p className="text-[10px] text-muted-foreground">{m.label}</p>
          </GlassCard>
        ))}
      </div>
      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Resident Financial Summary ({data.rows.length})</p>
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {data.rows.map((r) => (
            <div key={r.userId} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">{r.userName}</p><p className="text-[10px] text-muted-foreground">Deposited ₹{Math.round(r.totalDeposited)} · Billed ₹{Math.round(r.totalBilled)}</p></div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right"><p className="text-sm font-bold tabular-nums">{formatINR(r.availableBalance)}</p>{r.outstandingDue > 0 && <p className="text-[10px] text-destructive">due {formatINR(r.outstandingDue)}</p>}</div>
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", r.financialStatus === "HEALTHY" ? "bg-success/15 text-success" : r.financialStatus === "LOW_BALANCE" ? "bg-warning/15 text-warning" : (r.financialStatus === "OVERDUE" || r.financialStatus === "RESTRICTED") ? "bg-destructive/15 text-destructive" : "bg-primary/15 text-primary")}>{r.financialStatus}</span>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
