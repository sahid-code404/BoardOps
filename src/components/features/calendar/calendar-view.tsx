"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Lock,
  List,
  Grid3x3,
  Columns3,
  Clock,
  CalendarDays,
  AlertCircle,
  Sparkles,
  CircleDot,
  Info,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassNav } from "@/components/glass/glass-nav";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type MealEntry = {
  id: string;
  mealId: string;
  mealName: string;
  mealDisplayName: string;
  mealIcon: string;
  mealColor: string;
  serviceDate: string;
  status: string; // ON | OFF | LOCKED — Current State
  originalState: string; // ON | OFF — Original State
  overridden: boolean; // calculated dynamically: effectiveStatus !== originalState
  editableUntil: string;
  locked: boolean;
  startTime: string;
  endTime: string;
  mealType: string;
};

type MealConfigLite = {
  id: string;
  name: string;
  displayName: string;
  icon: string;
  color: string;
  mealType: string;
  status: string;
};

type CalendarResponse = {
  meals: MealConfigLite[];
  byDate: Record<string, MealEntry[]>;
};

type ViewMode = "agenda" | "week" | "month";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isPastDate(d: Date, today = new Date()): boolean {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return a.getTime() < b.getTime();
}

function relativeEditableUntil(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  if (diff <= 0) return "Locked";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `in ${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  return `in ${days}d`;
}

function formatTimeRange(start: string, end: string): string {
  const to12 = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const hr = h % 12 === 0 ? 12 : h % 12;
    return `${hr}:${String(m || 0).padStart(2, "0")} ${period}`;
  };
  return `${to12(start)} – ${to12(end)}`;
}

function formatEditableUntil(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// ─────────────────────────────────────────────────────────────
// Status helpers
// ─────────────────────────────────────────────────────────────

function entryIsOn(e: MealEntry): boolean {
  return e.status === "ON" || e.status === "LOCKED";
}

function entryIsLocked(e: MealEntry): boolean {
  return e.locked || e.status === "LOCKED";
}

// ─────────────────────────────────────────────────────────────
// Status chip
// ─────────────────────────────────────────────────────────────

function StatusChip({ entry }: { entry: MealEntry }) {
  if (entryIsLocked(entry)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-muted/80 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        <Lock className="h-2.5 w-2.5" /> LOCKED
      </span>
    );
  }
  if (entry.overridden) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-warning">
        <Sparkles className="h-2.5 w-2.5" /> OVERRIDE
      </span>
    );
  }
  if (entryIsOn(entry)) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
        <CircleDot className="h-2.5 w-2.5" /> ON
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
      OFF
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Toggle switch (optimistic, disabled when locked)
// ─────────────────────────────────────────────────────────────

function MealToggle({
  entry,
  onToggle,
}: {
  entry: MealEntry;
  onToggle: (entry: MealEntry, next: "ON" | "OFF") => void;
}) {
  const locked = entryIsLocked(entry);
  const isOn = entryIsOn(entry);
  return (
    <Switch
      checked={isOn}
      disabled={locked}
      onCheckedChange={(checked) =>
        onToggle(entry, checked ? "ON" : "OFF")
      }
      aria-label={`Toggle ${entry.mealDisplayName}`}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Meal Card (Agenda)
// ─────────────────────────────────────────────────────────────

function MealAgendaCard({
  entry,
  onToggle,
}: {
  entry: MealEntry;
  onToggle: (entry: MealEntry, next: "ON" | "OFF") => void;
}) {
  const on = entryIsOn(entry);
  const locked = entryIsLocked(entry);
  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      className={cn(
        "glass-soft rounded-2xl p-3.5 flex items-center gap-3 relative overflow-hidden",
        locked && "opacity-90"
      )}
      style={{
        background: on
          ? `linear-gradient(135deg, ${entry.mealColor}22, transparent 70%)`
          : undefined,
        borderColor: on ? `${entry.mealColor}55` : undefined,
      }}
    >
      {/* Color accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ background: entry.mealColor }}
      />
      {/* Icon */}
      <div
        className="grid place-items-center h-11 w-11 shrink-0 rounded-2xl text-xl"
        style={{ background: `${entry.mealColor}22` }}
      >
        <span aria-hidden>{entry.mealIcon}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-sm truncate">
            {entry.mealDisplayName}
          </p>
          <StatusChip entry={entry} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTimeRange(entry.startTime, entry.endTime)}
          </span>
          {!locked && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Editable {relativeEditableUntil(entry.editableUntil)}
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1 text-warning">
              <Lock className="h-3 w-3" /> Cutoff passed
            </span>
          )}
        </div>
      </div>

      <MealToggle entry={entry} onToggle={onToggle} />
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Calendar Header (title + nav)
// ─────────────────────────────────────────────────────────────

function CalendarHeader({
  view,
  cursor,
  onPrev,
  onNext,
  onToday,
  onPickMonth,
}: {
  view: ViewMode;
  cursor: Date;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickMonth: (year: number, month: number) => void;
}) {
  const title =
    view === "week"
      ? weekRangeLabel(cursor)
      : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`;

  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-2xl px-3 py-2 glass-soft hover:bg-secondary/60 transition-colors text-left"
              aria-label="Pick month"
            >
              <CalendarIcon className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">{title}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-64 p-3 glass-strong border-border/60 rounded-2xl"
            align="start"
          >
            <div className="grid grid-cols-3 gap-1.5">
              {MONTHS.map((m, i) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    onPickMonth(cursor.getFullYear(), i);
                    setOpen(false);
                  }}
                  className={cn(
                    "rounded-xl px-2 py-2 text-xs font-medium transition-colors",
                    cursor.getMonth() === i
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-secondary/70 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m.slice(0, 3)}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
              <button
                type="button"
                onClick={() =>
                  onPickMonth(cursor.getFullYear() - 1, cursor.getMonth())
                }
                className="rounded-lg px-2 py-1 text-xs hover:bg-secondary/60"
              >
                ← {cursor.getFullYear() - 1}
              </button>
              <span className="text-xs font-semibold">
                {cursor.getFullYear()}
              </span>
              <button
                type="button"
                onClick={() =>
                  onPickMonth(cursor.getFullYear() + 1, cursor.getMonth())
                }
                className="rounded-lg px-2 py-1 text-xs hover:bg-secondary/60"
              >
                {cursor.getFullYear() + 1} →
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-1.5">
        <GlassButton variant="ghost" size="sm" onClick={onToday}>
          <CalendarDays className="h-4 w-4" /> Today
        </GlassButton>
        <GlassButton
          variant="secondary"
          size="icon"
          onClick={onPrev}
          aria-label={
            view === "week" ? "Previous week" : "Previous month"
          }
        >
          <ChevronLeft className="h-4 w-4" />
        </GlassButton>
        <GlassButton
          variant="secondary"
          size="icon"
          onClick={onNext}
          aria-label={view === "week" ? "Next week" : "Next month"}
        >
          <ChevronRight className="h-4 w-4" />
        </GlassButton>
      </div>
    </div>
  );
}

function weekRangeLabel(d: Date): string {
  const start = startOfWeek(d);
  const end = endOfWeek(d);
  const sameMonth = start.getMonth() === end.getMonth();
  if (sameMonth) {
    return `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${end.getDate()}, ${start.getFullYear()}`;
  }
  return `${MONTHS[start.getMonth()].slice(0, 3)} ${start.getDate()} – ${MONTHS[end.getMonth()].slice(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setDate(d.getDate() - d.getDay());
  r.setHours(0, 0, 0, 0);
  return r;
}

function endOfWeek(d: Date): Date {
  const r = startOfWeek(d);
  r.setDate(r.getDate() + 6);
  return r;
}

// ─────────────────────────────────────────────────────────────
// Month View
// ─────────────────────────────────────────────────────────────

function MonthView({
  cursor,
  byDate,
  onToggle,
}: {
  cursor: Date;
  byDate: Record<string, MealEntry[]>;
  onToggle: (entry: MealEntry, next: "ON" | "OFF") => void;
}) {
  const today = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  const cells: Array<{ date: Date | null; iso: string | null }> = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startOffset + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: null, iso: null });
    } else {
      const d = new Date(year, month, dayNum);
      cells.push({ date: d, iso: isoDate(d) });
    }
  }

  return (
    <GlassCard className="p-3 md:p-5" hover={false}>
      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] md:text-xs font-semibold uppercase tracking-wider text-muted-foreground py-1"
          >
            {d.slice(0, 2)}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell, i) => {
          if (!cell.date || !cell.iso) {
            return (
              <div
                key={`empty-${i}`}
                className="rounded-xl min-h-16 md:min-h-24 bg-muted/10"
              />
            );
          }
          const entries = byDate[cell.iso] || [];
          const isToday = isSameDay(cell.date, today);
          const past = isPastDate(cell.date, today);
          return (
            <motion.div
              key={cell.iso}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: Math.min(i * 0.01, 0.2) }}
              className={cn(
                "rounded-xl p-1.5 min-h-16 md:min-h-24 flex flex-col gap-1 relative overflow-hidden",
                isToday ? "ring-2 ring-primary/70 bg-primary/5" : "bg-muted/20",
                past && "opacity-60"
              )}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "text-[10px] md:text-xs font-semibold",
                    isToday ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {cell.date.getDate()}
                </span>
                {past && entries.length > 0 && (
                  <Lock className="h-2.5 w-2.5 text-muted-foreground/70" />
                )}
              </div>
              <div className="flex flex-col gap-0.5 flex-1 overflow-hidden">
                {entries.slice(0, 3).map((e) => {
                  const on = entryIsOn(e);
                  return (
                    <div
                      key={e.id}
                      title={`${e.mealDisplayName} • ${e.status}`}
                      className={cn(
                        "flex items-center gap-1 rounded-md px-1 py-0.5 text-[9px] md:text-[10px] font-medium truncate",
                        on ? "text-white" : "text-muted-foreground"
                      )}
                      style={
                        on
                          ? { background: e.mealColor }
                          : {
                              background: `${e.mealColor}1A`,
                              color: e.mealColor,
                            }
                      }
                    >
                      <span className="text-[10px]">{e.mealIcon}</span>
                      <span className="truncate hidden sm:inline">
                        {e.mealDisplayName}
                      </span>
                      {entryIsLocked(e) && (
                        <Lock className="h-2 w-2 ml-auto shrink-0" />
                      )}
                    </div>
                  );
                })}
                {entries.length > 3 && (
                  <span className="text-[9px] md:text-[10px] text-muted-foreground px-1">
                    +{entries.length - 3} more
                  </span>
                )}
                {entries.length === 0 && (
                  <span className="text-[9px] text-muted-foreground/40 px-1 hidden md:inline">
                    —
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Week View (horizontal scroll on mobile, grid on desktop)
// ─────────────────────────────────────────────────────────────

function WeekView({
  cursor,
  byDate,
  onToggle,
}: {
  cursor: Date;
  byDate: Record<string, MealEntry[]>;
  onToggle: (entry: MealEntry, next: "ON" | "OFF") => void;
}) {
  const today = new Date();
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 md:grid md:grid-cols-7 md:overflow-visible">
      {days.map((d) => {
        const iso = isoDate(d);
        const entries = byDate[iso] || [];
        const isToday = isSameDay(d, today);
        const past = isPastDate(d, today);
        return (
          <motion.div
            key={iso}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-w-[260px] md:min-w-0 flex-shrink-0"
          >
            <GlassCard
              className={cn(
                "p-3 md:p-3 h-full",
                isToday && "ring-2 ring-primary/70"
              )}
              hover={false}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground">
                    {WEEKDAYS[d.getDay()]}
                  </p>
                  <p
                    className={cn(
                      "text-lg font-bold",
                      isToday ? "text-primary" : "text-foreground"
                    )}
                  >
                    {d.getDate()}
                  </p>
                </div>
                {past && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" /> Past
                  </span>
                )}
                {isToday && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Today
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {entries.length === 0 && (
                  <div className="text-[11px] text-muted-foreground/60 text-center py-3">
                    No meals
                  </div>
                )}
                {entries.map((e) => {
                  const on = entryIsOn(e);
                  const locked = entryIsLocked(e);
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "rounded-xl p-2.5 flex items-center gap-2",
                        on ? "" : "bg-muted/30"
                      )}
                      style={
                        on
                          ? {
                              background: `${e.mealColor}26`,
                              borderColor: `${e.mealColor}55`,
                            }
                          : undefined
                      }
                    >
                      <span className="text-base">{e.mealIcon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {e.mealDisplayName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {formatTimeRange(e.startTime, e.endTime)}
                        </p>
                      </div>
                      {locked ? (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      ) : (
                        <MealToggle entry={e} onToggle={onToggle} />
                      )}
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Agenda View (vertical list of dates)
// ─────────────────────────────────────────────────────────────

function AgendaView({
  cursor,
  byDate,
  onToggle,
}: {
  cursor: Date;
  byDate: Record<string, MealEntry[]>;
  onToggle: (entry: MealEntry, next: "ON" | "OFF") => void;
}) {
  const today = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const items = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month, i + 1);
    return { date: d, iso: isoDate(d), entries: byDate[isoDate(d)] || [] };
  });

  if (items.every((i) => i.entries.length === 0)) {
    return (
      <GlassCard className="p-10 md:p-14 text-center" hover={false}>
        <div className="grid place-items-center gap-3">
          <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/40">
            <CalendarDays className="h-7 w-7 text-muted-foreground" />
          </div>
          <p className="font-semibold text-lg">No meals scheduled</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            No meals are configured for {MONTHS[month]} {year}. Contact your
            administrator to set up meal configurations.
          </p>
        </div>
      </GlassCard>
    );
  }

  return (
    <StaggerGroup className="space-y-3">
      {items.map(({ date, iso, entries }) => {
        const isToday = isSameDay(date, today);
        const past = isPastDate(date, today);
        return (
          <StaggerItem key={iso}>
            <div className="flex items-start gap-3">
              {/* Date pill */}
              <div
                className={cn(
                  "shrink-0 w-14 md:w-16 rounded-2xl py-2 px-1 text-center",
                  isToday
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                    : "glass-soft"
                )}
              >
                <p className="text-[10px] font-semibold uppercase opacity-70">
                  {WEEKDAYS[date.getDay()].slice(0, 3)}
                </p>
                <p className="text-xl md:text-2xl font-bold leading-tight">
                  {date.getDate()}
                </p>
              </div>

              {/* Entries */}
              <div className="flex-1 min-w-0 space-y-2">
                {entries.length === 0 ? (
                  <div className="glass-soft rounded-2xl p-3 text-xs text-muted-foreground">
                    No meals scheduled
                  </div>
                ) : (
                  entries.map((e) => (
                    <MealAgendaCard
                      key={e.id}
                      entry={e}
                      onToggle={onToggle}
                    />
                  ))
                )}
              </div>
            </div>
          </StaggerItem>
        );
      })}
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Legend
// ─────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { label: "ON", dot: "bg-success" },
    { label: "OFF", dot: "bg-muted-foreground/40" },
    { label: "Locked", icon: Lock, color: "text-muted-foreground" },
    { label: "Override", icon: Sparkles, color: "text-warning" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-3 md:gap-4 text-[11px] text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          {"dot" in it && it.dot ? (
            <span className={cn("h-2 w-2 rounded-full", it.dot)} />
          ) : null}
          {"icon" in it && it.icon ? (
            <it.icon className={cn("h-3 w-3", it.color)} />
          ) : null}
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Loading skeletons
// ─────────────────────────────────────────────────────────────

function CalendarSkeleton({ mode }: { mode: ViewMode }) {
  if (mode === "month") {
    return (
      <GlassCard className="p-5" hover={false}>
        <div className="grid grid-cols-7 gap-1 mb-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <ShimmerSkeleton
              key={i}
              className="h-4 mx-auto"
              rounded="rounded-md"
            />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <ShimmerSkeleton key={i} className="h-20 md:h-24" />
          ))}
        </div>
      </GlassCard>
    );
  }
  if (mode === "week") {
    return (
      <div className="grid grid-cols-7 gap-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <ShimmerSkeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <ShimmerSkeleton className="w-14 md:w-16 h-16" />
          <div className="flex-1 space-y-2">
            <ShimmerSkeleton className="h-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main CalendarView
// ─────────────────────────────────────────────────────────────

export function CalendarView() {
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [modeOverride, setModeOverride] = React.useState<ViewMode | null>(null);
  const [cursor, setCursor] = React.useState<Date>(new Date());

  // Follow the responsive default until the user explicitly chooses a view.
  const mode: ViewMode = modeOverride ?? (isMobile ? "agenda" : "month");

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const queryKey = React.useMemo(
    () => ["meals", "entries", year, month] as const,
    [year, month]
  );

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: CalendarResponse }>(
        "/meals/entries",
        {
          params: { year, month },
        }
      );
      return r.data;
    },
    staleTime: 60_000,
  });

  // Toggle mutation with optimistic update
  const toggleMutation = useMutation({
    mutationFn: async ({
      entryId,
      status,
    }: {
      entryId: string;
      status: "ON" | "OFF";
    }) => {
      return api.patch<MealEntry>("/meals/toggle", { entryId, status });
    },
    onMutate: async ({ entryId, status }) => {
      // Cancel outgoing refetches
      await qc.cancelQueries({ queryKey });

      // Snapshot previous value
      const previous = qc.getQueryData<CalendarResponse>(queryKey);

      // Optimistically update
      qc.setQueryData<CalendarResponse>(queryKey, (old) => {
        if (!old) return old;
        const newByDate: Record<string, MealEntry[]> = {};
        for (const [key, entries] of Object.entries(old.byDate)) {
          newByDate[key] = entries.map((e) =>
            e.id === entryId
              ? {
                  ...e,
                  status: e.locked ? "LOCKED" : status,
                }
              : e
          );
        }
        return { ...old, byDate: newByDate };
      });

      return { previous };
    },
    onError: (err, _vars, ctx) => {
      // Revert on error
      if (ctx?.previous) {
        qc.setQueryData(queryKey, ctx.previous);
      }
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to update meal. Please try again.";
      toast.error(message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["meals", "entries"] });
    },
  });

  const handleToggle = React.useCallback(
    (entry: MealEntry, next: "ON" | "OFF") => {
      if (entryIsLocked(entry)) {
        toast.error("This meal is locked and cannot be changed.");
        return;
      }
      if (entry.status === next) return;
      toggleMutation.mutate({ entryId: entry.id, status: next });
    },
    [toggleMutation]
  );

  const goPrev = React.useCallback(() => {
    if (mode === "week") {
      const d = new Date(cursor);
      d.setDate(d.getDate() - 7);
      setCursor(d);
    } else {
      setCursor(new Date(year, month - 1, 1));
    }
  }, [mode, cursor, year, month]);

  const goNext = React.useCallback(() => {
    if (mode === "week") {
      const d = new Date(cursor);
      d.setDate(d.getDate() + 7);
      setCursor(d);
    } else {
      setCursor(new Date(year, month + 1, 1));
    }
  }, [mode, cursor, year, month]);

  const goToday = React.useCallback(() => setCursor(new Date()), []);

  const pickMonth = React.useCallback(
    (y: number, m: number) => setCursor(new Date(y, m, 1)),
    []
  );

  const byDate = data?.byDate || {};
  const mealsCount = Object.values(byDate).reduce(
    (s, arr) => s + arr.length,
    0
  );

  return (
    <StaggerGroup className="space-y-4 md:space-y-5 pb-6">
      {/* View toggle */}
      <StaggerItem>
        <div className="flex items-center justify-end">
          <GlassNav<ViewMode>
            value={mode}
            onChange={setModeOverride}
            items={[
              {
                value: "agenda",
                label: "Agenda",
                icon: <List className="h-3.5 w-3.5" />,
              },
              {
                value: "week",
                label: "Week",
                icon: <Columns3 className="h-3.5 w-3.5" />,
              },
              {
                value: "month",
                label: "Month",
                icon: <Grid3x3 className="h-3.5 w-3.5" />,
              },
            ]}
          />
        </div>
      </StaggerItem>

      {/* Quick nav */}
      <StaggerItem>
        <GlassCard className="p-3 md:p-4" hover={false}>
          <CalendarHeader
            view={mode}
            cursor={cursor}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            onPickMonth={pickMonth}
          />
        </GlassCard>
      </StaggerItem>

      {/* Content */}
      <StaggerItem>
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <CalendarSkeleton mode={mode} />
            </motion.div>
          ) : isError ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <GlassCard className="p-8 md:p-12 text-center" hover={false}>
                <div className="grid place-items-center gap-3">
                  <div className="grid place-items-center h-14 w-14 rounded-3xl bg-destructive/15">
                    <AlertCircle className="h-7 w-7 text-destructive" />
                  </div>
                  <p className="font-semibold text-lg">
                    Couldn&apos;t load your calendar
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {error instanceof ApiError
                      ? error.message
                      : "Something went wrong. Please try again."}
                  </p>
                  <GlassButton
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      qc.invalidateQueries({ queryKey: ["meals", "entries"] })
                    }
                  >
                    Retry
                  </GlassButton>
                </div>
              </GlassCard>
            </motion.div>
          ) : mealsCount === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <GlassCard className="p-10 md:p-14 text-center" hover={false}>
                <div className="grid place-items-center gap-3">
                  <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/40">
                    <CalendarDays className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-lg">No meals configured</p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Your administrator hasn&apos;t set up any meals for{" "}
                    {MONTHS[month]} {year}. Once meals are configured,
                    they&apos;ll appear here automatically.
                  </p>
                </div>
              </GlassCard>
            </motion.div>
          ) : (
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {mode === "month" && (
                <MonthView
                  cursor={cursor}
                  byDate={byDate}
                  onToggle={handleToggle}
                />
              )}
              {mode === "week" && (
                <WeekView
                  cursor={cursor}
                  byDate={byDate}
                  onToggle={handleToggle}
                />
              )}
              {mode === "agenda" && (
                <AgendaView
                  cursor={cursor}
                  byDate={byDate}
                  onToggle={handleToggle}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </StaggerItem>

      {/* Footer: Legend + cutoff info */}
      {mealsCount > 0 && (
        <StaggerItem>
          <GlassCard className="p-3 md:p-4" hover={false}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Legend />
              <p className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5">
                <Info className="h-3 w-3" />
                Cutoff shown as{" "}
                <span className="font-medium text-foreground">
                  Editable [time]
                </span>{" "}
                — meals lock automatically past that time.
              </p>
            </div>
          </GlassCard>
        </StaggerItem>
      )}
    </StaggerGroup>
  );
}

export default CalendarView;
