"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  X,
  User as UserIcon,
  Wallet,
  Receipt,
  CreditCard,
  RotateCcw,
  Lock,
  Shield,
  History,
  IndianRupee,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertTriangle,
  Utensils,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { UserAvatar } from "@/components/glass/user-avatar";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  avatarUrl: string | null;
  room: string | null;
  gender: string | null;
  emergencyContact: string | null;
  institutionName: string | null;
  institutionUserId: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type FundAccount = {
  availableBalance: number;
  pendingDeposits: number;
  refundPending: number;
  outstandingDue: number;
  previousDue: number;
  financialStatus: string;
  totalDeposited: number;
  totalBilled: number;
  totalRefunded: number;
  ledgerEntryCount: number;
};

type RestrictionEval = {
  canBookMeals: boolean;
  financialStatus: string;
  availableBalance: number;
  requiredBalance: number;
  graceDaysRemaining: number | null;
  hasExemption: boolean;
  restrictionReason: string | null;
};

type Bill = {
  id: string;
  billNumber: string | null;
  periodMonth: number;
  periodYear: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  previousDue: number;
  status: string;
  dueDate: string | null;
};

type Payment = {
  id: string;
  amount: number;
  method: string;
  status: string;
  reference: string | null;
  effectiveMonth: number | null;
  effectiveYear: number | null;
  createdAt: string;
};

type Refund = {
  id: string;
  refundNumber: string | null;
  amount: number;
  paidAmount: number;
  remainingAmount: number;
  status: string;
  createdAt: string;
};

type LedgerEntry = {
  id: string;
  type: string;
  amount: number;
  runningBalance: number;
  description: string;
  createdAt: string;
};

type ActiveRestriction = {
  id: string;
  type: string;
  reason: string;
  source: string;
  status: string;
  appliedAt: string;
  expiresAt: string | null;
};

type Resident360 = {
  profile: Profile;
  fundAccount: FundAccount | null;
  restrictions: RestrictionEval;
  activeRestrictions: ActiveRestriction[];
  recentBills: Bill[];
  recentPayments: Payment[];
  recentRefunds: Refund[];
  ledger: LedgerEntry[];
  mealStats: { currentMonthON: number };
  loginHistory: { id: string; success: boolean; ipAddress: string | null; createdAt: string; reason: string | null }[];
};

type ApiResponse<T> = { success: boolean; data: T };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: "text-success",
  LOW_BALANCE: "text-warning",
  RESTRICTED: "text-destructive",
  EXEMPTED: "text-primary",
  OVERDUE: "text-destructive",
};

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

type Tab = "overview" | "bills" | "payments" | "ledger" | "restrictions";

export function Resident360Dialog({
  userId,
  open,
  onClose,
}: {
  userId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");

  const { data, isLoading } = useQuery({
    queryKey: ["user-360", userId],
    queryFn: async () => {
      if (!userId) return null;
      const r = await api.get<ApiResponse<Resident360>>(`/users/${userId}/360`);
      return r.data;
    },
    enabled: !!userId && open,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Resident 360° View</DialogTitle>
        </DialogHeader>

        {isLoading || !data ? (
          <div className="p-6 space-y-3">
            <ShimmerSkeleton className="h-16 rounded-3xl" />
            <ShimmerSkeleton className="h-32 rounded-3xl" />
            <ShimmerSkeleton className="h-48 rounded-3xl" />
          </div>
        ) : (
          <div className="p-4 sm:p-6 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <UserAvatar
                  name={data.profile.name}
                  avatarUrl={data.profile.avatarUrl}
                  room={data.profile.room}
                  size="lg"
                />
                <div className="min-w-0">
                  <h2 className="text-xl font-bold truncate">{data.profile.name}</h2>
                  <p className="text-sm text-muted-foreground truncate">{data.profile.email}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",
                      data.profile.status === "ACTIVE" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                    )}>
                      {data.profile.status}
                    </span>
                    {data.profile.room && (
                      <span className="text-[10px] text-muted-foreground">Room {data.profile.room}</span>
                    )}
                    {data.profile.institutionUserId && (
                      <span className="text-[10px] text-muted-foreground font-mono">{data.profile.institutionUserId}</span>
                    )}
                  </div>
                </div>
              </div>
              <GlassButton variant="ghost" size="sm" onClick={onClose}>
                <X className="h-4 w-4" />
              </GlassButton>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-2xl glass-soft">
              {([
                { key: "overview", label: "Overview", icon: UserIcon },
                { key: "bills", label: "Bills", icon: Receipt },
                { key: "payments", label: "Payments", icon: CreditCard },
                { key: "ledger", label: "Ledger", icon: History },
                { key: "restrictions", label: "Restrictions", icon: Lock },
              ] as { key: Tab; label: string; icon: typeof UserIcon }[]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-all",
                    tab === t.key ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="space-y-3"
              >
                {tab === "overview" && <OverviewTab data={data} />}
                {tab === "bills" && <BillsTab bills={data.recentBills} />}
                {tab === "payments" && <PaymentsTab payments={data.recentPayments} refunds={data.recentRefunds} />}
                {tab === "ledger" && <LedgerTab ledger={data.ledger} />}
                {tab === "restrictions" && <RestrictionsTab data={data} />}
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OverviewTab({ data }: { data: Resident360 }) {
  const fa = data.fundAccount;
  const re = data.restrictions;
  return (
    <div className="space-y-3">
      {/* Financial summary */}
      {fa && (
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Resident Fund Account
            </p>
            <span className={cn("text-xs font-bold", STATUS_COLORS[fa.financialStatus] || "text-muted-foreground")}>
              {fa.financialStatus}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Available Balance" value={formatINR(fa.availableBalance)} icon={IndianRupee} color="text-success" />
            <Stat label="Outstanding Due" value={formatINR(fa.outstandingDue)} icon={TrendingDown} color="text-destructive" />
            <Stat label="Pending Deposits" value={formatINR(fa.pendingDeposits)} icon={TrendingUp} color="text-warning" />
            <Stat label="Refund Pending" value={formatINR(fa.refundPending)} icon={RotateCcw} color="text-info" />
          </div>
          <div className="mt-3 pt-3 border-t border-border grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground">Total Deposited</p>
              <p className="text-sm font-bold tabular-nums">{formatINR(fa.totalDeposited)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Total Billed</p>
              <p className="text-sm font-bold tabular-nums">{formatINR(fa.totalBilled)}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground">Total Refunded</p>
              <p className="text-sm font-bold tabular-nums">{formatINR(fa.totalRefunded)}</p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Meal + restriction summary */}
      <div className="grid grid-cols-2 gap-3">
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Utensils className="h-3.5 w-3.5" /> Meals This Month
          </div>
          <p className="text-2xl font-bold tabular-nums">{data.mealStats.currentMonthON}</p>
          <p className="text-[10px] text-muted-foreground">ON / LOCKED entries</p>
        </GlassCard>
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            {re.canBookMeals ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <Lock className="h-3.5 w-3.5 text-destructive" />}
            Meal Booking
          </div>
          <p className="text-lg font-bold">
            {re.canBookMeals ? "Enabled" : "Restricted"}
          </p>
          {re.graceDaysRemaining !== null && re.graceDaysRemaining > 0 && (
            <p className="text-[10px] text-warning">Grace: {re.graceDaysRemaining}d left</p>
          )}
        </GlassCard>
      </div>

      {/* Profile details */}
      <GlassCard className="p-4" hover={false}>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Profile</p>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Detail label="Phone" value={data.profile.phone || "—"} />
          <Detail label="Gender" value={data.profile.gender || "—"} />
          <Detail label="Joined" value={format(new Date(data.profile.createdAt), "d MMM yyyy")} />
          <Detail label="Last Login" value={data.profile.lastLoginAt ? format(new Date(data.profile.lastLoginAt), "d MMM yyyy") : "Never"} />
          <Detail label="Email Verified" value={data.profile.emailVerified ? "Yes" : "No"} />
          <Detail label="2FA" value={data.profile.twoFactorEnabled ? "Enabled" : "Disabled"} />
        </div>
      </GlassCard>
    </div>
  );
}

function BillsTab({ bills }: { bills: Bill[] }) {
  if (bills.length === 0) return <EmptyState icon={Receipt} label="No bills yet" />;
  return (
    <div className="space-y-2">
      {bills.map((b) => (
        <div key={b.id} className="flex items-center justify-between p-3 rounded-2xl glass-soft">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {b.billNumber || "—"} · {MONTHS[b.periodMonth]} {b.periodYear}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Total ₹{b.totalAmount} · Paid ₹{b.paidAmount} · Due ₹{b.dueAmount}
              {b.previousDue > 0 && ` · Prev Due ₹${b.previousDue}`}
            </p>
          </div>
          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0",
            b.status === "PAID" ? "bg-success/15 text-success" :
            b.status === "PARTIALLY_PAID" ? "bg-warning/15 text-warning" :
            "bg-muted text-muted-foreground"
          )}>
            {b.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function PaymentsTab({ payments, refunds }: { payments: Payment[]; refunds: Refund[] }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Payments</p>
        {payments.length === 0 ? <p className="text-xs text-muted-foreground">No payments yet</p> : (
          payments.map((p) => (
            <div key={p.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div>
                <p className="text-sm font-medium">₹{p.amount} · {p.method}</p>
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(p.createdAt), "d MMM yyyy")}
                  {p.effectiveMonth !== null && ` · Effective: ${MONTHS[p.effectiveMonth]} ${p.effectiveYear}`}
                </p>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",
                p.status === "APPROVED" ? "bg-success/15 text-success" :
                p.status === "PENDING" ? "bg-warning/15 text-warning" :
                "bg-muted text-muted-foreground"
              )}>
                {p.status}
              </span>
            </div>
          ))
        )}
      </div>
      {refunds.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recent Refunds</p>
          {refunds.map((r) => (
            <div key={r.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
              <div>
                <p className="text-sm font-medium">{r.refundNumber || "—"} · ₹{r.amount}</p>
                <p className="text-[10px] text-muted-foreground">
                  Paid ₹{r.paidAmount} · Remaining ₹{r.remainingAmount}
                </p>
              </div>
              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",
                r.status === "COMPLETED" ? "bg-success/15 text-success" :
                r.status === "PARTIALLY_PAID" ? "bg-warning/15 text-warning" :
                "bg-muted text-muted-foreground"
              )}>
                {r.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerTab({ ledger }: { ledger: LedgerEntry[] }) {
  if (ledger.length === 0) return <EmptyState icon={History} label="No ledger entries yet" />;
  return (
    <div className="space-y-1.5">
      {ledger.map((e) => (
        <div key={e.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{e.description}</p>
            <p className="text-[10px] text-muted-foreground">
              {format(new Date(e.createdAt), "d MMM yyyy, h:mm a")} · {e.type}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={cn("text-sm font-bold tabular-nums", e.amount >= 0 ? "text-success" : "text-destructive")}>
              {e.amount >= 0 ? "+" : ""}{formatINR(e.amount)}
            </p>
            <p className="text-[10px] text-muted-foreground">Bal: ₹{Math.round(e.runningBalance)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RestrictionsTab({ data }: { data: Resident360 }) {
  const re = data.restrictions;
  return (
    <div className="space-y-3">
      <GlassCard className="p-4" hover={false}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">Current Status</p>
          <span className={cn("text-sm font-bold", STATUS_COLORS[re.financialStatus])}>
            {re.financialStatus}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Detail label="Can Book Meals" value={re.canBookMeals ? "Yes" : "No"} />
          <Detail label="Has Exemption" value={re.hasExemption ? "Yes" : "No"} />
          <Detail label="Available" value={formatINR(re.availableBalance)} />
          <Detail label="Required" value={formatINR(re.requiredBalance)} />
          {re.graceDaysRemaining !== null && (
            <Detail label="Grace Days" value={`${re.graceDaysRemaining} day(s)`} />
          )}
        </div>
        {re.restrictionReason && (
          <div className="mt-2 p-2 rounded-xl bg-destructive/10 ring-1 ring-destructive/30">
            <p className="text-xs text-destructive">{re.restrictionReason}</p>
          </div>
        )}
      </GlassCard>

      {data.activeRestrictions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Restrictions</p>
          {data.activeRestrictions.map((r) => (
            <div key={r.id} className="p-3 rounded-xl glass-soft">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium",
                  r.type === "FINANCIAL" ? "bg-destructive/15 text-destructive" : "bg-warning/15 text-warning"
                )}>
                  {r.type}
                </span>
                <span className="text-[10px] text-muted-foreground">{r.source}</span>
                {r.expiresAt && (
                  <span className="text-[10px] text-muted-foreground">
                    Expires: {format(new Date(r.expiresAt), "d MMM yyyy")}
                  </span>
                )}
              </div>
              <p className="text-sm">{r.reason}</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Applied: {format(new Date(r.appliedAt), "d MMM yyyy")}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: string; icon: typeof IndianRupee; color: string }) {
  return (
    <div className="p-2.5 rounded-xl glass-soft">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
        <Icon className={cn("h-3 w-3", color)} />
        {label}
      </div>
      <p className={cn("text-base font-bold tabular-nums", color)}>{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: typeof Receipt; label: string }) {
  return (
    <div className="text-center py-8">
      <Icon className="h-10 w-10 text-muted-foreground/30 mx-auto mb-2" />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
