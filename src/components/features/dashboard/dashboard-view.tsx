"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useAppStore } from "@/stores/use-app-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { Users, Utensils, Wallet, Receipt, TrendingUp, TrendingDown, Bell, ArrowUpRight, Activity, Clock } from "lucide-react";
import { motion } from "framer-motion";
import { getTimeGreeting, getGradientForName } from "@/lib/greetings";
import { cn } from "@/lib/utils";

type DashboardData = {
  todayMeals: Array<{
    id: string;
    name: string;
    displayName: string;
    icon: string;
    color: string;
    startTime: string;
    endTime: string;
    status: string;
    locked: boolean;
    editableUntil: string;
  }>;
  kpis: {
    totalUsers: number;
    pendingUsers: number;
    todayOnCount: number;
    todayOffCount: number;
    currentMealCharge: number;
    totalResidentMeals: number;
    totalExpenses: number;
    pendingBills: number;
  };
  trend: Array<{ date: string; on: number; off: number }>;
  expenseBreakdown: Array<{ category: string; amount: number }>;
  unreadNotifications: number;
  recentActivity: Array<any>;
  isAdmin: boolean;
};


export function DashboardView() {
  const user = useAuthStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: DashboardData }>("/dashboard");
      return r.data;
    },
    refetchInterval: 30000,
    // Keep previous data visible while a refetch is in flight (every 30s) so
    // the dashboard doesn't flash empty during background refreshes.
    placeholderData: (prev) => prev,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid-kpi gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid-cards gap-4">
          <ShimmerSkeleton className="h-72" />
          <ShimmerSkeleton className="h-72" />
        </div>
      </div>
    );
  }

  const kpis = data.isAdmin
    ? [
        { label: "Total Users", value: data.kpis.totalUsers, icon: Users, color: "primary", change: "active members", route: "users" as const },
        { label: "Meals ON Today", value: data.kpis.todayOnCount, icon: Utensils, color: "success", change: `${data.kpis.todayOffCount} OFF`, route: "kitchen" as const },
        { label: "Expenses (Month)", value: data.kpis.totalExpenses, icon: Wallet, color: "warning", change: `₹${data.kpis.totalExpenses.toLocaleString("en-IN")}`, prefix: "₹", route: "expenses" as const },
        { label: "Meal Charge", value: data.kpis.currentMealCharge, icon: TrendingUp, color: "info", change: `${data.kpis.totalResidentMeals} meals`, prefix: "₹", route: "billing" as const },
      ]
    : [
        { label: "Meals ON Today", value: data.todayMeals.filter((m) => m.status === "ON").length, icon: Utensils, color: "success", change: `${data.todayMeals.filter((m) => m.status === "OFF").length} OFF`, route: "billing" as const },
        { label: "Pending Bills", value: data.kpis.pendingBills, icon: Receipt, color: "warning", change: "view billing", route: "billing" as const },
        { label: "Notifications", value: data.unreadNotifications, icon: Bell, color: "primary", change: "unread", route: "notifications" as const },
        { label: "Meals This Week", value: data.trend.reduce((s, t) => s + t.on, 0), icon: Activity, color: "info", change: "7-day total", route: "billing" as const },
      ];

  return (
    <StaggerGroup className="space-y-4">
      {/* Time-based greeting with gradient name */}
      <StaggerItem>
        <GlassCard className="p-5" hover={false} glow="primary">
          <p className="text-sm text-muted-foreground mb-2">
            {new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })}
          </p>
          <h2 className="text-2xl font-bold flex items-baseline gap-1.5 flex-wrap">
            <span>{getTimeGreeting().greeting},</span>
            {((user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
              <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
                Admin
              </span>
            ))}
            <span className={cn("bg-gradient-to-r bg-clip-text text-transparent", getGradientForName(user?.name || "User"))}>
              {user?.name.split(" ")[0]}
            </span>
            <span className="text-3xl">{getTimeGreeting().emoji}</span>
          </h2>
        </GlassCard>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid-kpi gap-3">
          {kpis.map((kpi) => {
            const Icon = kpi.icon;
            return (
              <motion.button
                key={kpi.label}
                whileHover={{ scale: 1.02, y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setView(kpi.route)}
                className="text-left w-full"
              >
                <GlassCard className="p-4 cursor-pointer" glow={kpi.color as never}>
                  <div className="flex items-start justify-between mb-3">
                    <div
                      className="grid place-items-center h-10 w-10 rounded-2xl"
                      style={{
                        background: `color-mix(in oklch, var(--${kpi.color === "primary" ? "primary" : kpi.color === "success" ? "success" : kpi.color === "warning" ? "warning" : "info"}) 15%, transparent)`,
                      }}
                    >
                      <Icon className="h-5 w-5" style={{ color: `var(--${kpi.color === "primary" ? "primary" : kpi.color === "success" ? "success" : kpi.color === "warning" ? "warning" : "info"})` }} />
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  <div className="text-2xl font-bold tracking-tight">
                    <AnimatedCounter
                      value={kpi.value}
                      prefix={"prefix" in kpi ? kpi.prefix : ""}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">{kpi.change}</p>
                </GlassCard>
              </motion.button>
            );
          })}
        </div>
      </StaggerItem>

      {/* UX-1: Today's Meals — horizontal scrollable row of the current user's meals */}
      <StaggerItem>
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">Today&apos;s Meals</h3>
            <button
              onClick={() => setView("meals")}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
            >
              Manage <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
          {data.todayMeals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No meals today</p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {data.todayMeals.map((m) => {
                // Status → color token. ON = success (green), LOCKED = warning
                // (orange), OFF/other = muted. Locked meals always render with
                // the LOCKED label even when the underlying status is ON (a
                // locked ON meal is one whose cutoff has passed — the user
                // can no longer change it but is still eating).
                const statusToken =
                  m.status === "ON" ? "var(--success)"
                  : m.status === "LOCKED" ? "var(--warning)"
                  : "var(--muted-foreground)";
                const effectiveLabel = m.locked ? "LOCKED" : m.status;
                return (
                  <div
                    key={m.id}
                    className="glass-soft rounded-2xl p-3 min-w-[130px] flex-shrink-0"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xl leading-none" aria-hidden>{m.icon}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight truncate">{m.displayName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {m.startTime}–{m.endTime}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: statusToken }}
                      />
                      <span
                        className="text-[10px] uppercase tracking-wide font-medium"
                        style={{ color: statusToken }}
                      >
                        {effectiveLabel}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </StaggerItem>

      {/* UX-1: 7-day meal trend + expense breakdown side-by-side */}
      <StaggerItem>
        <div className="grid-cards gap-4">
          {/* 7-Day Meal Trend — pure CSS bar chart (no chart lib) */}
          <GlassCard className="p-4" hover={false}>
            <h3 className="font-semibold mb-3">7-Day Meal Trend</h3>
            {(() => {
              const max = Math.max(1, ...data.trend.map((t) => Math.max(t.on, t.off)));
              return (
                <div className="flex items-end justify-between gap-2 h-36">
                  {data.trend.map((t) => {
                    // toLocalDateKey returns "YYYY-MM-DD"; append T00:00:00 to
                    // force local-time parsing (avoids UTC off-by-one shift).
                    const d = new Date(`${t.date}T00:00:00`);
                    const dayLabel = d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3);
                    const onH = Math.round((t.on / max) * 100);
                    const offH = Math.round((t.off / max) * 100);
                    return (
                      <div key={t.date} className="flex-1 flex flex-col items-center gap-1.5">
                        <div className="flex items-end gap-1 h-28 w-full justify-center">
                          <div
                            className="w-2.5 rounded-t-md transition-all"
                            style={{
                              height: `${onH}%`,
                              background: "var(--success)",
                              minHeight: t.on > 0 ? "4px" : "0",
                              opacity: t.on > 0 ? 1 : 0.25,
                            }}
                            title={`ON: ${t.on}`}
                          />
                          <div
                            className="w-2.5 rounded-t-md transition-all"
                            style={{
                              height: `${offH}%`,
                              background: "var(--warning)",
                              minHeight: t.off > 0 ? "4px" : "0",
                              opacity: t.off > 0 ? 1 : 0.25,
                            }}
                            title={`OFF: ${t.off}`}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{dayLabel}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
            <div className="flex items-center gap-3 mt-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--success)" }} />
                ON
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--warning)" }} />
                OFF
              </span>
            </div>
          </GlassCard>

          {/* Expense Breakdown — category list with proportional bars */}
          <GlassCard className="p-4" hover={false}>
            <h3 className="font-semibold mb-3">Expense Breakdown</h3>
            {data.expenseBreakdown.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No expenses this month</p>
            ) : (() => {
              const total = data.expenseBreakdown.reduce((s, e) => s + e.amount, 0);
              return (
                <div className="space-y-2.5">
                  {data.expenseBreakdown.map((e) => {
                    const pct = total > 0 ? (e.amount / total) * 100 : 0;
                    return (
                      <div key={e.category}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-medium truncate">{e.category}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            ₹{Math.round(e.amount).toLocaleString("en-IN")} · {pct.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Recent Activity (admin only) */}
      {data.isAdmin && data.recentActivity.length > 0 && (
        <StaggerItem>
          <GlassCard className="p-4" hover={false}>
            <h3 className="font-semibold mb-4">Recent Activity</h3>
            <div className="space-y-2">
              {data.recentActivity.map((a) => (
                <div key={a.id} className="glass-soft rounded-2xl p-3 flex items-start gap-3">
                  <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/15 shrink-0">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{a.actor?.name || "System"}</span>{" "}
                      <span className="text-muted-foreground">{a.action.toLowerCase().replace(/_/g, " ")}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(() => {
                        const d = new Date(a.createdAt);
                        const datePart = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                        const timePart = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
                        return `${datePart}, ${timePart}`;
                      })()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </StaggerItem>
      )}
    </StaggerGroup>
  );
}
