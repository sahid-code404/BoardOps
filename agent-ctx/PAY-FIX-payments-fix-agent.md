# PAY-FIX — Payments View Date Picker + Expenses-Style Filter Bar

Agent: payments-fix-agent
Task ID: PAY-FIX
Files touched:
- `src/components/features/billing/payments-view.tsx` (frontend)
- `src/app/api/payments/route.ts` (backend GET handler)

## Context
- Read worklog.md for full BoardOps history (596 lines, multiple prior agents)
- Inspected sibling views for design patterns:
  - `src/components/features/kitchen/kitchen-view.tsx` — provided the `getDatePickerLabels` helper + the capsule Day Picker JSX pattern (left circular arrow → glass-soft capsule with calendar icon + two-line label → right circular arrow)
  - `src/components/features/billing/expenses-view.tsx` — provided the search + horizontally scrollable filter-pills pattern
- Read existing payments-view.tsx (989 lines): had an action bar with the Submit Payment button, 4 KPIs (Total Approved / Pending / Rejected / This Month), an admin Pending Approvals card, and a single GlassCard holding search + status pills + a Method `Select` dropdown
- Read existing `/api/payments` GET route: only took a `limit` param and returned the latest N payments for the user (or all for admins) — no date filtering

## Changes made

### 1. Day Picker (top of view)
- Copied `getDatePickerLabels(d)` helper verbatim from kitchen-view.tsx — returns `{ top, bottom }` where today/yesterday/tomorrow map to relative labels + "EEE, d MMM", and far dates show "d MMM" on top + "EEE" on the bottom (no duplicate)
- Added `selectedDate` state (`useState<Date>(new Date())`) and derived `dateStr` (YYYY-MM-DD), `datePickerLabels`, and `isToday` (via `isSameDay` from date-fns)
- Added the picker JSX as the FIRST `StaggerItem` (above the existing action bar) — `flex items-center justify-center gap-4` wrapper containing:
  - Left circular `motion.button` (ChevronLeft, `h-10 w-10 rounded-full glass-strong`) — calls `setSelectedDate((d) => addDays(d, -1))`
  - Center glass-soft capsule button (`max-w-[280px] rounded-full px-6 py-2.5`) with `Calendar` icon + two-line label — clicking it jumps back to today unless already on today (a small `RotateCcw` icon appears when not on today as a hint)
  - Right circular `motion.button` (ChevronRight) — `setSelectedDate((d) => addDays(d, 1))`

### 2. API query updated for date filtering
- queryKey changed from `["payments"]` to `["payments", dateStr]` so changing the day triggers a refetch and is cached per-day
- queryFn now sends `{ params: { date: dateStr } }` to `api.get("/payments", ...)`
- Kept `isLoading` for the existing skeleton state

### 3. KPIs updated to use date-filtered data
- Removed the redundant month filter inside the KPI computation (was filtering approved payments by `now.getMonth()`/`now.getFullYear()`); since `payments` is already filtered to the selected day, every approved payment in the array already belongs to that day
- Replaced the 4th KPI card "This Month" (₹) with "Refunded" (count) — maps cleanly to the 4 status filter pills (excluding All) and avoids the misleading "month" label now that data is per-day
- The 4 KPIs are now: Total Approved (₹), Pending Approvals (count), Rejected (count), Refunded (count, RotateCcw icon, info color)

### 4. Filter bar replaced with expenses-style design
- Removed the GlassCard wrapper, the Method `Select` dropdown, and the `methodFilter` state (no longer needed)
- New structure mirrors expenses-view: a `space-y-3` div with a full-width `GlassInput` (Search icon) on top, then a horizontally scrollable pill row (`flex items-center gap-2 overflow-x-auto no-scrollbar`)
- Pills use the exact classes specified: `inline-flex items-center h-8 px-2.5 rounded-xl text-[11px] gap-1 font-medium whitespace-nowrap transition-all`
- Active/inactive styling copied from expenses-view: active = `bg-primary text-primary-foreground shadow-md shadow-primary/30`; inactive = `glass-soft text-muted-foreground hover:text-foreground`
- 5 pills in the order requested: All, Pending, Approved, Rejected, Refunded (PENDING first to mirror the order admins care about)

### 5. Backend `/api/payments` GET route
- Typed `where` as `{ userId?: string; createdAt?: { gte: Date; lte: Date } }` (was previously an untyped `userId | undefined`)
- Reads `date` from `url.searchParams`; if present, parses it and sets `where.createdAt = { gte: start, lte: end }` where start = 00:00:00.000 and end = 23:59:59.999 of that calendar day (using `d.getFullYear/getMonth/getDate` — same pattern the task spec gave)
- Backward compatible: when `date` is omitted, `where.createdAt` stays undefined and the query returns all payments (limited to `take: limit` as before)
- Preserved the existing USER-scope rule (`where.userId = user.id` for residents so they only see their own payments) — combined cleanly with the new createdAt filter

## What was kept (per the rules)
- All existing functionality: approve/reject confirm dialog, Submit Payment dialog (with method/bill/reference/notes fields), admin Pending Approvals card with inline Approve/Reject buttons, mobile PaymentCard + desktop table
- Existing components: `GlassCard`, `GlassButton`, `GlassInput`, `GlassTextarea`, `AnimatedCounter`, `StaggerGroup`/`StaggerItem`, `ShimmerSkeleton`, shadcn `Dialog`/`AlertDialog`/`Select`/`Table`/`Badge`
- The admin Pending Approvals card still pulls from the same date-filtered `payments` array (only renders when there are pending payments on the selected day)
- `Select` import retained — still used inside `SubmitPaymentDialog` for Method and bill selection

## Verification
- `bun run lint` → **0 errors** (1 pre-existing informational warning in `variables-view.tsx` from a prior task, unrelated to payments)
- dev.log shows clean recompilations and the new date filter working end-to-end:
  - `GET /api/payments?date=2026-06-28 200 in 13ms`
  - `GET /api/payments?date=2026-06-27 200` (previous day)
  - `GET /api/payments?date=2026-06-29 200` (next day)
- No backend errors; `where.createdAt` composes correctly with the existing `where.userId` for USER role

## Files unchanged
- All other views, components, lib, stores, prisma schema
- The POST and PATCH routes for `/api/payments` and `/api/payments/[id]` (no date logic needed there)
