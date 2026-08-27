/**
 * Business Event Catalog (PRD Engineering Improvement #2)
 *
 * Defines every business event in BoardOps. Modules subscribe to events
 * instead of calling each other directly — keeping the architecture modular.
 *
 * Usage:
 *   import { emit, on } from "@/lib/event-catalog";
 *   on("PAYMENT_APPROVED", async (payload) => { ... });
 *   await emit("PAYMENT_APPROVED", { paymentId, userId, amount });
 *
 * In a production system this would use a message broker (Redis, RabbitMQ).
 * Here we use an in-process event emitter — simple but sufficient.
 */

export type BusinessEvent =
  | "USER_REGISTERED"
  | "EMAIL_VERIFIED"
  | "USER_APPROVED"
  | "USER_REJECTED"
  | "USER_CHANGES_REQUESTED"
  | "USER_RESUBMITTED"
  | "MEAL_BOOKED"
  | "MEAL_CANCELLED"
  | "MEAL_LOCKED"
  | "MEAL_OVERRIDDEN"
  | "PAYMENT_SUBMITTED"
  | "PAYMENT_APPROVED"
  | "PAYMENT_REJECTED"
  | "PAYMENT_VOIDED"
  | "BILL_GENERATED"
  | "BILL_UPDATED"
  | "REFUND_CREATED"
  | "REFUND_PARTIAL_PAID"
  | "REFUND_COMPLETED"
  | "ADJUSTMENT_CREATED"
  | "MONTHLY_CLOSING_STARTED"
  | "MONTHLY_CLOSING_COMPLETED"
  | "MONTHLY_CLOSING_FAILED"
  | "RESTRICTION_APPLIED"
  | "RESTRICTION_LIFTED"
  | "RESTRICTION_EXEMPTED"
  | "ANNOUNCEMENT_PUBLISHED"
  | "ANNOUNCEMENT_ARCHIVED"
  | "HOLIDAY_CREATED"
  | "EXPENSE_CREATED"
  | "EXPENSE_LOCKED"
  | "PURCHASE_CREATED"
  | "POLICY_UPDATED"
  | "FORMULA_UPDATED";

export type EventHandler = (payload: Record<string, unknown>) => Promise<void> | void;

const handlers = new Map<BusinessEvent, Set<EventHandler>>();

/** Subscribe to a business event. Returns an unsubscribe function. */
export function on(event: BusinessEvent, handler: EventHandler): () => void {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
  }
  handlers.get(event)!.add(handler);
  return () => {
    handlers.get(event)?.delete(handler);
  };
}

/** Emit a business event to all subscribers. Errors in handlers are caught + logged. */
export async function emit(event: BusinessEvent, payload: Record<string, unknown> = {}): Promise<void> {
  const eventHandlers = handlers.get(event);
  if (!eventHandlers) return;
  for (const handler of eventHandlers) {
    try {
      await handler(payload);
    } catch (e) {
      console.error(`[Event:${event}] handler error:`, e);
    }
  }
}

/** Get all registered events (for debugging/introspection). */
export function getRegisteredEvents(): BusinessEvent[] {
  return Array.from(handlers.keys());
}

/** Get the count of handlers for a specific event. */
export function getHandlerCount(event: BusinessEvent): number {
  return handlers.get(event)?.size ?? 0;
}

// ─────────────────────────────────────────────────────────────
// Event metadata (for documentation + UI display)
// ─────────────────────────────────────────────────────────────

export const EVENT_METADATA: Record<BusinessEvent, { label: string; category: string; description: string }> = {
  USER_REGISTERED: { label: "User Registered", category: "AUTH", description: "A new resident submitted a registration" },
  EMAIL_VERIFIED: { label: "Email Verified", category: "AUTH", description: "A resident verified their email address" },
  USER_APPROVED: { label: "User Approved", category: "AUTH", description: "Admin approved a resident's registration" },
  USER_REJECTED: { label: "User Rejected", category: "AUTH", description: "Admin rejected a resident's registration" },
  USER_CHANGES_REQUESTED: { label: "Changes Requested", category: "AUTH", description: "Admin requested changes to a registration" },
  USER_RESUBMITTED: { label: "User Resubmitted", category: "AUTH", description: "A resident resubmitted their registration after changes" },
  MEAL_BOOKED: { label: "Meal Booked", category: "MEAL", description: "A resident turned a meal ON" },
  MEAL_CANCELLED: { label: "Meal Cancelled", category: "MEAL", description: "A resident turned a meal OFF" },
  MEAL_LOCKED: { label: "Meal Locked", category: "MEAL", description: "A meal's booking cutoff passed" },
  MEAL_OVERRIDDEN: { label: "Meal Overridden", category: "MEAL", description: "Admin overrode a locked meal" },
  PAYMENT_SUBMITTED: { label: "Payment Submitted", category: "PAYMENT", description: "A resident submitted a deposit payment" },
  PAYMENT_APPROVED: { label: "Payment Approved", category: "PAYMENT", description: "Admin approved a payment" },
  PAYMENT_REJECTED: { label: "Payment Rejected", category: "PAYMENT", description: "Admin rejected a payment" },
  PAYMENT_VOIDED: { label: "Payment Voided", category: "PAYMENT", description: "Admin voided an approved payment" },
  BILL_GENERATED: { label: "Bill Generated", category: "BILLING", description: "A bill was generated for a resident" },
  BILL_UPDATED: { label: "Bill Updated", category: "BILLING", description: "An existing bill was recalculated" },
  REFUND_CREATED: { label: "Refund Created", category: "REFUND", description: "A refund was initiated for a resident" },
  REFUND_PARTIAL_PAID: { label: "Partial Refund Paid", category: "REFUND", description: "A partial refund payment was processed" },
  REFUND_COMPLETED: { label: "Refund Completed", category: "REFUND", description: "A refund was fully completed" },
  ADJUSTMENT_CREATED: { label: "Adjustment Created", category: "FINANCIAL", description: "An adjustment entry was created to correct a financial record" },
  MONTHLY_CLOSING_STARTED: { label: "Monthly Closing Started", category: "BILLING", description: "The monthly closing workflow began" },
  MONTHLY_CLOSING_COMPLETED: { label: "Monthly Closing Completed", category: "BILLING", description: "The monthly closing workflow finished successfully" },
  MONTHLY_CLOSING_FAILED: { label: "Monthly Closing Failed", category: "BILLING", description: "The monthly closing workflow encountered an error" },
  RESTRICTION_APPLIED: { label: "Restriction Applied", category: "RESTRICTION", description: "A meal booking restriction was applied to a resident" },
  RESTRICTION_LIFTED: { label: "Restriction Lifted", category: "RESTRICTION", description: "A meal booking restriction was lifted" },
  RESTRICTION_EXEMPTED: { label: "Restriction Exempted", category: "RESTRICTION", description: "An admin exempted a resident from the low balance policy" },
  ANNOUNCEMENT_PUBLISHED: { label: "Announcement Published", category: "NOTIFICATION", description: "An institution-wide announcement was published" },
  ANNOUNCEMENT_ARCHIVED: { label: "Announcement Archived", category: "NOTIFICATION", description: "An announcement was archived" },
  HOLIDAY_CREATED: { label: "Holiday Created", category: "CALENDAR", description: "A holiday or calendar event was created" },
  EXPENSE_CREATED: { label: "Expense Created", category: "FINANCIAL", description: "An expense was recorded" },
  EXPENSE_LOCKED: { label: "Expense Locked", category: "FINANCIAL", description: "An expense was locked during monthly closing" },
  PURCHASE_CREATED: { label: "Purchase Created", category: "FINANCIAL", description: "A multi-item purchase was recorded" },
  POLICY_UPDATED: { label: "Policy Updated", category: "SYSTEM", description: "A system policy was changed" },
  FORMULA_UPDATED: { label: "Formula Updated", category: "SYSTEM", description: "A billing formula was updated to a new version" },
};
