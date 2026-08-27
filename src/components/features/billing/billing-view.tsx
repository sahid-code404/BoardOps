"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Wallet,
  AlertCircle,
  Receipt,
  Plus,
  Search,
  Ban,
  Eye,
  FileText,
  Calendar,
  CheckCircle2,
  Clock,
  MoreVertical,
  IndianRupee,
  ChevronLeft,
  ChevronRight,
  Trash2,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn, toLocalDateKey } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";
import { useAppStore } from "@/stores/use-app-store";
import { formatDeletionCountdown } from "@/lib/user-cleanup";

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
import { UserAvatar } from "@/components/glass/user-avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

type BillStatus =
  | "DRAFT"
  | "GENERATED"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "VOID"
  | "DELETED";

type Bill = {
  id: string;
  periodMonth: number;
  periodYear: number;
  mealCharges: number;
  otherCharges: number;
  adjustments: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: BillStatus;
  dueDate: string | null;
  generatedAt: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletionReason: string | null;
  user: { name: string; email: string; room: string | null; avatarUrl: string | null };
};

type ApiResponse<T> = { success: boolean; data: T; error?: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─────────────────────────────────────────────────────────────
// Status badge helpers
// ─────────────────────────────────────────────────────────────

const BILL_STATUS_STYLES: Record<
  BillStatus,
  { className: string; label: string }
> = {
  PAID: {
    className:
      "bg-success/15 text-success border-success/30",
    label: "Paid",
  },
  PARTIALLY_PAID: {
    className:
      "bg-warning/15 text-warning border-warning/30",
    label: "Partially Paid",
  },
  OVERDUE: {
    className:
      "bg-destructive/15 text-destructive border-destructive/30",
    label: "Overdue",
  },
  GENERATED: {
    className:
      "bg-info/15 text-info border-info/30",
    label: "Generated",
  },
  DRAFT: {
    className:
      "bg-muted text-muted-foreground border-border",
    label: "Draft",
  },
  VOID: {
    className:
      "bg-muted text-muted-foreground border-border",
    label: "Void",
  },
  DELETED: {
    className:
      "bg-destructive/15 text-destructive border-destructive/30",
    label: "Deleted",
  },
};

function BillStatusBadge({ status }: { status: BillStatus }) {
  const s = BILL_STATUS_STYLES[status];
  return (
    <Badge variant="outline" className={cn("rounded-full", s.className)}>
      {s.label}
    </Badge>
  );
}

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatMonthYear(month: number, year: number) {
  return `${MONTHS[month] ?? "—"} ${year}`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

/** Full date-time format: "29 June 2026, 05:28 am" */
function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

/** A bill is overdue if it has a due date in the past AND there's still an outstanding due amount. */
function isOverdue(bill: Bill): boolean {
  if (!bill.dueDate || bill.deletedAt) return false;
  if (bill.status === "PAID" || bill.status === "VOID") return false;
  return new Date(bill.dueDate) < new Date() && bill.dueAmount > 0;
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function BillingView() {
  const user = useAuthStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  const isAdmin =
    user?.role === "ADMIN";

  const qc = useQueryClient();
  // Debounced search — `searchInput` drives the input field; `search` is the
  // debounced value (200ms after the user stops typing) used for actual
  // filtering. Prevents re-filtering large lists on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [statusFilter, setStatusFilter] = useState<BillStatus | "ALL" | "DELETED">("ALL");
  const [generateOpen, setGenerateOpen] = useState(false);
  // UX-3: confirmation dialog shown when the admin clicks "Generate" inside the
  // Generate Bills dialog. Forces an explicit confirm before recalculating
  // every resident's bill for the selected period.
  const [confirmGenerateOpen, setConfirmGenerateOpen] = useState(false);
  // Default to last month — bills can only be generated for past months
  const nowDate = new Date();
  const [genMonth, setGenMonth] = useState<number>(
    nowDate.getMonth() === 0 ? 11 : nowDate.getMonth() - 1
  );
  const [genYear, setGenYear] = useState<number>(
    nowDate.getMonth() === 0 ? nowDate.getFullYear() - 1 : nowDate.getFullYear()
  );
  // Default due date = 10th of next month (matches the backend default)
  const defaultDueDate = (() => {
    const d = new Date(genYear, genMonth + 1, 10);
    return toLocalDateKey(d);
  })();
  const [genDueDate, setGenDueDate] = useState<string>(defaultDueDate);

  // Readiness checklist — fetched when the Generate dialog opens
  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ["billing-readiness", { month: genMonth, year: genYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{
        canClose: boolean;
        items: { key: string; label: string; status: "ready" | "warning" | "error"; detail: string; count?: number }[];
      }>>(`/billing-cycles/readiness?month=${genMonth}&year=${genYear}`);
      return r.data;
    },
    enabled: generateOpen,
    placeholderData: (prev) => prev,
  });
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [voidTarget, setVoidTarget] = useState<Bill | null>(null);
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const { data: bills = [], isLoading, isFetching } = useQuery({
    queryKey: ["bills", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Bill[]>>("/bills", {
        params: { month: selectedMonth, year: selectedYear },
      });
      return r.data;
    },
    // Keep previous data visible while a new month/year loads (stale-while-revalidate).
    // Eliminates the flash of empty content when switching months.
    placeholderData: (prev) => prev,
  });

  // Fetch soft-deleted bills (deletion queue) — admin only
  const { data: deletedBills = [] } = useQuery({
    queryKey: ["bills", "deleted", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Bill[]>>("/bills", {
        params: { month: selectedMonth, year: selectedYear, includeDeleted: "true" },
      });
      return r.data;
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<ApiResponse<{ generated: number; created: number; updated: number; skipped: number; month: number; year: number }>>(
        "/bills",
        { month: genMonth, year: genYear, dueDate: genDueDate || undefined }
      ),
    onSuccess: (r) => {
      const { created, updated, skipped } = r.data;
      const parts: string[] = [];
      if (created > 0) parts.push(`${created} new`);
      if (updated > 0) parts.push(`${updated} updated`);
      const summary = parts.length > 0 ? parts.join(", ") : "No changes";
      const msg = skipped > 0
        ? `${summary} · ${skipped} skipped (void/deleted)`
        : `${summary} for ${MONTHS[genMonth]} ${genYear}`;
      toast.success(`Bills generated — ${msg}`);
      setGenerateOpen(false);
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to generate bills"),
  });

  const voidMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<{ success: boolean }>>(`/bills/${id}`),
    onSuccess: () => {
      toast.success("Bill voided successfully");
      setVoidTarget(null);
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to void bill"),
  });

  const [deleteTarget, setDeleteTarget] = useState<Bill | null>(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteAllReason, setDeleteAllReason] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/bills/${id}`, { body: JSON.stringify({ reason: deleteReason || undefined }) });
    },
    onSuccess: () => {
      toast.success("Bill scheduled for deletion — permanently removed in 7 days");
      setDeleteTarget(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete bill"),
  });

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      const r = await api.delete<ApiResponse<{ deleted: number }>>("/bills", {
        params: { month: selectedMonth, year: selectedYear },
        body: JSON.stringify({ reason: deleteAllReason || undefined }),
      });
      return r.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.deleted} bills scheduled for deletion — permanently removed in 7 days`);
      setDeleteAllOpen(false);
      setDeleteAllReason("");
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete bills"),
  });

  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.post<ApiResponse<Bill>>(`/bills/${id}/restore`);
      return r.data;
    },
    onSuccess: () => {
      toast.success("Bill restored successfully");
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to restore bill"),
  });

  const restoreAllMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.all(
        deletedBills.map((b) => api.post(`/bills/${b.id}/restore`).catch(() => null))
      );
      return results.filter((r) => r !== null).length;
    },
    onSuccess: (count) => {
      toast.success(`${count} bills restored successfully`);
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to restore bills"),
  });

  // ── Derived KPIs ──
  // KPIs include ALL bills (active + soft-deleted) for the month, excluding only VOID.
  // Soft-deleting a bill removes it from the user's view but the financial data
  // (total billed, collected, outstanding) still counts in the KPIs.
  const allBills = useMemo(() => [...bills, ...deletedBills], [bills, deletedBills]);
  const kpis = useMemo(() => {
    const active = allBills.filter((b) => b.status !== "VOID");
    const totalBilled = active.reduce((s, b) => s + b.totalAmount, 0);
    const totalCollected = active.reduce((s, b) => s + b.paidAmount, 0);
    const overdueBills = active.filter((b) => isOverdue(b));
    const overdueCount = overdueBills.length;
    const overdueAmount = overdueBills.reduce((s, b) => s + b.dueAmount, 0);
    return { totalBilled, totalCollected, overdueCount, overdueAmount };
  }, [allBills]);

  // ── Filtered list ──
  // Use deleted bills when filter is DELETED, otherwise use active bills
  const sourceBills = statusFilter === "DELETED" ? deletedBills : bills;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sourceBills.filter((b) => {
      if (statusFilter !== "ALL" && statusFilter !== "DELETED" && b.status !== statusFilter) return false;
      if (!q) return true;
      return (
        b.user.name?.toLowerCase().includes(q) ||
        b.user.email?.toLowerCase().includes(q) ||
        (b.user.room || "").toLowerCase().includes(q)
      );
    });
  }, [sourceBills, search, statusFilter]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className={cn("gap-3", isAdmin ? "grid grid-cols-3" : "grid grid-cols-2")}>
          {Array.from({ length: isAdmin ? 3 : 2 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-32" />
          ))}
        </div>
        <ShimmerSkeleton className="h-14 w-full" />
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
              // Don't allow navigating past the current month
              const today = new Date();
              const currentPeriod = today.getFullYear() * 12 + today.getMonth();
              const nextPeriod = selectedYear * 12 + selectedMonth + 1;
              if (nextPeriod > currentPeriod) return;
              const d = new Date(selectedYear, selectedMonth + 1, 1);
              setSelectedMonth(d.getMonth());
              setSelectedYear(d.getFullYear());
            }}
            aria-label="Next month"
            className={`grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 transition-all ${
              selectedYear * 12 + selectedMonth >= new Date().getFullYear() * 12 + new Date().getMonth()
                ? "opacity-30 cursor-not-allowed"
                : "hover:ring-primary/40"
            }`}
          >
            <ChevronRight className="h-5 w-5" />
          </motion.button>
        </div>
      </StaggerItem>

      {/* Compact action bar — centered transparent glass card button */}
      {isAdmin ? (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              onClick={() => setGenerateOpen(true)}
              size="lg"
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <Plus className="h-5 w-5" />
              Generate Bills
            </GlassButton>
          </div>
        </StaggerItem>
      ) : (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              onClick={() => setView("payments")}
              size="lg"
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <Wallet className="h-5 w-5" />
              Pay Bill
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* KPIs — admins see 3 (Total Billed, Total Collected, Overdue), users see 2 (Total Billed, Overdue) */}
      <StaggerItem>
        <div className={cn("gap-3", isAdmin ? "grid grid-cols-3" : "grid grid-cols-2")}>
          <KpiCard
            label="Total Billed"
            value={kpis.totalBilled}
            icon={<Wallet className="h-4 w-4" />}
            color="primary"
            prefix="₹"
            sub={isAdmin ? "All bills" : "Your bills"}
          />
          {isAdmin && (
            <KpiCard
              label="Total Collected"
              value={kpis.totalCollected}
              icon={<CheckCircle2 className="h-4 w-4" />}
              color="success"
              prefix="₹"
              sub="Paid amount"
            />
          )}
          <KpiCard
            label="Overdue Amount"
            value={kpis.overdueAmount}
            icon={<AlertCircle className="h-4 w-4" />}
            color="danger"
            prefix="₹"
            sub={kpis.overdueCount > 0 ? `${kpis.overdueCount} overdue` : "None overdue"}
          />
        </div>
      </StaggerItem>

      {/* Search + Filter pills — all in a single horizontal scrollable line */}
      <StaggerItem>
        <div className="space-y-3">
          <GlassInput
            placeholder="Search by name, email, room…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<Search />}
          />
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
            {(
              [
                "ALL",
                "GENERATED",
                "PARTIALLY_PAID",
                "PAID",
                "OVERDUE",
                "VOID",
                ...(isAdmin ? ["DELETED" as const] : []),
              ] as const
            ).map((s) => {
              const active = statusFilter === s;
              const label = s === "DELETED" ? "Deletion Queue" : s === "ALL" ? "All" : BILL_STATUS_STYLES[s as BillStatus]?.label || s;
              const badge = s === "DELETED" && deletedBills.length > 0 ? deletedBills.length : null;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap shrink-0 transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "glass-soft text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  {badge !== null && (
                    <span className={cn(
                      "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                      active && s !== "DELETED"
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : active && s === "DELETED"
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : "bg-destructive text-white"
                    )}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
            {/* Delete All — inline at the end of the same scrollable row */}
            {isAdmin && statusFilter !== "DELETED" && bills.length > 0 && (
              <button
                onClick={() => setDeleteAllOpen(true)}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap shrink-0 text-destructive/70 hover:text-destructive transition-colors"
              >
                <Trash2 className="h-3 w-3" />
                Delete All ({bills.length})
              </button>
            )}
            {/* Restore All — inline at the end of the same scrollable row (deletion queue only) */}
            {isAdmin && statusFilter === "DELETED" && deletedBills.length > 0 && (
              <button
                onClick={() => restoreAllMutation.mutate()}
                disabled={restoreAllMutation.isPending}
                className="inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap shrink-0 text-success/70 hover:text-success transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                {restoreAllMutation.isPending ? "Restoring…" : `Restore All (${deletedBills.length})`}
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
                <p className="font-medium">No bills found</p>
                <p className="text-sm text-muted-foreground">
                  {isAdmin
                    ? "Generate bills for the current period to get started."
                    : "You have no bills matching the current filters."}
                </p>
              </div>
              {isAdmin && (
                <GlassButton className="mt-2" onClick={() => setGenerateOpen(true)}>
                  <Wallet className="h-4 w-4" />
                  Generate Bills
                </GlassButton>
              )}
              {!isAdmin && (
                <GlassButton variant="ghost" className="mt-2" onClick={() => setView("dashboard")}>
                  Back to Dashboard
                </GlassButton>
              )}
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((bill) => (
                <motion.div
                  key={bill.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                >
                  <BillRow
                    bill={bill}
                    isAdmin={isAdmin}
                    onView={() => setSelectedBill(bill)}
                    onVoid={() => setVoidTarget(bill)}
                    onDelete={() => setDeleteTarget(bill)}
                    onRestore={() => restoreMutation.mutate(bill.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Generate Bills Dialog — with integrated readiness checklist */}
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              Generate Bills
            </DialogTitle>
            <DialogDescription>
              Generate bills for a past month. All checks must pass before generation.
            </DialogDescription>
          </DialogHeader>

          {/* Month/Year picker — past months only */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Month</label>
              <Select
                value={String(genMonth)}
                onValueChange={(v) => setGenMonth(Number(v))}
              >
                <SelectTrigger className="w-full h-10 rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => {
                    const currentPeriod = now.getFullYear() * 12 + now.getMonth();
                    const itemPeriod = genYear * 12 + i;
                    if (itemPeriod >= currentPeriod) return null; // skip current/future months
                    return <SelectItem key={m} value={String(i)}>{m}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Year</label>
              <Select
                value={String(genYear)}
                onValueChange={(v) => setGenYear(Number(v))}
              >
                <SelectTrigger className="w-full h-10 rounded-2xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 5 }).map((_, i) => {
                    const y = now.getFullYear() - 4 + i; // 4 years ago to current year — no future years
                    return <SelectItem key={y} value={String(y)}>{y}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Readiness checklist */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Readiness Check</p>
              {readiness && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  readiness.canClose ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"
                }`}>
                  {readiness.canClose ? "ALL PASSED ✓" : `${readiness.items.filter(i => i.status !== "ready").length} ISSUES`}
                </span>
              )}
            </div>
            {readinessLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : readiness ? (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {readiness.items.map((item) => (
                  <div
                    key={item.key}
                    className={`flex items-start gap-2 p-2 rounded-xl text-xs ${
                      item.status === "ready" ? "bg-success/5" :
                      item.status === "warning" ? "bg-warning/5" : "bg-destructive/5"
                    }`}
                  >
                    <span className="shrink-0 mt-0.5">
                      {item.status === "ready" && <span className="text-success">✓</span>}
                      {item.status === "warning" && <span className="text-warning">⚠</span>}
                      {item.status === "error" && <span className="text-destructive">✗</span>}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className={`font-medium ${item.status === "ready" ? "text-success" : item.status === "warning" ? "text-warning" : "text-destructive"}`}>
                        {item.label}
                      </span>
                      {item.status !== "ready" && (
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.detail}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Loading checklist…</p>
            )}
          </div>

          {/* Due date picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground ml-1">Due Date</label>
            <GlassInput
              type="date"
              value={genDueDate}
              onChange={(e) => setGenDueDate(e.target.value)}
              icon={<Calendar className="h-4 w-4" />}
            />
            <p className="text-[11px] text-muted-foreground ml-1">
              Defaults to the 10th of next month.
            </p>
          </div>

          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setGenerateOpen(false)}>Cancel</GlassButton>
            <GlassButton
              onClick={() => setConfirmGenerateOpen(true)}
              loading={generateMutation.isPending}
              disabled={!readiness?.canClose}
            >
              <Sparkles className="h-4 w-4" />
              Generate
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* UX-3: final confirmation before generating bills */}
      <AlertDialog
        open={confirmGenerateOpen}
        onOpenChange={(o) => !o && setConfirmGenerateOpen(false)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Generate bills for {MONTHS[genMonth]} {genYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will recalculate all resident bills. Existing bills will be updated with new meal charges. Payment history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl" disabled={generateMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={generateMutation.isPending}
              onClick={() => {
                generateMutation.mutate();
                setConfirmGenerateOpen(false);
              }}
            >
              {generateMutation.isPending ? "Generating…" : "Generate Bills"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bill detail dialog */}
      <Dialog
        open={!!selectedBill}
        onOpenChange={(o) => !o && setSelectedBill(null)}
      >
        <DialogContent className="rounded-3xl max-w-lg">
          {selectedBill && (
            <BillDetail bill={selectedBill} isAdmin={isAdmin} />
          )}
        </DialogContent>
      </Dialog>

      {/* Void confirm */}
      <AlertDialog
        open={!!voidTarget}
        onOpenChange={(o) => !o && setVoidTarget(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Void this bill?</AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget && (
                <>
                  This will mark the bill for{" "}
                  <span className="font-medium text-foreground">
                    {voidTarget.user.name}
                  </span>{" "}
                  ({formatMonthYear(voidTarget.periodMonth, voidTarget.periodYear)}
                  ) as void. This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-destructive text-white hover:bg-destructive/90"
              onClick={() =>
                voidTarget && voidMutation.mutate(voidTarget.id)
              }
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending ? "Voiding…" : "Void Bill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete single bill confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete this bill?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will schedule the bill for{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget.user.name}
                  </span>{" "}
                  ({formatMonthYear(deleteTarget.periodMonth, deleteTarget.periodYear)}) for deletion.
                  It will be permanently removed after{" "}
                  <span className="font-medium text-foreground">7 days</span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <GlassTextarea
            label="Reason (required)"
            rows={2}
            placeholder="Why is this bill being deleted?"
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
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete Bill"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete all bills confirm */}
      <AlertDialog
        open={deleteAllOpen}
        onOpenChange={setDeleteAllOpen}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete all bills for {MONTHS[selectedMonth]} {selectedYear}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will schedule ALL {bills.length} bills for{" "}
              {MONTHS[selectedMonth]} {selectedYear} for deletion. The bills will
              be permanently removed after <span className="font-medium text-foreground">7 days</span>.
              You can restore them before the 7-day period expires. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <GlassTextarea
            label="Reason (required)"
            rows={2}
            placeholder="Why are these bills being deleted?"
            value={deleteAllReason}
            onChange={(e) => setDeleteAllReason(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-destructive text-white hover:bg-destructive/90"
              disabled={!deleteAllReason.trim() || deleteAllMutation.isPending}
              onClick={() => {
                if (!deleteAllReason.trim()) {
                  toast.error("A reason is required");
                  return;
                }
                deleteAllMutation.mutate();
              }}
            >
              {deleteAllMutation.isPending ? "Deleting…" : `Delete All (${bills.length})`}
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
  sub,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "primary" | "success" | "warning" | "danger" | "info";
  prefix?: string;
  sub?: string;
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
      className="p-4 relative overflow-hidden"
      glow={color === "danger" ? "danger" : color === "warning" ? "warning" : color === "success" ? "success" : "primary"}
      whileHover={{ y: -2 }}
    >
      <div
        className="absolute -top-8 -right-8 h-24 w-24 rounded-full blur-3xl opacity-30"
        style={{ background: colorVar }}
      />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div
            className="grid place-items-center h-9 w-9 rounded-2xl"
            style={{
              background: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
              color: colorVar,
            }}
          >
            {icon}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="text-2xl font-bold tracking-tight tabular-nums">
          <AnimatedCounter value={value} prefix={prefix || ""} />
        </div>
        {sub && (
          <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
        )}
      </div>
    </GlassCard>
  );
}

const BillRow = memo(function BillRow({
  bill,
  isAdmin,
  onView,
  onVoid,
  onDelete,
  onRestore,
}: {
  bill: Bill;
  isAdmin: boolean;
  onView: () => void;
  onVoid: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const isDeleted = !!bill.deletedAt;

  // Build the actions list — same shape as UserRow's `actions` array.
  const actions: { label: string; icon: typeof Eye; onClick: () => void; variant?: "destructive" }[] = [];
  if (isDeleted) {
    if (isAdmin) {
      actions.push({ label: "Restore Bill", icon: RotateCcw, onClick: onRestore });
    }
  } else {
    actions.push({ label: "View Details", icon: Eye, onClick: onView });
    if (isAdmin && bill.status !== "VOID") {
      actions.push({ label: "Void Bill", icon: Ban, onClick: onVoid, variant: "destructive" });
    }
    if (isAdmin) {
      actions.push({ label: "Delete Bill", icon: Trash2, onClick: onDelete, variant: "destructive" });
    }
  }

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-start gap-3">
        <UserAvatar
          name={bill.user.name}
          avatarUrl={bill.user.avatarUrl}
          className="h-10 w-10 rounded-xl"
          fallbackClassName="text-xs"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={cn("font-medium text-sm truncate", isDeleted && "text-muted-foreground line-through")}>
                  {bill.user.name}
                </h3>
                {isDeleted ? (
                  <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">
                    <Clock className="h-2.5 w-2.5" /> {formatDeletionCountdown(new Date(bill.deletedAt!))}
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className={cn("text-[10px]", BILL_STATUS_STYLES[bill.status].className)}>
                      {BILL_STATUS_STYLES[bill.status].label}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground border-border">
                      <Calendar className="h-2.5 w-2.5" /> {formatDateTime(bill.generatedAt)}
                    </Badge>
                  </>
                )}
              </div>
              {/* Transaction strip — Total / Paid / Due all the same size + dates */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(bill.totalAmount)}</span>
                </div>
                {!isDeleted && (
                  <>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Paid</span>
                      <span className="text-base font-bold text-success tabular-nums">{formatINR(bill.paidAmount)}</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Due</span>
                      <span className="text-base font-bold text-warning tabular-nums">{formatINR(bill.dueAmount)}</span>
                    </div>
                  </>
                )}
                {bill.deletedAt && bill.deletionReason && (
                  <span className="inline-flex items-start gap-1 text-[11px] text-destructive/80">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    Reason: {bill.deletionReason}
                  </span>
                )}
              </div>
              {/* Due date — red if overdue, with OVERDUE badge */}
              {!isDeleted && bill.dueDate && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1.5 text-[11px]">
                  {isOverdue(bill) && (
                    <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">
                      <AlertCircle className="h-2.5 w-2.5" /> Overdue
                    </Badge>
                  )}
                  <span className={cn(
                    "inline-flex items-center gap-1",
                    isOverdue(bill) ? "text-destructive font-semibold" : "text-muted-foreground"
                  )}>
                    <Clock className="h-3 w-3" /> Due {formatDate(bill.dueDate)}
                  </span>
                </div>
              )}
            </div>

            {/* Dropdown — only render if there are actions */}
            {actions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <GlassButton variant="ghost" size="icon" className="shrink-0" aria-label="Bill actions">
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

const BillDetail = memo(function BillDetail({ bill, isAdmin }: { bill: Bill; isAdmin: boolean }) {
  const { data: payments = [] } = useQuery({
    queryKey: ["bill", bill.id, "payments"],
    queryFn: async () => {
      const r = await api.get<
        ApiResponse<{
          id: string;
          payments: Array<{
            id: string;
            amount: number;
            method: string;
            status: string;
            reference: string | null;
            createdAt: string;
          }>;
        }>
      >(`/bills/${bill.id}`);
      return r.data.payments || [];
    },
    enabled: isAdmin,
  });

  const rows = [
    { label: "Meal Charges", value: bill.mealCharges, icon: <IndianRupee className="h-3.5 w-3.5" /> },
    { label: "Other Charges", value: bill.otherCharges, icon: <IndianRupee className="h-3.5 w-3.5" /> },
    {
      label: "Adjustments",
      value: bill.adjustments,
      icon: <IndianRupee className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wide">
            Bill Breakdown
          </p>
          <h3 className="text-lg font-semibold">{bill.user.name}</h3>
          <p className="text-xs text-muted-foreground">
            {formatMonthYear(bill.periodMonth, bill.periodYear)} · Room{" "}
            {bill.user.room || "—"}
          </p>
        </div>
        <BillStatusBadge status={bill.status} />
      </div>

      <div className="space-y-2 mb-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between glass-soft rounded-2xl px-4 py-2.5"
          >
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              {r.icon}
              {r.label}
            </span>
            <span className="text-sm font-medium tabular-nums">
              {formatINR(r.value)}
            </span>
          </div>
        ))}
      </div>

      <div className="glass-strong rounded-2xl p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Total Amount</span>
          <span className="text-base font-semibold tabular-nums">
            {formatINR(bill.totalAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-success flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> Paid
          </span>
          <span className="text-sm font-medium text-success tabular-nums">
            {formatINR(bill.paidAmount)}
          </span>
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-sm text-warning flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> Due
          </span>
          <span className="text-base font-bold text-warning tabular-nums">
            {formatINR(bill.dueAmount)}
          </span>
        </div>
      </div>

      <div className="text-xs text-muted-foreground flex items-center gap-2 mb-4">
        <Clock className="h-3.5 w-3.5" />
        Due {formatDate(bill.dueDate)} · Generated {formatDate(bill.generatedAt)}
      </div>

      {isAdmin && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 ml-1 uppercase tracking-wide">
            Payment History ({payments.length})
          </p>
          {payments.length === 0 ? (
            <div className="glass-soft rounded-2xl p-4 text-center text-sm text-muted-foreground">
              No payments recorded yet.
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto no-scrollbar space-y-2">
              {payments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between glass-soft rounded-2xl px-4 py-2.5"
                >
                  <div>
                    <p className="text-sm font-medium tabular-nums">
                      {formatINR(p.amount)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.method} · {formatDate(p.createdAt)}
                      {p.reference ? ` · Ref ${p.reference}` : ""}
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full">
                    {p.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// Small inline icon (sparkle) to avoid extra import cost
function Sparkles({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
    </svg>
  );
}
