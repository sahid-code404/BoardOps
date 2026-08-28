"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Palette,
  Check,
  RotateCcw,
  Save,
  Sparkles,
  Smartphone,
  Tablet,
  Type,
  CornerDownLeft,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { useThemeConfig, readableForeground, type ThemeConfig } from "@/providers/theme-config-provider";
import { useAuthStore } from "@/stores/use-auth-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Preset = {
  id: string;
  name: string;
  primary: string;
  accent: string;
  description: string;
};

const PRESETS: Preset[] = [
  { id: "violet", name: "Violet", primary: "#8b5cf6", accent: "#10b981", description: "Default — soft purple + emerald" },
  { id: "ocean", name: "Ocean", primary: "#06b6d4", accent: "#3b82f6", description: "Cyan + blue, cool & calm" },
  { id: "sunset", name: "Sunset", primary: "#f97316", accent: "#ec4899", description: "Orange + pink, warm" },
  { id: "forest", name: "Forest", primary: "#16a34a", accent: "#eab308", description: "Green + yellow, earthy" },
  { id: "rose", name: "Rose", primary: "#e11d48", accent: "#f59e0b", description: "Crimson + amber, bold" },
  { id: "midnight", name: "Midnight", primary: "#6366f1", accent: "#8b5cf6", description: "Indigo + violet, deep" },
  { id: "mono", name: "Graphite", primary: "#525252", accent: "#737373", description: "Neutral grayscale" },
  { id: "emerald", name: "Emerald", primary: "#059669", accent: "#0ea5e9", description: "Green + sky, fresh" },
];

const RADIUS_OPTIONS = [
  { value: "0.5rem", label: "Sharp", preview: "4px" },
  { value: "0.875rem", label: "Soft", preview: "8px" },
  { value: "1.25rem", label: "Default", preview: "12px" },
  { value: "1.75rem", label: "Round", preview: "18px" },
  { value: "2.25rem", label: "Pillow", preview: "24px" },
];

export function PersonalizationView() {
  const { theme, previewTheme, refresh } = useThemeConfig();
  const [draft, setLocal] = useState<ThemeConfig | null>(null);
  const local = draft ?? theme;
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);


  const dirty = JSON.stringify(local) !== JSON.stringify(theme);

  const applyPreset = (preset: Preset) => {
    const updated: ThemeConfig = {
      ...local,
      preset: preset.id,
      primary: preset.primary,
      primaryForeground: readableForeground(preset.primary),
      accent: preset.accent,
    };
    setLocal(updated);
    previewTheme(updated); // live preview
  };

  const updateColor = (key: "primary" | "accent" | "primaryForeground", value: string) => {
    const updated = { ...local, [key]: value };
    if (key === "primary") {
      updated.primaryForeground = readableForeground(value);
      updated.preset = "custom";
    }
    if (key === "accent") {
      updated.preset = "custom";
    }
    setLocal(updated);
    previewTheme(updated); // live preview
  };

  const updateRadius = (value: string) => {
    const updated = { ...local, radius: value };
    setLocal(updated);
    previewTheme(updated);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/theme", local);
      toast.success("Theme saved — applied to all users");
      await refresh();
      setLocal(null);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to save theme");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    const defaults: ThemeConfig = {
      primary: "#8b5cf6",
      primaryForeground: "#ffffff",
      accent: "#10b981",
      radius: "1.25rem",
      mode: "system",
      preset: "violet",
      glassMode: "on",
      blurIntensity: "normal",
      transparency: "medium",
    };
    setLocal(defaults);
    previewTheme(defaults);
    try {
      await api.put("/theme", defaults);
      toast.success("Theme reset to defaults");
      await refresh();
      setLocal(null);
    } catch (e: unknown) {
      toast.error("Failed to reset theme");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <ShimmerSkeleton className="h-40" />
        <div className="grid-cards gap-4">
          <ShimmerSkeleton className="h-64" />
          <ShimmerSkeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Header */}
      <StaggerItem>
        <GlassCard className="p-5" hover={false} glow="primary">
          <div className="flex flex-col justify-between gap-4">
            <div className="flex items-center gap-4">
              <div
                className="grid place-items-center h-12 w-12 rounded-3xl shrink-0"
                style={{ background: local.primary, color: local.primaryForeground }}
              >
                <Palette className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Personalization</h2>
              </div>
            </div>
            <div className="flex gap-2">
              <GlassButton variant="ghost" size="md" onClick={reset} disabled={!dirty && local.preset === "violet"}>
                <RotateCcw className="h-4 w-4" />
                Reset
              </GlassButton>
              <GlassButton size="md" onClick={save} loading={saving} disabled={!dirty}>
                <Save className="h-4 w-4" />
                Save Changes
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      </StaggerItem>

      <div className="grid-cards gap-4">
        {/* Left: Controls */}
        <div className="space-y-4">
          {/* Preset Themes */}
          <StaggerItem>
            <GlassCard className="p-5" hover={false}>
              <div className="flex items-center gap-2 mb-4">
                <Sparkles className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Preset Themes</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {PRESETS.map((preset) => {
                  const active = local.preset === preset.id;
                  return (
                    <motion.button
                      key={preset.id}
                      whileTap={{ scale: 0.96 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => applyPreset(preset)}
                      className={cn(
                        "relative text-left p-3 rounded-2xl transition-all border-2",
                        active ? "border-primary" : "border-border/40 glass-soft"
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div
                          className="h-8 w-8 rounded-xl shrink-0 grid place-items-center"
                          style={{ background: preset.primary }}
                        >
                          {active && <Check className="h-4 w-4 text-white" />}
                        </div>
                        <div
                          className="h-8 w-8 rounded-xl shrink-0"
                          style={{ background: preset.accent }}
                        />
                      </div>
                      <p className="text-sm font-medium">{preset.name}</p>
                      <p className="text-[10px] text-muted-foreground line-clamp-1">{preset.description}</p>
                    </motion.button>
                  );
                })}
              </div>
            </GlassCard>
          </StaggerItem>

          {/* Custom Colors */}
          <StaggerItem>
            <GlassCard className="p-5" hover={false}>
              <div className="flex items-center gap-2 mb-4">
                <Palette className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Custom Colors</h3>
              </div>
              <div className="space-y-4">
                <ColorPicker
                  label="Primary Color"
                  description="Used for buttons, active states, links, and highlights"
                  value={local.primary}
                  onChange={(v) => updateColor("primary", v)}
                />
                <ColorPicker
                  label="Accent Color"
                  description="Used for secondary highlights and chart accents"
                  value={local.accent}
                  onChange={(v) => updateColor("accent", v)}
                />
                <ColorPicker
                  label="Primary Foreground"
                  description="Text color on primary backgrounds (auto-calculated)"
                  value={local.primaryForeground}
                  onChange={(v) => updateColor("primaryForeground", v)}
                />
              </div>
            </GlassCard>
          </StaggerItem>

          {/* Corner Radius */}
          <StaggerItem>
            <GlassCard className="p-5" hover={false}>
              <div className="flex items-center gap-2 mb-4">
                <CornerDownLeft className="h-5 w-5 text-primary" />
                <h3 className="font-semibold">Corner Radius</h3>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {RADIUS_OPTIONS.map((opt) => {
                  const active = local.radius === opt.value;
                  return (
                    <motion.button
                      key={opt.value}
                      whileTap={{ scale: 0.94 }}
                      onClick={() => updateRadius(opt.value)}
                      className={cn(
                        "flex flex-col items-center gap-1.5 py-3 rounded-2xl border-2 transition-all",
                        active ? "border-primary bg-primary/10" : "border-border/40 glass-soft"
                      )}
                    >
                      <div
                        className={cn("h-6 w-6 border-2", active ? "border-primary" : "border-muted-foreground")}
                        style={{ borderRadius: opt.preview }}
                      />
                      <span className={cn("text-[10px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                        {opt.label}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            </GlassCard>
          </StaggerItem>
        </div>

        {/* Right: Live Preview */}
        <div className="space-y-4">
          <StaggerItem>
            <GlassCard className="p-5 sticky top-24" hover={false} glow="primary">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold">Live Preview</h3>
                </div>
                {dirty && (
                  <motion.span
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium"
                  >
                    Unsaved changes
                  </motion.span>
                )}
              </div>

              {/* Mini app preview */}
              <div
                className="rounded-3xl overflow-hidden border border-border/40"
                style={{ background: "var(--background)" }}
              >
                {/* Top bar */}
                <div
                  className="flex items-center justify-between px-3 py-2.5 border-b border-border/30"
                  style={{ background: "var(--card)" }}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="h-7 w-7 rounded-xl grid place-items-center"
                      style={{ background: local.primary }}
                    >
                      <Sparkles className="h-3.5 w-3.5" style={{ color: local.primaryForeground }} />
                    </div>
                    <div>
                      <div className="h-2 w-16 rounded-full bg-muted-foreground/40" />
                      <div className="h-1.5 w-10 rounded-full bg-muted-foreground/20 mt-1" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-6 w-6 rounded-lg bg-muted/40" />
                    <div
                      className="h-6 w-6 rounded-lg grid place-items-center"
                      style={{ background: `${local.primary}30` }}
                    >
                      <div className="h-2 w-2 rounded-full" style={{ background: local.primary }} />
                    </div>
                    <div
                      className="h-7 w-7 rounded-xl"
                      style={{ background: local.primary }}
                    />
                  </div>
                </div>

                {/* Content */}
                <div className="p-3 space-y-3">
                  {/* KPI cards */}
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "Users", value: "6", color: local.primary },
                      { label: "Meals", value: "3", color: local.accent },
                    ].map((kpi) => (
                      <div
                        key={kpi.label}
                        className="p-3 border border-border/30"
                        style={{ background: "var(--card)", borderRadius: local.radius }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div
                            className="h-7 w-7 rounded-xl grid place-items-center"
                            style={{ background: `${kpi.color}25` }}
                          >
                            <div className="h-3 w-3 rounded-full" style={{ background: kpi.color }} />
                          </div>
                        </div>
                        <div className="h-4 w-8 rounded bg-foreground/60 mb-1" />
                        <div className="h-2 w-12 rounded bg-muted-foreground/30" />
                      </div>
                    ))}
                  </div>

                  {/* Button preview */}
                  <div className="flex gap-2">
                    <div
                      className="flex-1 h-9 grid place-items-center text-xs font-medium"
                      style={{
                        background: local.primary,
                        color: local.primaryForeground,
                        borderRadius: local.radius,
                      }}
                    >
                      Primary Button
                    </div>
                    <div
                      className="flex-1 h-9 grid place-items-center text-xs font-medium border-2"
                      style={{
                        borderColor: `${local.primary}60`,
                        color: local.primary,
                        borderRadius: local.radius,
                      }}
                    >
                      Outline
                    </div>
                  </div>

                  {/* Nav indicator */}
                  <div
                    className="p-2 flex items-center gap-2"
                    style={{ background: "var(--card)", borderRadius: local.radius }}
                  >
                    <div
                      className="h-8 w-8 rounded-xl grid place-items-center"
                      style={{ background: local.primary }}
                    >
                      <Sparkles className="h-4 w-4" style={{ color: local.primaryForeground }} />
                    </div>
                    <div className="flex-1">
                      <div className="h-2 w-20 rounded-full bg-foreground/60" />
                      <div className="h-1.5 w-14 rounded-full bg-muted-foreground/30 mt-1" />
                    </div>
                    <div className="h-2 w-2 rounded-full" style={{ background: local.accent }} />
                  </div>

                  {/* Bottom nav */}
                  <div
                    className="flex items-center justify-around p-2 border-t border-border/30"
                    style={{ background: "var(--card)" }}
                  >
                    {[local.primary, local.accent, "#888", "#888", "#888"].map((color, i) => (
                      <div
                        key={i}
                        className={cn("h-7 w-7 rounded-xl", i === 0 && "grid place-items-center")}
                        style={i === 0 ? { background: `${color}25` } : { background: `${color}40` }}
                      >
                        {i === 0 && (
                          <div className="h-3 w-3 rounded-full" style={{ background: local.primary }} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Color swatches */}
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Swatch label="Primary" color={local.primary} />
                <Swatch label="Accent" color={local.accent} />
                <Swatch label="On Primary" color={local.primaryForeground} />
              </div>

              {dirty && (
                <div className="mt-4 flex gap-2">
                  <GlassButton variant="ghost" size="sm" className="flex-1" onClick={() => setLocal(theme)}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Discard
                  </GlassButton>
                  <GlassButton size="sm" className="flex-1" onClick={save} loading={saving}>
                    <Save className="h-3.5 w-3.5" />
                    Save & Apply
                  </GlassButton>
                </div>
              )}
            </GlassCard>
          </StaggerItem>
        </div>
      </div>
    </StaggerGroup>
  );
}

function ColorPicker({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <code className="text-xs font-mono text-muted-foreground uppercase">{value}</code>
          <label className="relative cursor-pointer">
            <div
              className="h-10 w-10 rounded-2xl border-2 border-border/40 shadow-sm"
              style={{ background: value }}
            />
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function Swatch({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 glass-soft rounded-xl p-2">
      <div className="h-6 w-6 rounded-lg shrink-0" style={{ background: color }} />
      <div className="min-w-0">
        <p className="text-[10px] text-muted-foreground truncate">{label}</p>
        <p className="text-[10px] font-mono uppercase truncate">{color}</p>
      </div>
    </div>
  );
}
