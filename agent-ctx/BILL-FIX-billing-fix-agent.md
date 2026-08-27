# Task BILL-FIX — Billing page month picker + filter redesign

## Task summary
Add an expenses-style month picker at the top of the Billing page, switch the bills API query to month/year-filtered, replace the existing GlassCard-wrapped search/filter bar with the expenses-style design (full-width `GlassInput` + horizontally scrollable filter pills), and update the backend `GET /api/bills` to accept `month`/`year` query params.

## Files modified
1. `src/components/features/billing/billing-view.tsx` — frontend
2. `src/app/api/bills/route.ts` — backend GET handler
3. `worklog.md` — appended BILL-FIX entry

## Changes to `billing-view.tsx`

### Imports
- Added `ChevronLeft` and `ChevronRight` to the lucide-react import block. `Calendar` was already imported and is reused by both the month picker capsule and the existing `BillCard` component.

### State + query
- Added `now`, `selectedMonth`, `selectedYear` state initialized to the current month/year.
- Changed the bills `useQuery` key from `["bills"]` to `["bills", { month: selectedMonth, year: selectedYear }]` and the `queryFn` now calls `api.get("/bills", { params: { month, year } })` exactly as the task spec'd.
- KPIs already compute from `bills` directly (`kpis = useMemo(... [bills])`), so they automatically reflect the month-filtered data — no other change needed.

### Layout (top of `BillingView`'s returned JSX)
1. **NEW month picker** — first `StaggerItem`, centered with `flex items-center justify-center gap-4`:
   - Left circular `motion.button` (h-10 w-10, rounded-full, glass-strong, ring-1 ring-border/40 hover:ring-primary/40) with `ChevronLeft`. onClick decrements month using `new Date(selectedYear, selectedMonth - 1, 1)`.
   - Center capsule: `glass-soft rounded-full px-6 py-2.5` with `Calendar` icon (text-primary) + two-line stack — top: month name (`text-sm font-bold text-primary`), bottom: year (`text-[11px] text-muted-foreground`). Uses `toLocaleDateString("en-US", { month: "long" })`.
   - Right circular `motion.button` with `ChevronRight`. onClick increments month using `new Date(selectedYear, selectedMonth + 1, 1)`.
   - Both buttons have `whileTap={{ scale: 0.9 }}` and aria-labels.
2. **Existing action bar** (Generate Bills button) — unchanged, now second `StaggerItem`.
3. **KPIs** — unchanged (now reflect the filtered month).
4. **Search + filter pills** — replaced the old GlassCard-wrapped flex-row. New design mirrors the expenses page exactly:
   - A full-width `GlassInput` (Search icon, "Search by name, email, room…") wrapped in a `space-y-3` div.
   - Below it: horizontally scrollable filter pills (`flex items-center gap-2 overflow-x-auto no-scrollbar`). Each pill uses `inline-flex items-center gap-1 h-8 px-2.5 rounded-xl text-[11px] font-medium whitespace-nowrap transition-all`. Active = `bg-primary text-primary-foreground shadow-md shadow-primary/30`. Inactive = `glass-soft text-muted-foreground hover:text-foreground`. Pills: All, Generated, Partially Paid, Paid, Overdue, Void.
5. **List, dialogs, void confirm** — unchanged.

## Changes to `api/bills/route.ts` GET handler
- Built a `where: Record<string, unknown>` object instead of `undefined | { userId }`.
- Still gates `userId` for USER role.
- Reads `month` and `year` from `url.searchParams`. If `month !== null && year`, sets `where.periodMonth = Number(month)` and `where.periodYear = Number(year)`.
- Backward compatible: when params are absent, the query returns all bills (subject to the existing `take: limit` with default 20) just like before.

## Verification
- `bun run lint` → 0 errors. (1 pre-existing informational warning in `variables-view.tsx` from a prior task — unrelated.)
- `dev.log` shows clean recompilation and `GET /api/bills 200` succeeding.
- Preserved: generate-bills dialog, void confirm, bill detail dialog with payment history, mobile cards, desktop table, KPI glow colors, `Sparkles` inline icon, `formatINR`/`formatMonthYear`/`formatDate` helpers.

## Notes for future agents
- The bills query still uses the default server-side `take: 20`. If a boarding house ever has >20 active residents in a single month, bump the limit or pass `params: { ..., limit: 500 }` from the frontend.
- The month picker capsule style and pill styles are intentionally identical to `expenses-view.tsx` so the two finance pages feel consistent. If you change one, change both.
