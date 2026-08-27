"use client";

import { useState } from "react";
import { GlassNav } from "@/components/glass/glass-nav";
import { NotificationsView } from "@/components/features/notifications/notifications-view";
import { AnnouncementsView } from "@/components/features/notifications/announcements-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

type Tab = "notifications" | "announcements";

const TABS = [
  { value: "notifications", label: "Personal" },
  { value: "announcements", label: "Announcements" },
];

export function NotificationsHubView() {
  const [tab, setTab] = useState<Tab>("notifications");
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav items={TABS} value={tab} onChange={(v) => setTab(v as Tab)} className="w-full" />
      </StaggerItem>
      {tab === "notifications" && <NotificationsView />}
      {tab === "announcements" && <AnnouncementsView />}
    </StaggerGroup>
  );
}
