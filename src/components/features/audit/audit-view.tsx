"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import {
  Shield,
  Search,
  ChevronDown,
  ChevronRight,
  Filter,
  Globe,
  Monitor,
  User as UserIcon,
  ArrowRight,
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
import { UserAvatar } from "@/components/glass/user-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type AuditLog = {
  id: string;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  reason: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string; avatarUrl: string | null } | null;
};

type AuditResponse = {
  logs: AuditLog[];
  total: number;
  pagination: { limit: number; offset: number; hasMore: boolean };
  filters: { entities: string[]; actions: string[] };
};

type ApiResponse<T> = { success: boolean; data: T };

// Action → color mapping
const ACTION_COLORS: Record<string, string> = {
  CREATE: "bg-success/15 text-success",
  UPDATE: "bg-info/15 text-info",
  DELETE: "bg-destructive/15 text-destructive",
  APPROVE: "bg-success/15 text-success",
  REJECT: "bg-destructive/15 text-destructive",
  VOID: "bg-destructive/15 text-destructive",
  ARCHIVE: "bg-muted text-muted-foreground",
  RESTORE: "bg-info/15 text-info",
  OVERRIDE: "bg-warning/15 text-warning",
  PUBLISH: "bg-primary/15 text-primary",
  SUBMIT: "bg-info/15 text-info",
};

function getActionColor(action: string): string {
  const upper = action.toUpperCase();
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (upper.includes(key)) return color;
  }
  return "bg-muted text-muted-foreground";
}

function getActionIcon(action: string): string {
  const upper = action.toUpperCase();
  if (upper.includes("CREATE") || upper.includes("APPROVE")) return "✓";
  if (upper.includes("DELETE") || upper.includes("REJECT") || upper.includes("VOID")) return "✗";
  if (upper.includes("UPDATE") || upper.includes("EDIT")) return "✎";
  if (upper.includes("ARCHIVE")) return "📁";
  if (upper.includes("RESTORE")) return "↻";
  if (upper.includes("OVERRIDE")) return "⚡";
  if (upper.includes("PUBLISH")) return "📢";
  if (upper.includes("SUBMIT")) return "→";
  if (upper.includes("CLOSE") || upper.includes("SETTLE")) return "🔒";
  return "•";
}

// Entity → emoji mapping
const ENTITY_ICONS: Record<string, string> = {
  User: "👤",
  Payment: "💳",
  Bill: "📄",
  Expense: "💰",
  Purchase: "🛒",
  Product: "📦",
  Unit: "📏",
  Variable: "🔢",
  Formula: "ƒ",
  BillingCycle: "📅",
  Holiday: "🏖️",
  Restriction: "🔒",
  Refund: "↩️",
  Adjustment: "⚖️",
  Announcement: "📢",
  MealEntry: "🍽️",
  MealOverride: "⚡",
  AuditLog: "📋",
};

export function AuditView() {
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const limit = 50;

  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", { search, entityFilter, actionFilter, offset }],
    queryFn: async () => {
      const params: Record<string, string> = { limit: String(limit), offset: String(offset) };
      if (search) params.search = search;
      if (entityFilter !== "ALL") params.entity = entityFilter;
      if (actionFilter !== "ALL") params.action = actionFilter;
      const r = await api.get<ApiResponse<AuditResponse>>("/audit-logs", { params });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const entities = data?.filters.entities ?? [];
  const actions = data?.filters.actions ?? [];

  const hasFilters = search || entityFilter !== "ALL" || actionFilter !== "ALL";

  const clearFilters = () => {
    setSearch("");
    setEntityFilter("ALL");
    setActionFilter("ALL");
    setOffset(0);
  };

  return (
    <StaggerGroup className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Audit Log
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Immutable record of every administrative action. {total.toLocaleString()} total entries.
          </p>
        </div>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Shield className="h-3.5 w-3.5" /> Total Entries
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={total} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Filter className="h-3.5 w-3.5" /> Entity Types
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              <AnimatedCounter value={entities.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Monitor className="h-3.5 w-3.5" /> Action Types
            </div>
            <p className="text-2xl font-bold tabular-nums text-info">
              <AnimatedCounter value={actions.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <UserIcon className="h-3.5 w-3.5" /> Showing
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {offset + 1}-{Math.min(offset + logs.length, total)}
            </p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Filters */}
      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <GlassInput
                placeholder="Search actions, entities, reasons…"
                icon={<Search className="h-4 w-4" />}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
              />
            </div>
            <Select value={entityFilter} onValueChange={(v) => { setEntityFilter(v); setOffset(0); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Entity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Entities</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e} value={e}>
                    {ENTITY_ICONS[e] || "•"} {e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setOffset(0); }}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Action" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Actions</SelectItem>
                {actions.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <GlassButton variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-3.5 w-3.5" />
                Clear
              </GlassButton>
            )}
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Audit entries */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-16 rounded-3xl" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <Shield className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No audit entries found</p>
            <p className="text-sm text-muted-foreground">
              {hasFilters ? "Try adjusting your filters." : "Audit entries will appear here as actions are performed."}
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence mode="popLayout">
              {logs.map((log) => (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <AuditEntry
                    log={log}
                    isExpanded={expandedId === log.id}
                    onToggle={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Pagination */}
      {total > limit && (
        <StaggerItem>
          <div className="flex items-center justify-center gap-3">
            <GlassButton
              variant="ghost"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              ← Previous
            </GlassButton>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + logs.length, total)} of {total.toLocaleString()}
            </span>
            <GlassButton
              variant="ghost"
              size="sm"
              disabled={!data?.pagination.hasMore}
              onClick={() => setOffset(offset + limit)}
            >
              Next →
            </GlassButton>
          </div>
        </StaggerItem>
      )}
    </StaggerGroup>
  );
}

// ─── Individual Audit Entry with expandable diff ───

function AuditEntry({
  log,
  isExpanded,
  onToggle,
}: {
  log: AuditLog;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const entityIcon = ENTITY_ICONS[log.entity] || "•";
  const actionColor = getActionColor(log.action);
  const actionIcon = getActionIcon(log.action);

  // Parse old/new values for diff
  const oldValue = useMemo(() => {
    if (!log.oldValue) return null;
    try { return JSON.parse(log.oldValue); } catch { return log.oldValue; }
  }, [log.oldValue]);

  const newValue = useMemo(() => {
    if (!log.newValue) return null;
    try { return JSON.parse(log.newValue); } catch { return log.newValue; }
  }, [log.newValue]);

  // Compute diff fields (which keys changed)
  const diffFields = useMemo(() => {
    if (!oldValue || !newValue || typeof oldValue !== "object" || typeof newValue !== "object") {
      return null;
    }
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    const changes: { key: string; oldVal: unknown; newVal: unknown; changed: boolean }[] = [];
    for (const key of allKeys) {
      const o = (oldValue as Record<string, unknown>)[key];
      const n = (newValue as Record<string, unknown>)[key];
      const changed = JSON.stringify(o) !== JSON.stringify(n);
      if (changed) {
        changes.push({ key, oldVal: o, newVal: n, changed: true });
      }
    }
    return changes;
  }, [oldValue, newValue]);

  return (
    <GlassCard className="overflow-hidden" hover>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 p-3 text-left"
      >
        {/* Entity icon */}
        <div className="grid place-items-center h-9 w-9 rounded-xl bg-secondary shrink-0 text-lg">
          {entityIcon}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded-full font-medium shrink-0", actionColor)}>
              {actionIcon} {log.action}
            </span>
            <span className="text-[10px] text-muted-foreground shrink-0">
              on <span className="font-medium text-foreground">{log.entity}</span>
              {log.entityId && <span className="font-mono"> · {log.entityId.slice(0, 12)}…</span>}
            </span>
            {diffFields && diffFields.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-warning/15 text-warning shrink-0">
                {diffFields.length} change{diffFields.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {log.actor ? (
              <div className="flex items-center gap-1.5">
                <UserAvatar name={log.actor.name} avatarUrl={log.actor.avatarUrl} size="xs" />
                <span className="text-xs text-muted-foreground">{log.actor.name}</span>
              </div>
            ) : (
              <span className="text-xs text-muted-foreground italic">System</span>
            )}
            <span className="text-[10px] text-muted-foreground">
              · {format(new Date(log.createdAt), "d MMM yyyy, h:mm:ss a")}
            </span>
            {log.reason && (
              <span className="text-[10px] text-muted-foreground italic truncate">
                · "{log.reason}"
              </span>
            )}
          </div>
        </div>

        {/* Expand indicator */}
        <div className="shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Expanded diff */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden border-t border-border"
          >
            <div className="p-3 space-y-3 bg-muted/20">
              {/* Metadata */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                {log.ipAddress && (
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Globe className="h-3 w-3" />
                    <span className="font-mono">{log.ipAddress}</span>
                  </div>
                )}
                {log.userAgent && (
                  <div className="flex items-center gap-1.5 text-muted-foreground col-span-2">
                    <Monitor className="h-3 w-3" />
                    <span className="truncate">{parseUA(log.userAgent)}</span>
                  </div>
                )}
                {log.entityId && (
                  <div className="text-muted-foreground">
                    <span className="font-mono text-[10px]">ID: {log.entityId}</span>
                  </div>
                )}
              </div>

              {/* Diff viewer */}
              {diffFields && diffFields.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Changes
                  </p>
                  {diffFields.map((c) => (
                    <div key={c.key} className="flex items-center gap-2 p-2 rounded-xl glass-soft">
                      <span className="text-xs font-mono font-medium w-32 shrink-0">{c.key}</span>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-xs font-mono px-2 py-0.5 rounded-lg bg-destructive/10 text-destructive truncate">
                          {formatVal(c.oldVal)}
                        </span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs font-mono px-2 py-0.5 rounded-lg bg-success/10 text-success truncate">
                          {formatVal(c.newVal)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {newValue && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Value
                      </p>
                      <pre className="text-xs font-mono p-2 rounded-xl glass-soft overflow-x-auto max-h-40">
                        {typeof newValue === "string" ? newValue : JSON.stringify(newValue, null, 2)}
                      </pre>
                    </div>
                  )}
                  {oldValue && !newValue && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Previous Value
                      </p>
                      <pre className="text-xs font-mono p-2 rounded-xl glass-soft overflow-x-auto max-h-40">
                        {typeof oldValue === "string" ? oldValue : JSON.stringify(oldValue, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Reason */}
              {log.reason && (
                <div className="p-2 rounded-xl bg-warning/10">
                  <p className="text-[10px] font-semibold text-warning uppercase tracking-wider mb-0.5">Reason</p>
                  <p className="text-xs">{log.reason}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length > 50 ? v.slice(0, 50) + "…" : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v).slice(0, 80); } catch { return String(v); }
}

function parseUA(ua: string): string {
  let browser = "Unknown";
  let os = "Unknown";
  if (/Edg/.test(ua)) browser = "Edge";
  else if (/Chrome/.test(ua) && /Safari/.test(ua)) browser = "Chrome";
  else if (/Firefox/.test(ua)) browser = "Firefox";
  else if (/Safari/.test(ua)) browser = "Safari";
  if (/iPhone/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Linux/.test(ua)) os = "Linux";
  return `${browser} · ${os}`;
}
