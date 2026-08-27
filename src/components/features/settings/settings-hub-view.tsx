"use client";

import { useState } from "react";
import { GlassNav } from "@/components/glass/glass-nav";
import { SettingsView } from "@/components/features/settings/settings-view";
import { PoliciesView } from "@/components/features/settings/policies-view";
import { PersonalizationView } from "@/components/features/personalization/personalization-view";
import { HolidaysView } from "@/components/features/settings/holidays-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

type Tab = "institution" | "policies" | "appearance" | "calendar";

const TABS = [
  { value: "institution", label: "Institution" },
  { value: "policies", label: "Policies" },
  { value: "appearance", label: "Appearance" },
  { value: "calendar", label: "Calendar" },
];

export function SettingsHubView() {
  const [tab, setTab] = useState<Tab>("institution");
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav items={TABS} value={tab} onChange={(v) => setTab(v as Tab)} className="w-full" />
      </StaggerItem>
      {tab === "institution" && <SettingsView />}
      {tab === "policies" && <PoliciesView />}
      {tab === "appearance" && <PersonalizationView />}
      {tab === "calendar" && <HolidaysView />}
    </StaggerGroup>
  );
}
