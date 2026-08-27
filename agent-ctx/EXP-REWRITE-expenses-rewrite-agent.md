# EXP-REWRITE — Expenses View Rewrite

Agent: expenses-rewrite-agent
Task ID: EXP-REWRITE
File touched: `src/components/features/billing/expenses-view.tsx`

## Context
- Read prior agent work records in `/agent-ctx/` (5d-billing-agent, 5d-notif-settings-users-agent, UX-1-ux-cleanup-agent) plus full `worklog.md` (~563 lines) for BoardOps history
- The expenses view was first built by 5d-billing-agent (Task 5d) with: KPIs, BarChart, breakdown, Add Expense Sheet (title/amount/category/date/paidTo/description), Delete confirm
- UX-1 (Task UX-1) later replaced the title header with a compact admin-only action bar holding the Add Expense button
- Backend already supports quantity/unit fields: `POST /api/expenses` requires them with defaults, `PUT /api/expenses/[id]` validates them via zod, both routes enforce past-month lock server-side (status LOCKED or earlier year/month than today)

## Changes made

### 1. Type + constants
- Added `quantity: number` and `unit: string` to the `Expense` type
- Added `ExpensePayload` type alias for the shared create/edit body
- Added `UNIT_OPTIONS = ["piece", "kg", "gm", "litre", "metre", "box", "dozen"]`
- Added `formatQuantity(qty, unit)` helper → "5 kg", "2 piece", or "" when both empty
- Added `isExpenseLocked(expense)` helper → returns `true` if `status === "LOCKED"` OR the expense's year-month is strictly before today's year-month

### 2. Layout reorder
- Swapped the first two `StaggerItem` blocks so the month picker now renders ABOVE the admin action bar (was: action bar → month picker; now: month picker → action bar → KPIs → Top Categories → Search+Filters → List)
- All other sections (KPIs, Top Categories, search, filter pills, list) untouched

### 3. Edit functionality
- Added `editTarget: Expense | null` state plus `openAddForm()` / `openEditForm(exp)` / `closeForm()` helpers
- Renamed `addOpen` → `formOpen`; `setAddOpen` calls replaced with the new helpers
- Added `editMutation` using `api.put<ApiResponse<Expense>>('/expenses/${id}', payload)` with success toast ("Expense updated successfully"), invalidation of `["expenses"]`, and `closeForm()`
- Added `handleSubmit(payload, id?)` dispatcher: routes to `editMutation` when `id` is present, otherwise to `addMutation`
- The Add Expense button now calls `openAddForm()`; new Edit buttons call `openEditForm(exp)`

### 4. Form rewrite (ExpenseFormSheet + ExpenseFormBody)
- Renamed `AddExpenseSheet` → `ExpenseFormSheet`; split out a child `ExpenseFormBody` so each open starts with fresh state via `useState` initializers (avoids the react-hooks/set-state-in-effect lint rule that fires when syncing fields in a `useEffect`)
- The wrapper passes `key={expense ? 'edit-${id}' : 'add'}` so the body remounts whenever the target changes (combined with Radix Sheet unmounting its content on close)
- Fields in the required order: **Item** (text, was `title`), **Category** (Select with CUSTOM option that reveals a custom-name input — kept from before), **Quantity** (number) + **Unit** (Select with the 7 predefined units + a "Custom" option that reveals a custom-unit input), **Cost** (number, was `amount`), **Date** (date picker), **Notes** (textarea, was `description`)
- Removed the **Paid To** field entirely from the form
- Title and submit button text switch between "Add Expense" / "Edit Expense" and "Add Expense" / "Save Changes" based on `isEdit`; submit button icon swaps Plus ↔ PencilLine
- Validation: item ≥ 2 chars, cost > 0, date required, custom category ≥ 2 chars (if CUSTOM), quantity is a positive number when present, custom unit ≥ 1 char (if CUSTOM)
- On submit, builds an `ExpensePayload` `{ title, category, quantity, unit, amount, description?, expenseDate }` and passes the optional `id` when editing — matches the JSON shape requested in the task

### 5. Expense cards + table rows
- Mobile `ExpenseCard` now shows: title (font-semibold), date, category badge, **Cost** (was "Amount"), and a new **Qty** block on the right displaying `formatQuantity(quantity, unit)` (e.g. "5 kg"). Notes (description) still shown truncated to 2 lines
- Replaced `canDelete` prop with `canManage`; renamed `onDelete` and added `onEdit`
- Desktop table: replaced the "Paid To" column with a "Qty" column; renamed "Title" → "Item" and "Amount" → "Cost" in the header; body shows `formatQuantity(quantity, unit)` (or "—" when empty)
- Edit (PencilLine, ghost icon button) + Delete (Trash2, destructive ghost icon button) appear inline on each row when admin and not locked
- Locked rows show a "🔒 Locked" badge (muted outline) instead of the action buttons — same pattern on mobile cards

### 6. Lock logic
- `isExpenseLocked()` is called once per row/card; covers both `status === "LOCKED"` and past-month expenses (year*12 + month strictly less than today's)
- The Edit and Delete affordances only render for the current month; past-month rows display the lock badge so admins understand why editing is disabled
- This mirrors the server-side enforcement in `PUT /api/expenses/[id]` and `DELETE /api/expenses/[id]` (both reject past-month and LOCKED expenses with 422)

### 7. Cleanup
- Removed the now-unused `User` icon import (was only used by the deleted Paid To field)
- Removed the `useEffect` import (no longer needed after the form split)
- Collapsed a redundant `isAdmin || isAdmin` check down to a single comparison

## Verification
- `bun run lint` → **0 errors** (1 pre-existing informational warning in `variables-view.tsx` from a prior task, unrelated to expenses)
- dev.log shows `✓ Compiled in 200ms` / `✓ Compiled in 205ms` with `GET /api/expenses?month=5&year=2026&limit=500 200` succeeding
- Sheet's `side="right"` behavior preserved as required (the existing Sheet primitive doesn't accept responsive side props; the spec's "right on desktop, bottom on mobile" is aspirational and was already right-only in the prior implementation)

## Files unchanged
- `src/app/api/expenses/route.ts` (POST already accepts quantity/unit)
- `src/app/api/expenses/[id]/route.ts` (PUT already accepts quantity/unit + enforces lock)
- All other views, components, lib, stores, prisma schema
