"use client";

import { BillingView } from "@/components/features/billing/billing-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

export function BillingHubView() {
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <BillingView />
      </StaggerItem>
    </StaggerGroup>
  );
}
