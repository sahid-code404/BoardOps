"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { addDays, format, isSameDay } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Utensils,
  UtensilsCrossed,
  UserPlus,
  Users,
  CalendarDays,
  Soup,
  Lock,
  RotateCcw,
  Check,
  X,
  Search,
  ChevronDown,
  ShieldCheck,
  Trash2,
  Plane,
  CheckCircle2,
  Ban,
} from "lucide-react";
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
import { useAuthStore } from "@/stores/use-auth-store";
import { useAppStore } from "@/stores/use-app-store";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api-client";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type MealCount = {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  startTime: string;
  endTime: string;
  on: number;
  off: number;
  guests: number;
  total: number;
};

type GuestMealEntry = {
  id: string;
  mealId: string;
  guestCount: number;
  notes: string | null;
  guestName: string;
};

type UserMealItem = {
  mealId: string;
  mealName: string;
  mealIcon: string;
  mealColor: string;
  status: string;
  originalState: string;
  locked: boolean;
  overridden: boolean;
};

type UserMealStatus = {
  userId: string;
  name: string;
  email: string;
  room: string | null;
  avatarUrl: string | null;
  onCount: number;
  offCount: number;
  monthConsumed: number;
  meals: UserMealItem[];
  notEnrolled?: boolean;
};

type KitchenResponse = {
  date: string;
  counts: MealCount[];
  activeUsers: number;
  access?: boolean;
  monthTotals?: {
    meals: number;
    guests: number;
    off: number;
  };
  userMealStatus?: UserMealStatus[];
  guestMealEntries?: GuestMealEntry[];
};

type LeaveApplicationItem = {
  id: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: string;
  mealType: string;
  mealIds: string | null;
  adminNotes: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    room: string | null;
    avatarUrl: string | null;
  };
};

type ApiResponse<T> = { success: boolean; data: T };

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Returns { top, bottom } for the date picker.
 *  - Today/Yesterday/Tomorrow: top = relative label, bottom = "EEE, d MMM"
 *  - Other dates: top = "d MMM" (date only), bottom = "EEE" (day name only, no duplicate) */
function getDatePickerLabels(d: Date): { top: string; bottom: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(d);
  target.setHours(0, 0, 0, 0);
  const diffMs = target.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return { top: "Today", bottom: format(target, "EEE, d MMM") };
  if (diffDays === -1) return { top: "Yesterday", bottom: format(target, "EEE, d MMM") };
  if (diffDays === 1) return { top: "Tomorrow", bottom: format(target, "EEE, d MMM") };
  // Far dates: top = date only, bottom = day name only (no duplicate)
  return { top: format(target, "d MMM"), bottom: format(target, "EEE") };
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function KitchenView() {
  const user = useAuthStore((s) => s.user);
  const setView = useAppStore((s) => s.setView);
  const [date, setDate] = useState<Date>(new Date());
  const [guestMealOpen, setGuestMealOpen] = useState(false);

  const dateStr = toDateString(date);
  const datePickerLabels = getDatePickerLabels(date);
  const isUser = user?.role === "USER";

  const { data: resp, isLoading } = useQuery({
    queryKey: ["kitchen", dateStr],
    queryFn: () =>
      api.get<ApiResponse<KitchenResponse>>("/kitchen", {
        params: { date: dateStr },
      }),
    // Live kitchen dashboard — refresh every 30s (was 15s; increased to halve
    // the API load while still being responsive enough for live counts).
    refetchInterval: 30_000,
    // Keep refetching on window focus so returning to the tab gives fresh
    // counts immediately. Combined with the 30s interval, this provides both
    // live updates and on-demand freshness.
    refetchOnWindowFocus: true,
    enabled: !isUser,
    // Keep previous day's data visible while a new date loads (stale-while-
    // revalidate). Eliminates the flash of empty content when switching dates.
    placeholderData: (prev) => prev,
  });

  const counts = resp?.data?.counts ?? [];
  const guestMealEntries = resp?.data?.guestMealEntries ?? [];

  const totals = useMemo(() => {
    return {
      meals: counts.reduce((s, c) => s + c.on + c.guests, 0),
      guests: counts.reduce((s, c) => s + c.guests, 0),
      off: counts.reduce((s, c) => s + c.off, 0),
    };
  }, [counts]);

  const monthTotals = resp?.data?.monthTotals ?? { meals: 0, guests: 0, off: 0 };
  const userMealStatus = resp?.data?.userMealStatus;

  // Admin override + search for user meal status
  const qc = useQueryClient();
  const [mealSearch, setMealSearch] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [overrideLoading, setOverrideLoading] = useState<string | null>(null);

  const overrideMutation = useMutation({
    mutationFn: async (params: {
      mealId: string;
      userId: string;
      serviceDate: string;
      action: "TURN_ON" | "TURN_OFF" | "LOCK" | "UNLOCK";
    }) => {
      setOverrideLoading(`${params.userId}_${params.mealId}`);
      await api.post("/meals/override", {
        ...params,
        reason: "Admin override from kitchen dashboard",
      });
    },
    onSuccess: () => {
      toast.success("Meal overridden successfully");
      setOverrideLoading(null);
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to override meal");
      setOverrideLoading(null);
    },
  });

  // ── Guest meal create/delete ──
  const [guestMealMealId, setGuestMealMealId] = useState<string>("");
  const [guestMealCount, setGuestMealCount] = useState<number>(1);
  const [guestMealNotes, setGuestMealNotes] = useState<string>("");
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);

  const createGuestMealMutation = useMutation({
    mutationFn: async (input: { mealId: string; guestCount: number; notes?: string; serviceDate: string }) => {
      await api.post("/kitchen", input);
    },
    onSuccess: () => {
      toast.success("Guest meal added");
      setGuestMealOpen(false);
      setGuestMealMealId("");
      setGuestMealCount(1);
      setGuestMealNotes("");
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add guest meal"),
  });

  const deleteGuestMealMutation = useMutation({
    mutationFn: async (guestMealId: string) => {
      setDeleteLoadingId(guestMealId);
      await api.delete("/kitchen", { body: JSON.stringify({ guestMealId }) });
    },
    onSuccess: () => {
      toast.success("Guest meal removed");
      setDeleteLoadingId(null);
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to remove guest meal");
      setDeleteLoadingId(null);
    },
  });

  // Active meals list for the guest meal dialog dropdown
  const { data: mealsResp } = useQuery({
    queryKey: ["meals-config-active"],
    queryFn: () => api.get<ApiResponse<{ id: string; name: string; displayName: string; icon: string; status: string }[]>>("/meals/config"),
    enabled: !isUser,
    staleTime: 60_000,
  });
  const activeMeals = (mealsResp?.data ?? []).filter((m) => m.status === "ACTIVE");

  // ── Pending leave applications (admin only) ──
  const { data: leaveResp } = useQuery({
    queryKey: ["leave-applications"],
    queryFn: () => api.get<ApiResponse<LeaveApplicationItem[]>>("/leave"),
    enabled: !isUser,
    refetchInterval: 60_000,
  });
  const pendingLeaves = (leaveResp?.data ?? []).filter((l) => l.status === "PENDING");

  const [leaveActionLoadingId, setLeaveActionLoadingId] = useState<string | null>(null);
  const decideLeaveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "APPROVED" | "REJECTED" }) => {
      setLeaveActionLoadingId(id);
      await api.patch(`/leave/${id}`, { status });
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.status === "APPROVED" ? "Leave approved — meals set to OFF" : "Leave rejected");
      setLeaveActionLoadingId(null);
      qc.invalidateQueries({ queryKey: ["leave-applications"] });
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to update leave application");
      setLeaveActionLoadingId(null);
    },
  });

  // Filtered users (search only, no sort)
  const filteredUsers = useMemo(() => {
    if (!userMealStatus) return [];
    let result = userMealStatus;
    const q = mealSearch.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          (u.room || "").toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
      );
    }
    return result;
  }, [userMealStatus, mealSearch]);

  // USER role or server denied access — kitchen is admin/manager only
  if (isUser || resp?.data?.access === false) {
    return <AccessRestricted />;
  }

  if (isLoading) return <KitchenSkeleton />;

  return (
    <StaggerGroup className="space-y-4">
      {/* Date picker — wide capsule with centered text + circular arrows */}
      <StaggerItem>
        <div className="flex items-center justify-center gap-3 sm:gap-4">
          {/* Left arrow — circular */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Previous day"
            className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
          >
            <ChevronLeft className="h-5 w-5" />
          </motion.button>

          {/* Date capsule — wide, centered text with relative day label */}
          <button
            onClick={() => !isSameDay(date, new Date()) && setDate(new Date())}
            className="flex-1 max-w-[280px] flex items-center justify-center gap-2.5 glass-soft rounded-full px-4 sm:px-6 py-2.5 transition-all hover:ring-1 hover:ring-primary/30"
          >
            <CalendarDays className="h-4 w-4 text-primary shrink-0" />
            <div className="leading-tight text-center min-w-0">
              <p className="text-sm font-bold text-primary truncate">
                {datePickerLabels.top}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {datePickerLabels.bottom}
              </p>
            </div>
            {!isSameDay(date, new Date()) && (
              <RotateCcw className="h-3 w-3 text-muted-foreground shrink-0" />
            )}
          </button>

          {/* Right arrow — circular */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Next day"
            className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
          >
            <ChevronRight className="h-5 w-5" />
          </motion.button>

          {/* Add Guest Meal — small icon button next to the date picker */}
          <GlassButton
            variant="secondary"
            size="icon"
            onClick={() => setGuestMealOpen(true)}
            aria-label="Add guest meal"
            className="shrink-0"
          >
            <UserPlus className="h-5 w-5" />
          </GlassButton>
        </div>
      </StaggerItem>

      {/* KPI cards — always 3 in a single horizontal row, stretches evenly on desktop */}
      <StaggerItem>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard
            icon={<Utensils className="h-4 w-4" />}
            label="Total Meals"
            value={monthTotals.meals}
            color="success"
            sub="This Month"
          />
          <KpiCard
            icon={<UserPlus className="h-4 w-4" />}
            label="Guests"
            value={totals.guests}
            color="primary"
            sub="Today"
          />
          <KpiCard
            icon={<Users className="h-4 w-4" />}
            label="Meals OFF"
            value={totals.off}
            color="warning"
            sub="Skipped"
          />
        </div>
      </StaggerItem>

      {/* Empty state */}
      {counts.length === 0 ? (
        <StaggerItem>
          <GlassCard className="p-10 text-center" hover={false}>
            <div className="grid place-items-center h-16 w-16 rounded-3xl bg-muted/40 mx-auto mb-4">
              <Soup className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-lg mb-1">No meals configured</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              No active meal configurations found for{" "}
              {format(date, "d MMM yyyy")}. Set up meals in the Meals section to
              see kitchen counts here.
            </p>
            <GlassButton className="mt-5" onClick={() => setView("meals")}>
              <UtensilsCrossed className="h-4 w-4" />
              Configure Meals
            </GlassButton>
          </GlassCard>
        </StaggerItem>
      ) : (
        <>
          {/* Per-meal cards */}
          <StaggerItem>
            <div className="grid-cards gap-3">
              {counts.map((m) => (
                <MealCard
                  key={m.id}
                  meal={m}
                  guestMealEntries={guestMealEntries.filter((g) => g.mealId === m.id)}
                  onDeleteGuestMeal={(id) => deleteGuestMealMutation.mutate(id)}
                  deleteLoadingId={deleteLoadingId}
                />
              ))}
            </div>
          </StaggerItem>

          {/* User meal status — admin can see + override, expandable like agenda */}
          {userMealStatus && userMealStatus.length > 0 && (
            <StaggerItem>
              <GlassCard className="p-4" hover={false}>
                <div className="flex items-center gap-2 mb-3">
                  <Users className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">User Meal Status</h3>
                  <span className="text-xs text-muted-foreground">· {format(date, "d MMM yyyy")}</span>
                </div>

                {/* Search */}
                <div className="mb-3">
                  <GlassInput
                    placeholder="Search by name, room, or email…"
                    value={mealSearch}
                    onChange={(e) => setMealSearch(e.target.value)}
                    icon={<Search className="h-4 w-4" />}
                  />
                </div>

                {/* User list — expandable rows */}
                <div className="max-h-[28rem] overflow-y-auto no-scrollbar space-y-2">
                  {filteredUsers.length === 0 ? (
                    <p className="text-center py-4 text-sm text-muted-foreground">No users match your search.</p>
                  ) : (
                    filteredUsers.map((u) => {
                      const isExpanded = expandedUser === u.userId;
                      return (
                        <GlassCard key={u.userId} className="overflow-hidden" hover={false}>
                          {/* Collapsed row — click to expand */}
                          <button
                            onClick={() => setExpandedUser(isExpanded ? null : u.userId)}
                            className="w-full flex items-center gap-3 p-3 hover:bg-secondary/20 transition-colors"
                          >
                            {/* Avatar */}
                            <UserAvatar
                              name={u.name}
                              avatarUrl={u.avatarUrl}
                              className="h-9 w-9 rounded-xl"
                              fallbackClassName="text-xs"
                            />
                            {/* Name + room */}
                            <div className="flex-1 min-w-0 text-left">
                              <p className="text-sm font-medium truncate">{u.name}</p>
                              {u.room && (
                                <p className="text-[11px] text-muted-foreground">Room {u.room}</p>
                              )}
                            </div>
                            {/* Before Enrollment badge — shown when the selected date
                                is before this user's registration date */}
                            {u.notEnrolled && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full font-medium shrink-0">
                                <UserPlus className="h-2.5 w-2.5" /> Before Enrollment
                              </span>
                            )}
                            {/* Expand chevron */}
                            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            </motion.div>
                          </button>

                          {/* Expanded — meal details with override controls */}
                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: "auto", opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-3 space-y-2">
                                  {/* Before Enrollment banner — shown when the selected date
                                      is before this user's registration date */}
                                  {u.notEnrolled && (
                                    <div className="flex items-center gap-2 p-2.5 rounded-2xl bg-muted/40 ring-1 ring-border/40">
                                      <div className="grid place-items-center h-8 w-8 rounded-xl bg-muted/60 text-muted-foreground shrink-0">
                                        <UserPlus className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-medium text-foreground/80 leading-tight">Before Enrollment</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                          This date is before the user registered. Meals default to OFF.
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                  {/* Monthly tally — total meals consumed this month */}
                                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-primary/10 ring-1 ring-primary/20">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/20 text-primary shrink-0">
                                        <Utensils className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-[11px] font-medium text-foreground/80 leading-tight">Total Meals Consumed</p>
                                        <p className="text-[10px] text-muted-foreground leading-tight">
                                          {format(date, "MMM yyyy")}
                                        </p>
                                      </div>
                                    </div>
                                    <span className="inline-flex items-center justify-center min-w-[2.5rem] h-9 px-2.5 rounded-xl bg-primary text-primary-foreground text-lg font-bold tabular-nums shrink-0 shadow-sm shadow-primary/30">
                                      {u.monthConsumed}
                                    </span>
                                  </div>

                                  {u.meals.map((m) => {
                                    const isOn = m.status === "ON" || m.status === "LOCKED";
                                    const isLocked = m.locked || m.status === "LOCKED";
                                    const isOverridden = m.overridden;
                                    // Unlocked meals are READ-ONLY for the admin: the user can still
                                    // toggle these themselves before the cutoff, so the admin must not
                                    // override them. Admin override is only available on LOCKED meals.
                                    const isReadOnly = !isLocked;
                                    const hintKey = `${u.userId}_${m.mealId}`;
                                    const isLoading = overrideLoading === hintKey && !isReadOnly;
                                    return (
                                      <div
                                        key={m.mealId}
                                        className="flex items-center gap-3 p-2.5 rounded-2xl glass-soft"
                                      >
                                        {/* Meal icon */}
                                        <div
                                          className="grid place-items-center h-9 w-9 rounded-xl shrink-0 text-lg"
                                          style={{ background: `color-mix(in oklch, ${m.mealColor} 15%, transparent)` }}
                                        >
                                          {m.mealIcon}
                                        </div>
                                        {/* Meal name + status labels */}
                                        <div className="flex-1 min-w-0">
                                          <p className="text-sm font-medium truncate">{m.mealName}</p>
                                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                            {isLocked && (
                                              <span className="text-[10px] text-destructive flex items-center gap-0.5">
                                                <Lock className="h-2.5 w-2.5" /> Locked
                                              </span>
                                            )}
                                            {isOverridden && (
                                              <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                                <ShieldCheck className="h-2.5 w-2.5" /> Overridden
                                              </span>
                                            )}
                                            {isReadOnly && (
                                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                                Read-only — user can edit
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        {/* Toggle
                                            - LOCKED meals: admin can override (clickable).
                                            - UNLOCKED meals: read-only. Clicking shows a toast with the reason. */}
                                        <div className="relative shrink-0">
                                          <button
                                            type="button"
                                            title={
                                              isReadOnly
                                                ? `${m.mealName} — read-only. The user can still change this meal before the cutoff. Admin override is only available after the meal is locked.`
                                                : `Toggle ${m.mealName} — currently ${m.status}. Admin can override.`
                                            }
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              if (isReadOnly) {
                                                toast.error(
                                                  `${m.mealName} is not locked yet. The user can still change it before the cutoff — admin override is only available after the meal is locked.`,
                                                  { duration: 4000 }
                                                );
                                                return;
                                              }
                                              const action = isOn ? "TURN_OFF" : "TURN_ON";
                                              overrideMutation.mutate({
                                                mealId: m.mealId,
                                                userId: u.userId,
                                                serviceDate: dateStr,
                                                action,
                                              });
                                            }}
                                            className={cn(
                                              "relative inline-flex h-7 w-12 items-center rounded-full transition-all shrink-0",
                                              isOn ? "bg-success shadow-sm shadow-success/30" : "bg-muted",
                                              isReadOnly &&
                                                "opacity-70 cursor-not-allowed ring-2 ring-destructive/50 ring-offset-1 ring-offset-background",
                                              isLoading && "opacity-50 cursor-wait"
                                            )}
                                          >
                                            <span
                                              className={cn(
                                                "inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-[margin,transform] duration-200 ease-out",
                                                isOn ? "ml-auto mr-1" : "ml-1"
                                              )}
                                            />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </GlassCard>
                      );
                    })
                  )}
                </div>
              </GlassCard>
            </StaggerItem>
          )}

          {/* Pending leave applications — admin approval */}
          {pendingLeaves.length > 0 && (
            <StaggerItem>
              <GlassCard className="p-4" hover={false}>
                <div className="flex items-center gap-2 mb-3">
                  <Plane className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Pending Leave Applications</h3>
                  <span className="text-xs text-muted-foreground">· {pendingLeaves.length} pending</span>
                </div>

                <div className="space-y-2">
                  {pendingLeaves.map((l) => {
                    const start = l.startDate.slice(0, 10);
                    const end = l.endDate.slice(0, 10);
                    const isLoading = leaveActionLoadingId === l.id;
                    return (
                      <div
                        key={l.id}
                        className="flex items-start gap-3 p-3 rounded-2xl glass-soft"
                      >
                        <UserAvatar
                          name={l.user.name}
                          avatarUrl={l.user.avatarUrl}
                          className="h-9 w-9 rounded-xl shrink-0"
                          fallbackClassName="text-xs"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate">{l.user.name}</p>
                            {l.user.room && (
                              <span className="text-[10px] text-muted-foreground">Room {l.user.room}</span>
                            )}
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium shrink-0">
                              {l.mealType === "ALL" ? "All meals" : "Specific meals"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {start === end ? start : `${start} → ${end}`}
                          </p>
                          <p className="text-[11px] text-foreground/80 mt-1 line-clamp-2">{l.reason}</p>
                        </div>
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "APPROVED" })}
                            disabled={isLoading}
                            aria-label="Approve leave"
                            className="grid place-items-center h-8 w-8 rounded-xl bg-success/15 text-success hover:bg-success/25 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => decideLeaveMutation.mutate({ id: l.id, status: "REJECTED" })}
                            disabled={isLoading}
                            aria-label="Reject leave"
                            className="grid place-items-center h-8 w-8 rounded-xl bg-destructive/15 text-destructive hover:bg-destructive/25 transition-colors disabled:opacity-50"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            </StaggerItem>
          )}
        </>
      )}

      {/* Add Guest Meal Dialog */}
      <Dialog open={guestMealOpen} onOpenChange={setGuestMealOpen}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-primary" />
              Add Guest Meal
            </DialogTitle>
            <DialogDescription>
              Add guest meal counts for {format(date, "d MMM yyyy")}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Meal</label>
              <Select value={guestMealMealId} onValueChange={setGuestMealMealId}>
                <SelectTrigger className="w-full h-11 rounded-2xl">
                  <SelectValue placeholder="Select a meal…" />
                </SelectTrigger>
                <SelectContent>
                  {activeMeals.length === 0 ? (
                    <SelectItem value="__none" disabled>
                      No active meals
                    </SelectItem>
                  ) : (
                    activeMeals.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.icon} {m.displayName}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Guest count</label>
              <GlassInput
                type="number"
                min={1}
                value={guestMealCount}
                onChange={(e) => setGuestMealCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Notes (optional)</label>
              <GlassTextarea
                rows={2}
                placeholder="e.g. family visitors"
                value={guestMealNotes}
                onChange={(e) => setGuestMealNotes(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setGuestMealOpen(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              disabled={!guestMealMealId || guestMealMealId === "__none" || guestMealCount < 1 || createGuestMealMutation.isPending}
              loading={createGuestMealMutation.isPending}
              onClick={() =>
                createGuestMealMutation.mutate({
                  mealId: guestMealMealId,
                  guestCount: guestMealCount,
                  notes: guestMealNotes.trim() || undefined,
                  serviceDate: dateStr,
                })
              }
            >
              <UserPlus className="h-4 w-4" />
              Add Guest Meal
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
  icon,
  label,
  value,
  color,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "primary" | "success" | "warning" | "danger" | "info";
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
          <AnimatedCounter value={value} />
        </div>
        {sub && (
          <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
        )}
      </div>
    </GlassCard>
  );
}

function MealCard({
  meal,
  guestMealEntries = [],
  onDeleteGuestMeal,
  deleteLoadingId,
}: {
  meal: MealCount;
  guestMealEntries?: GuestMealEntry[];
  onDeleteGuestMeal?: (id: string) => void;
  deleteLoadingId?: string | null;
}) {
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="relative rounded-3xl p-5 overflow-hidden glass"
      style={{
        background: `linear-gradient(135deg, ${meal.color}30 0%, ${meal.color}0a 55%, transparent 100%)`,
        borderColor: `${meal.color}50`,
        boxShadow: `0 8px 32px -10px ${meal.color}40, inset 0 1px 0 0 ${meal.color}25`,
      }}
    >
      <div
        className="absolute -top-12 -right-12 h-32 w-32 rounded-full blur-3xl opacity-40 pointer-events-none"
        style={{ background: meal.color }}
      />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div className="text-4xl drop-shadow-sm">{meal.icon}</div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Service
            </div>
            <div className="text-xs font-medium tabular-nums">
              {(() => {
                const to12 = (t: string) => {
                  const [h, m] = t.split(":").map(Number);
                  const period = h >= 12 ? "PM" : "AM";
                  const hr = h % 12 || 12;
                  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
                };
                return `${to12(meal.startTime)} – ${to12(meal.endTime)}`;
              })()}
            </div>
          </div>
        </div>
        <h4 className="font-semibold text-base">{meal.displayName}</h4>

        <div className="mt-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              ON count
            </div>
            <AnimatedCounter
              value={meal.on}
              className="text-4xl font-bold tracking-tight tabular-nums block leading-none"
            />
          </div>
          <div className="flex flex-col gap-1 items-end">
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground">
              OFF: <strong className="tabular-nums">{meal.off}</strong>
            </span>
            <span
              className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{
                background: `${meal.color}25`,
                color: meal.color,
              }}
            >
              Guests:{" "}
              <strong className="tabular-nums">{meal.guests}</strong>
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/20 text-success font-medium">
              Total:{" "}
              <strong className="tabular-nums">{meal.total}</strong>
            </span>
          </div>
        </div>

        {/* Per-guest-meal delete chips — only render if there are guest entries */}
        {guestMealEntries.length > 0 && onDeleteGuestMeal && (
          <div className="mt-3 pt-3 border-t border-border/30 space-y-1.5">
            {guestMealEntries.map((g) => (
              <div
                key={g.id}
                className="flex items-center justify-between gap-2 text-[11px] glass-soft rounded-xl px-2.5 py-1.5"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <UserPlus className="h-3 w-3 text-primary shrink-0" />
                  <span className="font-medium tabular-nums shrink-0">×{g.guestCount}</span>
                  {g.notes && (
                    <span className="text-muted-foreground truncate">— {g.notes}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => onDeleteGuestMeal(g.id)}
                  disabled={deleteLoadingId === g.id}
                  aria-label="Delete guest meal"
                  className="shrink-0 grid place-items-center h-6 w-6 rounded-lg text-destructive/70 hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// States
// ─────────────────────────────────────────────────────────────

function AccessRestricted() {
  return (
    <div className="grid place-items-center min-h-[60vh] p-4">
      <StaggerGroup className="w-full max-w-md">
        <StaggerItem>
          <GlassCard
            className="p-8 text-center"
            glow="warning"
            hover={false}
          >
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 220, damping: 18 }}
              className="grid place-items-center h-16 w-16 rounded-3xl bg-warning/15 mx-auto mb-5"
            >
              <Lock className="h-8 w-8 text-warning" />
            </motion.div>
            <h2 className="text-xl font-bold mb-2">
              Access restricted
            </h2>
            <p className="text-sm text-muted-foreground">
              The Kitchen Dashboard is available to{" "}
              <strong className="text-foreground">managers and admins</strong>{" "}
              only. Residents don&apos;t have access to live meal counts.
            </p>
            <p className="text-xs text-muted-foreground mt-4">
              If you believe this is a mistake, please contact your
              administrator.
            </p>
          </GlassCard>
        </StaggerItem>
      </StaggerGroup>
    </div>
  );
}

function KitchenSkeleton() {
  return (
    <div className="space-y-4">
      <ShimmerSkeleton className="h-32" />
      <div className="grid-kpi gap-3">
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
      </div>
      <ShimmerSkeleton className="h-32" />
      <div className="grid-cards gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <ShimmerSkeleton key={i} className="h-44" />
        ))}
      </div>
    </div>
  );
}
