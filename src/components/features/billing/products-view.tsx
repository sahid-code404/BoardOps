"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Package,
  Plus,
  Search,
  Archive,
  RotateCcw,
  Trash2,
  Edit3,
  Ruler,
  Tag,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Unit = {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
};

type Product = {
  id: string;
  name: string;
  slug: string;
  category: string;
  defaultUnitId: string | null;
  defaultUnit: Unit | null;
  isActive: boolean;
  archivedAt: string | null;
  createdAt: string;
};

type ApiResponse<T> = { success: boolean; data: T };

const UNIT_CATEGORIES = [
  { value: "WEIGHT", label: "Weight (kg, gm)" },
  { value: "VOLUME", label: "Volume (litre, ml)" },
  { value: "QUANTITY", label: "Quantity (piece, packet)" },
  { value: "OTHER", label: "Other" },
];

export function ProductsView() {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [productFormOpen, setProductFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [unitFormOpen, setUnitFormOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products", { includeArchived: showArchived }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Product[]>>("/products", {
        params: { includeArchived: showArchived ? "true" : "false" },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Unit[]>>("/units");
      return r.data;
    },
  });

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category));
    return ["ALL", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "ALL" && p.category !== categoryFilter) return false;
      if (q && !p.name.toLowerCase().includes(q) && !p.category.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [products, search, categoryFilter]);

  const activeCount = products.filter((p) => p.isActive).length;
  const archivedCount = products.filter((p) => !p.isActive).length;

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      toast.success("Product removed");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete product"),
  });

  const toggleArchiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/products/${id}`, { isActive }),
    onSuccess: () => {
      toast.success("Product updated");
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update product"),
  });

  return (
    <StaggerGroup className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Package className="h-6 w-6 text-primary" />
              Product Catalog
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Reusable list of purchasable items. Purchase records reference these products for consistent reporting.
            </p>
          </div>
          <div className="flex gap-2">
            <GlassButton variant="ghost" size="sm" onClick={() => setUnitFormOpen(true)}>
              <Ruler className="h-4 w-4" />
              Manage Units
            </GlassButton>
            <GlassButton size="sm" onClick={() => { setEditTarget(null); setProductFormOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add Product
            </GlassButton>
          </div>
        </div>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Package className="h-3.5 w-3.5" /> Total Products
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={products.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Tag className="h-3.5 w-3.5" /> Active
            </div>
            <p className="text-2xl font-bold tabular-nums text-success">
              <AnimatedCounter value={activeCount} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Archive className="h-3.5 w-3.5" /> Archived
            </div>
            <p className="text-2xl font-bold tabular-nums text-muted-foreground">
              <AnimatedCounter value={archivedCount} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Ruler className="h-3.5 w-3.5" /> Units
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              <AnimatedCounter value={units.filter((u) => u.isActive).length} />
            </p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Search + Filters */}
      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <GlassInput
                placeholder="Search products by name or category…"
                icon={<Search className="h-4 w-4" />}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c === "ALL" ? "All Categories" : c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} />
              Show archived
            </label>
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Products grid */}
      <StaggerItem>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-28 rounded-3xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <Package className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No products found</p>
            <p className="text-sm text-muted-foreground mb-4">
              {search || categoryFilter !== "ALL"
                ? "Try adjusting your search or filters."
                : "Add your first product to start building the catalog."}
            </p>
            <GlassButton size="sm" onClick={() => { setEditTarget(null); setProductFormOpen(true); }}>
              <Plus className="h-4 w-4" />
              Add Product
            </GlassButton>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <GlassCard className="p-4 h-full flex flex-col" hover>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="grid place-items-center h-9 w-9 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Package className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{p.slug}</p>
                        </div>
                      </div>
                      {!p.isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                      <span className="px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                        {p.category}
                      </span>
                      {p.defaultUnit && (
                        <span className="flex items-center gap-0.5">
                          <Ruler className="h-3 w-3" />
                          {p.defaultUnit.name}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-auto">
                      <GlassButton
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => { setEditTarget(p); setProductFormOpen(true); }}
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </GlassButton>
                      <GlassButton
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleArchiveMutation.mutate({ id: p.id, isActive: !p.isActive })}
                      >
                        {p.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      </GlassButton>
                      <GlassButton
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </GlassButton>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Product form dialog */}
      <ProductFormDialog
        key={editTarget?.id ?? "new"}
        open={productFormOpen}
        onOpenChange={setProductFormOpen}
        editTarget={editTarget}
        units={units}
      />

      {/* Units management dialog */}
      <UnitsDialog open={unitFormOpen} onOpenChange={setUnitFormOpen} />
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Product Form Dialog
// ─────────────────────────────────────────────────────────────

function ProductFormDialog({
  open,
  onOpenChange,
  editTarget,
  units,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: Product | null;
  units: Unit[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(editTarget?.name ?? "");
  const [category, setCategory] = useState(editTarget?.category ?? "GENERAL");
  const [defaultUnitId, setDefaultUnitId] = useState<string>(editTarget?.defaultUnitId ?? "none");

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        category,
        defaultUnitId: defaultUnitId === "none" ? null : defaultUnitId,
      };
      if (editTarget) {
        return api.patch(`/products/${editTarget.id}`, payload);
      }
      return api.post("/products", payload);
    },
    onSuccess: () => {
      toast.success(editTarget ? "Product updated" : "Product created");
      qc.invalidateQueries({ queryKey: ["products"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save product"),
  });

  const activeUnits = units.filter((u) => u.isActive);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editTarget ? "Edit Product" : "Add Product"}</DialogTitle>
          <DialogDescription>
            Products are reusable catalog items referenced by purchases for consistent reporting.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="prod-name">Product Name *</Label>
            <GlassInput
              id="prod-name"
              placeholder="e.g. Fish, Rice, Cooking Oil"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="prod-cat">Category *</Label>
            <GlassInput
              id="prod-cat"
              placeholder="e.g. Non-Veg, Grains, Oil, Vegetables, Dairy"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Default Unit (optional)</Label>
            <Select value={defaultUnitId} onValueChange={setDefaultUnitId}>
              <SelectTrigger>
                <SelectValue placeholder="No default unit" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No default unit</SelectItem>
                {activeUnits.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name} ({u.category})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </GlassButton>
          <GlassButton
            loading={mutation.isPending}
            disabled={!name.trim() || !category.trim()}
            onClick={() => mutation.mutate()}
          >
            {editTarget ? "Save Changes" : "Create Product"}
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Units Management Dialog
// ─────────────────────────────────────────────────────────────

function UnitsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("QUANTITY");

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Unit[]>>("/units");
      return r.data;
    },
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/units", { name: name.trim(), category }),
    onSuccess: () => {
      toast.success(`Unit "${name.trim()}" added`);
      setName("");
      qc.invalidateQueries({ queryKey: ["units"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to add unit"),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/units/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["units"] }),
    onError: (e: Error) => toast.error(e.message || "Failed to update unit"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5 text-primary" />
            Manage Units
          </DialogTitle>
          <DialogDescription>
            Units are used in purchases (e.g. kg, litre, piece). Deactivating a unit doesn&apos;t affect historical purchases.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {/* Add new unit */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="unit-name">Unit Name</Label>
              <GlassInput
                id="unit-name"
                placeholder="e.g. box, crate, bag"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <GlassButton
              size="sm"
              loading={createMutation.isPending}
              disabled={!name.trim()}
              onClick={() => createMutation.mutate()}
            >
              <Plus className="h-4 w-4" />
              Add
            </GlassButton>
          </div>

          {/* Units list */}
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {units.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between p-2 rounded-xl glass-soft"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">{u.name}</span>
                  <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded-full bg-secondary">
                    {u.category}
                  </span>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Switch
                    checked={u.isActive}
                    onCheckedChange={(v) => toggleMutation.mutate({ id: u.id, isActive: v })}
                  />
                  {u.isActive ? "Active" : "Inactive"}
                </label>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
