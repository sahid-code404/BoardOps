"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Sigma,
  Plus,
  Play,
  Edit3,
  Archive,
  History,
  X,
  Variable as VariableIcon,
  FunctionSquare,
  Hash,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  FORMULA_FUNCTIONS,
  FORMULA_OPERATORS,
} from "@/lib/formula-engine";

type Variable = {
  id: string;
  key: string;
  name: string;
  type: string;
  value: string;
  unit: string | null;
  category: string;
  isSystem: boolean;
  status: string;
};

type FormulaVersion = {
  id: string;
  version: number;
  expression: string;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

type Formula = {
  id: string;
  name: string;
  key: string;
  description: string | null;
  expression: string;
  returnType: string;
  category: string;
  version: number;
  status: string;
  versions?: FormulaVersion[];
};

type TestResult = {
  value: number;
  error?: string;
  valid: boolean;
  referencedSlugs: string[];
  missingVariables: string[];
  resolvedValues: Record<string, number>;
};

type ApiResponse<T> = { success: boolean; data: T };

export function FormulasView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Formula | null>(null);
  const [historyTarget, setHistoryTarget] = useState<Formula | null>(null);

  const { data: formulas = [], isLoading } = useQuery({
    queryKey: ["formulas"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Formula[]>>("/formulas");
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const { data: variables } = useQuery({
    queryKey: ["variables"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Variable[]>>("/variables");
      return r.data;
    },
  });
  const variablesList = Array.isArray(variables) ? variables : [];

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return formulas.filter(
      (f) =>
        !q ||
        f.name.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q) ||
        f.expression.toLowerCase().includes(q)
    );
  }, [formulas, search]);

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/formulas/${id}`),
    onSuccess: () => {
      toast.success("Formula archived");
      qc.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to archive formula"),
  });

  const activeCount = formulas.filter((f) => f.status === "ACTIVE").length;

  return (
    <StaggerGroup className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Sigma className="h-6 w-6 text-primary" />
              Formula Engine
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Configurable financial formulas with variable slugs, operators, functions, versioning, and live testing.
            </p>
          </div>
          <GlassButton
            size="sm"
            onClick={() => {
              setEditTarget(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Formula
          </GlassButton>
        </div>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Sigma className="h-3.5 w-3.5" /> Total Formulas
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={formulas.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Active
            </div>
            <p className="text-2xl font-bold tabular-nums text-success">
              <AnimatedCounter value={activeCount} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <VariableIcon className="h-3.5 w-3.5" /> Variables Available
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              <AnimatedCounter value={variablesList.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <FunctionSquare className="h-3.5 w-3.5" /> Functions
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={FORMULA_FUNCTIONS.length} />
            </p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Search */}
      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <GlassInput
            placeholder="Search formulas by name, key, or expression…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </GlassCard>
      </StaggerItem>

      {/* Formulas list */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-28 rounded-3xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <Sigma className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No formulas found</p>
            <p className="text-sm text-muted-foreground mb-4">
              Create your first formula to drive billing calculations.
            </p>
            <GlassButton
              size="sm"
              onClick={() => {
                setEditTarget(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New Formula
            </GlassButton>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((f) => (
                <motion.div
                  key={f.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <GlassCard className="p-4" hover>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="grid place-items-center h-10 w-10 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Sigma className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{f.name}</p>
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                              {f.key}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                              v{f.version}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {f.returnType}
                            </span>
                          </div>
                          {f.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 truncate">
                              {f.description}
                            </p>
                          )}
                          <p className="text-xs font-mono mt-1.5 p-2 rounded-lg glass-soft text-foreground/80 break-all line-clamp-2">
                            {f.expression}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {f.versions && f.versions.length > 0 && (
                          <GlassButton
                            variant="ghost"
                            size="sm"
                            onClick={() => setHistoryTarget(f)}
                          >
                            <History className="h-3.5 w-3.5" />
                          </GlassButton>
                        )}
                        <GlassButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditTarget(f);
                            setFormOpen(true);
                          }}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </GlassButton>
                        <GlassButton
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => archiveMutation.mutate(f.id)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </GlassButton>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Formula Builder dialog */}
      <FormulaBuilderDialog
        key={editTarget?.id ?? "new"}
        open={formOpen}
        onOpenChange={setFormOpen}
        editTarget={editTarget}
        variables={variablesList}
      />

      {/* Version history dialog */}
      <VersionHistoryDialog target={historyTarget} onClose={() => setHistoryTarget(null)} />
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Formula Builder Dialog — the main builder with token picker, test panel, live preview
// ─────────────────────────────────────────────────────────────

function FormulaBuilderDialog({
  open,
  onOpenChange,
  editTarget,
  variables,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: Formula | null;
  variables: Variable[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editTarget?.name ?? "");
  const [key, setKey] = useState(editTarget?.key ?? "");
  const [description, setDescription] = useState(editTarget?.description ?? "");
  const [expression, setExpression] = useState(editTarget?.expression ?? "");
  const [returnType, setReturnType] = useState(editTarget?.returnType ?? "CURRENCY");
  const [category, setCategory] = useState(editTarget?.category ?? "BILLING");
  const [changeNote, setChangeNote] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const activeVariables = variables.filter((v) => v.status === "ACTIVE");

  const insertAtCursor = (text: string) => {
    setExpression((prev) => prev + text);
  };

  const insertVar = (slug: string) => {
    insertAtCursor(`var('${slug}')`);
  };

  const insertFunc = (sig: string) => {
    // Insert function with cursor inside parens
    const parenIdx = sig.indexOf("(");
    const name = parenIdx > 0 ? sig.slice(0, parenIdx) : sig;
    insertAtCursor(`${name}()`);
  };

  const testMutation = useMutation({
    mutationFn: async () => {
      setTesting(true);
      const r = await api.post<ApiResponse<TestResult>>("/formulas/test", {
        expression,
      });
      return r.data;
    },
    onSuccess: (data) => {
      setTestResult(data);
      setTesting(false);
    },
    onError: (e: Error) => {
      toast.error(e.message || "Test failed");
      setTesting(false);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        key,
        description: description || undefined,
        expression,
        returnType,
        category,
        ...(editTarget && expression !== editTarget.expression
          ? { changeNote }
          : {}),
      };
      if (editTarget) {
        return api.patch(`/formulas/${editTarget.id}`, payload);
      }
      return api.post("/formulas", payload);
    },
    onSuccess: () => {
      toast.success(editTarget ? "Formula updated" : "Formula created");
      qc.invalidateQueries({ queryKey: ["formulas"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save formula"),
  });

  const expressionChanged = editTarget && expression !== editTarget.expression;
  const needsChangeNote = !!expressionChanged;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma className="h-5 w-5 text-primary" />
            {editTarget ? "Edit Formula" : "New Formula"}
          </DialogTitle>
          <DialogDescription>
            Build a formula using variable slugs, operators, and functions. Test with live variable values before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Meta fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="f-name">Name *</Label>
              <GlassInput
                id="f-name"
                placeholder="e.g. Meal Charges"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="f-key">Key *</Label>
              <GlassInput
                id="f-key"
                placeholder="e.g. formula.mealCharges"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={!!editTarget}
              />
              {editTarget && (
                <p className="text-[10px] text-muted-foreground">Key cannot be changed after creation</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Return Type</Label>
              <Select value={returnType} onValueChange={setReturnType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CURRENCY">Currency (₹)</SelectItem>
                  <SelectItem value="NUMBER">Number</SelectItem>
                  <SelectItem value="PERCENTAGE">Percentage (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label htmlFor="f-cat">Category</Label>
              <GlassInput
                id="f-cat"
                placeholder="e.g. BILLING, MEAL, GUEST"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="f-desc">Description (optional)</Label>
            <GlassInput
              id="f-desc"
              placeholder="What does this formula calculate?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Expression editor */}
          <div className="space-y-1.5">
            <Label>Expression *</Label>
            <textarea
              className="w-full min-h-[100px] p-3 rounded-2xl glass-soft font-mono text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="e.g. (var('total_expense') - var('guest_revenue')) / var('resident_meals')"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
            />
          </div>

          {/* Builder palette: Variables */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <VariableIcon className="h-3 w-3" /> Variables — click to insert
            </p>
            <div className="flex gap-1.5 flex-wrap max-h-28 overflow-y-auto p-2 rounded-xl glass-soft">
              {activeVariables.length === 0 ? (
                <p className="text-xs text-muted-foreground">No active variables. Create variables first.</p>
              ) : (
                activeVariables.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => insertVar(v.key)}
                    className="text-[11px] font-mono px-2 py-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    title={`${v.name} = ${v.value} (${v.type})`}
                  >
                    {v.key}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Builder palette: Operators */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Hash className="h-3 w-3" /> Operators
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {FORMULA_OPERATORS.map((op) => (
                <button
                  key={op}
                  type="button"
                  onClick={() => insertAtCursor(op)}
                  className="grid place-items-center h-8 w-8 rounded-lg glass-soft hover:bg-secondary font-mono text-sm font-bold"
                >
                  {op}
                </button>
              ))}
              <button
                type="button"
                onClick={() => insertAtCursor(" > ")}
                className="grid place-items-center h-8 px-2 rounded-lg glass-soft hover:bg-secondary font-mono text-sm font-bold"
              >
                &gt;
              </button>
              <button
                type="button"
                onClick={() => insertAtCursor(" < ")}
                className="grid place-items-center h-8 px-2 rounded-lg glass-soft hover:bg-secondary font-mono text-sm font-bold"
              >
                &lt;
              </button>
            </div>
          </div>

          {/* Builder palette: Functions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FunctionSquare className="h-3 w-3" /> Functions
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {FORMULA_FUNCTIONS.map((fn) => (
                <button
                  key={fn.name}
                  type="button"
                  onClick={() => insertFunc(fn.sig)}
                  className="text-left p-2 rounded-xl glass-soft hover:bg-secondary transition-colors"
                >
                  <p className="text-xs font-mono font-semibold">{fn.sig}</p>
                  <p className="text-[10px] text-muted-foreground">{fn.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Change note (only when editing + expression changed) */}
          {needsChangeNote && (
            <div className="space-y-1.5 p-3 rounded-xl bg-warning/10 ring-1 ring-warning/30">
              <Label htmlFor="f-note" className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                Change Note (required — creates version {editTarget!.version + 1})
              </Label>
              <GlassInput
                id="f-note"
                placeholder="e.g. Added guest revenue deduction"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
              />
            </div>
          )}

          {/* Test panel */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Test Panel
              </p>
              <GlassButton
                variant="ghost"
                size="sm"
                onClick={() => testMutation.mutate()}
                loading={testing}
                disabled={!expression.trim()}
              >
                <Play className="h-3.5 w-3.5" />
                Test
              </GlassButton>
            </div>
            {testResult && (
              <div
                className={cn(
                  "p-3 rounded-xl space-y-2",
                  testResult.valid
                    ? "bg-success/10 ring-1 ring-success/30"
                    : "bg-destructive/10 ring-1 ring-destructive/30"
                )}
              >
                <div className="flex items-center gap-2">
                  {testResult.valid ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                  <span className="text-sm font-semibold">
                    {testResult.valid ? `Result: ₹${Math.round(testResult.value).toLocaleString("en-IN")}` : "Invalid"}
                  </span>
                  {!testResult.valid && testResult.error && (
                    <span className="text-xs text-destructive">{testResult.error}</span>
                  )}
                </div>
                {testResult.referencedSlugs.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                      Resolved Variables
                    </p>
                    <div className="flex gap-1.5 flex-wrap">
                      {testResult.referencedSlugs.map((slug) => (
                        <span
                          key={slug}
                          className={cn(
                            "text-[10px] font-mono px-1.5 py-0.5 rounded-md",
                            testResult.missingVariables.includes(slug)
                              ? "bg-destructive/15 text-destructive"
                              : "bg-success/15 text-success"
                          )}
                        >
                          {slug} = {testResult.resolvedValues[slug]}
                        </span>
                      ))}
                    </div>
                    {testResult.missingVariables.length > 0 && (
                      <p className="text-[10px] text-warning">
                        ⚠ {testResult.missingVariables.length} variable(s) not found — treated as 0. Create them in the Variable Engine.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </GlassButton>
          <GlassButton
            loading={saveMutation.isPending}
            disabled={!name.trim() || !key.trim() || !expression.trim() || (needsChangeNote && !changeNote.trim())}
            onClick={() => saveMutation.mutate()}
          >
            {editTarget ? "Save Changes" : "Create Formula"}
            <ArrowRight className="h-4 w-4" />
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Version History Dialog
// ─────────────────────────────────────────────────────────────

function VersionHistoryDialog({
  target,
  onClose,
}: {
  target: Formula | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            Version History
          </DialogTitle>
          <DialogDescription>
            {target?.name} ({target?.key}) — all versions preserved for historical bill reproducibility.
          </DialogDescription>
        </DialogHeader>
        {target?.versions && (
          <div className="space-y-2">
            {target.versions.map((v) => (
              <div
                key={v.id}
                className={cn(
                  "p-3 rounded-xl",
                  v.version === target.version ? "bg-primary/10 ring-1 ring-primary/30" : "glass-soft"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold">Version {v.version}</span>
                  {v.version === target.version && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary text-primary-foreground font-medium">
                      Current
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono p-2 rounded-lg glass-soft break-all">{v.expression}</p>
                {v.changeNote && (
                  <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{v.changeNote}&rdquo;</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(v.createdAt).toLocaleString()}
                  {v.user && ` · by ${v.user.name}`}
                </p>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <GlassButton variant="ghost" onClick={onClose}>
            Close
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
