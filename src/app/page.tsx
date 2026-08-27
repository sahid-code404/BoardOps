"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuthStore, type CurrentUser } from "@/stores/use-auth-store";
import { AuthScreen } from "@/components/features/auth/auth-screen";
import { AppShell } from "@/components/layout/app-shell";
import { LazyViewRouter } from "@/components/layout/lazy-view-router";
import { AnimatedBackground } from "@/components/glass/animated-background";
import { GlassButton } from "@/components/glass/glass-button";
import { api } from "@/lib/api-client";
import { ShieldX } from "lucide-react";
import { useAppStore } from "@/stores/use-app-store";
import { CommandPalette } from "@/components/layout/command-palette";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

export default function Page() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const clearAuth = useAuthStore((s) => s.logout);
  const view = useAppStore((s) => s.view);

  const { isLoading, isError } = useQuery({
    queryKey: ["auth-me", token],
    queryFn: async () => {
      const r = await api.get<{ success: boolean; data: CurrentUser }>("/auth/me");
      setUser(r.data);
      return r.data;
    },
    enabled: !!token,
    retry: false,
    staleTime: 60 * 1000,
  });

  if (isError && token) {
    queueMicrotask(() => clearAuth());
  }

  if (token && isLoading && !user) {
    return (
      <div className="min-h-screen grid place-items-center safe-top safe-bottom">
        <AnimatedBackground />
        <div className="space-y-3 w-72">
          <ShimmerSkeleton className="h-12 w-12 rounded-3xl mx-auto" />
          <ShimmerSkeleton className="h-4 w-3/4 mx-auto" />
          <ShimmerSkeleton className="h-3 w-1/2 mx-auto" />
        </div>
      </div>
    );
  }

  if (!token || (isError && !user)) {
    return <AuthScreen />;
  }

  const userRole = user?.role || "USER";
  const isAdmin = userRole === "ADMIN" || userRole === "SUPER_ADMIN";

  // Permission guard: residents can only access their allowed views
  const adminOnlyViews = ["meals", "kitchen", "expenses", "funds", "monthly-closing", "formula-engine", "users", "settings", "system"];
  const isForbidden = !isAdmin && adminOnlyViews.includes(view);

  if (isForbidden) {
    return (
      <>
        <AnimatedBackground />
        <AppShell>
          <div className="min-h-[60vh] grid place-items-center">
            <div className="text-center space-y-3">
              <div className="grid place-items-center h-16 w-16 rounded-3xl bg-destructive/10 mx-auto">
                <ShieldX className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-bold">Access Restricted</h2>
              <p className="text-sm text-muted-foreground max-w-xs">
                You don&apos;t have permission to access this section. Contact your administrator if you believe this is incorrect.
              </p>
              <GlassButton size="sm" onClick={() => useAppStore.getState().setView("dashboard")}>
                Back to Dashboard
              </GlassButton>
            </div>
          </div>
        </AppShell>
      </>
    );
  }

  return (
    <>
      <AnimatedBackground />
      <AppShell>
        <LazyViewRouter view={view} isAdmin={isAdmin} />
      </AppShell>
      <CommandPalette />
    </>
  );
}
