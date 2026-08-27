"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Wallet,
  IndianRupee,
  Plus,
  Trash2,
  ShoppingBag,
  Zap,
  Users,
  Wrench,
  Boxes,
  Calendar,
  Receipt,
  PencilLine,
  Search,
  ChevronLeft,
  ChevronRight,
  MoreVertical,
  RotateCcw,
  AlertTriangle,
  Clock,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn, toLocalDateKey } from "@/lib/utils";
import { formatDeletionCountdown } from "@/lib/deletion-utils";
import { useAuthStore } from "@/stores/use-auth-store";

import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type ExpenseCategory =
  | "GROCERY"
  | "UTILITIES"
  | "SALARY"
  | "MAINTENANCE"
  | "GENERAL"
  | "CUSTOM";

type Expense = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  quantity: number;
  unit: string;
  amount: number;
  currency: string;
  expenseDate: string;
  paidTo: string | null;
  status: string;
  deletedAt: string | null;
  deletionReason: string | null;
  user: { name: string } | null;
};

type ApiResponse<T> = { success: boolean; data: T; error?: string };

/** Payload sent to POST /api/expenses and PUT /api/expenses/[id]. */
type ExpensePayload = {
  title: string;
  category: string;
  quantity: number;
  unit: string;
  amount: number;
  description?: string;
  expenseDate: string;
};

// ─────────────────────────────────────────────────────────────
// Style maps
// ─────────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  ExpenseCategory,
  {
    label: string;
    icon: React.ReactNode;
    className: string;
    colorVar: string;
    chartColor: string;
  }
> = {
  GROCERY: {
    label: "Grocery",
    icon: <ShoppingBag className="h-3.5 w-3.5" />,
    className: "bg-success/15 text-success border-success/30",
    colorVar: "var(--success)",
    chartColor: "var(--success)",
  },
  UTILITIES: {
    label: "Utilities",
    icon: <Zap className="h-3.5 w-3.5" />,
    className: "bg-info/15 text-info border-info/30",
    colorVar: "var(--info)",
    chartColor: "var(--info)",
  },
  SALARY: {
    label: "Salary",
    icon: <Users className="h-3.5 w-3.5" />,
    className: "bg-primary/15 text-primary border-primary/30",
    colorVar: "var(--primary)",
    chartColor: "var(--primary)",
  },
  MAINTENANCE: {
    label: "Maintenance",
    icon: <Wrench className="h-3.5 w-3.5" />,
    className: "bg-warning/15 text-warning border-warning/30",
    colorVar: "var(--warning)",
    chartColor: "var(--warning)",
  },
  GENERAL: {
    label: "General",
    icon: <Boxes className="h-3.5 w-3.5" />,
    className: "bg-muted text-muted-foreground border-border",
    colorVar: "var(--muted-foreground)",
    chartColor: "var(--muted-foreground)",
  },
  CUSTOM: {
    label: "Custom",
    icon: <Plus className="h-3.5 w-3.5" />,
    className: "bg-primary/15 text-primary border-primary/30",
    colorVar: "var(--primary)",
    chartColor: "var(--primary)",
  },
};

const CATEGORY_ORDER: ExpenseCategory[] = [
  "GROCERY",
  "UTILITIES",
  "SALARY",
  "MAINTENANCE",
  "GENERAL",
  "CUSTOM",
];

/**
 * Component lookup for category icons — used inside the larger avatar-style
 * tile in `ExpenseRow` where the icon needs to render at h-5 w-5 (vs the
 * pre-rendered h-3.5 w-3.5 element stored in CATEGORY_META.icon, which is sized
 * for inline use in badges/pills).
 */
const CATEGORY_ICON_COMPONENTS: Record<string, typeof Boxes> = {
  GROCERY: ShoppingBag,
  UTILITIES: Zap,
  SALARY: Users,
  MAINTENANCE: Wrench,
  GENERAL: Boxes,
  CUSTOM: Plus,
};

const UNIT_OPTIONS = ["piece", "kg", "gm", "litre", "metre", "box", "dozen"];

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** Safely get category metadata — returns GENERAL meta for unknown/custom categories. */
function getCatMeta(cat: string) {
  return CATEGORY_META[cat as ExpenseCategory] || {
    label: cat.charAt(0) + cat.slice(1).toLowerCase(),
    icon: <Boxes className="h-3.5 w-3.5" />,
    className: "bg-muted text-muted-foreground border-border",
    colorVar: "var(--muted-foreground)",
    chartColor: "var(--muted-foreground)",
  };
}

/** Full date-time format: "29 June 2026, 05:28 am" */
function formatDate(iso: string) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

/** Format quantity + unit for display (e.g. "5 kg", "2 piece"). */
function formatQuantity(qty: number, unit: string): string {
  if (!qty && !unit) return "";
  if (!unit) return String(qty);
  if (!qty) return unit;
  return `${qty} ${unit}`;
}

/**
 * An expense is locked when its status is LOCKED, it's in the deletion queue,
 * or it belongs to a past month (bills may have been generated against it).
 */
function isExpenseLocked(expense: Expense): boolean {
  if (expense.status === "LOCKED") return true;
  if (expense.deletedAt) return true; // in deletion queue — can't edit
  const expDate = new Date(expense.expenseDate);
  const now = new Date();
  const expYM = expDate.getFullYear() * 12 + expDate.getMonth();
  const todayYM = now.getFullYear() * 12 + now.getMonth();
  return expYM < todayYM;
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function ExpensesView() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN" || false;
  const qc = useQueryClient();

  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  // Debounced search — `searchInput` drives the input field; `search` is the
  // debounced value (200ms after the user stops typing) used for actual
  // filtering. Prevents re-filtering large lists on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const { data: expenses = [], isLoading, isFetching } = useQuery({
    queryKey: ["expenses", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Expense[]>>("/expenses", {
        params: { month: selectedMonth, year: selectedYear, limit: 500 },
      });
      return r.data;
    },
    // Keep previous data visible while a new month/year loads (stale-while-revalidate).
    // Eliminates the flash of empty content when switching months.
    placeholderData: (prev) => prev,
  });

  // Soft-deleted expenses for the Deletion Queue (admin only). The backend
  // returns ONLY deleted rows when includeDeleted=true is set.
  const { data: deletedExpenses = [] } = useQuery({
    queryKey: ["expenses", "deleted", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Expense[]>>("/expenses", {
        params: {
          month: selectedMonth,
          year: selectedYear,
          includeDeleted: "true",
          limit: 500,
        },
      });
      return r.data;
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  const addMutation = useMutation({
    mutationFn: (payload: ExpensePayload) =>
      api.post<ApiResponse<Expense>>("/expenses", payload),
    onSuccess: () => {
      toast.success("Expense added successfully");
      closeForm();
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add expense"),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ExpensePayload }) =>
      api.put<ApiResponse<Expense>>(`/expenses/${id}`, payload),
    onSuccess: () => {
      toast.success("Expense updated successfully");
      closeForm();
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update expense"),
  });

  const openAddForm = useCallback(() => {
    setEditTarget(null);
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((exp: Expense) => {
    setEditTarget(exp);
    setFormOpen(true);
  }, []);

  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditTarget(null);
  }, []);

  const handleSubmit = useCallback((payload: ExpensePayload, id?: string) => {
    if (id) {
      editMutation.mutate({ id, payload });
    } else {
      addMutation.mutate(payload);
    }
  }, [addMutation, editMutation]);

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await api.delete(`/expenses/${id}`, {
        body: JSON.stringify({ reason: reason || undefined }),
      });
    },
    onSuccess: () => {
      toast.success("Expense scheduled for deletion — permanently removed in 7 days");
      setDeleteTarget(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete expense"),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.post<ApiResponse<Expense>>(`/expenses/${id}/restore`);
      return r.data;
    },
    onSuccess: () => {
      toast.success("Expense restored successfully");
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to restore expense"),
  });

  // KPIs + breakdown — data is already filtered by selected month from the API
  const { totalThisMonth, byCategory, count } = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const byCat: Record<string, number> = {};
    expenses.forEach((e) => {
      byCat[e.category] = (byCat[e.category] || 0) + e.amount;
    });
    return {
      totalThisMonth: total,
      byCategory: byCat,
      count: expenses.length,
    };
  }, [expenses]);

  // When showDeleted is true, the list source swaps to the soft-deleted rows
  // (which the backend returns only via ?includeDeleted=true). Category filter
  // is intentionally ignored in that mode since deleted rows can be of any
  // category and the queue is meant to be a flat review surface.
  const sourceExpenses = showDeleted ? deletedExpenses : expenses;

  const filtered = useMemo(() => {
    let result = sourceExpenses;
    if (!showDeleted && categoryFilter !== "ALL") {
      result = result.filter((e) => e.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          (e.paidTo || "").toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [sourceExpenses, categoryFilter, search, showDeleted]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid-kpi gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-32" />
          ))}
        </div>
        <ShimmerSkeleton className="h-72" />
        <div className="grid gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <StaggerGroup className="space-y-4">
      {/* Subtle refetch indicator — thin animated bar at the top of the list.
          Shows on every refetch (month change, mutation invalidation) but
          NOT on the initial load (the full skeleton handles that). */}
      <AnimatePresence>
        {isFetching && (
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: "left" }}
            className="h-0.5 rounded-full bg-primary/60 shadow-sm shadow-primary/30"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      {/* Month picker — centered capsule with circular arrows + click-to-reset */}
      <StaggerItem>
        <div className="flex items-center justify-center gap-4">
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              const d = new Date(selectedYear, selectedMonth - 1, 1);
              setSelectedMonth(d.getMonth());
              setSelectedYear(d.getFullYear());
            }}
            aria-label="Previous month"
            className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
          >
            <ChevronLeft className="h-5 w-5" />
          </motion.button>

          <button
            onClick={() => {
              const today = new Date();
              if (selectedMonth !== today.getMonth() || selectedYear !== today.getFullYear()) {
                setSelectedMonth(today.getMonth());
                setSelectedYear(today.getFullYear());
              }
            }}
            className="flex-1 max-w-[280px] flex items-center justify-center gap-2.5 glass-soft rounded-full px-6 py-2.5 transition-all hover:ring-1 hover:ring-primary/30"
          >
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <div className="leading-tight text-center">
              <p className="text-sm font-bold text-primary">
                {new Date(selectedYear, selectedMonth).toLocaleDateString("en-US", { month: "long" })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {selectedYear}
              </p>
            </div>
            {(selectedMonth !== new Date().getMonth() || selectedYear !== new Date().getFullYear()) && (
              <RotateCcw className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
          </button>

          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              const d = new Date(selectedYear, selectedMonth + 1, 1);
              setSelectedMonth(d.getMonth());
              setSelectedYear(d.getFullYear());
            }}
            aria-label="Next month"
            className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
          >
            <ChevronRight className="h-5 w-5" />
          </motion.button>
        </div>
      </StaggerItem>

      {/* Action bar — centered transparent glass card button */}
      {isAdmin && (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              size="lg"
              onClick={openAddForm}
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <Plus className="h-5 w-5" />
              Add Expense
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* KPIs */}
      <StaggerItem>
        <div className="grid-kpi gap-3">
          <KpiCard
            label={`Total Expenses · ${new Date(selectedYear, selectedMonth).toLocaleDateString("en-US", { month: "short" })}`}
            value={totalThisMonth}
            icon={<Wallet className="h-5 w-5" />}
            color="primary"
            prefix="₹"
          />
          <KpiCard
            label="Total Entries"
            value={count}
            icon={<Receipt className="h-5 w-5" />}
            color="info"
          />
        </div>
      </StaggerItem>

      {/* Top Categories — horizontal bars sorted high to low */}
      <StaggerItem>
        <GlassCard className="p-4" hover={false}>
          <h3 className="font-semibold mb-4">Top Categories <span className="text-xs font-normal text-muted-foreground ml-1">· {new Date(selectedYear, selectedMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span></h3>
          <div className="space-y-3">
            {(() => {
              const sorted = Object.entries(byCategory)
                .map(([cat, amount]) => ({ cat, amount }))
                .filter((x) => x.amount > 0)
                .sort((a, b) => b.amount - a.amount);
              if (sorted.length === 0) {
                return <p className="text-sm text-muted-foreground text-center py-4">No expenses this month</p>;
              }
              const maxAmount = sorted[0].amount;
              return sorted.map(({ cat, amount }) => {
                const pct = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
                const meta = getCatMeta(cat);
                return (
                  <div key={cat} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: meta.chartColor }}
                        />
                        {meta.label}
                      </span>
                      <span className="font-medium tabular-nums">₹{amount.toLocaleString("en-IN")}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="h-full rounded-full"
                        style={{ background: meta.chartColor }}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Search + Filters — all pills in a single horizontal scrollable line */}
      <StaggerItem>
        <div className="space-y-3">
          <GlassInput
            placeholder="Search by title, category, vendor, or description…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<Search />}
          />
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
            {(() => {
              // Build list: ALL + predefined categories (except CUSTOM) + any custom categories from expenses
              const predefined = CATEGORY_ORDER.filter((c) => c !== "CUSTOM");
              const customCats = [...new Set(expenses.map((e) => e.category))].filter(
                (c) => !CATEGORY_ORDER.includes(c as ExpenseCategory)
              );
              const allCats = ["ALL", ...predefined, ...customCats] as const;
              return allCats.map((c) => {
              const active = !showDeleted && categoryFilter === c;
              const meta = c === "ALL" ? null : getCatMeta(c);
              return (
                <button
                  key={c}
                  onClick={() => {
                    // Selecting a category pill exits the deletion-queue view
                    // so the category filter takes effect immediately.
                    setShowDeleted(false);
                    setCategoryFilter(c);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap shrink-0 transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "glass-soft text-muted-foreground hover:text-foreground"
                  )}
                >
                  {meta?.icon}
                  {c === "ALL" ? "All" : meta!.label}
                </button>
              );
              });
            })()}
            {/* Deletion Queue pill — admin only, in the same row */}
            {isAdmin && (
              <button
                onClick={() => setShowDeleted(!showDeleted)}
                className={cn(
                  "inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap shrink-0 transition-all",
                  showDeleted
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "glass-soft text-muted-foreground hover:text-foreground"
                )}
              >
                <Trash2 className="h-3 w-3" />
                Deletion Queue
                {deletedExpenses.length > 0 && (
                  <span
                    className={cn(
                      "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                      showDeleted
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-destructive text-white"
                    )}
                  >
                    {deletedExpenses.length}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </StaggerItem>

      {/* List */}
      <StaggerItem>
        {filtered.length === 0 ? (
          <GlassCard className="p-10" hover={false}>
            <div className="flex flex-col items-center justify-center text-center gap-3">
              <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/40">
                <Receipt className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No expenses found</p>
                <p className="text-sm text-muted-foreground">
                  {showDeleted
                    ? "No expenses in the deletion queue."
                    : isAdmin
                      ? "Add your first expense to start tracking spending."
                      : "There are no expenses in this category yet."}
                </p>
              </div>
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((exp) => (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                >
                  <ExpenseRow
                    expense={exp}
                    canManage={isAdmin}
                    onEdit={() => openEditForm(exp)}
                    onDelete={() => setDeleteTarget(exp)}
                    onRestore={() => restoreMutation.mutate(exp.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Add/Edit Expense Sheet */}
      <ExpenseFormSheet
        open={formOpen}
        onOpenChange={(o) => !o && closeForm()}
        onSubmit={handleSubmit}
        loading={addMutation.isPending || editMutation.isPending}
        expense={editTarget}
      />

      {/* Delete confirm — schedules a soft-delete with a 7-day grace period */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteTarget(null);
            setDeleteReason("");
          }
        }}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete this expense?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will schedule{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget.title}
                  </span>{" "}
                  ({formatINR(deleteTarget.amount)}) for deletion. It will be
                  permanently removed after{" "}
                  <span className="font-medium text-foreground">7 days</span>.
                  You can restore it from the Deletion Queue before then.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <GlassTextarea
            label="Reason (required)"
            rows={2}
            placeholder="Why is this expense being deleted?"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-destructive text-white hover:bg-destructive/90"
              disabled={!deleteReason.trim() || deleteMutation.isPending}
              onClick={() => {
                if (!deleteReason.trim()) {
                  toast.error("A reason is required");
                  return;
                }
                if (deleteTarget) {
                  deleteMutation.mutate({
                    id: deleteTarget.id,
                    reason: deleteReason,
                  });
                }
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Expense"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  color,
  prefix,
  suffixLabel,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "primary" | "success" | "warning" | "danger" | "info";
  prefix?: string;
  suffixLabel?: string;
}) {
  const colorVar =
    color === "primary"
      ? "var(--primary)"
      : color === "success"
        ? "var(--success)"
        : color === "warning"
          ? "var(--warning)"
          : color === "danger"
            ? "var(--destructive)"
            : "var(--info)";
  return (
    <GlassCard
      className="p-4"
      glow={color === "danger" ? "danger" : color === "warning" ? "warning" : color === "success" ? "success" : "primary"}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="grid place-items-center h-10 w-10 rounded-2xl"
          style={{
            background: `color-mix(in oklch, ${colorVar} 15%, transparent)`,
            color: colorVar,
          }}
        >
          {icon}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-2xl font-bold tracking-tight tabular-nums">
        <AnimatedCounter value={value} prefix={prefix || ""} />
      </div>
      {suffixLabel && (
        <p className="text-[11px] text-muted-foreground mt-1">{suffixLabel}</p>
      )}
    </GlassCard>
  );
}

const ExpenseRow = memo(function ExpenseRow({
  expense,
  canManage,
  onEdit,
  onDelete,
  onRestore,
}: {
  expense: Expense;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const meta = getCatMeta(expense.category);
  const isDeleted = !!expense.deletedAt;
  const locked = isExpenseLocked(expense);
  const qty = formatQuantity(expense.quantity, expense.unit);

  // Build the actions list — same shape as UserRow's `actions` array.
  const actions: {
    label: string;
    icon: typeof PencilLine;
    onClick: () => void;
    variant?: "destructive";
  }[] = [];
  if (isDeleted) {
    if (canManage) {
      actions.push({ label: "Restore Expense", icon: RotateCcw, onClick: onRestore });
    }
  } else if (canManage && !locked) {
    actions.push({ label: "Edit Expense", icon: PencilLine, onClick: onEdit });
    actions.push({
      label: "Delete Expense",
      icon: Trash2,
      onClick: onDelete,
      variant: "destructive",
    });
  }

  const CatIcon = CATEGORY_ICON_COMPONENTS[expense.category] ?? Boxes;

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-start gap-3">
        {/* Category icon tile */}
        <div
          className="grid place-items-center h-10 w-10 rounded-xl shrink-0"
          style={{
            background: `color-mix(in oklch, ${meta.colorVar} 15%, transparent)`,
            color: meta.colorVar,
          }}
        >
          <CatIcon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={cn(
                    "font-medium text-sm truncate",
                    (locked || isDeleted) && "text-muted-foreground",
                    isDeleted && "line-through"
                  )}
                >
                  {expense.title}
                </h3>
                {isDeleted ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-destructive/15 text-destructive border-destructive/30"
                  >
                    <Clock className="h-2.5 w-2.5" />{" "}
                    {formatDeletionCountdown(new Date(expense.deletedAt!))}
                  </Badge>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", meta.className)}
                    >
                      {meta.label}
                    </Badge>
                    {locked && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-muted/60 text-muted-foreground border-border/60"
                      >
                        🔒 Locked
                      </Badge>
                    )}
                  </>
                )}
              </div>
              {/* Transaction strip — Quantity + Cost on the same row, same size */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
                {qty && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Quantity</span>
                    <span className="text-base font-bold tabular-nums">{qty}</span>
                  </div>
                )}
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Cost</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(expense.amount)}</span>
                </div>
                {isDeleted && expense.deletionReason && (
                  <span className="inline-flex items-start gap-1 text-[11px] text-destructive/80">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    Reason: {expense.deletionReason}
                  </span>
                )}
              </div>
              {/* Date-time row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
                <span>{formatDate(expense.expenseDate)}</span>
                {expense.description && (
                  <span className="truncate max-w-[200px]">
                    · {expense.description}
                  </span>
                )}
              </div>
            </div>

            {/* Dropdown — only render if there are actions */}
            {actions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <GlassButton
                    variant="ghost"
                    size="icon"
                    className="shrink-0"
                    aria-label="Expense actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </GlassButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44 rounded-2xl">
                  <DropdownMenuLabel>Actions</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {actions.map((a) => {
                    const Icon = a.icon;
                    return (
                      <DropdownMenuItem
                        key={a.label}
                        onClick={a.onClick}
                        variant={a.variant}
                        className="rounded-xl cursor-pointer"
                      >
                        <Icon className="h-4 w-4" />
                        {a.label}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
});

// ─────────────────────────────────────────────────────────────
// Add / Edit Expense Sheet
// ─────────────────────────────────────────────────────────────

function ExpenseFormSheet({
  open,
  onOpenChange,
  onSubmit,
  loading,
  expense,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: ExpensePayload, id?: string) => void;
  loading: boolean;
  expense: Expense | null;
}) {
  // A `key` based on the editing target forces the body to remount whenever
  // the user switches between add / edit / a different expense. Combined with
  // the Sheet unmounting its content when closed, this means each open starts
  // with fresh state initialized from the `expense` prop — no useEffect sync
  // needed (which would trigger cascading renders per the react-hooks rule).
  const bodyKey = expense ? `edit-${expense.id}` : "add";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md flex flex-col gap-0 p-0"
      >
        <ExpenseFormBody
          key={bodyKey}
          expense={expense}
          onSubmit={onSubmit}
          loading={loading}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function ExpenseFormBody({
  expense,
  onSubmit,
  loading,
  onCancel,
}: {
  expense: Expense | null;
  onSubmit: (payload: ExpensePayload, id?: string) => void;
  loading: boolean;
  onCancel: () => void;
}) {
  const today = toLocalDateKey(new Date());
  const isEdit = !!expense;

  // Derive initial category (predefined or CUSTOM) from the expense.
  const initialCategory: ExpenseCategory = (() => {
    if (!expense?.category) return "GROCERY";
    if (
      CATEGORY_ORDER.includes(expense.category as ExpenseCategory) &&
      expense.category !== "CUSTOM"
    ) {
      return expense.category as ExpenseCategory;
    }
    return "CUSTOM";
  })();
  const initialCustomCategory =
    initialCategory === "CUSTOM" ? expense?.category ?? "" : "";

  // Derive initial unit (predefined or CUSTOM) from the expense.
  const initialUnit: string = (() => {
    if (!expense?.unit) return "piece";
    if (UNIT_OPTIONS.includes(expense.unit)) return expense.unit;
    return "CUSTOM";
  })();
  const initialCustomUnit = initialUnit === "CUSTOM" ? expense?.unit ?? "" : "";

  const [title, setTitle] = useState(expense?.title ?? "");
  const [amount, setAmount] = useState(
    expense?.amount ? String(expense.amount) : ""
  );
  const [quantity, setQuantity] = useState(
    expense?.quantity ? String(expense.quantity) : ""
  );
  const [category, setCategory] = useState<ExpenseCategory>(initialCategory);
  const [customCategory, setCustomCategory] = useState(initialCustomCategory);
  const [unit, setUnit] = useState<string>(initialUnit);
  const [customUnit, setCustomUnit] = useState(initialCustomUnit);
  const [date, setDate] = useState(
    expense
      ? toLocalDateKey(new Date(expense.expenseDate))
      : today
  );
  const [description, setDescription] = useState(expense?.description ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit() {
    const next: Record<string, string> = {};
    if (!title.trim() || title.trim().length < 2) next.title = "Item name is required";
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) next.amount = "Enter a valid cost";
    if (!date) next.date = "Date is required";
    if (category === "CUSTOM" && customCategory.trim().length < 2) {
      next.customCategory = "Enter a custom category name";
    }
    const qty = quantity ? parseFloat(quantity) : 0;
    if (quantity && (!qty || qty <= 0)) next.quantity = "Enter a valid quantity";
    if (unit === "CUSTOM" && customUnit.trim().length < 1) {
      next.customUnit = "Enter a custom unit";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const finalCategory =
      category === "CUSTOM"
        ? customCategory.trim().toUpperCase().replace(/\s+/g, "_")
        : category;
    const finalUnit = unit === "CUSTOM" ? customUnit.trim() : unit;

    onSubmit(
      {
        title: title.trim(),
        amount: amt,
        category: finalCategory,
        quantity: qty || 0,
        unit: finalUnit,
        expenseDate: new Date(date).toISOString(),
        description: description.trim() || undefined,
      },
      isEdit ? expense!.id : undefined
    );
  }

  return (
    <>
      <SheetHeader className="px-6 pt-6 pb-2">
        <SheetTitle className="flex items-center gap-2 text-xl">
          <PencilLine className="h-5 w-5 text-primary" />
          {isEdit ? "Edit Expense" : "Add Expense"}
        </SheetTitle>
        <SheetDescription>
          {isEdit
            ? "Update the details of this expense."
            : "Record a new operational expense. It will be visible immediately."}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 no-scrollbar">
        <GlassInput
          label="Item"
          placeholder="e.g. Monthly groceries"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
          icon={<Receipt />}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground ml-1">
            Category
          </label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as ExpenseCategory)}
          >
            <SelectTrigger className="w-full h-11 rounded-2xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_ORDER.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_META[c].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {category === "CUSTOM" && (
            <GlassInput
              placeholder="Enter custom category name…"
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              error={errors.customCategory}
              icon={<PencilLine className="h-4 w-4" />}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <GlassInput
            label="Quantity"
            type="number"
            inputMode="decimal"
            placeholder="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            error={errors.quantity}
          />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground ml-1">
              Unit
            </label>
            <Select value={unit} onValueChange={(v) => setUnit(v)}>
              <SelectTrigger className="w-full h-11 rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
                <SelectItem value="CUSTOM">Custom</SelectItem>
              </SelectContent>
            </Select>
            {unit === "CUSTOM" && (
              <GlassInput
                placeholder="Enter custom unit…"
                value={customUnit}
                onChange={(e) => setCustomUnit(e.target.value)}
                error={errors.customUnit}
                icon={<PencilLine className="h-4 w-4" />}
              />
            )}
          </div>
        </div>

        <GlassInput
          label="Cost (₹)"
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          icon={<IndianRupee />}
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground ml-1">
            Date
          </label>
          <GlassInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date}
            icon={<Calendar />}
          />
        </div>

        <GlassTextarea
          label="Notes (optional)"
          placeholder="Add any notes about this expense…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
        />
      </div>

      <SheetFooter className="px-6 py-4 border-t border-border/40 flex-row gap-2">
        <GlassButton variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </GlassButton>
        <GlassButton
          className="flex-1"
          onClick={handleSubmit}
          loading={loading}
        >
          {isEdit ? (
            <PencilLine className="h-4 w-4" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {isEdit ? "Save Changes" : "Add Expense"}
        </GlassButton>
      </SheetFooter>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
