"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { isSameMonth } from "date-fns";
import {
  Wallet,
  CheckCircle2,
  Clock,
  XCircle,
  IndianRupee,
  Plus,
  CreditCard,
  Banknote,
  Building2,
  Smartphone,
  Wallet as WalletIcon,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  ChevronLeft,
  ChevronRight,
  Calendar,
  RotateCcw,
  MoreVertical,
  PencilLine,
  Trash2,
  AlertTriangle,
  Ban,
} from "lucide-react";

import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDeletionCountdown } from "@/lib/deletion-utils";

import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { UserAvatar } from "@/components/glass/user-avatar";

import { Badge } from "@/components/ui/badge";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type PaymentStatus = "PENDING" | "APPROVED" | "REJECTED" | "REFUNDED" | "VOID" | "DELETED";
type PaymentMethod = "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "WALLET" | "REFUND";

type Payment = {
  id: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string | null;
  notes: string | null;
  billId: string | null;
  createdAt: string;
  deletedAt: string | null;
  deletionReason: string | null;
  user: { name: string; email: string; room: string | null; avatarUrl: string | null };
};

type ApiResponse<T> = { success: boolean; data: T; error?: string };

type BillListItem = {
  id: string;
  periodMonth: number;
  periodYear: number;
  dueAmount: number;
  status: string;
  user: { name: string };
};

// ─────────────────────────────────────────────────────────────
// Style maps
// ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  PaymentStatus,
  { className: string; label: string }
> = {
  APPROVED: {
    className: "bg-success/15 text-success border-success/30",
    label: "Approved",
  },
  PENDING: {
    className: "bg-warning/15 text-warning border-warning/30",
    label: "Pending",
  },
  REJECTED: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
    label: "Rejected",
  },
  REFUNDED: {
    className: "bg-info/15 text-info border-info/30",
    label: "Refunded",
  },
  VOID: {
    className: "bg-muted text-muted-foreground border-border",
    label: "Void",
  },
  DELETED: {
    className: "bg-destructive/15 text-destructive border-destructive/30",
    label: "Deleted",
  },
};

const METHOD_META: Record<
  PaymentMethod,
  { label: string; icon: React.ReactNode; className: string }
> = {
  CASH: {
    label: "Cash",
    icon: <Banknote className="h-3.5 w-3.5" />,
    className: "bg-success/10 text-success border-success/20",
  },
  UPI: {
    label: "UPI",
    icon: <Smartphone className="h-3.5 w-3.5" />,
    className: "bg-primary/10 text-primary border-primary/20",
  },
  CARD: {
    label: "Card",
    icon: <CreditCard className="h-3.5 w-3.5" />,
    className: "bg-info/10 text-info border-info/20",
  },
  BANK_TRANSFER: {
    label: "Bank",
    icon: <Building2 className="h-3.5 w-3.5" />,
    className: "bg-warning/10 text-warning border-warning/20",
  },
  WALLET: {
    label: "Wallet",
    icon: <WalletIcon className="h-3.5 w-3.5" />,
    className: "bg-secondary text-secondary-foreground border-border",
  },
  REFUND: {
    label: "Refund",
    icon: <RotateCcw className="h-3.5 w-3.5" />,
    className: "bg-info/10 text-info border-info/20",
  },
};

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

/** Full date-time format: "29 June 2026, 05:28 am" */
function formatDateTime(iso: string) {
  const d = new Date(iso);
  const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${datePart}, ${timePart}`;
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function PaymentsView() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "ADMIN";
  const qc = useQueryClient();

  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const isThisMonth = isSameMonth(new Date(selectedYear, selectedMonth, 1), now);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  // Debounced search — `searchInput` drives the input field; `search` is the
  // debounced value (200ms after the user stops typing) used for actual
  // filtering. Prevents re-filtering large lists on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [statusFilter, setStatusFilter] = useState<PaymentStatus | "ALL" | "DELETED">("ALL");

  const [submitOpen, setSubmitOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<{
    payment: Payment;
    action: "APPROVE" | "REJECT";
  } | null>(null);

  // New state — edit / delete / void flows (admin only)
  const [editTarget, setEditTarget] = useState<Payment | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);

  // Pay Refund state (admin only) — users with credit balance (overpaid bills)
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundUsers, setRefundUsers] = useState<Array<{
    userId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    room: string | null;
    creditAmount: number;
  }>>([]);
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundTarget, setRefundTarget] = useState<{ userId: string; name: string; creditAmount: number } | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundNotes, setRefundNotes] = useState("");

  // Fetch ALL payments for KPIs (not affected by month picker)
  const { data: allPayments = [] } = useQuery({
    queryKey: ["payments", "all"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Payment[]>>("/payments");
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  // Fetch month-filtered payments for the list
  const { data: payments = [], isLoading, isFetching } = useQuery({
    queryKey: ["payments", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Payment[]>>("/payments", {
        params: { month: selectedMonth, year: selectedYear, limit: 500 },
      });
      return r.data;
    },
    // Keep previous data visible while a new month/year loads (stale-while-revalidate).
    // Eliminates the flash of empty content when switching months.
    placeholderData: (prev) => prev,
  });

  // Fetch soft-deleted payments (deletion queue) — admin only
  const { data: deletedPayments = [] } = useQuery({
    queryKey: ["payments", "deleted", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Payment[]>>("/payments", {
        params: { month: selectedMonth, year: selectedYear, includeDeleted: "true", limit: 500 },
      });
      return r.data;
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  // Fetch pending refunds from the Refund model (created during bill generation)
  // Also fetch users with refundable credit (old system) — combine both counts
  const { data: refundCreditUsers = [] } = useQuery({
    queryKey: ["payments", "refund-users"],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: Array<{ userId: string; creditAmount: number }> }>("/payments/refund");
      return r.data;
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  // Fetch actual Refund records (PENDING + PARTIALLY_PAID) from the new refund system
  const { data: pendingRefunds = [] } = useQuery({
    queryKey: ["refunds", "pending"],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: Array<{ id: string; amount: number; remainingAmount: number; status: string }> }>("/refunds?status=PENDING");
      return r.data;
    },
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  // Refund pending = users with credit (old) + pending refund records (new)
  const refundPendingCount = refundCreditUsers.length + pendingRefunds.length;
  const refundPendingAmount = pendingRefunds.reduce((s, r) => s + r.remainingAmount, 0);

  const submitMutation = useMutation({
    mutationFn: (payload: {
      amount: number;
      method: PaymentMethod;
      billId?: string;
      reference?: string;
      notes?: string;
    }) =>
      api.post<ApiResponse<Payment>>("/payments", payload),
    onSuccess: () => {
      toast.success("Payment submitted — pending admin approval");
      setSubmitOpen(false);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["bills", "submit-payment-dialog"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to submit payment"),
  });

  const actionMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "APPROVE" | "REJECT";
    }) => api.patch<ApiResponse<Payment>>(`/payments/${id}`, { action }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.action === "APPROVE"
          ? "Payment approved — bill updated"
          : "Payment rejected"
      );
      setActionTarget(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      qc.invalidateQueries({ queryKey: ["bills", "submit-payment-dialog"] });
    },
    onError: (e: Error) => toast.error(e.message || "Action failed"),
  });

  // Edit payment (PUT /api/payments/[id] { action: "EDIT", ... })
  const editMutation = useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: string;
      payload: {
        amount?: number;
        method?: PaymentMethod;
        reference?: string | null;
        notes?: string | null;
      };
    }) =>
      api.put<ApiResponse<Payment>>(`/payments/${id}`, {
        action: "EDIT",
        ...payload,
      }),
    onSuccess: () => {
      toast.success("Payment updated");
      setEditOpen(false);
      setEditTarget(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update payment"),
  });

  // Void payment (PUT /api/payments/[id] { action: "VOID" })
  const voidMutation = useMutation({
    mutationFn: (id: string) =>
      api.put<ApiResponse<Payment>>(`/payments/${id}`, { action: "VOID" }),
    onSuccess: () => {
      toast.success("Payment voided");
      setVoidTarget(null);
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to void payment"),
  });

  // Soft-delete payment (DELETE /api/payments/[id] { reason? })
  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      await api.delete(`/payments/${id}`, {
        body: JSON.stringify({ reason: reason || undefined }),
      });
    },
    onSuccess: () => {
      toast.success("Payment scheduled for deletion — permanently removed in 7 days");
      setDeleteTarget(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete payment"),
  });

  // Restore soft-deleted payment (POST /api/payments/[id]/restore)
  const restoreMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.post<ApiResponse<Payment>>(`/payments/${id}/restore`);
      return r.data;
    },
    onSuccess: () => {
      toast.success("Payment restored successfully");
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to restore payment"),
  });

  const openEditForm = useCallback((p: Payment) => {
    setEditTarget(p);
    setEditOpen(true);
  }, []);

  const closeEditForm = useCallback(() => {
    setEditOpen(false);
    setEditTarget(null);
  }, []);

  // Pay Refund — fetch users with credit balance, then process refund
  const fetchRefundUsers = async () => {
    setRefundLoading(true);
    setRefundOpen(true); // open dialog immediately so the user sees a loading state
    setRefundUsers([]);  // clear stale list
    try {
      const r = await api.get<{ success: boolean; data: typeof refundUsers }>("/payments/refund");
      setRefundUsers(r.data);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to load refund users");
      setRefundOpen(false);
    } finally {
      setRefundLoading(false);
    }
  };

  const refundMutation = useMutation({
    mutationFn: async () => {
      if (!refundTarget) return;
      await api.post("/payments/refund", {
        userId: refundTarget.userId,
        amount: parseFloat(refundAmount),
        notes: refundNotes || undefined,
      });
    },
    onSuccess: () => {
      toast.success(`Refund of ₹${refundAmount} processed — user notified`);
      setRefundTarget(null);
      setRefundAmount("");
      setRefundNotes("");
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
      // Refresh the refund users list
      fetchRefundUsers();
    },
    onError: (e: Error) => toast.error(e.message || "Failed to process refund"),
  });

  // KPIs — computed from the month-filtered payments list
  const kpis = useMemo(() => {
    const approved = payments.filter((p) => p.status === "APPROVED");
    const totalApproved = approved.reduce((s, p) => s + p.amount, 0);
    const pending = payments.filter((p) => p.status === "PENDING").length;
    const refunded = payments.filter((p) => p.status === "REFUNDED").length;
    return { totalApproved, pending, refunded };
  }, [payments]);

  // Filtered list — search + status filter pills only
  const sourcePayments = statusFilter === "DELETED" ? deletedPayments : payments;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sourcePayments.filter((p) => {
      if (statusFilter !== "ALL" && statusFilter !== "DELETED" && p.status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.user.name?.toLowerCase().includes(q) ||
        p.user.email?.toLowerCase().includes(q) ||
        (p.reference || "").toLowerCase().includes(q)
      );
    });
  }, [sourcePayments, search, statusFilter]);

  // Pending payments for the admin approval card — from ALL payments (not month-scoped)
  const pendingPayments = allPayments.filter((p) => p.status === "PENDING");

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid-kpi gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
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
      {/* Month picker — centered capsule with circular arrows (matches billing/expenses) */}
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
            onClick={() => !isThisMonth && (setSelectedMonth(now.getMonth()), setSelectedYear(now.getFullYear()))}
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
            {!isThisMonth && (
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

      {/* Pay Refund — admin only, centered glass card button */}
      {isAdmin && (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              size="lg"
              onClick={fetchRefundUsers}
              loading={refundLoading}
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <RotateCcw className="h-5 w-5" />
              Pay Refund
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* Action bar — only for non-admins (who can submit payments) */}
      {!isAdmin && (
        <StaggerItem>
          <div className="flex items-center justify-end gap-3">
            <GlassButton
              size="lg"
              onClick={() => setSubmitOpen(true)}
              className="shrink-0"
            >
              <Plus className="h-4 w-4" />
              Submit Payment
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* KPIs */}
      <StaggerItem>
        <div className={cn("gap-3", isAdmin ? "grid grid-cols-3" : "grid grid-cols-2")}>
          <KpiCard
            label="Total Deposit"
            value={kpis.totalApproved}
            icon={<CheckCircle2 className="h-4 w-4" />}
            color="success"
            prefix="₹"
            sub="Approved"
          />
          <KpiCard
            label="Pending Approvals"
            value={kpis.pending}
            icon={<Clock className="h-4 w-4" />}
            color="warning"
            sub={kpis.pending > 0 ? "Awaiting review" : "All clear"}
          />
          <KpiCard
            label="Refund Pending"
            value={refundPendingCount}
            icon={<RotateCcw className="h-4 w-4" />}
            color="primary"
            sub={refundPendingCount > 0 ? `₹${Math.round(refundPendingAmount).toLocaleString("en-IN")}` : "None pending"}
            onClick={isAdmin ? fetchRefundUsers : undefined}
          />
        </div>
      </StaggerItem>

      {/* Admin: Pending payments section */}
      {isAdmin && pendingPayments.length > 0 && (
        <StaggerItem>
          <GlassCard className="p-5" hover={false} glow="warning">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Clock className="h-5 w-5 text-warning" />
                  Pending Approvals
                  <Badge variant="outline" className="bg-warning/15 text-warning border-warning/30 rounded-full">
                    {pendingPayments.length}
                  </Badge>
                </h3>
                <p className="text-xs text-muted-foreground">
                  Review and approve or reject incoming payments.
                </p>
              </div>
            </div>
            <StaggerGroup className="space-y-2">
              {pendingPayments.slice(0, 4).map((p) => (
                <StaggerItem key={p.id}>
                  <PendingRow
                    payment={p}
                    onApprove={() =>
                      setActionTarget({ payment: p, action: "APPROVE" })
                    }
                    onReject={() =>
                      setActionTarget({ payment: p, action: "REJECT" })
                    }
                    loading={
                      actionMutation.isPending &&
                      actionTarget?.payment.id === p.id
                    }
                  />
                </StaggerItem>
              ))}
            </StaggerGroup>
          </GlassCard>
        </StaggerItem>
      )}

      {/* Search + Filter pills (expenses-style) */}
      <StaggerItem>
        <div className="space-y-3">
          <GlassInput
            placeholder="Search by name, email, reference…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<Search />}
          />
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
            {(
              [
                "ALL",
                "PENDING",
                "APPROVED",
                "REJECTED",
                "REFUNDED",
                ...(isAdmin ? (["DELETED"] as const) : []),
              ] as const
            ).map((s) => {
              const active = statusFilter === s;
              const label =
                s === "DELETED"
                  ? "Deletion Queue"
                  : s === "ALL"
                    ? "All"
                    : STATUS_STYLES[s as PaymentStatus].label;
              const badge =
                s === "DELETED" && deletedPayments.length > 0
                  ? deletedPayments.length
                  : s === "PENDING" && kpis.pending > 0
                    ? kpis.pending
                    : null;
              const isQueueBadge = s === "DELETED";
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={cn(
                    "inline-flex items-center h-8 px-2.5 rounded-xl text-[11px] gap-1.5 font-medium whitespace-nowrap shrink-0 transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "glass-soft text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                  {badge !== null && (
                    <span
                      className={cn(
                        "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                        active
                          ? "bg-primary-foreground/20 text-primary-foreground"
                          : isQueueBadge
                            ? "bg-destructive text-white"
                            : "bg-warning text-white"
                      )}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </StaggerItem>

      {/* List */}
      <StaggerItem>
        {filtered.length === 0 ? (
          <GlassCard className="p-10" hover={false}>
            <div className="flex flex-col items-center justify-center text-center gap-3">
              <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/40">
                <IndianRupee className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No payments found</p>
                <p className="text-sm text-muted-foreground">
                  Submit a payment or adjust your filters.
                </p>
              </div>
            </div>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                >
                  <PaymentRow
                    payment={p}
                    isAdmin={isAdmin}
                    onApprove={() =>
                      setActionTarget({ payment: p, action: "APPROVE" })
                    }
                    onReject={() =>
                      setActionTarget({ payment: p, action: "REJECT" })
                    }
                    onEdit={() => openEditForm(p)}
                    onDelete={() => setDeleteTarget(p)}
                    onVoid={() => setVoidTarget(p)}
                    onRestore={() => restoreMutation.mutate(p.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Submit Payment Dialog */}
      <SubmitPaymentDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        onSubmit={(payload) => submitMutation.mutate(payload)}
        loading={submitMutation.isPending}
      />

      {/* Approve/Reject confirm */}
      <AlertDialog
        open={!!actionTarget}
        onOpenChange={(o) => !o && setActionTarget(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {actionTarget?.action === "APPROVE"
                ? "Approve payment?"
                : "Reject payment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {actionTarget && (
                <>
                  {actionTarget.action === "APPROVE" ? (
                    <>
                      Approve{" "}
                      <span className="font-medium text-foreground">
                        {formatINR(actionTarget.payment.amount)}
                      </span>{" "}
                      from{" "}
                      <span className="font-medium text-foreground">
                        {actionTarget.payment.user.name}
                      </span>
                      ? The linked bill will be updated.
                    </>
                  ) : (
                    <>
                      Reject the{" "}
                      <span className="font-medium text-foreground">
                        {formatINR(actionTarget.payment.amount)}
                      </span>{" "}
                      payment from{" "}
                      <span className="font-medium text-foreground">
                        {actionTarget.payment.user.name}
                      </span>
                      ?
                    </>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(
                "rounded-2xl",
                actionTarget?.action === "APPROVE"
                  ? "bg-success text-white hover:bg-success/90"
                  : "bg-destructive text-white hover:bg-destructive/90"
              )}
              onClick={() =>
                actionTarget &&
                actionMutation.mutate({
                  id: actionTarget.payment.id,
                  action: actionTarget.action,
                })
              }
              disabled={actionMutation.isPending}
            >
              {actionMutation.isPending
                ? "Processing…"
                : actionTarget?.action === "APPROVE"
                  ? "Approve"
                  : "Reject"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Payment Sheet (admin only — rendered for everyone but only
          opened when an admin triggers onEdit) */}
      <PaymentEditSheet
        open={editOpen}
        onOpenChange={(o) => !o && closeEditForm()}
        onSubmit={(id, payload) => editMutation.mutate({ id, payload })}
        loading={editMutation.isPending}
        payment={editTarget}
      />

      {/* Delete single payment confirm */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete this payment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will schedule the{" "}
                  <span className="font-medium text-foreground">
                    {formatINR(deleteTarget.amount)}
                  </span>{" "}
                  payment from{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget.user.name}
                  </span>{" "}
                  for deletion. It will be permanently removed after{" "}
                  <span className="font-medium text-foreground">7 days</span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <GlassTextarea
            label="Reason (required)"
            rows={2}
            placeholder="Why is this payment being deleted?"
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
              {deleteMutation.isPending ? "Deleting…" : "Delete Payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Void payment confirm */}
      <AlertDialog
        open={!!voidTarget}
        onOpenChange={(o) => !o && setVoidTarget(null)}
      >
        <AlertDialogContent className="rounded-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Ban className="h-5 w-5 text-destructive" />
              Void this payment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {voidTarget && (
                <>
                  This will mark the{" "}
                  <span className="font-medium text-foreground">
                    {formatINR(voidTarget.amount)}
                  </span>{" "}
                  payment from{" "}
                  <span className="font-medium text-foreground">
                    {voidTarget.user.name}
                  </span>{" "}
                  as void.
                  {voidTarget.status === "APPROVED" && voidTarget.billId && (
                    <>
                      {" "}Since this payment was approved and linked to a
                      bill, the bill's paid amount will be reduced
                      accordingly.
                    </>
                  )}
                  {" "}This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-2xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-2xl bg-destructive text-white hover:bg-destructive/90"
              onClick={() => voidTarget && voidMutation.mutate(voidTarget.id)}
              disabled={voidMutation.isPending}
            >
              {voidMutation.isPending ? "Voiding…" : "Void Payment"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Refund — user list dialog */}
      <Dialog open={refundOpen && !refundTarget} onOpenChange={(o) => !o && setRefundOpen(false)}>
        <DialogContent className="rounded-3xl max-w-md max-h-[80vh] overflow-y-auto no-scrollbar">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              Users with Credit Balance
            </DialogTitle>
            <DialogDescription>
              These users have overpaid and are eligible for a refund. Click to process.
            </DialogDescription>
          </DialogHeader>
          {refundLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <ShimmerSkeleton key={i} className="h-16" />
              ))}
            </div>
          ) : refundUsers.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground space-y-1">
              <p>No users with refundable credit right now.</p>
              <p className="text-[11px]">Refunds are only available after bill generation for the current month.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {refundUsers.map((u) => (
                <button
                  key={u.userId}
                  onClick={() => {
                    setRefundTarget({ userId: u.userId, name: u.name, creditAmount: u.creditAmount });
                    setRefundAmount(String(u.creditAmount));
                    setRefundNotes("");
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-2xl glass-soft hover:ring-1 hover:ring-primary/30 transition-all text-left"
                >
                  <UserAvatar
                    name={u.name}
                    avatarUrl={u.avatarUrl}
                    className="h-10 w-10 rounded-xl"
                    fallbackClassName="text-xs"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-success tabular-nums">₹{Math.round(u.creditAmount).toLocaleString("en-IN")}</p>
                    <p className="text-[10px] text-muted-foreground">credit</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Refund — confirm + amount dialog */}
      <Dialog open={!!refundTarget} onOpenChange={(o) => !o && (setRefundTarget(null), setRefundAmount(""), setRefundNotes(""))}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-primary" />
              Process Refund
            </DialogTitle>
            <DialogDescription>
              Refund to <span className="font-medium text-foreground">{refundTarget?.name}</span>.
              Available credit: <span className="font-medium text-success">₹{Math.round(refundTarget?.creditAmount || 0).toLocaleString("en-IN")}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <GlassInput
              label="Refund Amount (₹)"
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
              icon={<IndianRupee className="h-4 w-4" />}
            />
            <GlassTextarea
              label="Notes (optional)"
              rows={2}
              placeholder="Reason for refund…"
              value={refundNotes}
              onChange={(e) => setRefundNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => { setRefundTarget(null); setRefundAmount(""); setRefundNotes(""); }}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="danger"
              loading={refundMutation.isPending}
              disabled={!refundAmount || parseFloat(refundAmount) <= 0 || parseFloat(refundAmount) > (refundTarget?.creditAmount || 0)}
              onClick={() => refundMutation.mutate()}
            >
              <RotateCcw className="h-4 w-4" />
              Process Refund
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: "primary" | "success" | "warning" | "danger" | "info";
  prefix?: string;
  sub?: string;
  onClick?: () => void;
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
  const glow = color === "danger" ? "danger" : color === "warning" ? "warning" : color === "success" ? "success" : "primary";
  const content = (
    <>
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
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </>
  );
  if (onClick) {
    return (
      <GlassCard
        className="p-4 relative overflow-hidden transition-all hover:ring-1 hover:ring-primary/30 cursor-pointer"
        glow={glow}
        whileHover={{ y: -2 }}
        onClick={onClick}
      >
        {content}
      </GlassCard>
    );
  }
  return (
    <GlassCard className="p-4 relative overflow-hidden" glow={glow} whileHover={{ y: -2 }}>
      {content}
    </GlassCard>
  );
}

const PendingRow = memo(function PendingRow({
  payment,
  onApprove,
  onReject,
  loading,
}: {
  payment: Payment;
  onApprove: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  return (
    <motion.div
      whileHover={{ x: 2 }}
      className="glass-soft rounded-2xl p-3 flex items-center gap-3"
    >
      <div
        className={cn(
          "grid place-items-center h-10 w-10 rounded-xl shrink-0",
          (METHOD_META[payment.method] ?? METHOD_META.WALLET).className
        )}
      >
        {(METHOD_META[payment.method] ?? METHOD_META.WALLET).icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="font-medium truncate">{payment.user.name}</p>
          <span className="text-xs text-muted-foreground truncate">
            · {(METHOD_META[payment.method] ?? METHOD_META.WALLET).label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground truncate">
          {formatDateTime(payment.createdAt)}
          {payment.reference ? ` · Ref ${payment.reference}` : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-bold tabular-nums">{formatINR(payment.amount)}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <GlassButton
          size="sm"
          variant="success"
          onClick={onApprove}
          loading={loading}
          className="!h-8 !px-3"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Approve
        </GlassButton>
        <GlassButton
          size="sm"
          variant="danger"
          onClick={onReject}
          loading={loading}
          className="!h-8 !px-3"
        >
          <XCircle className="h-3.5 w-3.5" />
        </GlassButton>
      </div>
    </motion.div>
  );
});

const PaymentRow = memo(function PaymentRow({
  payment,
  isAdmin,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  onVoid,
  onRestore,
}: {
  payment: Payment;
  isAdmin: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onVoid: () => void;
  onRestore: () => void;
}) {
  const isDeleted = !!payment.deletedAt;

  // Build the actions list — admin-only. Deleted rows show Restore; otherwise
  // PENDING rows get Approve/Reject, non-VOID rows get Edit/Void, all get Delete.
  const actions: {
    label: string;
    icon: typeof CheckCircle2;
    onClick: () => void;
    variant?: "destructive";
  }[] = [];

  if (isDeleted) {
    if (isAdmin) {
      actions.push({ label: "Restore Payment", icon: RotateCcw, onClick: onRestore });
    }
  } else {
    if (isAdmin && payment.status === "PENDING") {
      actions.push({ label: "Approve Payment", icon: CheckCircle2, onClick: onApprove });
      actions.push({
        label: "Reject Payment",
        icon: XCircle,
        onClick: onReject,
        variant: "destructive",
      });
    }
    if (isAdmin && payment.status !== "VOID") {
      actions.push({ label: "Edit Payment", icon: PencilLine, onClick: onEdit });
      actions.push({
        label: "Void Payment",
        icon: Ban,
        onClick: onVoid,
        variant: "destructive",
      });
    }
    if (isAdmin) {
      actions.push({
        label: "Delete Payment",
        icon: Trash2,
        onClick: onDelete,
        variant: "destructive",
      });
    }
  }

  const methodMeta = METHOD_META[payment.method] ?? {
    label: payment.method,
    icon: <WalletIcon className="h-3.5 w-3.5" />,
    className: "bg-secondary text-secondary-foreground border-border",
  };
  const statusMeta = STATUS_STYLES[payment.status] ?? {
    label: payment.status,
    className: "bg-muted text-muted-foreground border-border",
  };

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-start gap-3">
        <UserAvatar
          name={payment.user.name}
          avatarUrl={payment.user.avatarUrl}
          className="h-10 w-10 rounded-xl"
          fallbackClassName="text-xs"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3
                  className={cn(
                    "font-medium text-sm truncate",
                    isDeleted && "text-muted-foreground line-through"
                  )}
                >
                  {isAdmin ? payment.user.name : methodMeta.label}
                </h3>
                {isDeleted ? (
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-destructive/15 text-destructive border-destructive/30"
                  >
                    <Clock className="h-2.5 w-2.5" />{" "}
                    {formatDeletionCountdown(new Date(payment.deletedAt!))}
                  </Badge>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", statusMeta.className)}
                    >
                      {statusMeta.label}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", methodMeta.className)}
                    >
                      {methodMeta.label}
                    </Badge>
                  </>
                )}
              </div>
              {/* Transaction strip — Amount with label, same size as billing */}
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
                <div className="flex items-baseline gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Amount</span>
                  <span className="text-base font-bold tabular-nums">{formatINR(payment.amount)}</span>
                </div>
                {isDeleted && payment.deletionReason && (
                  <span className="inline-flex items-start gap-1 text-[11px] text-destructive/80">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    Reason: {payment.deletionReason}
                  </span>
                )}
              </div>
              {/* Date + reference + notes row */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatDateTime(payment.createdAt)}
                </span>
                {payment.reference && (
                  <span className="inline-flex items-center gap-1 truncate">
                    <ArrowUpRight className="h-3 w-3" /> Ref {payment.reference}
                  </span>
                )}
                {payment.notes && (
                  <span className="truncate max-w-[200px]">
                    · {payment.notes}
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
                    aria-label="Payment actions"
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
// Submit payment dialog
// ─────────────────────────────────────────────────────────────

function SubmitPaymentDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (payload: {
    amount: number;
    method: PaymentMethod;
    billId?: string;
    reference?: string;
    notes?: string;
  }) => void;
  loading: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("UPI");
  const [billId, setBillId] = useState<string>("NONE");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string>("");

  // Load user's outstanding bills for selection — uses a unique queryKey so it
  // always fetches fresh data when the dialog opens. Passes future=false so
  // bills from future billing periods (generated by accident) don't appear.
  const { data: bills = [] } = useQuery({
    queryKey: ["bills", "submit-payment-dialog"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<BillListItem[]>>("/bills", {
        params: { future: "false" },
      });
      return r.data;
    },
    enabled: open,
    staleTime: 0,
  });

  const outstanding = bills.filter(
    (b) => b.status !== "PAID" && b.status !== "VOID" && b.status !== "DELETED" && b.dueAmount > 0
  );

  function reset() {
    setAmount("");
    setMethod("UPI");
    setBillId("NONE");
    setReference("");
    setNotes("");
    setError("");
  }

  function handleClose(o: boolean) {
    if (!o) reset();
    onOpenChange(o);
  }

  function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      setError("Enter a valid amount greater than 0");
      return;
    }
    onSubmit({
      amount: amt,
      method,
      billId: billId === "NONE" ? undefined : billId,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="rounded-3xl max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            Submit a Payment
          </DialogTitle>
          <DialogDescription>
            Your payment will be reviewed by an administrator before being
            applied to your bill.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <GlassInput
            label="Amount (₹)"
            type="number"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setError("");
            }}
            error={error}
            icon={<IndianRupee />}
          />

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground ml-1">
              Method
            </label>
            <Select
              value={method}
              onValueChange={(v) => setMethod(v as PaymentMethod)}
            >
              <SelectTrigger className="w-full h-11 rounded-2xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(METHOD_META).map(([k, m]) => (
                  <SelectItem key={k} value={k}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {outstanding.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">
                Apply to bill (optional)
              </label>
              <Select value={billId} onValueChange={setBillId}>
                <SelectTrigger className="w-full h-11 rounded-2xl">
                  <SelectValue placeholder="Select a bill" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No specific bill</SelectItem>
                  {outstanding.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.user.name} — {formatMonthLabel(b.periodMonth, b.periodYear)} · ₹
                      {Math.round(b.dueAmount).toLocaleString("en-IN")} due
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <GlassInput
            label="Reference (optional)"
            placeholder="UTR / Txn ID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            icon={<ArrowUpRight />}
          />

          <GlassTextarea
            label="Notes (optional)"
            placeholder="Any note for the admin…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </div>

        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => handleClose(false)}>
            Cancel
          </GlassButton>
          <GlassButton onClick={handleSubmit} loading={loading}>
            <ArrowDownRight className="h-4 w-4" />
            Submit
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatMonthLabel(month: number, year: number) {
  return new Date(year, month, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

// ─────────────────────────────────────────────────────────────
// Edit payment sheet (admin only — key-based remount so each open
// starts with fresh state initialized from the `payment` prop)
// ─────────────────────────────────────────────────────────────

function PaymentEditSheet({
  open,
  onOpenChange,
  onSubmit,
  loading,
  payment,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (
    id: string,
    payload: {
      amount?: number;
      method?: PaymentMethod;
      reference?: string | null;
      notes?: string | null;
    }
  ) => void;
  loading: boolean;
  payment: Payment | null;
}) {
  // A `key` based on the editing target forces the body to remount whenever
  // the user opens the sheet for a different payment. Combined with the Sheet
  // unmounting its content when closed, this means each open starts with
  // fresh state initialized from the `payment` prop — no useEffect sync
  // needed (which would trigger cascading renders per the react-hooks rule).
  const bodyKey = payment ? `edit-${payment.id}` : "edit";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-md flex flex-col gap-0 p-0"
      >
        <PaymentEditBody
          key={bodyKey}
          payment={payment}
          onSubmit={onSubmit}
          loading={loading}
          onCancel={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function PaymentEditBody({
  payment,
  onSubmit,
  loading,
  onCancel,
}: {
  payment: Payment | null;
  onSubmit: (
    id: string,
    payload: {
      amount?: number;
      method?: PaymentMethod;
      reference?: string | null;
      notes?: string | null;
    }
  ) => void;
  loading: boolean;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [method, setMethod] = useState<PaymentMethod>(payment?.method ?? "UPI");
  const [reference, setReference] = useState(payment?.reference ?? "");
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Cannot edit amount on APPROVED + bill-linked payments — backend will
  // reject with 422. Lock the field and explain why; admin must void + resubmit.
  const amountLocked = payment?.status === "APPROVED" && !!payment?.billId;

  function handleSubmit() {
    if (!payment) return;
    const next: Record<string, string> = {};
    const amt = parseFloat(amount);
    if (!amountLocked) {
      if (!amt || amt <= 0) next.amount = "Enter a valid amount";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const payload: {
      amount?: number;
      method?: PaymentMethod;
      reference?: string | null;
      notes?: string | null;
    } = {
      method,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
    };
    if (!amountLocked) payload.amount = amt;
    onSubmit(payment.id, payload);
  }

  return (
    <>
      <SheetHeader className="px-6 pt-6 pb-2">
        <SheetTitle className="flex items-center gap-2 text-xl">
          <PencilLine className="h-5 w-5 text-primary" />
          Edit Payment
        </SheetTitle>
        <SheetDescription>
          Update the details of this payment from {payment?.user.name}.
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 no-scrollbar">
        <GlassInput
          label="Amount (₹)"
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          icon={<IndianRupee />}
          disabled={amountLocked}
          hint={
            amountLocked
              ? "Amount locked — this approved payment is linked to a bill. Void it and submit a new payment to change the amount."
              : undefined
          }
        />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground ml-1">
            Method
          </label>
          <Select
            value={method}
            onValueChange={(v) => setMethod(v as PaymentMethod)}
          >
            <SelectTrigger className="w-full h-11 rounded-2xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(METHOD_META).map(([k, m]) => (
                <SelectItem key={k} value={k}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <GlassInput
          label="Reference (optional)"
          placeholder="UTR / Txn ID"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          icon={<ArrowUpRight />}
        />

        <GlassTextarea
          label="Notes (optional)"
          placeholder="Any note for the admin…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <SheetFooter className="px-6 py-4 border-t border-border/40 flex-row gap-2">
        <GlassButton variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </GlassButton>
        <GlassButton className="flex-1" onClick={handleSubmit} loading={loading}>
          <PencilLine className="h-4 w-4" />
          Save Changes
        </GlassButton>
      </SheetFooter>
    </>
  );
}
