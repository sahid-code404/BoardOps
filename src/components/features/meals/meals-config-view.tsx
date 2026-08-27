"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Utensils,
  Plus,
  Search,
  Pencil,
  Trash2,
  Archive,
  Clock,
  Shield,
  AlertCircle,
  EyeOff,
  Sparkles,
  ArrowUpDown,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { GlassNav } from "@/components/glass/glass-nav";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DigitalClockPicker } from "@/components/ui/digital-clock-picker";
import { Badge } from "@/components/ui/badge";
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
import { api, ApiError } from "@/lib/api-client";
import { useAuthStore } from "@/stores/use-auth-store";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type MealConfiguration = {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  icon: string;
  color: string;
  mealType: string; // REGULAR | SPECIAL | GUEST_ONLY | FESTIVAL | CUSTOM
  status: string; // ACTIVE | INACTIVE | ARCHIVED
  displayOrder: number;
  defaultState: string; // ON | OFF
  defaultVisibility: string; // VISIBLE | HIDDEN
  cutoffStrategy: string; // PREVIOUS_DAY | SAME_DAY | CUSTOM_OFFSET
  cutoffOffsetMinutes: number;
  cutoffTime: string;
  startTime: string;
  endTime: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const MEAL_TYPES: { value: string; label: string; hint: string }[] = [
  { value: "REGULAR", label: "Regular", hint: "Daily standard meal" },
  { value: "SPECIAL", label: "Special", hint: "Special occasion meal" },
  { value: "GUEST_ONLY", label: "Guest Only", hint: "Available to guests only" },
  { value: "FESTIVAL", label: "Festival", hint: "Festival/holiday meal" },
  { value: "CUSTOM", label: "Custom", hint: "Custom type" },
];

const CUTOFF_STRATEGIES: {
  value: string;
  label: string;
  hint: string;
}[] = [
  {
    value: "PREVIOUS_DAY",
    label: "Previous Day",
    hint: "Cutoff on the day before service",
  },
  {
    value: "SAME_DAY",
    label: "Same Day",
    hint: "Cutoff on the service day itself",
  },
  {
    value: "CUSTOM_OFFSET",
    label: "Custom Offset",
    hint: "Cutoff N minutes before service",
  },
];

const COLOR_SWATCHES = [
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#a855f7",
  "#84cc16",
];

const EMOJI_CHOICES = [
  "🍽️",
  "🌅",
  "🥐",
  "🍳",
  "☕",
  "🥗",
  "🍲",
  "🍱",
  "🍛",
  "🍝",
  "🌮",
  "🍔",
  "🍕",
  "🥪",
  "🍜",
  "🥘",
  "🍣",
  "🥟",
  "🍤",
  "🍦",
  "🍰",
  "🍵",
  "🧃",
  "🍪",
  "🍩",
  "🥤",
];

// ─────────────────────────────────────────────────────────────
// Form schema
// ─────────────────────────────────────────────────────────────

const mealSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  displayName: z.string().min(2, "Display name must be at least 2 characters"),
  description: z.string().optional(),
  icon: z.string().min(1, "Pick an icon"),
  color: z.string().min(1, "Pick a color"),
  mealType: z.enum([
    "REGULAR",
    "SPECIAL",
    "GUEST_ONLY",
    "FESTIVAL",
    "CUSTOM",
  ]),
  displayOrder: z.coerce.number().int().min(0, "Must be ≥ 0"),
  defaultState: z.enum(["ON", "OFF"]),
  defaultVisibility: z.enum(["VISIBLE", "HIDDEN"]),
  cutoffStrategy: z.enum(["PREVIOUS_DAY", "SAME_DAY", "CUSTOM_OFFSET"]),
  cutoffTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
  cutoffOffsetMinutes: z.coerce.number().int().min(0).max(1440),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Enter a valid time"),
  notes: z.string().optional(),
});

type MealFormValues = z.infer<typeof mealSchema>;
type MealFormInput = z.input<typeof mealSchema>;

const DEFAULT_FORM_VALUES: MealFormValues = {
  name: "",
  displayName: "",
  description: "",
  icon: "🍽️",
  color: COLOR_SWATCHES[0],
  mealType: "REGULAR",
  displayOrder: 0,
  defaultState: "ON",
  defaultVisibility: "VISIBLE",
  cutoffStrategy: "PREVIOUS_DAY",
  cutoffTime: "22:00",
  cutoffOffsetMinutes: 0,
  startTime: "08:00",
  endTime: "10:00",
  notes: "",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────


function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:${String(m || 0).padStart(2, "0")} ${period}`;
}

function computeCutoffPreview(
  strategy: string,
  cutoffTime: string,
  offsetMinutes: number
): string {
  const time12 = formatTime12(cutoffTime);
  switch (strategy) {
    case "PREVIOUS_DAY":
      return `Previous day, ${time12}`;
    case "SAME_DAY":
      return `Service day, ${time12}`;
    case "CUSTOM_OFFSET":
      return `${offsetMinutes} min before service`;
    default:
      return time12;
  }
}

function mealTypeBadgeClass(type: string): string {
  switch (type) {
    case "REGULAR":
      return "bg-primary/15 text-primary border-primary/30";
    case "SPECIAL":
      return "bg-accent/15 text-accent border-accent/30";
    case "GUEST_ONLY":
      return "bg-warning/15 text-warning border-warning/30";
    case "FESTIVAL":
      return "bg-success/15 text-success border-success/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

// ─────────────────────────────────────────────────────────────
// Meal Form (used in both Dialog & Sheet)
// ─────────────────────────────────────────────────────────────

function MealForm({
  values,
  onSubmit,
  onCancel,
  submitting,
  submitLabel,
}: {
  values: MealFormValues | null;
  onSubmit: (v: MealFormValues) => void;
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  const {
    register,
    handleSubmit,
    control,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MealFormInput, unknown, MealFormValues>({
    resolver: zodResolver(mealSchema),
    defaultValues: values ?? DEFAULT_FORM_VALUES,
    mode: "onChange",
  });

  const watchedStrategy = useWatch({ control, name: "cutoffStrategy" });
  const watchedCutoffTime = useWatch({ control, name: "cutoffTime" });
  const watchedOffset = useWatch({ control, name: "cutoffOffsetMinutes" });
  const watchedColor = useWatch({ control, name: "color" });
  const watchedIcon = useWatch({ control, name: "icon" });

  const cutoffPreview = computeCutoffPreview(
    watchedStrategy,
    watchedCutoffTime,
    Number(watchedOffset ?? 0)
  );

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="space-y-4 max-h-[70vh] overflow-y-auto no-scrollbar px-1"
    >
      {/* Identity section */}
      <div className="grid grid-cols-1 gap-3">
        <GlassInput
          label="Internal name"
          placeholder="morning_tea"
          {...register("name")}
          error={errors.name?.message}
          hint="Lowercase identifier used by the system"
        />
        <GlassInput
          label="Display name"
          placeholder="Morning Tea"
          {...register("displayName")}
          error={errors.displayName?.message}
          hint="Shown to residents"
        />
      </div>

      <GlassTextarea
        label="Description"
        placeholder="A short description of this meal..."
        rows={2}
        {...register("description")}
      />

      {/* Icon picker */}
      <div>
        <Label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
          Icon
        </Label>
        <div className="glass-soft rounded-2xl p-3">
          <div className="flex items-center gap-3 mb-2">
            <div
              className="grid place-items-center h-11 w-11 rounded-2xl text-xl shrink-0"
              style={{ background: `${watchedColor}22` }}
            >
              <span aria-hidden>{watchedIcon}</span>
            </div>
            <GlassInput
              placeholder="Paste any emoji"
              className="flex-1"
              {...register("icon")}
            />
          </div>
          <div className="grid grid-cols-8 gap-1.5 mt-2 max-h-32 overflow-y-auto no-scrollbar">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setValue("icon", emoji, { shouldValidate: true })}
                className={cn(
                  "grid place-items-center h-9 w-9 rounded-xl text-base transition-all hover:scale-110",
                  watchedIcon === emoji
                    ? "bg-primary/20 ring-2 ring-primary"
                    : "bg-muted/40 hover:bg-muted/70"
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
        {errors.icon?.message && (
          <p className="mt-1.5 ml-1 text-xs text-destructive">
            {errors.icon.message}
          </p>
        )}
      </div>

      {/* Color picker */}
      <div>
        <Label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
          Color
        </Label>
        <div className="glass-soft rounded-2xl p-3 flex flex-wrap items-center gap-2">
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setValue("color", c, { shouldValidate: true })}
              className={cn(
                "h-8 w-8 rounded-full transition-transform hover:scale-110",
                watchedColor === c
                  ? "ring-2 ring-offset-2 ring-offset-background ring-foreground"
                  : ""
              )}
              style={{ background: c }}
              aria-label={`Pick color ${c}`}
            />
          ))}
          <input
            type="color"
            value={watchedColor}
            onChange={(e) =>
              setValue("color", e.target.value, { shouldValidate: true })
            }
            className="h-8 w-8 rounded-full bg-transparent cursor-pointer border-0 p-0"
            aria-label="Custom color"
          />
        </div>
      </div>

      {/* Type + status */}
      <div className="grid grid-cols-1 gap-3">
        <div>
          <Label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
            Meal type
          </Label>
          <Controller
            control={control}
            name="mealType"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEAL_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      <span className="font-medium">{t.label}</span>
                      <span className="text-xs text-muted-foreground ml-1">
                        · {t.hint}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>

        <GlassInput
          label="Display order"
          type="number"
          min={0}
          {...register("displayOrder")}
          error={errors.displayOrder?.message}
          icon={<ArrowUpDown className="h-4 w-4" />}
        />
      </div>

      {/* Times */}
      <div className="grid grid-cols-2 gap-3">
        <DigitalClockPicker
          label="Service start"
          value={watch("startTime") || "08:00"}
          onChange={(v) => setValue("startTime", v, { shouldValidate: true, shouldDirty: true })}
          error={errors.startTime?.message}
        />
        <DigitalClockPicker
          label="Service end"
          value={watch("endTime") || "10:00"}
          onChange={(v) => setValue("endTime", v, { shouldValidate: true, shouldDirty: true })}
          error={errors.endTime?.message}
        />
      </div>

      {/* Cutoff */}
      <div className="glass-soft rounded-2xl p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">Cutoff configuration</p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <Label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
              Cutoff strategy
            </Label>
            <Controller
              control={control}
              name="cutoffStrategy"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full h-11 rounded-2xl glass-soft">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CUTOFF_STRATEGIES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="font-medium">{t.label}</span>
                        <span className="text-xs text-muted-foreground ml-1">
                          · {t.hint}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <DigitalClockPicker
            label="Cutoff time"
            value={watch("cutoffTime") || "16:00"}
            onChange={(v) => setValue("cutoffTime", v, { shouldValidate: true, shouldDirty: true })}
            error={errors.cutoffTime?.message}
          />
        </div>

        {watchedStrategy === "CUSTOM_OFFSET" && (
          <GlassInput
            label="Offset minutes (before service)"
            type="number"
            min={0}
            {...register("cutoffOffsetMinutes")}
            error={errors.cutoffOffsetMinutes?.message}
            hint="How many minutes before the service start time the meal locks"
          />
        )}

        {/* Cutoff preview */}
        <div className="rounded-xl bg-primary/8 border border-primary/20 px-3 py-2 flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <p className="text-xs">
            <span className="text-muted-foreground">Editable until: </span>
            <span className="font-semibold text-foreground">
              {cutoffPreview}
            </span>
          </p>
        </div>
      </div>

      {/* Defaults */}
      <div className="grid grid-cols-1 gap-3">
        <div className="glass-soft rounded-2xl p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Default state</p>
            <p className="text-[11px] text-muted-foreground">
              Initial ON/OFF for new entries
            </p>
          </div>
          <Controller
            control={control}
            name="defaultState"
            render={({ field }) => (
              <Switch
                checked={field.value === "ON"}
                onCheckedChange={(c) =>
                  field.onChange(c ? "ON" : "OFF")
                }
              />
            )}
          />
        </div>

        <div className="glass-soft rounded-2xl p-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Default visibility</p>
            <p className="text-[11px] text-muted-foreground">
              Visible or hidden initially
            </p>
          </div>
          <Controller
            control={control}
            name="defaultVisibility"
            render={({ field }) => (
              <Switch
                checked={field.value === "VISIBLE"}
                onCheckedChange={(c) =>
                  field.onChange(c ? "VISIBLE" : "HIDDEN")
                }
              />
            )}
          />
        </div>
      </div>

      {/* Notes */}
      <GlassTextarea
        label="Internal notes"
        placeholder="Optional notes for admins..."
        rows={2}
        {...register("notes")}
      />

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 pt-2 sticky bottom-0 bg-background/80 backdrop-blur-md">
        <GlassButton
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </GlassButton>
        <GlassButton type="submit" loading={submitting}>
          {submitLabel}
        </GlassButton>
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────
// Meal Config Card
// ─────────────────────────────────────────────────────────────

function MealConfigCard({
  meal,
  isAdmin,
  onEdit,
  onDelete,
  onStatusChange,
  statusLoading,
}: {
  meal: MealConfiguration;
  isAdmin: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  statusLoading?: boolean;
}) {
  const cutoffPreview = computeCutoffPreview(
    meal.cutoffStrategy,
    meal.cutoffTime,
    meal.cutoffOffsetMinutes
  );
  const inactive = meal.status === "INACTIVE";
  const archived = meal.status === "ARCHIVED";

  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      className="h-full"
    >
      <GlassCard
        className="p-4 h-full flex flex-col relative overflow-hidden"
        glow="primary"
      >
        {/* Color accent */}
        <div
          className="absolute top-0 left-0 right-0 h-1"
          style={{ background: meal.color }}
        />

        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="grid place-items-center h-12 w-12 rounded-2xl text-2xl shrink-0"
              style={{ background: `${meal.color}22` }}
            >
              <span aria-hidden>{meal.icon}</span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm truncate">
                {meal.displayName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate font-mono">
                {meal.name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Badge
              variant="outline"
              className={cn("text-[10px]", mealTypeBadgeClass(meal.mealType))}
            >
              {MEAL_TYPES.find((t) => t.value === meal.mealType)?.label ||
                meal.mealType}
            </Badge>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {archived ? (
            <Badge variant="secondary" className="text-[10px] bg-muted text-muted-foreground">
              <Archive className="h-2.5 w-2.5" /> Archived
            </Badge>
          ) : inactive ? (
            <Badge variant="secondary" className="text-[10px]">
              Inactive
            </Badge>
          ) : (
            <Badge className="bg-success/15 text-success border-success/30 text-[10px]">
              <Shield className="h-2.5 w-2.5" /> Active
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px]">
            Order: {meal.displayOrder}
          </Badge>
        </div>

        {/* Description */}
        {meal.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">
            {meal.description}
          </p>
        )}

        {/* Cutoff preview */}
        <div className="rounded-xl glass-soft px-3 py-2 mb-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" /> Cutoff preview
          </p>
          <p className="text-xs font-semibold">
            Editable until: {cutoffPreview}
          </p>
        </div>

        {/* Times */}
        <div className="text-[11px] text-muted-foreground mb-3">
          <span className="font-medium text-foreground">Service: </span>
          {formatTime12(meal.startTime)} – {formatTime12(meal.endTime)}
        </div>

        {/* Actions */}
        {isAdmin && (
          <div className="mt-auto space-y-2">
            {/* Status selector */}
            <Select
              value={meal.status}
              onValueChange={(v) => onStatusChange(v)}
              disabled={statusLoading}
            >
              <SelectTrigger className="h-9 rounded-xl glass-soft border-0 text-xs w-full">
                <div className="flex items-center gap-1.5">
                  {meal.status === "ACTIVE" && <Shield className="h-3 w-3 text-success" />}
                  {meal.status === "INACTIVE" && <EyeOff className="h-3 w-3 text-muted-foreground" />}
                  {meal.status === "ARCHIVED" && <Archive className="h-3 w-3 text-muted-foreground" />}
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">
                  <span className="flex items-center gap-2">
                    <Shield className="h-3.5 w-3.5 text-success" /> Active
                  </span>
                </SelectItem>
                <SelectItem value="INACTIVE">
                  <span className="flex items-center gap-2">
                    <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> Inactive
                  </span>
                </SelectItem>
                <SelectItem value="ARCHIVED">
                  <span className="flex items-center gap-2">
                    <Archive className="h-3.5 w-3.5 text-muted-foreground" /> Archived
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            {/* Edit + Delete */}
            <div className="flex items-center gap-2">
              <GlassButton
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={onEdit}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </GlassButton>
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={onDelete}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </GlassButton>
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Skeletons
// ─────────────────────────────────────────────────────────────

function ConfigSkeleton() {
  return (
    <div className="grid-cards gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <ShimmerSkeleton key={i} className="h-56" />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main MealsConfigView
// ─────────────────────────────────────────────────────────────

export function MealsConfigView() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isMobile = useIsMobile();
  const isAdmin =
    user?.role === "ADMIN";

  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState<string>("ALL");
  const [statusFilter, setStatusFilter] = React.useState<string>("ALL");

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<MealConfiguration | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<MealConfiguration | null>(null);

  const queryKey = React.useMemo(() => ["meals", "config"] as const, []);

  const { data, isLoading, isError, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: MealConfiguration[] }>("/meals/config");
      return r.data;
    },
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async (v: MealFormValues) => {
      const r = await api.post<{ success: boolean; data: MealConfiguration }>("/meals/config", v);
      return r.data;
    },
    onSuccess: () => {
      toast.success("Meal created successfully");
      qc.invalidateQueries({ queryKey });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Failed to create meal. Please try again."
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: MealFormValues }) => {
      const r = await api.put<{ success: boolean; data: MealConfiguration }>(`/meals/config/${id}`, values);
      return r.data;
    },
    onSuccess: () => {
      toast.success("Meal updated successfully");
      qc.invalidateQueries({ queryKey });
      setFormOpen(false);
      setEditing(null);
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Failed to update meal. Please try again."
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/meals/config/${id}`);
    },
    onSuccess: () => {
      toast.success("Meal deleted");
      qc.invalidateQueries({ queryKey });
      setDeleteTarget(null);
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Failed to delete meal. Please try again."
      );
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await api.put<{ success: boolean; data: MealConfiguration }>(
        `/meals/config/${id}`,
        { status }
      );
      return res.data;
    },
    onSuccess: (_, { status }) => {
      const label = status === "ACTIVE" ? "activated" : status === "INACTIVE" ? "deactivated" : "archived";
      toast.success(`Meal ${label}`);
      qc.invalidateQueries({ queryKey });
    },
    onError: (e) => {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Failed to update meal status. Please try again."
      );
    },
  });

  const handleSubmit = (v: MealFormValues) => {
    if (editing) {
      updateMutation.mutate({ id: editing.id, values: v });
    } else {
      createMutation.mutate(v);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (m: MealConfiguration) => {
    setEditing(m);
    setFormOpen(true);
  };

  // Filtering
  const filtered = React.useMemo(() => {
    if (!data) return [];
    return data.filter((m) => {
      if (typeFilter !== "ALL" && m.mealType !== typeFilter) return false;
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          m.name.toLowerCase().includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          (m.description || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, typeFilter, statusFilter, search]);

  const submitting =
    createMutation.isPending || updateMutation.isPending;

  // Filter bar
  const filterBar = (
    <div className="flex flex-col gap-3">
      <div className="flex-1">
        <GlassInput
          placeholder="Search meals by name or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          icon={<Search className="h-4 w-4" />}
        />
      </div>
      <div className="flex items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-11 rounded-2xl glass-soft w-full">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {MEAL_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-11 rounded-2xl glass-soft w-full">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Action bar — centered transparent glass card button */}
      {isAdmin && (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              onClick={openCreate}
              size="lg"
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <Plus className="h-5 w-5" /> Create Meal
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* Filters */}
      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          {filterBar}
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
              <ConfigSkeleton />
            </motion.div>
          ) : isError ? (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <GlassCard className="p-8 text-center" hover={false}>
                <div className="grid place-items-center gap-3">
                  <div className="grid place-items-center h-14 w-14 rounded-3xl bg-destructive/15">
                    <AlertCircle className="h-7 w-7 text-destructive" />
                  </div>
                  <p className="font-semibold text-lg">
                    Couldn&apos;t load meal configurations
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
                      qc.invalidateQueries({ queryKey: ["meals", "config"] })
                    }
                  >
                    Retry
                  </GlassButton>
                </div>
              </GlassCard>
            </motion.div>
          ) : filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <GlassCard className="p-10 text-center" hover={false}>
                <div className="grid place-items-center gap-3">
                  <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/40">
                    <Utensils className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-lg">
                    {data && data.length > 0
                      ? "No meals match your filters"
                      : "No meals configured yet"}
                  </p>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    {data && data.length > 0
                      ? "Try adjusting your search or filters."
                      : isAdmin
                        ? "Create your first meal configuration to get started."
                        : "Your administrator hasn't configured any meals yet."}
                  </p>
                  {isAdmin &&
                    (data && data.length > 0 ? (
                      <GlassButton
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearch("");
                          setTypeFilter("ALL");
                          setStatusFilter("ALL");
                        }}
                      >
                        Clear filters
                      </GlassButton>
                    ) : (
                      <GlassButton size="sm" onClick={openCreate}>
                        <Plus className="h-4 w-4" /> Create Meal
                      </GlassButton>
                    ))}
                </div>
              </GlassCard>
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <StaggerGroup className="grid-cards gap-4">
                {filtered.map((m) => (
                  <StaggerItem key={m.id} className="h-full">
                    <MealConfigCard
                      meal={m}
                      isAdmin={!!isAdmin}
                      onEdit={() => openEdit(m)}
                      onDelete={() => setDeleteTarget(m)}
                      onStatusChange={(status) =>
                        statusMutation.mutate({ id: m.id, status })
                      }
                      statusLoading={
                        statusMutation.isPending &&
                        statusMutation.variables?.id === m.id
                      }
                    />
                  </StaggerItem>
                ))}
              </StaggerGroup>
            </motion.div>
          )}
        </AnimatePresence>
      </StaggerItem>

      {/* Create / Edit form — Dialog on desktop, bottom Sheet on mobile */}
      <AnimatePresence>
        {formOpen && (
          isMobile ? (
            <Sheet
              key="sheet"
              open={formOpen}
              onOpenChange={(o) => {
                setFormOpen(o);
                if (!o) setEditing(null);
              }}
            >
              <SheetContent
                side="bottom"
                className="glass-strong max-h-[92vh] flex flex-col rounded-t-3xl safe-bottom"
              >
                <SheetHeader>
                  <SheetTitle>
                    {editing ? "Edit meal" : "Create new meal"}
                  </SheetTitle>
                  <SheetDescription>
                    {editing
                      ? `Update configuration for ${editing.displayName}`
                      : "Configure a new meal type for your residents."}
                  </SheetDescription>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto px-4 pb-2">
                  <MealForm
                    values={
                      editing
                        ? ({
                            name: editing.name,
                            displayName: editing.displayName,
                            description: editing.description || "",
                            icon: editing.icon,
                            color: editing.color,
                            mealType: editing.mealType as MealFormValues["mealType"],
                            displayOrder: editing.displayOrder,
                            defaultState: editing.defaultState as MealFormValues["defaultState"],
                            defaultVisibility:
                              editing.defaultVisibility as MealFormValues["defaultVisibility"],
                            cutoffStrategy:
                              editing.cutoffStrategy as MealFormValues["cutoffStrategy"],
                            cutoffTime: editing.cutoffTime,
                            cutoffOffsetMinutes: editing.cutoffOffsetMinutes,
                            startTime: editing.startTime,
                            endTime: editing.endTime,
                            notes: editing.notes || "",
                          } as MealFormValues)
                        : null
                    }
                    onSubmit={handleSubmit}
                    onCancel={() => {
                      setFormOpen(false);
                      setEditing(null);
                    }}
                    submitting={submitting}
                    submitLabel={editing ? "Save changes" : "Create meal"}
                  />
                </div>
              </SheetContent>
            </Sheet>
          ) : (
            <Dialog
              key="dialog"
              open={formOpen}
              onOpenChange={(o) => {
                setFormOpen(o);
                if (!o) setEditing(null);
              }}
            >
              <DialogContent className="glass-strong max-w-2xl max-h-[92vh] flex flex-col">
                <DialogHeader>
                  <DialogTitle>
                    {editing ? "Edit meal" : "Create new meal"}
                  </DialogTitle>
                  <DialogDescription>
                    {editing
                      ? `Update configuration for ${editing.displayName}`
                      : "Configure a new meal type for your residents."}
                  </DialogDescription>
                </DialogHeader>
                <MealForm
                  values={
                    editing
                      ? ({
                          name: editing.name,
                          displayName: editing.displayName,
                          description: editing.description || "",
                          icon: editing.icon,
                          color: editing.color,
                          mealType: editing.mealType as MealFormValues["mealType"],
                          displayOrder: editing.displayOrder,
                          defaultState: editing.defaultState as MealFormValues["defaultState"],
                          defaultVisibility:
                            editing.defaultVisibility as MealFormValues["defaultVisibility"],
                          cutoffStrategy:
                            editing.cutoffStrategy as MealFormValues["cutoffStrategy"],
                          cutoffTime: editing.cutoffTime,
                          cutoffOffsetMinutes: editing.cutoffOffsetMinutes,
                          startTime: editing.startTime,
                          endTime: editing.endTime,
                          notes: editing.notes || "",
                        } as MealFormValues)
                      : null
                  }
                  onSubmit={handleSubmit}
                  onCancel={() => {
                    setFormOpen(false);
                    setEditing(null);
                  }}
                  submitting={submitting}
                  submitLabel={editing ? "Save changes" : "Create meal"}
                />
              </DialogContent>
            </Dialog>
          ))
        }
      </AnimatePresence>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this meal?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">
                <span className="font-medium text-foreground">
                  {deleteTarget?.displayName}
                </span>{" "}
                will be permanently deleted along with all related meal entries, history, and overrides. This cannot be undone.
                meal entries will remain accessible.
              </span>
              <span className="block mt-2 text-warning">
                This action is irreversible.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete meal"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaggerGroup>
  );
}

export default MealsConfigView;
