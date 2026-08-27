"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Search,
  Plus,
  Shield,
  Lock,
  Trash2,
  Check,
  X,
  Database,
  Sparkles,
  Filter,
  Hash,
  DollarSign,
  Percent,
  Type,
  ToggleLeft,
  Pencil,
  Save,
  AlertCircle,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useAuthStore } from "@/stores/use-auth-store";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type VariableType =
  | "NUMBER"
  | "CURRENCY"
  | "PERCENTAGE"
  | "TEXT"
  | "BOOLEAN";

type Variable = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  type: VariableType;
  value: string;
  unit?: string | null;
  category: string;
  isSystem: boolean;
  isProtected: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> = { success: boolean; data: T };

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const TYPE_META: Record<
  VariableType,
  { icon: typeof Hash; tint: string; color: string }
> = {
  NUMBER: { icon: Hash, tint: "bg-info/15 text-info", color: "var(--info)" },
  CURRENCY: {
    icon: DollarSign,
    tint: "bg-success/15 text-success",
    color: "var(--success)",
  },
  PERCENTAGE: {
    icon: Percent,
    tint: "bg-warning/15 text-warning",
    color: "var(--warning)",
  },
  TEXT: {
    icon: Type,
    tint: "bg-primary/15 text-primary",
    color: "var(--primary)",
  },
  BOOLEAN: {
    icon: ToggleLeft,
    tint: "bg-secondary text-foreground",
    color: "var(--foreground)",
  },
};

const PRESET_CATEGORIES = [
  "GENERAL",
  "MEAL_RATES",
  "BILLING",
  "PENALTIES",
  "DISCOUNTS",
  "SYSTEM",
];

// ─────────────────────────────────────────────────────────────
// Form schema
// ─────────────────────────────────────────────────────────────

const createSchema = z.object({
  key: z
    .string()
    .min(2, "Key must be at least 2 characters")
    .regex(
      /^[a-z0-9_.-]+$/i,
      "Use letters, numbers, dots, dashes, underscores only"
    ),
  name: z.string().min(2, "Name must be at least 2 characters"),
  type: z.enum([
    "NUMBER",
    "CURRENCY",
    "PERCENTAGE",
    "TEXT",
    "BOOLEAN",
  ]),
  value: z.string().min(1, "Value is required"),
  unit: z.string().optional(),
  category: z
    .string()
    .min(1, "Category required"),
  description: z.string().optional(),
});

type CreateForm = z.infer<typeof createSchema>;

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function VariablesView() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const isAdmin = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [catFilter, setCatFilter] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: resp, isLoading } = useQuery({
    queryKey: ["variables"],
    queryFn: () => api.get<ApiResponse<Variable[]>>("/variables"),
  });

  const variables = resp?.data ?? [];

  const createMutation = useMutation({
    mutationFn: (data: CreateForm) =>
      api.post<ApiResponse<Variable>>("/variables", data),
    onSuccess: () => {
      toast.success("Variable created successfully");
      queryClient.invalidateQueries({ queryKey: ["variables"] });
      setCreateOpen(false);
    },
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Failed to create variable"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      api.put<ApiResponse<Variable>>(`/variables/${id}`, { value }),
    onSuccess: () => {
      toast.success("Variable updated");
      queryClient.invalidateQueries({ queryKey: ["variables"] });
    },
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Failed to update variable"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<{ success: boolean }>>(`/variables/${id}`),
    onSuccess: () => {
      toast.success("Variable archived");
      queryClient.invalidateQueries({ queryKey: ["variables"] });
    },
    onError: (e: { message?: string }) =>
      toast.error(e.message || "Failed to delete variable"),
  });

  // Categories — derive from existing variables plus presets
  const categories = useMemo(() => {
    const set = new Set<string>(PRESET_CATEGORIES);
    variables.forEach((v) => set.add(v.category));
    return Array.from(set).sort();
  }, [variables]);

  // Filter + group
  const grouped = useMemo(() => {
    const filtered = variables.filter((v) => {
      if (search) {
        const q = search.toLowerCase();
        const hit =
          v.name.toLowerCase().includes(q) ||
          v.key.toLowerCase().includes(q) ||
          (v.description ?? "").toLowerCase().includes(q) ||
          v.category.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (typeFilter !== "ALL" && v.type !== typeFilter) return false;
      if (catFilter !== "ALL" && v.category !== catFilter) return false;
      return true;
    });

    const groups: Record<string, Variable[]> = {};
    filtered.forEach((v) => {
      if (!groups[v.category]) groups[v.category] = [];
      groups[v.category].push(v);
    });
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
  }, [variables, search, typeFilter, catFilter]);

  const stats = {
    total: variables.length,
    system: variables.filter((v) => v.isSystem).length,
    custom: variables.filter((v) => !v.isSystem).length,
    categories: new Set(variables.map((v) => v.category)).size,
  };

  if (isLoading) return <VariablesSkeleton />;

  return (
    <StaggerGroup className="space-y-4">
      {/* Action bar — centered transparent glass card button */}
      {isAdmin && (
        <StaggerItem>
          <div className="flex items-center justify-center">
            <GlassButton
              variant="ghost"
              onClick={() => setCreateOpen(true)}
              size="lg"
              className="shrink-0 glass text-primary hover:text-primary font-semibold"
            >
              <Plus className="h-5 w-5" />
              Create Variable
            </GlassButton>
          </div>
        </StaggerItem>
      )}

      {/* Stats bar */}
      <StaggerItem>
        <div className="grid-kpi gap-3">
          <StatCard
            icon={Database}
            label="Total"
            value={stats.total}
            color="primary"
          />
          <StatCard
            icon={Shield}
            label="System"
            value={stats.system}
            color="info"
          />
          <StatCard
            icon={Sparkles}
            label="Custom"
            value={stats.custom}
            color="success"
          />
          <StatCard
            icon={Filter}
            label="Categories"
            value={stats.categories}
            color="warning"
          />
        </div>
      </StaggerItem>

      {/* Search + filters */}
      <StaggerItem>
        <GlassCard className="p-4" hover={false}>
          <div className="flex flex-col gap-3">
            <div className="flex-1">
              <GlassInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, key, or description..."
                icon={<Search />}
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full h-12 glass-soft rounded-2xl border-2 border-transparent">
                <Filter className="h-4 w-4 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                <SelectItem value="NUMBER">Number</SelectItem>
                <SelectItem value="CURRENCY">Currency</SelectItem>
                <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                <SelectItem value="TEXT">Text</SelectItem>
                <SelectItem value="BOOLEAN">Boolean</SelectItem>
              </SelectContent>
            </Select>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-full h-12 glass-soft rounded-2xl border-2 border-transparent">
                <Tag className="h-4 w-4 mr-1 text-muted-foreground" />
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Grouped list */}
      {grouped.length === 0 ? (
        <StaggerItem>
          <GlassCard className="p-10 text-center" hover={false}>
            <div className="grid place-items-center h-16 w-16 rounded-3xl bg-muted/40 mx-auto mb-4">
              <Database className="h-8 w-8 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-lg mb-1">
              {variables.length === 0
                ? "No variables yet"
                : "No matching variables"}
            </h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {variables.length === 0
                ? "Create your first variable to start configuring system behaviour."
                : "Try adjusting your search or filter criteria."}
            </p>
            {isAdmin && variables.length === 0 && (
              <GlassButton
                className="mt-4"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="h-4 w-4" /> Create Variable
              </GlassButton>
            )}
          </GlassCard>
        </StaggerItem>
      ) : (
        <StaggerItem>
          <Accordion
            type="multiple"
            defaultValue={grouped[0] ? [grouped[0][0]] : []}
            className="space-y-3"
          >
            {grouped.map(([category, vars]) => (
              <AccordionItem
                key={category}
                value={category}
                className="glass rounded-3xl overflow-hidden border-b-0 px-4"
              >
                <AccordionTrigger className="hover:no-underline py-4">
                  <div className="flex items-center gap-3">
                    <div className="grid place-items-center h-9 w-9 rounded-2xl bg-primary/15">
                      <Database className="h-4 w-4 text-primary" />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-sm tracking-wide">
                        {category}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {vars.length} variable
                        {vars.length === 1 ? "" : "s"} ·{" "}
                        {vars.filter((v) => v.isSystem).length} system
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid-cards gap-3 pb-3 pt-1">
                    {vars.map((v) => (
                      <VariableCard
                        key={v.id}
                        variable={v}
                        isAdmin={isAdmin}
                        onSave={(value) =>
                          updateMutation.mutate({ id: v.id, value })
                        }
                        onDelete={() => deleteMutation.mutate(v.id)}
                        saving={
                          updateMutation.isPending &&
                          updateMutation.variables?.id === v.id
                        }
                        deleting={
                          deleteMutation.isPending &&
                          deleteMutation.variables === v.id
                        }
                      />
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </StaggerItem>
      )}

      {/* Create dialog */}
      <CreateVariableDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(d) => createMutation.mutate(d)}
        loading={createMutation.isPending}
        categories={categories}
      />
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: typeof Database;
  label: string;
  value: number;
  color: "primary" | "info" | "success" | "warning";
}) {
  const colorVar =
    color === "primary"
      ? "var(--primary)"
      : color === "info"
        ? "var(--info)"
        : color === "success"
          ? "var(--success)"
          : "var(--warning)";
  return (
    <GlassCard
      className="p-4 relative overflow-hidden"
      glow={color === "info" ? "primary" : color}
      whileHover={{ y: -2 }}
    >
      <div
        className="absolute -top-8 -right-8 h-24 w-24 rounded-full blur-3xl opacity-25"
        style={{ background: colorVar }}
      />
      <div className="relative flex items-center gap-3">
        <div
          className="grid place-items-center h-10 w-10 rounded-2xl shrink-0"
          style={{
            background: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
          }}
        >
          <Icon className="h-5 w-5" style={{ color: colorVar }} />
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums leading-none">
            {value}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Variable card with inline edit
// ─────────────────────────────────────────────────────────────

function VariableCard({
  variable,
  isAdmin,
  onSave,
  onDelete,
  saving,
  deleting,
}: {
  variable: Variable;
  isAdmin: boolean;
  onSave: (value: string) => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(variable.value);

  // NOTE: draft is re-synced from variable.value each time the user opens the
  // editor (see startEdit below). External refetches that update variable.value
  // while not editing don't affect the (hidden) draft, which is the desired
  // behaviour.

  const typeMeta = TYPE_META[variable.type] ?? TYPE_META.TEXT;
  const TypeIcon = typeMeta.icon;
  const isBool = variable.type === "BOOLEAN";
  const boolValue = variable.value === "true";

  const startEdit = () => {
    setDraft(variable.value);
    setEditing(true);
  };
  const cancelEdit = () => {
    setDraft(variable.value);
    setEditing(false);
  };
  const save = () => {
    if (draft === variable.value) {
      setEditing(false);
      return;
    }
    onSave(draft);
    setEditing(false);
  };

  const canEditValue = isAdmin;
  const canDelete = isAdmin && !variable.isProtected && !variable.isSystem;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="glass-soft rounded-3xl p-4 relative overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h4 className="font-semibold text-sm truncate">
              {variable.name}
            </h4>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium",
                typeMeta.tint
              )}
            >
              <TypeIcon className="h-3 w-3" />
              {variable.type}
            </span>
            {variable.isSystem && (
              <Badge
                variant="secondary"
                className="h-5 text-[10px] gap-1 px-1.5"
              >
                <Shield className="h-3 w-3" /> System
              </Badge>
            )}
            {variable.isProtected && (
              <Badge
                variant="outline"
                className="h-5 text-[10px] gap-1 px-1.5 border-warning/40 text-warning"
              >
                <Lock className="h-3 w-3" /> Protected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-2">
            <code className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
              {variable.key}
            </code>
            {variable.unit && (
              <span className="text-[10px] text-muted-foreground">
                · unit: <strong>{variable.unit}</strong>
              </span>
            )}
          </div>
          {variable.description && (
            <p className="text-xs text-muted-foreground/80 line-clamp-2 mb-2">
              {variable.description}
            </p>
          )}
        </div>
      </div>

      {/* Value display / inline edit */}
      <div className="mt-2">
        {isBool ? (
          // BOOLEAN — switch (only editable by admin)
          <div className="flex items-center justify-between glass rounded-2xl px-3 py-2">
            <span className="text-[11px] text-muted-foreground">
              Current state
            </span>
            <Switch
              checked={boolValue}
              disabled={!canEditValue || saving}
              onCheckedChange={(c) => {
                if (canEditValue) onSave(c ? "true" : "false");
              }}
            />
          </div>
        ) : editing ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") cancelEdit();
              }}
              className="flex-1 bg-transparent glass rounded-2xl px-3 py-2 text-sm font-medium tabular-nums outline-none focus:ring-2 focus:ring-primary/40"
            />
            <GlassButton
              size="icon"
              variant="success"
              onClick={save}
              loading={saving}
              aria-label="Save"
            >
              <Check className="h-4 w-4" />
            </GlassButton>
            <GlassButton
              size="icon"
              variant="ghost"
              onClick={cancelEdit}
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </GlassButton>
          </div>
        ) : (
          <div className="flex items-center justify-between glass rounded-2xl px-3 py-2">
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Value
              </span>
              <span className="text-base font-semibold tabular-nums truncate">
                {variable.value}
              </span>
              {variable.unit && (
                <span className="text-xs text-muted-foreground">
                  {variable.unit}
                </span>
              )}
            </div>
            {canEditValue && (
              <GlassButton
                size="icon"
                variant="ghost"
                onClick={startEdit}
                aria-label="Edit value"
                className="h-8 w-8"
              >
                <Pencil className="h-3.5 w-3.5" />
              </GlassButton>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      {canDelete && (
        <div className="mt-2 flex justify-end">
          <GlassButton
            size="sm"
            variant="ghost"
            onClick={onDelete}
            loading={deleting}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Archive
          </GlassButton>
        </div>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Create variable dialog
// ─────────────────────────────────────────────────────────────

function CreateVariableDialog({
  open,
  onOpenChange,
  onSubmit,
  loading,
  categories,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: CreateForm) => void;
  loading: boolean;
  categories: string[];
}) {
  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      key: "",
      name: "",
      type: "NUMBER",
      value: "",
      unit: "",
      category: "GENERAL",
      description: "",
    },
  });

  const type = useWatch({ control: form.control, name: "type" });
  const isBool = type === "BOOLEAN";

  useEffect(() => {
    if (!open) {
      form.reset();
    }
  }, [open, form]);

  const submit = (data: CreateForm) => {
    onSubmit(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong rounded-3xl max-w-md max-h-[90vh] overflow-y-auto no-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Create Variable
          </DialogTitle>
          <DialogDescription>
            Add a new configurable variable to the system. Keys must be unique.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(submit)}
          className="space-y-4 pt-2"
        >
          <GlassInput
            label="Name"
            placeholder="e.g., Breakfast Rate"
            error={form.formState.errors.name?.message}
            {...form.register("name")}
          />

          <GlassInput
            label="Key"
            placeholder="e.g., breakfast_rate"
            hint="Letters, numbers, dots, dashes, underscores only"
            error={form.formState.errors.key?.message}
            trailing={
              <code className="text-[10px] font-mono text-muted-foreground">
                /^[a-z0-9_.-]+$/i
              </code>
            }
            {...form.register("key")}
          />

          <div>
            <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
              Type
            </label>
            <Controller
              control={form.control}
              name="type"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <SelectTrigger className="w-full h-12 glass-soft rounded-2xl border-2 border-transparent">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NUMBER">Number</SelectItem>
                    <SelectItem value="CURRENCY">Currency</SelectItem>
                    <SelectItem value="PERCENTAGE">Percentage</SelectItem>
                    <SelectItem value="TEXT">Text</SelectItem>
                    <SelectItem value="BOOLEAN">Boolean</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          {isBool ? (
            <div>
              <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
                Value
              </label>
              <Controller
                control={form.control}
                name="value"
                render={({ field }) => (
                  <div className="flex items-center gap-3 glass-soft rounded-2xl px-4 py-3 h-12">
                    <Switch
                      checked={field.value === "true"}
                      onCheckedChange={(c) =>
                        field.onChange(c ? "true" : "false")
                      }
                    />
                    <span className="text-sm font-medium">
                      {field.value === "true" ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                )}
              />
            </div>
          ) : (
            <GlassInput
              label="Value"
              placeholder={
                type === "CURRENCY"
                  ? "e.g., 50.00"
                  : type === "PERCENTAGE"
                    ? "e.g., 12.5"
                    : type === "NUMBER"
                      ? "e.g., 4"
                      : "Enter value"
              }
              error={form.formState.errors.value?.message}
              {...form.register("value")}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <GlassInput
              label="Unit (optional)"
              placeholder="e.g., ₹/meal"
              {...form.register("unit")}
            />
            <div>
              <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
                Category
              </label>
              <Controller
                control={form.control}
                name="category"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger className="w-full h-12 glass-soft rounded-2xl border-2 border-transparent">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
              Description (optional)
            </label>
            <GlassTextarea
              placeholder="What does this variable control?"
              className="min-h-[80px]"
              {...form.register("description")}
            />
          </div>

          <div className="flex items-center gap-2 p-3 rounded-2xl bg-info/10 text-info text-[11px]">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Custom variables can be edited or archived later. System variables
            are locked to preserve formula integrity.
          </div>

          <DialogFooter className="gap-2">
            <GlassButton
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </GlassButton>
            <GlassButton type="submit" loading={loading}>
              <Save className="h-4 w-4" />
              Create Variable
            </GlassButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────

function VariablesSkeleton() {
  return (
    <div className="space-y-4">
      <ShimmerSkeleton className="h-28" />
      <div className="grid-kpi gap-3">
        <ShimmerSkeleton className="h-20" />
        <ShimmerSkeleton className="h-20" />
        <ShimmerSkeleton className="h-20" />
        <ShimmerSkeleton className="h-20" />
      </div>
      <ShimmerSkeleton className="h-20" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ShimmerSkeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}
