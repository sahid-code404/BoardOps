"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  RotateCcw,
  Lock,
  History,
  ArrowRight,
  TrendingUp,
  Users,
  Utensils,
  Receipt,
  IndianRupee,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { GlassInput } from "@/components/glass/glass-input";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type ReadinessItem = {
  key: string;
  label: string;
  status: "ready" | "warning" | "error";
  detail: string;
  count?: number;
};

type ReadinessResult = {
  month: number;
  year: number;
  periodLabel: string;
  items: ReadinessItem[];
  canClose: boolean;
  existingCycle?: { id: string; status: string } | null;
};

type BillingCycle = {
  id: string;
  periodMonth: number;
  periodYear: number;
  status: string;
  totalExpenses: number;
  totalMeals: number;
  totalGuestMeals: number;
  mealCharge: number;
  billsGenerated: number;
  refundQueueTotal: number;
  outstandingDue: number;
  closedBy: string | null;
  closedAt: string | null;
  startedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
};

type ClosingResult = {
  success: boolean;
  cycleId: string;
  status: string;
  summary: {
    totalExpenses: number;
    totalResidentMeals: number;
    totalGuestMeals: number;
    guestRevenue: number;
    mealCharge: number;
    billsGenerated: number;
    refundQueueTotal: number;
    outstandingDue: number;
  };
  error?: string;
};

type ApiResponse<T> = { success: boolean; data: T };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  OPEN: { label: "Open", color: "bg-muted text-muted-foreground" },
  PREPARING: { label: "Preparing", color: "bg-warning/15 text-warning" },
  SNAPSHOT_CREATED: { label: "Snapshot Created", color: "bg-info/15 text-info" },
  BILLS_GENERATED: { label: "Bills Generated", color: "bg-info/15 text-info" },
  SETTLED: { label: "Settled", color: "bg-primary/15 text-primary" },
  CLOSED: { label: "Closed", color: "bg-success/15 text-success" },
  FAILED: { label: "Failed", color: "bg-destructive/15 text-destructive" },
};

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function MonthlyClosingView() {
  const qc = useQueryClient();
  const now = new Date();
  // Default to last month — bills can only be generated for past months
  const [selectedMonth, setSelectedMonth] = useState(
    now.getMonth() === 0 ? 11 : now.getMonth() - 1
  );
  const [selectedYear, setSelectedYear] = useState(
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  );
  const [closeOpen, setCloseOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [resultDialog, setResultDialog] = useState<ClosingResult | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState<BillingCycle | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");

  const { data: readiness, isLoading: readinessLoading } = useQuery({
    queryKey: ["billing-cycles", "readiness", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<ReadinessResult>>("/billing-cycles/readiness", {
        params: { month: selectedMonth, year: selectedYear },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const { data: cycles = [] } = useQuery({
    queryKey: ["billing-cycles"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<BillingCycle[]>>("/billing-cycles");
      return r.data;
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { month: selectedMonth, year: selectedYear };
      if (dueDate) payload.dueDate = dueDate;
      return api.post<ApiResponse<ClosingResult>>("/billing-cycles", payload);
    },
    onSuccess: (res) => {
      const result = res.data;
      setResultDialog(result);
      setCloseOpen(false);
      if (result.success) {
        toast.success(`${MONTHS[selectedMonth]} ${selectedYear} closed successfully — ${result.summary.billsGenerated} bills generated`);
      } else {
        toast.error(result.error || "Closing failed");
      }
      qc.invalidateQueries({ queryKey: ["billing-cycles"] });
      qc.invalidateQueries({ queryKey: ["bills"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to close billing cycle"),
  });

  const rollbackMutation = useMutation({
    mutationFn: () => {
      if (!rollbackTarget) throw new Error("No cycle selected");
      return api.post(`/billing-cycles/${rollbackTarget.id}/rollback`, { reason: rollbackReason });
    },
    onSuccess: () => {
      toast.success("Billing cycle rolled back to OPEN");
      setRollbackTarget(null);
      setRollbackReason("");
      qc.invalidateQueries({ queryKey: ["billing-cycles"] });
    },
    onError: (e: Error) => toast.error(e.message || "Rollback failed"),
  });

  const prevMonth = () => {
    if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear((y) => y - 1); }
    else setSelectedMonth((m) => m - 1);
  };
  const nextMonth = () => {
    // Don't allow navigating to current or future months — bills can only be
    // generated for past months. The latest selectable month is last month.
    const currentPeriod = now.getFullYear() * 12 + now.getMonth();
    const nextPeriod = selectedYear * 12 + selectedMonth + 1;
    if (nextPeriod >= currentPeriod) return; // can't go past last month
    if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear((y) => y + 1); }
    else setSelectedMonth((m) => m + 1);
  };
  // Is the "next" button disabled? (we're already at the latest selectable month = last month)
  const isAtLatest = selectedYear * 12 + selectedMonth >= now.getFullYear() * 12 + now.getMonth() - 1;

  const currentCycle = cycles.find(
    (c) => c.periodMonth === selectedMonth && c.periodYear === selectedYear
  );
  const isClosed = currentCycle?.status === "CLOSED";
  const canRollback = currentCycle && ["PREPARING", "SNAPSHOT_CREATED", "FAILED"].includes(currentCycle.status);

  return (
    <StaggerGroup className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              Monthly Closing
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Orchestrate the monthly financial closing — freeze data, execute formulas, generate bills from immutable snapshots.
            </p>
          </div>
        </div>
      </StaggerItem>

      {/* Month picker + status */}
      <StaggerItem>
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <GlassButton variant="ghost" size="sm" onClick={prevMonth}>←</GlassButton>
              <p className="font-semibold text-lg min-w-[140px] text-center">
                {MONTHS[selectedMonth]} {selectedYear}
              </p>
              <GlassButton variant="ghost" size="sm" onClick={nextMonth} disabled={isAtLatest} className={isAtLatest ? "opacity-30 cursor-not-allowed" : ""}>→</GlassButton>
            </div>
            {currentCycle && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Status:</span>
                <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full", STATUS_META[currentCycle.status]?.color)}>
                  {STATUS_META[currentCycle.status]?.label ?? currentCycle.status}
                </span>
                {canRollback && (
                  <GlassButton variant="ghost" size="sm" className="text-warning" onClick={() => setRollbackTarget(currentCycle)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Rollback
                  </GlassButton>
                )}
              </div>
            )}
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Readiness checklist */}
      <StaggerItem>
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Readiness Checklist
            </h2>
            <span className="text-xs text-muted-foreground">
              Pre-closing review for {MONTHS[selectedMonth]} {selectedYear}
            </span>
          </div>
          {readinessLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <ShimmerSkeleton key={i} className="h-14 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {readiness?.items.map((item) => (
                <motion.div
                  key={item.key}
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-2xl",
                    item.status === "ready" && "bg-success/5 ring-1 ring-success/20",
                    item.status === "warning" && "bg-warning/5 ring-1 ring-warning/20",
                    item.status === "error" && "bg-destructive/5 ring-1 ring-destructive/20"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {item.status === "ready" && <CheckCircle2 className="h-5 w-5 text-success" />}
                    {item.status === "warning" && <AlertTriangle className="h-5 w-5 text-warning" />}
                    {item.status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  {typeof item.count === "number" && (
                    <span className="text-xs font-bold tabular-nums px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground shrink-0">
                      {item.count}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-border">
            {readiness?.canClose ? (
              <GlassButton
                size="lg"
                className="w-full"
                onClick={() => setCloseOpen(true)}
                disabled={isClosed}
              >
                <Lock className="h-4 w-4" />
                {isClosed ? "Cycle Already Closed" : `Close ${MONTHS[selectedMonth]} ${selectedYear}`}
                <ArrowRight className="h-4 w-4" />
              </GlassButton>
            ) : (
              <div className="text-center p-3 rounded-2xl bg-destructive/5 ring-1 ring-destructive/20">
                <XCircle className="h-5 w-5 text-destructive mx-auto mb-1" />
                <p className="text-sm font-medium text-destructive">
                  {isClosed ? "This cycle is closed" : "Resolve errors before closing"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isClosed
                    ? "Corrections require adjustment entries (PRD DEC-033)."
                    : "Fix all error items in the checklist above, then retry."}
                </p>
              </div>
            )}
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Cycle history */}
      {cycles.length > 0 && (
        <StaggerItem>
          <GlassCard className="p-5" hover={false}>
            <h2 className="font-semibold flex items-center gap-2 mb-3">
              <History className="h-4 w-4 text-primary" />
              Recent Billing Cycles
            </h2>
            <div className="space-y-2 max-h-72 overflow-y-auto">
              <AnimatePresence mode="popLayout">
                {cycles.map((c) => (
                  <motion.div
                    key={c.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    className="flex items-center justify-between p-3 rounded-2xl glass-soft"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="grid place-items-center h-9 w-9 rounded-xl bg-primary/10 text-primary shrink-0">
                        <CalendarClock className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">
                          {MONTHS[c.periodMonth]} {c.periodYear}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {c.closedAt
                            ? `Closed ${format(new Date(c.closedAt), "d MMM yyyy, h:mm a")}`
                            : c.startedAt
                            ? `Started ${format(new Date(c.startedAt), "d MMM yyyy, h:mm a")}`
                            : `Created ${format(new Date(c.createdAt), "d MMM yyyy")}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {c.status === "CLOSED" && (
                        <div className="text-right">
                          <p className="text-xs font-semibold tabular-nums">{formatINR(c.totalExpenses)}</p>
                          <p className="text-[10px] text-muted-foreground">{c.billsGenerated} bills</p>
                        </div>
                      )}
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", STATUS_META[c.status]?.color)}>
                        {STATUS_META[c.status]?.label ?? c.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </GlassCard>
        </StaggerItem>
      )}

      {/* Close confirmation dialog */}
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              Close {MONTHS[selectedMonth]} {selectedYear}
            </DialogTitle>
            <DialogDescription>
              This will freeze all data into an immutable snapshot, execute the formula engine, generate bills, and settle resident fund accounts. This action is logged.
            </DialogDescription>
          </DialogHeader>
          {readiness && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-xl glass-soft">
                  <p className="text-[10px] text-muted-foreground">Expenses</p>
                  <p className="text-sm font-bold tabular-nums">
                    {formatINR(readiness.items.find((i) => i.key === "expenses")?.count ? readiness.items.find((i) => i.key === "expenses")!.count! * 0 : 0)}
                  </p>
                </div>
                <div className="p-2 rounded-xl glass-soft">
                  <p className="text-[10px] text-muted-foreground">Residents</p>
                  <p className="text-sm font-bold tabular-nums">
                    {readiness.items.find((i) => i.key === "residents")?.count ?? 0}
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="due-date">Due Date (optional — defaults to 10th of next month)</Label>
                <GlassInput
                  id="due-date"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setCloseOpen(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              loading={closeMutation.isPending}
              onClick={() => closeMutation.mutate()}
            >
              <Lock className="h-4 w-4" />
              Execute Closing
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Closing result dialog */}
      <Dialog open={!!resultDialog} onOpenChange={(v) => !v && setResultDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {resultDialog?.success ? (
                <><CheckCircle2 className="h-5 w-5 text-success" /> Closing Complete</>
              ) : (
                <><XCircle className="h-5 w-5 text-destructive" /> Closing Failed</>
              )}
            </DialogTitle>
            <DialogDescription>
              {resultDialog?.success
                ? `${MONTHS[selectedMonth]} ${selectedYear} has been closed successfully.`
                : "The closing workflow encountered an error."}
            </DialogDescription>
          </DialogHeader>
          {resultDialog?.success && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <SummaryCard icon={Receipt} label="Total Expenses" value={formatINR(resultDialog.summary.totalExpenses)} />
                <SummaryCard icon={Utensils} label="Resident Meals" value={String(resultDialog.summary.totalResidentMeals)} />
                <SummaryCard icon={Users} label="Bills Generated" value={String(resultDialog.summary.billsGenerated)} />
                <SummaryCard icon={IndianRupee} label="Meal Charge" value={formatINR(resultDialog.summary.mealCharge)} />
                <SummaryCard icon={TrendingUp} label="Refund Queue" value={formatINR(resultDialog.summary.refundQueueTotal)} />
                <SummaryCard icon={AlertTriangle} label="Outstanding Due" value={formatINR(resultDialog.summary.outstandingDue)} />
              </div>
            </div>
          )}
          {resultDialog?.error && (
            <div className="p-3 rounded-xl bg-destructive/10 ring-1 ring-destructive/30">
              <p className="text-sm text-destructive">{resultDialog.error}</p>
            </div>
          )}
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setResultDialog(null)}>
              Close
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rollback confirmation */}
      <Dialog open={!!rollbackTarget} onOpenChange={(v) => !v && setRollbackTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-warning">
              <RotateCcw className="h-5 w-5" />
              Rollback Billing Cycle
            </DialogTitle>
            <DialogDescription>
              Rollback {rollbackTarget && `${MONTHS[rollbackTarget.periodMonth]} ${rollbackTarget.periodYear}`} to OPEN status. The snapshot will be deleted. This is only possible before bills are published.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="rb-reason">Reason (required)</Label>
            <GlassInput
              id="rb-reason"
              placeholder="e.g. Expense was missing, need to re-run"
              value={rollbackReason}
              onChange={(e) => setRollbackReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setRollbackTarget(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="danger"
              loading={rollbackMutation.isPending}
              disabled={!rollbackReason.trim()}
              onClick={() => rollbackMutation.mutate()}
            >
              <RotateCcw className="h-4 w-4" />
              Rollback to Open
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-xl glass-soft">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="text-sm font-bold tabular-nums">{value}</p>
    </div>
  );
}
