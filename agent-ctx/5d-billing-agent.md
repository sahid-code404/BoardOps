# Task 5d — Billing / Payments / Expenses Views

**Agent**: billing-agent
**Task ID**: 5d

## Task
Build three premium liquid-glass views for the BoardOps platform:
1. `BillingView` — Billing engine view (Part 7)
2. `PaymentsView` — Payments & Wallet view (Part 8)
3. `ExpensesView` — Expenses & Procurement view (Part 9)

## Files created
- `/home/z/my-project/src/components/features/billing/billing-view.tsx` (~890 lines)
- `/home/z/my-project/src/components/features/billing/payments-view.tsx` (~995 lines)
- `/home/z/my-project/src/components/features/billing/expenses-view.tsx` (~981 lines)

## Implementation summary

### Shared patterns across all 3 views
- `"use client"` named exports matching imports in `src/app/page.tsx`
- All API calls go through `api` from `@/lib/api-client`; unwrap `{ success, data }` envelope via local `ApiResponse<T>` type
- TanStack Query for server state (`useQuery` + `useMutation` with `queryClient.invalidateQueries`)
- Sonner toasts for every mutation success/error
- `StaggerGroup` + `StaggerItem` for list entrance animations
- `AnimatedCounter` for every KPI number
- `ShimmerSkeleton` blocks for loading states
- `GlassCard`, `GlassButton`, `GlassInput`, `GlassTextarea` from `@/components/glass/*`
- shadcn `Dialog`, `Sheet`, `Select`, `Badge`, `Table`, `AlertDialog` from `@/components/ui/*`
- Mobile-first: cards stack on mobile, full tables on `md:`+ breakpoints
- framer-motion `whileTap` / `whileHover` micro-interactions on rows and cards
- Currency formatted as `₹{n.toLocaleString("en-IN")}` via shared `formatINR` helper
- Role gating via `useAuthStore` (`user.role === "SUPER_ADMIN" || "ADMIN"` for admin; manager also allowed for expenses add)

### BillingView (billing-view.tsx)
- Header card with `Generate Bills` button (admin only) → Dialog with month/year Select
- 4 KPI cards: Total Billed, Total Collected, Outstanding, Overdue Count (with AnimatedCounter + ₹ prefix)
- Filter row: search input (name/email/room) + status segmented control (All, Generated, Partially Paid, Paid, Overdue, Void)
- Mobile: StaggerGroup of `BillCard` components (color-coded status, 3-cell mini-grid Total/Paid/Due)
- Desktop: full shadcn Table with resident, period, meal charges, other, total, paid, due, status badge, due date, view/void actions
- `BillStatusBadge` with color variants: PAID=success, PARTIALLY_PAID=warning, OVERDUE=destructive, GENERATED=info, DRAFT/VOID=muted
- Click any bill → Bill detail dialog: breakdown rows (meal/other/adjustments), totals card, due/generated dates, and admin-only payment history list (fetched via `GET /api/bills/[id]`)
- Admin void action via AlertDialog confirm → `DELETE /api/bills/[id]`
- Regular users see only their own bills (server-enforced) and have no generate/void buttons

### PaymentsView (payments-view.tsx)
- 4 KPIs: Total Approved, Pending Approvals, Rejected, This Month's Total
- `Submit Payment` button → Dialog with: amount (₹), method select, optional bill select (only shows user's outstanding bills), reference, notes
- Admin-only "Pending Approvals" section at top with one-click Approve/Reject buttons per row (confirm via AlertDialog)
- Method badges with icons: CASH (Banknote/success), UPI (Smartphone/primary), CARD (CreditCard/info), BANK_TRANSFER (Building2/warning), WALLET (WalletIcon/muted)
- Status badges: APPROVED=success, PENDING=warning, REJECTED=destructive, REFUNDED=info
- Filter row: search (name/email/reference) + status segmented control + method Select
- Mobile: `PaymentCard` with large amount, method icon avatar, status badge, optional notes block
- Desktop: full table (admin sees resident column, regular users see amount/method/status/reference/date/notes)
- Mutations: POST `/api/payments` (user submit), PATCH `/api/payments/[id]` with `{ action: "APPROVE" | "REJECT" }` (admin) — invalidates both `payments` and `bills` queries on approve so bill totals refresh

### ExpensesView (expenses-view.tsx)
- 4 KPIs: Total This Month, Transactions count, Top Category (with name as suffix label), Categories Active count
- Bar chart (recharts `BarChart`) showing expenses by category for current month with per-category gradient fills
- Breakdown sidebar with animated progress bars per category (motion.div width animation)
- Category segmented filter: All, Grocery, Utilities, Salary, Maintenance, General
- Mobile: `ExpenseCard` with left color stripe, title, date, large amount, paid-to, description block, admin delete button
- Desktop: full table with title/description, category badge, amount, date, paid-to, delete action
- Category badges: GROCERY=success, UTILITIES=info, SALARY=primary, MAINTENANCE=warning, GENERAL=muted
- Add expense via right-side `Sheet` (not Dialog) with: title, amount, category select, native date input, paidTo, description — full validation with field-level errors
- Delete confirm via AlertDialog → `DELETE /api/expenses/[id]` (admin only)
- Regular users get read-only view (no Add button, no delete buttons)

## Verification
- `bunx eslint src/components/features/billing/*.tsx` → no errors, no warnings
- `bunx tsc --noEmit --skipLibCheck` → no errors in any of the 3 files
- `dev.log` shows `✓ Compiled in 144ms` with no errors attributable to billing/payments/expenses
- Other lint/tsc errors in `page.tsx`, `kitchen-view`, `variables-view`, `top-bar`, `session.ts`, etc. are owned by other agents

## Notes for next agents
- API responses are wrapped as `{ success: boolean, data: T }` — always unwrap with `.data` in `queryFn`
- For nested generic types with object literals (e.g. `Array<{ user: { name: string } }>`), prefer extracting a named type to avoid TS parser ambiguity with `}>>` tokens (saw this issue in `SubmitPaymentDialog`)
- `useAuthStore` exposes `user.role` as `SUPER_ADMIN | ADMIN | MANAGER | USER` — expenses add/delete allows MANAGER; billing/payments admin actions restrict to SUPER_ADMIN/ADMIN
- All three views are already wired into `src/app/page.tsx` via existing imports; no other files were modified
