"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format, isAfter, isBefore, isToday, parseISO } from "date-fns";
import {
  CalendarDays,
  Plus,
  Trash2,
  Edit3,
  UtensilsCrossed,
  PartyPopper,
  Wrench,
  IndianRupee,
  X,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput } from "@/components/glass/glass-input";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Holiday = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  startDate: string;
  endDate: string;
  mealsDisabled: boolean;
  status: string;
  createdBy: string | null;
  createdAt: string;
};

type ApiResponse<T> = { success: boolean; data: T };

const TYPE_META: Record<string, { label: string; icon: typeof PartyPopper; color: string }> = {
  HOLIDAY: { label: "Holiday", icon: CalendarDays, color: "bg-destructive/15 text-destructive" },
  FESTIVAL: { label: "Festival", icon: PartyPopper, color: "bg-primary/15 text-primary" },
  SPECIAL_MEAL: { label: "Special Meal", icon: UtensilsCrossed, color: "bg-success/15 text-success" },
  BILLING_DAY: { label: "Billing Day", icon: IndianRupee, color: "bg-warning/15 text-warning" },
  REFUND_DAY: { label: "Refund Day", icon: IndianRupee, color: "bg-info/15 text-info" },
  MAINTENANCE: { label: "Maintenance", icon: Wrench, color: "bg-muted text-muted-foreground" },
};

export function HolidaysView() {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Holiday | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: holidays = [], isLoading } = useQuery({
    queryKey: ["holidays", { status: showArchived ? "ARCHIVED" : "ACTIVE" }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Holiday[]>>("/holidays", {
        params: { status: showArchived ? "ARCHIVED" : "ACTIVE" },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const now = new Date();
  const upcoming = holidays.filter((h) => isAfter(parseISO(h.startDate), now));
  const ongoing = holidays.filter((h) => {
    const start = parseISO(h.startDate);
    const end = parseISO(h.endDate);
    return (isBefore(start, now) || isToday(start)) && (isAfter(end, now) || isToday(end));
  });
  const past = holidays.filter((h) => isBefore(parseISO(h.endDate), now));

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/holidays/${id}`),
    onSuccess: () => {
      toast.success("Holiday archived");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to archive holiday"),
  });

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" />
              Institution Calendar
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Holidays, festivals, and special events. Holidays with meals enabled automatically disable meal booking for affected dates.
            </p>
          </div>
          <div className="flex gap-2">
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
            <GlassButton size="sm" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add Holiday
            </GlassButton>
          </div>
        </div>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CalendarDays className="h-3.5 w-3.5" /> Total
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={holidays.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <PartyPopper className="h-3.5 w-3.5" /> Ongoing
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              <AnimatedCounter value={ongoing.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CalendarDays className="h-3.5 w-3.5" /> Upcoming
            </div>
            <p className="text-2xl font-bold tabular-nums text-success">
              <AnimatedCounter value={upcoming.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <UtensilsCrossed className="h-3.5 w-3.5" /> Meals Disabled
            </div>
            <p className="text-2xl font-bold tabular-nums text-destructive">
              <AnimatedCounter value={holidays.filter((h) => h.mealsDisabled).length} />
            </p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Holidays list */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-20 rounded-3xl" />
            ))}
          </div>
        ) : holidays.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <CalendarDays className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No holidays configured</p>
            <p className="text-sm text-muted-foreground mb-4">
              Add holidays, festivals, or maintenance windows to automatically manage meal availability.
            </p>
            <GlassButton size="sm" onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add Holiday
            </GlassButton>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {holidays.map((h) => {
                const meta = TYPE_META[h.type] || TYPE_META.HOLIDAY;
                const Icon = meta.icon;
                const start = parseISO(h.startDate);
                const end = parseISO(h.endDate);
                const isOngoing = (isBefore(start, now) || isToday(start)) && (isAfter(end, now) || isToday(end));
                const isUpcoming = isAfter(start, now);
                return (
                  <motion.div
                    key={h.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <GlassCard className="p-4" hover>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0 flex-1">
                          <div className={cn("grid place-items-center h-10 w-10 rounded-xl shrink-0", meta.color)}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold truncate">{h.name}</p>
                              <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", meta.color)}>
                                {meta.label}
                              </span>
                              {h.mealsDisabled && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/10 text-destructive flex items-center gap-0.5">
                                  <UtensilsCrossed className="h-2.5 w-2.5" /> Meals off
                                </span>
                              )}
                              {isOngoing && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium animate-pulse">
                                  Ongoing
                                </span>
                              )}
                              {isUpcoming && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-success/15 text-success">
                                  Upcoming
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {format(start, "d MMM yyyy")}
                              {end > start && ` → ${format(end, "d MMM yyyy")}`}
                            </p>
                            {h.description && (
                              <p className="text-xs text-muted-foreground mt-1 truncate">{h.description}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <GlassButton
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditTarget(h); setFormOpen(true); }}
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </GlassButton>
                          <GlassButton
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(h.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </GlassButton>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Form dialog */}
      <HolidayFormDialog
        key={editTarget?.id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        editTarget={editTarget}
      />
    </StaggerGroup>
  );
}

function HolidayFormDialog({
  open,
  onOpenChange,
  editTarget,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: Holiday | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editTarget?.name ?? "");
  const [description, setDescription] = useState(editTarget?.description ?? "");
  const [type, setType] = useState(editTarget?.type ?? "HOLIDAY");
  const [startDate, setStartDate] = useState(
    editTarget ? format(parseISO(editTarget.startDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(
    editTarget ? format(parseISO(editTarget.endDate), "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd")
  );
  const [mealsDisabled, setMealsDisabled] = useState(editTarget?.mealsDisabled ?? true);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { name, description: description || undefined, type, startDate, endDate, mealsDisabled };
      if (editTarget) {
        return api.patch(`/holidays/${editTarget.id}`, payload);
      }
      return api.post("/holidays", payload);
    },
    onSuccess: () => {
      toast.success(editTarget ? "Holiday updated" : "Holiday created");
      qc.invalidateQueries({ queryKey: ["holidays"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save holiday"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5 text-primary" />
            {editTarget ? "Edit Holiday" : "Add Holiday"}
          </DialogTitle>
          <DialogDescription>
            Holidays with meals disabled automatically prevent meal booking for the affected dates.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="h-name">Name *</Label>
            <GlassInput id="h-name" placeholder="e.g. Independence Day, Durga Puja" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="h-desc">Description (optional)</Label>
            <GlassInput id="h-desc" placeholder="e.g. Mess closed for renovation" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="h-start">Start Date *</Label>
              <GlassInput id="h-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="h-end">End Date *</Label>
              <GlassInput id="h-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TYPE_META).map(([key, meta]) => (
                  <SelectItem key={key} value={key}>{meta.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-center justify-between p-3 rounded-xl glass-soft cursor-pointer">
            <div>
              <p className="text-sm font-medium">Disable meals during this period</p>
              <p className="text-xs text-muted-foreground">When enabled, meal booking is blocked for affected dates</p>
            </div>
            <Switch checked={mealsDisabled} onCheckedChange={setMealsDisabled} />
          </label>
        </div>
        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>Cancel</GlassButton>
          <GlassButton
            loading={mutation.isPending}
            disabled={!name.trim() || !startDate || !endDate}
            onClick={() => mutation.mutate()}
          >
            {editTarget ? "Save Changes" : "Create Holiday"}
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
