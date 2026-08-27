"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Save,
  ShieldCheck,
  Building2,
  Flag,
  CreditCard,
  Bell,
  Lock,
  Palette,
  Sparkles,
  KeyRound,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type SettingType = "TEXT" | "NUMBER" | "BOOLEAN" | "JSON";
type SettingCategory =
  | "INSTITUTION"
  | "FEATURE_FLAG"
  | "BILLING"
  | "NOTIFICATIONS"
  | "SECURITY"
  | "UI"
  | "GENERAL";

type Setting = {
  id: string;
  key: string;
  value: string;
  category: SettingCategory;
  type: SettingType;
  description?: string | null;
  isPublic: boolean;
};

const CATEGORY_META: Record<SettingCategory, { icon: typeof Flag; label: string; description: string }> = {
  INSTITUTION: { icon: Building2, label: "Institution", description: "Organization profile & branding" },
  FEATURE_FLAG: { icon: Flag, label: "Feature Flags", description: "Toggle modules on or off" },
  BILLING: { icon: CreditCard, label: "Billing", description: "Billing cycles, currencies & rates" },
  NOTIFICATIONS: { icon: Bell, label: "Notifications", description: "Notification routing & defaults" },
  SECURITY: { icon: Lock, label: "Security", description: "Auth, sessions & permissions" },
  UI: { icon: Palette, label: "UI", description: "Theming, layout & display options" },
  GENERAL: { icon: SettingsIcon, label: "General", description: "Miscellaneous configuration" },
};

const CATEGORY_ORDER: SettingCategory[] = [
  "FEATURE_FLAG",
  "INSTITUTION",
  "BILLING",
  "NOTIFICATIONS",
  "SECURITY",
  "UI",
  "GENERAL",
];

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = await promise;
  if (res && typeof res === "object" && "success" in res && "data" in (res as Record<string, unknown>)) {
    return (res as unknown as { data: T }).data;
  }
  return res as T;
}

export function SettingsView() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "ADMIN";
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<SettingCategory>("FEATURE_FLAG");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => unwrap<Setting[]>(api.get("/settings")),
    enabled: isAdmin,
  });

  const updateMutation = useMutation({
    mutationFn: (s: Setting) =>
      unwrap<Setting>(
        api.post("/settings", {
          key: s.key,
          value: drafts[s.id] ?? s.value,
          category: s.category,
          type: s.type,
          description: s.description,
          isPublic: s.isPublic,
        })
      ),
    onMutate: async (s) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<Setting[]>(["settings"]);
      if (prev) {
        const next = prev.map((p) =>
          p.id === s.id ? { ...p, value: drafts[s.id] ?? s.value } : p
        );
        qc.setQueryData<Setting[]>(["settings"], next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
      toast.error("Failed to save setting");
    },
    onSuccess: (updated) => {
      toast.success(`Saved "${(updated as Setting)?.key ?? "setting"}"`);
      setDrafts((d) => {
        const next = { ...d };
        delete next[(updated as Setting)?.id];
        return next;
      });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (key: string) => unwrap<{ success: boolean }>(api.delete(`/settings/${encodeURIComponent(key)}`)),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: ["settings"] });
      const prev = qc.getQueryData<Setting[]>(["settings"]);
      if (prev) {
        qc.setQueryData<Setting[]>(["settings"], prev.filter((p) => p.key !== key));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["settings"], ctx.prev);
      toast.error("Failed to delete setting");
    },
    onSuccess: (_d, key) => toast.success(`Deleted "${key}"`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  if (!isAdmin) {
    return (
      <GlassCard className="p-10 text-center" hover={false}>
        <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold">Admins only</h3>
        <p className="text-sm text-muted-foreground mt-1">
          You need administrator privileges to view system settings.
        </p>
      </GlassCard>
    );
  }

  const settings = data ?? [];
  const grouped = (cat: SettingCategory) => settings.filter((s) => s.category === cat);
  const availableCats = CATEGORY_ORDER.filter((c) => grouped(c).length > 0 || c === activeCat);
  const currentCat = availableCats.includes(activeCat) ? activeCat : availableCats[0];

  const setDraft = (id: string, value: string) =>
    setDrafts((d) => ({ ...d, [id]: value }));

  const isDirty = (s: Setting) => drafts[s.id] !== undefined && drafts[s.id] !== s.value;

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Action bar — centered transparent glass card button */}
      <StaggerItem>
        <div className="flex items-center justify-center">
          <GlassButton
            variant="ghost"
            size="lg"
            onClick={() => setAddOpen(true)}
            className="shrink-0 glass text-primary hover:text-primary font-semibold"
          >
            <Plus className="h-5 w-5" />
            Add Setting
          </GlassButton>
        </div>
      </StaggerItem>

      {/* Body */}
      <StaggerItem>
        <Tabs value={currentCat} onValueChange={(v) => setActiveCat(v as SettingCategory)}>
          <div className="overflow-x-auto no-scrollbar pb-1">
            <TabsList className="bg-muted/40 h-auto p-1 gap-1">
              {availableCats.map((cat) => {
                const meta = CATEGORY_META[cat];
                const Icon = meta.icon;
                return (
                  <TabsTrigger
                    key={cat}
                    value={cat}
                    className="rounded-2xl px-3 py-1.5 text-xs gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {meta.label}
                    <span className="ml-1 text-[10px] bg-muted-foreground/15 text-muted-foreground rounded-full px-1.5 py-0.5 leading-none data-[state=active]:bg-primary-foreground/20 data-[state=active]:text-primary-foreground">
                      {grouped(cat).length}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {isLoading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <ShimmerSkeleton key={i} className="h-20" />
              ))}
            </div>
          ) : (
            availableCats.map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const items = grouped(cat);
              return (
                <TabsContent key={cat} value={cat} className="mt-4 space-y-3">
                  {items.length === 0 ? (
                    <GlassCard className="p-8 text-center" hover={false}>
                      <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        No settings in this category yet.
                      </p>
                    </GlassCard>
                  ) : (
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {items.map((s) => (
                          <motion.div
                            key={s.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={{ type: "spring", stiffness: 280, damping: 26 }}
                          >
                            <SettingRow
                              setting={s}
                              draft={drafts[s.id]}
                              isDirty={isDirty(s)}
                              onDraft={(v) => setDraft(s.id, v)}
                              onSave={() => updateMutation.mutate(s)}
                              onDelete={() => deleteMutation.mutate(s.key)}
                              saving={updateMutation.isPending}
                              deleting={deleteMutation.isPending}
                              canDelete={role === "ADMIN"}
                            />
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </TabsContent>
              );
            })
          )}
        </Tabs>
      </StaggerItem>

      <AddSettingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["settings"] })}
      />
    </StaggerGroup>
  );
}

function SettingRow({
  setting,
  draft,
  isDirty,
  onDraft,
  onSave,
  onDelete,
  saving,
  deleting,
  canDelete,
}: {
  setting: Setting;
  draft?: string;
  isDirty: boolean;
  onDraft: (v: string) => void;
  onSave: () => void;
  onDelete: () => void;
  saving: boolean;
  deleting: boolean;
  canDelete: boolean;
}) {
  const isFlag = setting.category === "FEATURE_FLAG" || setting.type === "BOOLEAN";
  const value = draft ?? setting.value;
  const isBoolValue = setting.type === "BOOLEAN" && (value === "true" || value === "false");
  const boolOn = value === "true";

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono px-2 py-0.5 rounded-md bg-muted/60 text-foreground">
              {setting.key}
            </code>
            <Badge variant="outline" className="text-[10px]">
              {setting.type}
            </Badge>
            {setting.isPublic ? (
              <Badge variant="secondary" className="text-[10px] bg-success/15 text-success">
                Public
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                Private
              </Badge>
            )}
          </div>
          {setting.description && (
            <p className="text-xs text-muted-foreground mt-1.5">{setting.description}</p>
          )}
        </div>
        {canDelete && (
          <GlassButton
            variant="ghost"
            size="icon"
            onClick={onDelete}
            loading={deleting}
            className="shrink-0 hover:text-destructive"
            aria-label="Delete setting"
          >
            {!deleting && <Trash2 className="h-4 w-4" />}
          </GlassButton>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex-1">
          {isFlag && isBoolValue ? (
            <div className="glass-soft rounded-2xl px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={boolOn}
                  onCheckedChange={(c) => onDraft(c ? "true" : "false")}
                  disabled={saving}
                />
                <div>
                  <p className="text-sm font-medium">
                    {boolOn ? "Enabled" : "Disabled"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Feature is currently {boolOn ? "ON" : "OFF"}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  "text-[10px] px-2 py-1 rounded-full font-medium",
                  boolOn ? "bg-success/20 text-success" : "bg-muted text-muted-foreground"
                )}
              >
                {boolOn ? "ON" : "OFF"}
              </span>
            </div>
          ) : setting.type === "NUMBER" ? (
            <GlassInput
              type="number"
              value={value}
              onChange={(e) => onDraft(e.target.value)}
              disabled={saving}
              icon={<KeyRound className="h-4 w-4" />}
            />
          ) : setting.type === "JSON" ? (
            <GlassTextarea
              rows={3}
              value={value}
              onChange={(e) => onDraft(e.target.value)}
              disabled={saving}
              className="font-mono text-xs"
            />
          ) : (
            <GlassInput
              value={value}
              onChange={(e) => onDraft(e.target.value)}
              disabled={saving}
              icon={<KeyRound className="h-4 w-4" />}
            />
          )}
        </div>
        <GlassButton
          variant={isDirty ? "primary" : "secondary"}
          size="md"
          onClick={onSave}
          loading={saving}
          disabled={!isDirty}
          className="w-full"
        >
          <Save className="h-4 w-4" />
          {isDirty ? "Save" : "Saved"}
        </GlassButton>
      </div>
    </GlassCard>
  );
}

function AddSettingDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    key: "",
    value: "",
    category: "FEATURE_FLAG" as SettingCategory,
    type: "TEXT" as SettingType,
    description: "",
    isPublic: false,
  });
  const [saving, setSaving] = useState(false);

  const reset = () =>
    setForm({
      key: "",
      value: "",
      category: "FEATURE_FLAG",
      type: "TEXT",
      description: "",
      isPublic: false,
    });

  const submit = async () => {
    if (!form.key.trim()) {
      toast.error("Key is required");
      return;
    }
    try {
      setSaving(true);
      const isBool = form.type === "BOOLEAN";
      const value = isBool ? (form.value === "true" ? "true" : "false") : form.value;
      await unwrap<Setting>(
        api.post("/settings", { ...form, value })
      );
      toast.success(`Created setting "${form.key}"`);
      qc.invalidateQueries({ queryKey: ["settings"] });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error)?.message || "Failed to create setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-lg">Add Setting</DialogTitle>
          <DialogDescription>
            Create or update a system configuration entry.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <GlassInput
            label="Key"
            placeholder="e.g. feature.calendar.enabled"
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            disabled={saving}
            hint="Use dot.notation for grouping"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Category</label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v as SettingCategory }))}
              >
                <SelectTrigger className="w-full glass-soft border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_ORDER.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Type</label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((f) => ({ ...f, type: v as SettingType }))}
              >
                <SelectTrigger className="w-full glass-soft border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TEXT">Text</SelectItem>
                  <SelectItem value="NUMBER">Number</SelectItem>
                  <SelectItem value="BOOLEAN">Boolean</SelectItem>
                  <SelectItem value="JSON">JSON</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.type === "BOOLEAN" ? (
            <div className="glass-soft rounded-2xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm">Value</span>
              <Switch
                checked={form.value === "true"}
                onCheckedChange={(c) => setForm((f) => ({ ...f, value: c ? "true" : "false" }))}
              />
            </div>
          ) : (
            <GlassInput
              label="Value"
              placeholder={form.type === "NUMBER" ? "0" : "value"}
              type={form.type === "NUMBER" ? "number" : "text"}
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              disabled={saving}
            />
          )}

          <GlassTextarea
            label="Description (optional)"
            rows={2}
            placeholder="What does this setting control?"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            disabled={saving}
          />

          <label className="glass-soft rounded-2xl px-4 py-3 flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm font-medium">Public</p>
              <p className="text-[10px] text-muted-foreground">Visible to non-admin users</p>
            </div>
            <Switch
              checked={form.isPublic}
              onCheckedChange={(c) => setForm((f) => ({ ...f, isPublic: c }))}
            />
          </label>
        </div>

        <DialogFooter className="gap-2">
          <GlassButton
            variant="ghost"
            size="md"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            <X className="h-4 w-4" />
            Cancel
          </GlassButton>
          <GlassButton variant="primary" size="md" onClick={submit} loading={saving}>
            <Plus className="h-4 w-4" />
            Create
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
