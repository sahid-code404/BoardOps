"use client";

import { ExpensesView } from "@/components/features/billing/expenses-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

export function ExpensesHubView() {
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <ExpensesView />
      </StaggerItem>
    </StaggerGroup>
  );
}
