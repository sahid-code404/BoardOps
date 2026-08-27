"use client";

import { useState, useMemo, memo, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { isSameMonth, isSameDay, format, addDays, startOfMonth, endOfMonth, eachDayOfInterval, getDay } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Calendar,
  RotateCcw,
  Utensils,
  Lock,
  Check,
  X,
  ChevronDown,
  CalendarDays,
  List,
  Sun,
  UserPlus,
  ShieldCheck,
  Plane,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
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
import { Checkbox } from "@/components/ui/checkbox";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type MealConfig = {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  startTime: string;
  endTime: string;
  cutoffTime: string;
};

type FlatEntry = {
  id: string;
  mealId: string;
  mealName: string;
  mealDisplayName: string;
  mealIcon: string;
  mealColor: string;
  serviceDate: string;
  status: string;
  originalState: string;
  overridden: boolean;
  editableUntil: string;
  locked: boolean;
  preRegistration: boolean;
  startTime: string;
  endTime: string;
  mealType: string;
};

type MealEntry = {
  id: string;
  status: string;
  originalState: string;
  overridden: boolean;
  locked: boolean;
  editableUntil: string;
  serviceDate: string;
  preRegistration: boolean;
  meal: {
    id: string;
    name: string;
    displayName: string;
    icon: string;
    color: string;
    startTime: string;
    endTime: string;
    cutoffTime: string;
  };
};

type EntriesResponse = {
  meals: MealConfig[];
  byDate: Record<string, FlatEntry[]>;
  registrationDate?: string;
};

type ApiResponse<T> = { success: boolean; data: T };
type ViewMode = "agenda" | "calendar" | "day";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function to12h(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return `${hr}:${String(m).padStart(2, "0")} ${period}`;
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function UserMealsView() {
  const qc = useQueryClient();
  const now = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>("agenda");
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedDay, setSelectedDay] = useState(new Date());
  const isThisMonth = isSameMonth(new Date(selectedYear, selectedMonth, 1), now);
  const [expandedDay, setExpandedDay] = useState<string | null>(toDateString(now));

  // ── Leave application dialog state ──
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaveStart, setLeaveStart] = useState(toDateString(now));
  const [leaveEnd, setLeaveEnd] = useState(toDateString(now));
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveMealType, setLeaveMealType] = useState<"ALL" | "SPECIFIC">("ALL");
  const [leaveMealIds, setLeaveMealIds] = useState<string[]>([]);

  // Active meals list — for the SPECIFIC meal selection in the leave dialog
  const { data: mealsConfigResp } = useQuery({
    queryKey: ["meals-config-active"],
    queryFn: () =>
      api.get<ApiResponse<{ id: string; name: string; displayName: string; icon: string; status: string }[]>>("/meals/config"),
    enabled: leaveOpen,
    staleTime: 60_000,
  });
  const activeMealsForLeave = (mealsConfigResp?.data ?? []).filter((m) => m.status === "ACTIVE");

  const applyLeaveMutation = useMutation({
    mutationFn: async (input: {
      startDate: string;
      endDate: string;
      reason: string;
      mealType: "ALL" | "SPECIFIC";
      mealIds: string[];
    }) => {
      await api.post("/leave", input);
    },
    onSuccess: () => {
      toast.success("Leave application submitted");
      setLeaveOpen(false);
      setLeaveStart(toDateString(now));
      setLeaveEnd(toDateString(now));
      setLeaveReason("");
      setLeaveMealType("ALL");
      setLeaveMealIds([]);
      qc.invalidateQueries({ queryKey: ["leave-applications"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to submit leave application"),
  });

  // Month query — for agenda + calendar views
  const { data: monthData, isLoading: monthLoading } = useQuery({
    queryKey: ["user-meals", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<EntriesResponse>>("/meals/entries", {
        params: { month: selectedMonth, year: selectedYear },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
    enabled: viewMode !== "day",
  });

  // Single-day query — for day view
  const dayStr = toDateString(selectedDay);
  const { data: dayData, isLoading: dayLoading } = useQuery({
    queryKey: ["user-meals-day", dayStr],
    queryFn: async () => {
      const r = await api.get<ApiResponse<EntriesResponse>>("/meals/entries", {
        params: { date: dayStr },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
    enabled: viewMode === "day",
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ entryId, status }: { entryId: string; status: "ON" | "OFF" }) => {
      await api.patch("/meals/toggle", { entryId, status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["user-meals"] });
      qc.invalidateQueries({ queryKey: ["user-meals-day"] });
      qc.invalidateQueries({ queryKey: ["kitchen"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to toggle meal"),
  });

  // Normalize month data into sorted days array
  const days = useMemo(() => {
    const src = monthData;
    if (!src) return [];
    const mealMap = new Map(src.meals.map((m) => [m.id, m]));
    const result: { dateStr: string; date: Date; entries: MealEntry[] }[] = [];
    const dateKeys = Object.keys(src.byDate).sort();
    for (const dateStr of dateKeys) {
      const flatEntries = src.byDate[dateStr];
      if (!flatEntries || flatEntries.length === 0) continue;
      const entries: MealEntry[] = flatEntries.map((f) => {
        const meal = mealMap.get(f.mealId);
        return {
          id: f.id, status: f.status, locked: f.locked,
          editableUntil: f.editableUntil, serviceDate: f.serviceDate,
          originalState: f.originalState,
          overridden: f.overridden,
          preRegistration: f.preRegistration,
          meal: {
            id: f.mealId, name: f.mealName, displayName: f.mealDisplayName,
            icon: f.mealIcon, color: f.mealColor,
            startTime: f.startTime, endTime: f.endTime,
            cutoffTime: meal?.cutoffTime ?? "",
          },
        };
      });
      result.push({ dateStr, date: parseDateStr(dateStr), entries });
    }
    return result;
  }, [monthData]);

  // Map for quick lookup by dateStr
  const dayMap = useMemo(() => {
    const m = new Map<string, MealEntry[]>();
    for (const d of days) m.set(d.dateStr, d.entries);
    return m;
  }, [days]);

  // Day view entries
  const dayEntries = useMemo(() => {
    if (!dayData) return [];
    const mealMap = new Map(dayData.meals.map((m) => [m.id, m]));
    const flat = dayData.byDate[dayStr] ?? [];
    return flat.map<MealEntry>((f) => {
      const meal = mealMap.get(f.mealId);
      return {
        id: f.id, status: f.status, locked: f.locked,
        editableUntil: f.editableUntil, serviceDate: f.serviceDate,
        originalState: f.originalState,
        overridden: f.overridden,
        preRegistration: f.preRegistration,
        meal: {
          id: f.mealId, name: f.mealName, displayName: f.mealDisplayName,
          icon: f.mealIcon, color: f.mealColor,
          startTime: f.startTime, endTime: f.endTime,
          cutoffTime: meal?.cutoffTime ?? "",
        },
      };
    });
  }, [dayData, dayStr]);

  // Month stats
  const stats = useMemo(() => {
    let on = 0, off = 0, locked = 0;
    for (const day of days) {
      for (const e of day.entries) {
        if (e.status === "ON" || e.status === "LOCKED") on++;
        else if (e.status === "OFF") off++;
        if (e.locked || e.status === "LOCKED") locked++;
      }
    }
    return { on, off, locked };
  }, [days]);

  // Day stats
  const dayStats = useMemo(() => {
    const on = dayEntries.filter((e) => e.status === "ON" || e.status === "LOCKED").length;
    const off = dayEntries.filter((e) => e.status === "OFF").length;
    const locked = dayEntries.filter((e) => e.locked || e.status === "LOCKED").length;
    return { on, off, locked };
  }, [dayEntries]);

  // Registration date — used for the pre-reg toast message + before-enrollment labels.
  // Normalize to local midnight so the comparison is date-only (not affected by timezone).
  const registrationDate = useMemo(() => {
    const raw = monthData?.registrationDate ?? dayData?.registrationDate;
    if (!raw) return null;
    const d = new Date(raw);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [monthData, dayData]);

  // Whether the selected day (day view) is before registration.
  // Uses date-only comparison (both normalized to local midnight) so a user who
  // registered on July 8 is NOT "before enrollment" on July 8.
  const isDayBeforeRegistration = useMemo(() => {
    if (!registrationDate) return false;
    const sel = new Date(selectedDay);
    sel.setHours(0, 0, 0, 0);
    return sel.getTime() < registrationDate.getTime();
  }, [registrationDate, selectedDay]);

  // Short toast shown when a user tries to toggle a pre-registration meal
  const showPreRegToast = useCallback(() => {
    const dateLabel = registrationDate
      ? format(registrationDate, "d MMM yyyy")
      : "your enrollment";
    toast.error(
      `You enrolled on ${dateLabel} — meals before this date can only be changed by an admin.`
    );
  }, [registrationDate]);

  const handleToggleDay = useCallback((dateStr: string) => {
    setExpandedDay((prev) => (prev === dateStr ? null : dateStr));
  }, []);

  // Auto-scroll to today's row when agenda view loads or month changes
  const todayRef = useRef<HTMLDivElement>(null);
  const todayDateStr = toDateString(now);
  const isLoading = viewMode === "day" ? dayLoading : monthLoading;
  useEffect(() => {
    if (viewMode !== "agenda" || isLoading || days.length === 0) return;
    // Only auto-scroll if today is in the current month's data
    const hasToday = days.some((d) => d.dateStr === todayDateStr);
    if (!hasToday) return;
    // Small delay to let the DOM render after loading
    const t = setTimeout(() => {
      todayRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(t);
  }, [viewMode, isLoading, days, todayDateStr]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <ShimmerSkeleton className="h-14 w-full" />
        <div className="grid grid-cols-3 gap-3">
          <ShimmerSkeleton className="h-28" />
          <ShimmerSkeleton className="h-28" />
          <ShimmerSkeleton className="h-28" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-16" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Picker — month picker for agenda/calendar, day picker for day view */}
      {viewMode === "day" ? (
        <StaggerItem>
          <div className="flex items-center justify-center gap-4">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setSelectedDay((d) => addDays(d, -1))}
              aria-label="Previous day"
              className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
            >
              <ChevronLeft className="h-5 w-5" />
            </motion.button>
            <button
              onClick={() => !isSameDay(selectedDay, now) && setSelectedDay(new Date())}
              className="flex-1 max-w-[280px] flex items-center justify-center gap-2.5 glass-soft rounded-full px-6 py-2.5 transition-all hover:ring-1 hover:ring-primary/30"
            >
              <Calendar className="h-4 w-4 text-primary shrink-0" />
              <div className="leading-tight text-center">
                <p className="text-sm font-bold text-primary">
                  {isSameDay(selectedDay, now) ? "Today" : format(selectedDay, "d MMM")}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {format(selectedDay, "EEE, d MMM yyyy")}
                </p>
              </div>
              {!isSameDay(selectedDay, now) && (
                <RotateCcw className="h-3 w-3 text-muted-foreground shrink-0" />
              )}
            </button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => setSelectedDay((d) => addDays(d, 1))}
              aria-label="Next day"
              className="grid place-items-center h-10 w-10 rounded-full glass-strong shrink-0 ring-1 ring-border/40 hover:ring-primary/40 transition-all"
            >
              <ChevronRight className="h-5 w-5" />
            </motion.button>
          </div>
        </StaggerItem>
      ) : (
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
      )}

      {/* KPI cards */}
      <StaggerItem>
        <div className="grid grid-cols-3 gap-3">
          <GlassCard className="p-4" glow="success" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-success/15 text-success mb-3">
              <Check className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Meals ON</p>
            <div className="text-2xl font-bold tracking-tight">
              <AnimatedCounter value={viewMode === "day" ? dayStats.on : stats.on} />
            </div>
          </GlassCard>
          <GlassCard className="p-4" glow="warning" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-warning/15 text-warning mb-3">
              <X className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Meals OFF</p>
            <div className="text-2xl font-bold tracking-tight">
              <AnimatedCounter value={viewMode === "day" ? dayStats.off : stats.off} />
            </div>
          </GlassCard>
          <GlassCard className="p-4" glow="danger" hover={false}>
            <div className="grid place-items-center h-10 w-10 rounded-2xl bg-destructive/15 text-destructive mb-3">
              <Lock className="h-5 w-5" />
            </div>
            <p className="text-xs text-muted-foreground">Locked</p>
            <div className="text-2xl font-bold tracking-tight">
              <AnimatedCounter value={viewMode === "day" ? dayStats.locked : stats.locked} />
            </div>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* View mode toggle — segmented control (below KPIs) + Apply for Leave */}
      <StaggerItem>
        <div className="flex items-center justify-center gap-2 flex-wrap">
          <div className="inline-flex items-center gap-1 glass-soft rounded-2xl p-1">
            {([
              { mode: "agenda" as const, label: "Agenda", icon: List },
              { mode: "calendar" as const, label: "Calendar", icon: CalendarDays },
              { mode: "day" as const, label: "Day", icon: Sun },
            ]).map((opt) => {
              const active = viewMode === opt.mode;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.mode}
                  onClick={() => setViewMode(opt.mode)}
                  className={cn(
                    "inline-flex items-center gap-1.5 h-8 px-3 rounded-xl text-[11px] font-medium transition-all shrink-0",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              );
            })}
          </div>
          <GlassButton
            variant="secondary"
            size="sm"
            onClick={() => setLeaveOpen(true)}
            aria-label="Apply for leave"
          >
            <Plane className="h-4 w-4" />
            Apply for Leave
          </GlassButton>
        </div>
      </StaggerItem>

      {/* Content — agenda / calendar / day */}
      {viewMode === "agenda" && (
        <StaggerItem>
          {days.length === 0 ? (
            <GlassCard className="p-10 text-center" hover={false}>
              <Utensils className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">
                No meals configured for {new Date(selectedYear, selectedMonth).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
              </p>
            </GlassCard>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {days.map((day) => (
                  <motion.div
                    key={day.dateStr}
                    ref={day.dateStr === todayDateStr ? todayRef : undefined}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 280, damping: 26 }}
                  >
                    <DayRow
                      dateStr={day.dateStr}
                      date={day.date}
                      entries={day.entries}
                      isExpanded={expandedDay === day.dateStr}
                      onToggleExpand={() => handleToggleDay(day.dateStr)}
                      onToggleMeal={(entryId, status) =>
                        toggleMutation.mutate({ entryId, status })
                      }
                      onPreRegToggle={showPreRegToast}
                      registrationDate={registrationDate}
                      loading={toggleMutation.isPending}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </StaggerItem>
      )}

      {viewMode === "calendar" && (
        <StaggerItem>
          <GlassCard className="p-4" hover={false}>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="text-center text-[10px] font-medium text-muted-foreground py-1">
                  {wd}
                </div>
              ))}
            </div>
            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {(() => {
                const monthStart = startOfMonth(new Date(selectedYear, selectedMonth, 1));
                const monthEnd = endOfMonth(monthStart);
                const startPad = getDay(monthStart);
                const allDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
                const cells: (Date | null)[] = [];
                for (let i = 0; i < startPad; i++) cells.push(null);
                allDays.forEach((d) => cells.push(d));
                while (cells.length % 7 !== 0) cells.push(null);

                return cells.map((date, i) => {
                  if (!date) return <div key={`pad-${i}`} className="aspect-square min-h-[44px]" />;
                  const ds = toDateString(date);
                  const entries = dayMap.get(ds) ?? [];
                  const isToday = ds === toDateString(now);
                  // Check if this date is before the user's registration date
                  const cellDate = new Date(date);
                  cellDate.setHours(0, 0, 0, 0);
                  const isPreReg = registrationDate ? cellDate < registrationDate : false;
                  const onCount = entries.filter((e) => e.status === "ON" || e.status === "LOCKED").length;
                  const offCount = entries.filter((e) => e.status === "OFF").length;
                  const hasLocked = entries.some((e) => e.locked || e.status === "LOCKED");
                  const hasOverride = entries.some((e) => e.overridden);
                  const isPast = date < now && !isToday;

                  return (
                    <button
                      key={ds}
                      onClick={() => {
                        setSelectedDay(date);
                        setViewMode("day");
                      }}
                      className={cn(
                        "aspect-square min-h-[44px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all text-[10px] relative",
                        isPreReg
                          ? "bg-muted/30 ring-1 ring-dashed ring-border/50 hover:bg-muted/50"
                          : isToday
                            ? "bg-primary/15 ring-1 ring-primary/40"
                            : entries.length > 0
                              ? "glass-soft hover:ring-1 hover:ring-primary/30"
                              : "opacity-40",
                        !isPreReg && isPast && "opacity-60"
                      )}
                      title={isPreReg ? "Before your enrollment — not editable" : undefined}
                    >
                      <span className={cn("font-bold", isToday && !isPreReg ? "text-primary" : "text-foreground")}>
                        {format(date, "d")}
                      </span>
                      {isPreReg ? (
                        hasOverride ? (
                          <span className="h-1.5 w-1.5 rounded-full bg-primary/50" title="Admin override" />
                        ) : (
                          <span className="text-[8px] text-muted-foreground/70 font-medium leading-none">pre</span>
                        )
                      ) : entries.length > 0 ? (
                        <div className="flex items-center gap-0.5">
                          {onCount > 0 && (
                            <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          )}
                          {offCount > 0 && (
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                          )}
                          {hasLocked && (
                            <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                          )}
                        </div>
                      ) : null}
                    </button>
                  );
                });
              })()}
            </div>
            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-3 pt-3 border-t border-border/40 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> ON
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" /> OFF
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive" /> Locked
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <UserPlus className="h-2.5 w-2.5" /> Before Enrollment
              </span>
            </div>
          </GlassCard>
        </StaggerItem>
      )}

      {viewMode === "day" && (
        <StaggerItem>
          {/* Before Enrollment banner — shown when the selected day is before
              the user's registration date */}
          {isDayBeforeRegistration && (
            <div className="flex items-start gap-3 p-3.5 rounded-2xl glass-soft ring-1 ring-border/40 mb-3">
              <div className="grid place-items-center h-9 w-9 rounded-xl bg-muted/60 text-muted-foreground shrink-0">
                <UserPlus className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-sm font-semibold text-foreground">
                  Before Enrollment
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {format(selectedDay, "d MMMM yyyy")} is before your registration date
                  {registrationDate ? ` (${format(registrationDate, "d MMM yyyy")})` : ""}.
                  Meals are not available for this date. Only an administrator can override them.
                </p>
              </div>
            </div>
          )}
          {dayEntries.length === 0 ? (
            <GlassCard className="p-10 text-center" hover={false}>
              {isDayBeforeRegistration ? (
                <>
                  <UserPlus className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm font-medium text-foreground">
                    Not enrolled on this date
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(selectedDay, "d MMMM yyyy")} is before your registration date
                    {registrationDate ? ` (${format(registrationDate, "d MMM yyyy")})` : ""}.
                    Meals are not available for this date.
                  </p>
                </>
              ) : (
                <>
                  <Utensils className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No meals configured for {format(selectedDay, "d MMMM yyyy")}.
                  </p>
                </>
              )}
            </GlassCard>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {dayEntries.map((entry) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 280, damping: 26 }}
                  >
                    <DayMealCard
                      entry={entry}
                      onToggle={(newStatus) =>
                        toggleMutation.mutate({ entryId: entry.id, status: newStatus })
                      }
                      onPreRegToggle={showPreRegToast}
                      loading={toggleMutation.isPending}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </StaggerItem>
      )}

      {/* Apply for Leave Dialog */}
      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plane className="h-5 w-5 text-primary" />
              Apply for Leave
            </DialogTitle>
            <DialogDescription>
              Submit a leave application. An admin will review and set your meals to OFF for the selected period.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Start date</label>
                <GlassInput
                  type="date"
                  value={leaveStart}
                  onChange={(e) => setLeaveStart(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">End date</label>
                <GlassInput
                  type="date"
                  value={leaveEnd}
                  onChange={(e) => setLeaveEnd(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Reason</label>
              <GlassTextarea
                rows={2}
                placeholder="e.g. family trip, medical leave"
                value={leaveReason}
                onChange={(e) => setLeaveReason(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground ml-1">Applies to</label>
              <Select
                value={leaveMealType}
                onValueChange={(v) => {
                  setLeaveMealType(v as "ALL" | "SPECIFIC");
                  if (v === "ALL") setLeaveMealIds([]);
                }}
              >
                <SelectTrigger className="w-full h-11 rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All meals</SelectItem>
                  <SelectItem value="SPECIFIC">Specific meals</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {leaveMealType === "SPECIFIC" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground ml-1">Select meals</label>
                <div className="grid grid-cols-1 gap-1.5 p-2 rounded-2xl glass-soft">
                  {activeMealsForLeave.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No active meals</p>
                  ) : (
                    activeMealsForLeave.map((m) => {
                      const checked = leaveMealIds.includes(m.id);
                      return (
                        <label
                          key={m.id}
                          className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-secondary/40 cursor-pointer text-sm"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(c) => {
                              if (c) setLeaveMealIds((prev) => [...prev, m.id]);
                              else setLeaveMealIds((prev) => prev.filter((x) => x !== m.id));
                            }}
                          />
                          <span className="text-base leading-none">{m.icon}</span>
                          <span className="font-medium">{m.displayName}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setLeaveOpen(false)}>
              Cancel
            </GlassButton>
            <GlassButton
              disabled={
                !leaveStart ||
                !leaveEnd ||
                leaveReason.trim().length < 3 ||
                (leaveMealType === "SPECIFIC" && leaveMealIds.length === 0) ||
                applyLeaveMutation.isPending
              }
              loading={applyLeaveMutation.isPending}
              onClick={() =>
                applyLeaveMutation.mutate({
                  startDate: leaveStart,
                  endDate: leaveEnd,
                  reason: leaveReason.trim(),
                  mealType: leaveMealType,
                  mealIds: leaveMealIds,
                })
              }
            >
              <Plane className="h-4 w-4" />
              Submit Application
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Day row — for agenda view (collapsible)
// ─────────────────────────────────────────────────────────────

const DayRow = memo(function DayRow({
  dateStr, date, entries, isExpanded, onToggleExpand, onToggleMeal, onPreRegToggle, registrationDate, loading,
}: {
  dateStr: string; date: Date; entries: MealEntry[];
  isExpanded: boolean; onToggleExpand: () => void;
  onToggleMeal: (entryId: string, status: "ON" | "OFF") => void;
  onPreRegToggle: () => void;
  registrationDate: Date | null;
  loading: boolean;
}) {
  const isToday = toDateString(new Date()) === dateStr;
  const onCount = entries.filter((e) => e.status === "ON" || e.status === "LOCKED").length;
  const offCount = entries.filter((e) => e.status === "OFF").length;
  const lockedCount = entries.filter((e) => e.locked || e.status === "LOCKED").length;
  const overriddenCount = entries.filter((e) => e.overridden).length;
  // Check if this date is before the user's registration date
  const cellDate = new Date(date);
  cellDate.setHours(0, 0, 0, 0);
  const isPreReg = registrationDate ? cellDate < registrationDate : false;

  return (
    <GlassCard className="overflow-hidden" hover={false}>
      <button
        onClick={onToggleExpand}
        className="w-full flex items-center gap-3 p-3 hover:bg-secondary/20 transition-colors"
      >
        <div className={cn("grid place-items-center h-11 w-11 rounded-2xl shrink-0 flex-col", isToday ? "bg-primary/15" : "bg-muted/40")}>
          <span className={cn("text-xs font-bold leading-none", isToday ? "text-primary" : "text-muted-foreground")}>
            {format(date, "EEE").toUpperCase()}
          </span>
          <span className={cn("text-sm font-bold leading-none mt-0.5", isToday ? "text-primary" : "text-foreground")}>
            {format(date, "d")}
          </span>
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className={cn("text-sm font-medium", isToday && "text-primary")}>
            {isToday ? "Today" : format(date, "EEEE, d MMMM")}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {isPreReg && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
                <UserPlus className="h-2.5 w-2.5" /> Before Enrollment
              </span>
            )}
            {onCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-success/15 text-success px-1.5 py-0.5 rounded-full font-medium">
                <Check className="h-2.5 w-2.5" /> {onCount} ON
              </span>
            )}
            {offCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-warning/15 text-warning px-1.5 py-0.5 rounded-full font-medium">
                <X className="h-2.5 w-2.5" /> {offCount} OFF
              </span>
            )}
            {lockedCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-destructive/15 text-destructive px-1.5 py-0.5 rounded-full font-medium">
                <Lock className="h-2.5 w-2.5" /> {lockedCount}
              </span>
            )}
            {overriddenCount > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium">
                <ShieldCheck className="h-2.5 w-2.5" /> {overriddenCount} Admin
              </span>
            )}
          </div>
        </div>
        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </motion.div>
      </button>
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
              {entries.map((entry) => (
                <MealCard
                  key={entry.id}
                  entry={entry}
                  onToggle={(newStatus) => onToggleMeal(entry.id, newStatus)}
                  onPreRegToggle={onPreRegToggle}
                  loading={loading}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
});

// ─────────────────────────────────────────────────────────────
// Compact meal card — for agenda expanded view
// ─────────────────────────────────────────────────────────────

const MealCard = memo(function MealCard({
  entry, onToggle, onPreRegToggle, loading,
}: {
  entry: MealEntry;
  onToggle: (status: "ON" | "OFF") => void;
  onPreRegToggle: () => void;
  loading: boolean;
}) {
  const isOn = entry.status === "ON" || entry.status === "LOCKED";
  const isLocked = entry.locked || entry.status === "LOCKED";
  const isPreReg = entry.preRegistration;
  const isOverridden = entry.overridden;
  const disabled = (isLocked && !isPreReg) || (isPreReg && isOverridden) || loading;

  const handleClick = () => {
    if (isPreReg && !isOverridden) {
      onPreRegToggle();
      return;
    }
    if (!disabled) onToggle(isOn ? "OFF" : "ON");
  };

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-2xl glass-soft">
      <div className="grid place-items-center h-10 w-10 rounded-xl shrink-0 text-xl" style={{ background: `color-mix(in oklch, ${entry.meal.color} 15%, transparent)` }}>
        {entry.meal.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{entry.meal.displayName}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">{to12h(entry.meal.startTime)} – {to12h(entry.meal.endTime)}</span>
          {isLocked && !isPreReg && <Lock className="h-2.5 w-2.5 text-destructive" />}
          {isOverridden && (
            <span className="inline-flex items-center gap-0.5 text-[9px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium">
              <ShieldCheck className="h-2.5 w-2.5" /> Admin
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleClick}
        disabled={disabled}
        className={cn("relative inline-flex h-7 w-12 items-center rounded-full transition-[margin,transform] duration-200 ease-out shrink-0", isOn ? "bg-success shadow-sm shadow-success/30" : "bg-muted", disabled && "opacity-50 cursor-not-allowed")}
      >
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-[margin,transform] duration-200 ease-out", isOn ? "ml-auto mr-1" : "ml-1")} />
      </button>
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// Full meal card — for day view (larger, with cutoff info)
// ─────────────────────────────────────────────────────────────

const DayMealCard = memo(function DayMealCard({
  entry, onToggle, onPreRegToggle, loading,
}: {
  entry: MealEntry;
  onToggle: (status: "ON" | "OFF") => void;
  onPreRegToggle: () => void;
  loading: boolean;
}) {
  const isOn = entry.status === "ON" || entry.status === "LOCKED";
  const isLocked = entry.locked || entry.status === "LOCKED";
  const isPreReg = entry.preRegistration;
  const isOverridden = entry.overridden;
  const disabled = (isLocked && !isPreReg) || (isPreReg && isOverridden) || loading;

  const handleClick = () => {
    if (isPreReg && !isOverridden) {
      onPreRegToggle();
      return;
    }
    if (!disabled) onToggle(isOn ? "OFF" : "ON");
  };

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-center gap-3">
        <div className="grid place-items-center h-12 w-12 rounded-2xl shrink-0 text-2xl" style={{ background: `color-mix(in oklch, ${entry.meal.color} 15%, transparent)` }}>
          {entry.meal.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold truncate">{entry.meal.displayName}</h3>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-muted-foreground">{to12h(entry.meal.startTime)} – {to12h(entry.meal.endTime)}</span>
            {isLocked && !isPreReg && <span className="inline-flex items-center gap-0.5 text-[10px] text-destructive"><Lock className="h-2.5 w-2.5" /> Locked</span>}
            {isOverridden && (
              <span className="inline-flex items-center gap-0.5 text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-medium">
                <ShieldCheck className="h-2.5 w-2.5" /> Overridden by admin
              </span>
            )}
          </div>
        </div>
        <button
          onClick={handleClick}
          disabled={disabled}
          className={cn("relative inline-flex h-8 w-14 items-center rounded-full transition-[margin,transform] duration-200 ease-out shrink-0", isOn ? "bg-success shadow-md shadow-success/30" : "bg-muted", disabled && "opacity-50 cursor-not-allowed")}
        >
          <span className={cn("inline-block h-6 w-6 rounded-full bg-white shadow-md transition-[margin,transform] duration-200 ease-out", isOn ? "ml-auto mr-1" : "ml-1")} />
        </button>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", isOn ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
          {isLocked && !isPreReg ? "🔒 Locked" : isOn ? "ON" : "OFF"}
        </span>
        {!isLocked && !isPreReg && entry.meal.cutoffTime && (
          <span className="text-[10px] text-muted-foreground">Cutoff: {to12h(entry.meal.cutoffTime)}</span>
        )}
      </div>
    </GlassCard>
  );
});
