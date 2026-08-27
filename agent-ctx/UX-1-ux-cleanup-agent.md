# Task UX-1 — Remove duplicate big title headers across feature views

Agent: ux-cleanup-agent
Date: 2026-06-28

## Context
The BoardOps TopBar already renders the current page title (e.g. "Billing & Invoices", "User Management", "Notifications", "System Settings", "Variable Engine", "Kitchen Dashboard", "Meal Configuration", "Meal Calendar"). Each feature view ALSO rendered a big title header card (typically a `GlassCard` with `glow="primary"` containing an `<h1>`/`<h2>` + subtitle and sometimes an action button) — this duplicated the title and wasted vertical space.

## Approach
For each view, locate the big title header `GlassCard` block and:
- If it contained an action button (Generate/Create/Add/Submit/Refresh/Mark all read/Print/Today): replace the card with a compact action bar `<div className="flex items-center justify-end gap-3">` containing an optional short description `<p className="text-sm text-muted-foreground hidden sm:block">` + the action button(s), each wrapped with `className="shrink-0"`.
- If it had NO action button (users-view, calendar-view title): remove the header card entirely so the next StaggerItem (KPIs / filters / view toggle) becomes the first element.

## Files modified
1. `src/components/features/users/users-view.tsx` — removed entire title `GlassCard` (no action button)
2. `src/components/features/notifications/notifications-view.tsx` — replaced title card with compact action bar (Refresh + Mark all read). Removed unused `Bell` import.
3. `src/components/features/settings/settings-view.tsx` — replaced title card with compact action bar (Add Setting)
4. `src/components/features/variables/variables-view.tsx` — replaced title card with admin-only compact action bar (Create Variable). Removed unused `VariableIcon` import.
5. `src/components/features/kitchen/kitchen-view.tsx` — replaced title card with compact action bar (Prev/Date/Next/Today/Print + auto-refresh status on the left via `mr-auto`). Removed unused `Flame` import.
6. `src/components/features/meals/meals-config-view.tsx` — replaced title card with admin-only compact action bar (Create Meal)
7. `src/components/features/calendar/calendar-view.tsx` — removed title card; GlassNav view-toggle (Agenda/Week/Month) is now the first element, right-aligned
8. `src/components/features/billing/payments-view.tsx` — replaced title card with compact action bar (Submit Payment) + role-aware short description
9. `src/components/features/billing/expenses-view.tsx` — replaced title card with admin-only compact action bar (Add Expense) + short description

## Import cleanup
After removing the title cards, the following imports became unused and were removed:
- `Bell` (notifications-view.tsx)
- `Variable as VariableIcon` (variables-view.tsx)
- `Flame` (kitchen-view.tsx)

Other previously-imported icons (`SettingsIcon`, `UsersIcon`, `Utensils`, `CalendarIcon`, etc.) are still referenced elsewhere in their files, so they were left intact.

## Rules honored
- TopBar was NOT modified
- KPI cards, search bars, filters, charts, list content all untouched
- All action buttons kept their original variant/size/icon/onClick/loading/disabled props
- RBAC gating preserved (admin-only Create Variable / Create Meal / Add Expense bars rendered conditionally with `{isAdmin && (...)}`)
- All existing imports + component logic preserved (only removed the 3 truly-unused icon imports)

## Verification
- `bun run lint` → 0 errors, 1 pre-existing informational warning (react-hook-form `watch()` in variables-view.tsx — known React Compiler note, mentioned in earlier worklog entries)
- dev.log shows clean recompilation on all touched files with no errors

## Result
Cleaner, less repetitive UI: each view's first element is now either an action bar (right-aligned, with optional short hint) or directly the KPI/filter content. TopBar remains the single source of truth for the page title. More vertical space is now available for actual content.
