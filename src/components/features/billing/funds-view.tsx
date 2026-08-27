"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  PiggyBank,
  TrendingDown,
  Wallet,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Search,
  Check,
  AlertCircle,
  DoorOpen,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassInput } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import { UserAvatar } from "@/components/glass/user-avatar";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Badge } from "@/components/ui/badge";

type UserFund = {
  userId: string;
  name: string;
  email: string;
  room: string | null;
  avatarUrl: string | null;
  billTotal: number;
  deposit: number;
  needToPay: number;
  deficit: number;
  hasBills: boolean;
};

type FundsData = {
  totalDeposit: number;
  totalExpenses: number;
  remainingFund: number;
  totalRefunded: number;
  month: number;
  year: number;
  users: UserFund[];
};

type ApiResponse<T> = { success: boolean; data: T };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type FundFilter = "ALL" | "DEFICIT";

const FILTER_LABELS: Record<FundFilter, string> = {
  ALL: "All",
  DEFICIT: "Deficit",
};

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function FundsView() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FundFilter>("ALL");
  const isThisMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

  const { data, isLoading } = useQuery({
    queryKey: ["funds", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<FundsData>>("/funds", {
        params: { month: selectedMonth, year: selectedYear },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const users = data?.users ?? [];

  // Search filter
  const searchedUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.room || "").toLowerCase().includes(q)
    );
  }, [users, search]);

  // Status classification — a user is "DEFICIT" if their deficit > 0
  // (their share of expenses exceeds their deposit)
  const classified = useMemo(() => searchedUsers.map((u) => {
    const hasDeficit = (u.deficit || 0) > 0;
    const bucket: FundFilter = hasDeficit ? "DEFICIT" : "ALL";
    return { ...u, hasDeficit, bucket };
  }), [searchedUsers]);

  // Sort bar counts (based on searched set, not the active filter)
  const counts = useMemo(() => ({
    ALL: classified.length,
    DEFICIT: classified.filter((u) => u.bucket === "DEFICIT").length,
  }), [classified]);

  // Total deficit = sum of all users' deficit (total expenses − total deposit).
  // Default ₹0 when no deficit.
  const totalDeficit = useMemo(
    () => classified.reduce((sum, u) => sum + (u.deficit || 0), 0),
    [classified]
  );

  const filteredUsers = useMemo(() => {
    if (filter === "ALL") return classified;
    return classified.filter((u) => u.bucket === filter);
  }, [classified, filter]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <ShimmerSkeleton className="h-14 w-full" />
        <div className="grid grid-cols-3 gap-3">
          <ShimmerSkeleton className="h-28" />
          <ShimmerSkeleton className="h-28" />
          <ShimmerSkeleton className="h-28" />
        </div>
        <ShimmerSkeleton className="h-11 w-full" />
        <ShimmerSkeleton className="h-8 w-64" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Month picker */}
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
              if (!isThisMonth) {
                setSelectedMonth(now.getMonth());
                setSelectedYear(now.getFullYear());
              }
            }}
            className="flex-1 max-w-[280px] flex items-center justify-center gap-2.5 glass-soft rounded-full px-6 py-2.5 transition-all hover:ring-1 hover:ring-primary/30"
          >
            <Calendar className="h-4 w-4 text-primary shrink-0" />
            <div className="leading-tight text-center">
              <p className="text-sm font-bold text-primary">
                {new Date(selectedYear, selectedMonth).toLocaleDateString("en-US", { month: "long" })}
              </p>
              <p className="text-[11px] text-muted-foreground">{selectedYear}</p>
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

      {/* KPIs — 3 in a single horizontal row */}
      <StaggerItem>
        <div className="grid grid-cols-3 gap-3">
          <GlassCard className="p-4" glow="success" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-success/15 text-success mb-3">
              <Wallet className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Total Deposit</p>
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              <AnimatedCounter value={data?.totalDeposit ?? 0} prefix="₹" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">{MONTHS[selectedMonth]} {selectedYear}</p>
          </GlassCard>

          <GlassCard className="p-4" glow="primary" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-primary/15 text-primary mb-3">
              <PiggyBank className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Remaining Fund</p>
            <div className={cn(
              "text-2xl font-bold tracking-tight tabular-nums",
              (data?.remainingFund ?? 0) < 0 && "text-destructive"
            )}>
              <AnimatedCounter value={data?.remainingFund ?? 0} prefix="₹" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Deposit − Expenses</p>
          </GlassCard>

          <GlassCard className="p-4" glow="warning" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-warning/15 text-warning mb-3">
              <TrendingDown className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Total Deficit</p>
            <div className="text-2xl font-bold tracking-tight tabular-nums">
              <AnimatedCounter value={totalDeficit} prefix="₹" />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">Overused amount</p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Search bar */}
      <StaggerItem>
        <GlassInput
          placeholder="Search by name, email, or room…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search className="h-4 w-4" />}
        />
      </StaggerItem>

      {/* Sort bar — All / Deficit (horizontal, scrollable) */}
      <StaggerItem>
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
          {(["ALL", "DEFICIT"] as const).map((s) => {
            const active = filter === s;
            const count = counts[s];
            return (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "inline-flex items-center h-8 px-2.5 rounded-xl text-[11px] gap-1.5 font-medium whitespace-nowrap shrink-0 transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                    : "glass-soft text-muted-foreground hover:text-foreground"
                )}
              >
                {FILTER_LABELS[s]}
                <span
                  className={cn(
                    "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                    active
                      ? "bg-primary-foreground/20 text-primary-foreground"
                      : s === "DEFICIT"
                        ? "bg-warning text-white"
                        : "bg-muted-foreground/30 text-white"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </StaggerItem>

      {/* User fund list — billing-style rows */}
      <StaggerItem>
        {filteredUsers.length === 0 ? (
          <GlassCard className="p-10 text-center" hover={false}>
            <p className="text-sm text-muted-foreground">
              {search
                ? "No users match your search."
                : filter === "DEFICIT"
                  ? "No users with deficit for this month."
                  : "No user data for this month."}
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            {filteredUsers.map((u) => (
              <GlassCard key={u.userId} className="p-4" hover={false}>
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <UserAvatar
                    name={u.name}
                    avatarUrl={u.avatarUrl}
                    className="h-10 w-10 rounded-xl"
                    fallbackClassName="text-xs"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {/* Name + status badge */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-medium text-sm truncate">{u.name}</h3>
                          {(u.deficit || 0) > 0 ? (
                            <Badge variant="outline" className="text-[10px] bg-warning/15 text-warning border-warning/30">
                              <AlertCircle className="h-2.5 w-2.5" /> Deficit
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] bg-success/15 text-success border-success/30">
                              <Check className="h-2.5 w-2.5" /> Paid
                            </Badge>
                          )}
                        </div>

                        {/* Transaction strip — Deposit / Deficit only */}
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2">
                          <div className="flex items-baseline gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Deposit</span>
                            <span className="text-base font-bold text-success tabular-nums">{formatINR(u.deposit)}</span>
                          </div>
                          <div className="flex items-baseline gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Deficit</span>
                            {(u.deficit || 0) > 0 ? (
                              <span className="text-base font-bold text-warning tabular-nums">{formatINR(u.deficit)}</span>
                            ) : (
                              <span className="text-base font-bold text-success tabular-nums">{formatINR(0)}</span>
                            )}
                          </div>
                        </div>

                        {/* Room info row */}
                        {u.room && (
                          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                            <DoorOpen className="h-3 w-3" />
                            <span>Room {u.room}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        )}
      </StaggerItem>
    </StaggerGroup>
  );
}
