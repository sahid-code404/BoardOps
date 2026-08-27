"use client";

import { useState } from "react";
import { GlassNav } from "@/components/glass/glass-nav";
import { AuditView } from "@/components/features/audit/audit-view";
import { TasksView } from "@/components/features/tasks/tasks-view";
import { DataExportView } from "@/components/features/system/data-export-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

type Tab = "audit" | "tasks" | "export";

const TABS = [
  { value: "audit", label: "Audit Log" },
  { value: "tasks", label: "Background Tasks" },
  { value: "export", label: "Data Export" },
];

export function SystemHubView() {
  const [tab, setTab] = useState<Tab>("audit");
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav items={TABS} value={tab} onChange={(v) => setTab(v as Tab)} className="w-full" />
      </StaggerItem>
      {tab === "audit" && <AuditView />}
      {tab === "tasks" && <TasksView />}
      {tab === "export" && <DataExportView />}
    </StaggerGroup>
  );
}
