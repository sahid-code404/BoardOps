"use client";

import { lazy, Suspense, memo, useMemo } from "react";
import type { ViewKey } from "@/stores/use-app-store";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";

// ─────────────────────────────────────────────────────────────
// Lazy-loaded view components.
//
// Each `lazy()` call creates a separate JS chunk that's only fetched when the
// user navigates to that view. This dramatically reduces:
//   - Initial bundle size (only Dashboard loads on first paint)
//   - Memory usage (only the active view's code is in memory)
//   - Parse/compile time (less JS to evaluate upfront)
// ─────────────────────────────────────────────────────────────

const DashboardView = lazy(() =>
  import("@/components/features/dashboard/dashboard-view").then((m) => ({ default: m.DashboardView }))
);
const MealsConfigView = lazy(() =>
  import("@/components/features/meals/meals-config-view").then((m) => ({ default: m.MealsConfigView }))
);
const UserMealsView = lazy(() =>
  import("@/components/features/meals/user-meals-view").then((m) => ({ default: m.UserMealsView }))
);
const KitchenView = lazy(() =>
  import("@/components/features/kitchen/kitchen-view").then((m) => ({ default: m.KitchenView }))
);
const BillingHubView = lazy(() =>
  import("@/components/features/billing/billing-hub-view").then((m) => ({ default: m.BillingHubView }))
);
const PaymentsView = lazy(() =>
  import("@/components/features/billing/payments-view").then((m) => ({ default: m.PaymentsView }))
);
const ExpensesHubView = lazy(() =>
  import("@/components/features/billing/expenses-hub-view").then((m) => ({ default: m.ExpensesHubView }))
);
const FundsView = lazy(() =>
  import("@/components/features/billing/funds-view").then((m) => ({ default: m.FundsView }))
);
const MonthlyClosingView = lazy(() =>
  import("@/components/features/billing/monthly-closing-view").then((m) => ({ default: m.MonthlyClosingView }))
);
const FormulaEngineView = lazy(() =>
  import("@/components/features/variables/formula-engine-view").then((m) => ({ default: m.FormulaEngineView }))
);
const UsersView = lazy(() =>
  import("@/components/features/users/users-view").then((m) => ({ default: m.UsersView }))
);
const NotificationsHubView = lazy(() =>
  import("@/components/features/notifications/notifications-hub-view").then((m) => ({ default: m.NotificationsHubView }))
);
const SettingsHubView = lazy(() =>
  import("@/components/features/settings/settings-hub-view").then((m) => ({ default: m.SettingsHubView }))
);
const SystemHubView = lazy(() =>
  import("@/components/features/system/system-hub-view").then((m) => ({ default: m.SystemHubView }))
);
const ProfileView = lazy(() =>
  import("@/components/features/auth/profile-view").then((m) => ({ default: m.ProfileView }))
);

// ─────────────────────────────────────────────────────────────
// Loading skeleton — shown while a view chunk is being fetched.
// ─────────────────────────────────────────────────────────────

function ViewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
        <ShimmerSkeleton className="h-28" />
      </div>
      <div className="space-y-3">
        <ShimmerSkeleton className="h-16" />
        <ShimmerSkeleton className="h-16" />
        <ShimmerSkeleton className="h-16" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// LazyView — wraps a lazy component in a Suspense boundary.
// Memoized so it doesn't re-render when the parent re-renders.
// ─────────────────────────────────────────────────────────────

const LazyDashboard = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><DashboardView /></Suspense>
));
const LazyMealsConfig = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><MealsConfigView /></Suspense>
));
const LazyUserMeals = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><UserMealsView /></Suspense>
));
const LazyKitchen = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><KitchenView /></Suspense>
));
const LazyBilling = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><BillingHubView /></Suspense>
));
const LazyPayments = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><PaymentsView /></Suspense>
));
const LazyExpenses = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><ExpensesHubView /></Suspense>
));
const LazyFunds = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><FundsView /></Suspense>
));
const LazyMonthlyClosing = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><MonthlyClosingView /></Suspense>
));
const LazyFormulaEngine = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><FormulaEngineView /></Suspense>
));
const LazyUsers = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><UsersView /></Suspense>
));
const LazyNotifications = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><NotificationsHubView /></Suspense>
));
const LazySettings = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><SettingsHubView /></Suspense>
));
const LazySystem = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><SystemHubView /></Suspense>
));
const LazyProfile = memo(() => (
  <Suspense fallback={<ViewSkeleton />}><ProfileView /></Suspense>
));

// ─────────────────────────────────────────────────────────────
// LazyViewRouter — renders the active view based on Zustand `view` state.
// ─────────────────────────────────────────────────────────────

export function LazyViewRouter({
  view,
  isAdmin,
}: {
  view: ViewKey;
  isAdmin: boolean;
}) {
  const content = useMemo(() => {
    switch (view) {
      case "dashboard": return <LazyDashboard />;
      case "meals": return isAdmin ? <LazyMealsConfig /> : null;
      case "user-meals": return <LazyUserMeals />;
      case "kitchen": return isAdmin ? <LazyKitchen /> : null;
      case "billing": return <LazyBilling />;
      case "payments": return <LazyPayments />;
      case "expenses": return isAdmin ? <LazyExpenses /> : null;
      case "funds": return isAdmin ? <LazyFunds /> : null;
      case "monthly-closing": return isAdmin ? <LazyMonthlyClosing /> : null;
      case "formula-engine": return isAdmin ? <LazyFormulaEngine /> : null;
      case "users": return isAdmin ? <LazyUsers /> : null;
      case "notifications": return <LazyNotifications />;
      case "settings": return isAdmin ? <LazySettings /> : null;
      case "system": return isAdmin ? <LazySystem /> : null;
      case "profile": return <LazyProfile />;
      default: return <LazyDashboard />;
    }
  }, [view, isAdmin]);

  return content;
}
