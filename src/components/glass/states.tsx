"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassCard } from "@/components/glass/glass-card";

/**
 * Reusable error state component (PRD EP-006 — every screen supports error state).
 * Usage: {isError ? <ErrorState message="Failed to load" onRetry={refetch} /> : ...}
 */
export function ErrorState({
  title = "Something went wrong",
  message = "An error occurred while loading this data. Please try again.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <GlassCard className="p-8 text-center" hover={false}>
      <div className="grid place-items-center h-14 w-14 rounded-3xl bg-destructive/10 mx-auto mb-3">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <p className="font-semibold mb-1">{title}</p>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">{message}</p>
      {onRetry && (
        <GlassButton size="sm" variant="ghost" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </GlassButton>
      )}
    </GlassCard>
  );
}

/**
 * Reusable empty state component (PRD EP-006 — every screen supports empty state).
 */
export function EmptyState({
  icon: Icon = AlertTriangle,
  title = "Nothing here yet",
  message = "Data will appear here once it's available.",
  action,
}: {
  icon?: typeof AlertTriangle;
  title?: string;
  message?: string;
  action?: React.ReactNode;
}) {
  return (
    <GlassCard className="p-8 text-center" hover={false}>
      <div className="grid place-items-center h-14 w-14 rounded-3xl bg-muted/50 mx-auto mb-3">
        <Icon className="h-7 w-7 text-muted-foreground/50" />
      </div>
      <p className="font-semibold mb-1">{title}</p>
      <p className="text-sm text-muted-foreground mb-4 max-w-xs mx-auto">{message}</p>
      {action}
    </GlassCard>
  );
}
