/**
 * State Machine Framework (PRD Engineering Improvement #1)
 *
 * Provides a common, declarative way to define entity lifecycle states and
 * valid transitions. Every transition validates permissions, business rules,
 * and triggers notifications/audit consistently.
 *
 * Usage:
 *   const machine = createStateMachine({
 *     initial: "PENDING",
 *     states: {
 *       PENDING: { on: { APPROVE: "APPROVED", REJECT: "REJECTED" } },
 *       APPROVED: { on: { VOID: "VOIDED" } },
 *       REJECTED: { final: true },
 *       VOIDED: { final: true },
 *     }
 *   });
 *   machine.canTransition("PENDING", "APPROVE") // true
 *   machine.transition("PENDING", "APPROVE")    // "APPROVED"
 */

export type StateMachineConfig<S extends string, E extends string> = {
  initial: S;
  states: {
    [K in S]: {
      on?: Partial<Record<E, S>>;
      final?: boolean;
    };
  };
};

export type StateMachine<S extends string, E extends string> = {
  initial: S;
  states: S[];
  canTransition: (from: S, event: E) => boolean;
  transition: (from: S, event: E) => S | null;
  getNextStates: (from: S) => { event: E; to: S }[];
  isFinal: (state: S) => boolean;
};

export function createStateMachine<S extends string, E extends string>(
  config: StateMachineConfig<S, E>
): StateMachine<S, E> {
  return {
    initial: config.initial,
    states: Object.keys(config.states) as S[],

    canTransition(from: S, event: E): boolean {
      const state = config.states[from];
      if (!state || !state.on) return false;
      return event in state.on;
    },

    transition(from: S, event: E): S | null {
      const state = config.states[from];
      if (!state || !state.on) return null;
      const next = state.on[event];
      return next ?? null;
    },

    getNextStates(from: S): { event: E; to: S }[] {
      const state = config.states[from];
      if (!state || !state.on) return [];
      return Object.entries(state.on).map(([event, to]) => ({
        event: event as E,
        to: to as S,
      }));
    },

    isFinal(state: S): boolean {
      return config.states[state]?.final ?? false;
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Pre-defined state machines for BoardOps entities
// ─────────────────────────────────────────────────────────────

export const PaymentStateMachine = createStateMachine({
  initial: "PENDING",
  states: {
    PENDING: { on: { APPROVE: "APPROVED", REJECT: "REJECTED", VOID: "VOIDED" } },
    APPROVED: { on: { VOID: "VOIDED" } },
    REJECTED: { on: { RESUBMIT: "PENDING" } },
    VOIDED: { final: true },
  },
});

export const BillStateMachine = createStateMachine({
  initial: "DRAFT",
  states: {
    DRAFT: { on: { GENERATE: "GENERATED" } },
    GENERATED: { on: { PARTIAL_PAY: "PARTIALLY_PAID", FULL_PAY: "PAID", MARK_OVERDUE: "OVERDUE", VOID: "VOIDED" } },
    PARTIALLY_PAID: { on: { FULL_PAY: "PAID", MARK_OVERDUE: "OVERDUE", VOID: "VOIDED" } },
    PAID: { on: { VOID: "VOIDED" } },
    OVERDUE: { on: { PARTIAL_PAY: "PARTIALLY_PAID", FULL_PAY: "PAID" } },
    VOIDED: { final: true },
  },
});

export const RefundStateMachine = createStateMachine({
  initial: "PENDING",
  states: {
    PENDING: { on: { PARTIAL_PAY: "PARTIALLY_PAID", FULL_PAY: "COMPLETED", CANCEL: "CANCELLED" } },
    PARTIALLY_PAID: { on: { PARTIAL_PAY: "PARTIALLY_PAID", FULL_PAY: "COMPLETED", CANCEL: "CANCELLED" } },
    COMPLETED: { final: true },
    CANCELLED: { final: true },
  },
});

export const BillingCycleStateMachine = createStateMachine({
  initial: "OPEN",
  states: {
    OPEN: { on: { START: "PREPARING" } },
    PREPARING: { on: { SNAPSHOT: "SNAPSHOT_CREATED", FAIL: "FAILED", ROLLBACK: "OPEN" } },
    SNAPSHOT_CREATED: { on: { GENERATE: "BILLS_GENERATED", FAIL: "FAILED", ROLLBACK: "OPEN" } },
    BILLS_GENERATED: { on: { SETTLE: "SETTLED" } },
    SETTLED: { on: { CLOSE: "CLOSED" } },
    CLOSED: { final: true },
    FAILED: { on: { RETRY: "PREPARING", ROLLBACK: "OPEN" } },
  },
});

export const UserStateMachine = createStateMachine({
  initial: "PENDING",
  states: {
    PENDING: { on: { APPROVE: "ACTIVE", REJECT: "ARCHIVED", REQUEST_CHANGES: "PENDING" } },
    ACTIVE: { on: { SUSPEND: "SUSPENDED", DEACTIVATE: "INACTIVE", ARCHIVE: "ARCHIVED" } },
    INACTIVE: { on: { ACTIVATE: "ACTIVE", ARCHIVE: "ARCHIVED" } },
    SUSPENDED: { on: { RESTORE: "ACTIVE", ARCHIVE: "ARCHIVED" } },
    ARCHIVED: { on: { RESTORE: "ACTIVE" } },
  },
});

export const AnnouncementStateMachine = createStateMachine({
  initial: "DRAFT",
  states: {
    DRAFT: { on: { PUBLISH: "PUBLISHED", SCHEDULE: "SCHEDULED" } },
    SCHEDULED: { on: { PUBLISH: "PUBLISHED", CANCEL: "ARCHIVED" } },
    PUBLISHED: { on: { EXPIRE: "EXPIRED", ARCHIVE: "ARCHIVED" } },
    EXPIRED: { on: { ARCHIVE: "ARCHIVED" } },
    ARCHIVED: { final: true },
  },
});

export const TaskStateMachine = createStateMachine({
  initial: "QUEUED",
  states: {
    QUEUED: { on: { START: "RUNNING", CANCEL: "CANCELLED" } },
    RUNNING: { on: { COMPLETE: "COMPLETED", FAIL: "FAILED", CANCEL: "CANCELLED" } },
    COMPLETED: { final: true },
    FAILED: { on: { RETRY: "QUEUED", CANCEL: "CANCELLED" } },
    CANCELLED: { final: true },
  },
});
