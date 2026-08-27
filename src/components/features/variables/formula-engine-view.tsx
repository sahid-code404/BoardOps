"use client";

import { useState } from "react";
import { GlassNav } from "@/components/glass/glass-nav";
import { VariablesView } from "@/components/features/variables/variables-view";
import { FormulasView } from "@/components/features/variables/formulas-view";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";

type Tab = "variables" | "formulas";

const TABS = [
  { value: "variables", label: "Variables" },
  { value: "formulas", label: "Formulas" },
];

export function FormulaEngineView() {
  const [tab, setTab] = useState<Tab>("variables");
  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <GlassNav items={TABS} value={tab} onChange={(v) => setTab(v as Tab)} className="w-full" />
      </StaggerItem>
      {tab === "variables" && <VariablesView />}
      {tab === "formulas" && <FormulasView />}
    </StaggerGroup>
  );
}
