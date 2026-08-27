"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format, isToday, isSameMonth } from "date-fns";
import {
  ShoppingCart,
  Plus,
  Search,
  Trash2,
  Eye,
  X,
  TrendingUp,
  Calendar,
  Store,
  Package as PackageIcon,
  IndianRupee,
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
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Product = {
  id: string;
  name: string;
  category: string;
  defaultUnit: { id: string; name: string } | null;
  isActive: boolean;
};

type Unit = { id: string; name: string; category: string; isActive: boolean };

type PurchaseItem = {
  id: string;
  productId: string | null;
  productName: string;
  category: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
  notes: string | null;
};

type Purchase = {
  id: string;
  vendor: string;
  purchaseDate: string;
  totalAmount: number;
  receiptUrl: string | null;
  notes: string | null;
  status: string;
  deletedAt: string | null;
  createdBy: string | null;
  items?: PurchaseItem[];
  user?: { name: string; email: string } | null;
};

type PurchaseStats = {
  todayTotal: number;
  monthTotal: number;
  monthCount: number;
  topProducts: { name: string; totalSpend: number; totalQuantity: number }[];
  topCategories: { category: string; totalSpend: number }[];
};

type ApiResponse<T> = { success: boolean; data: T };

function formatINR(n: number) {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function PurchasesView() {
  const qc = useQueryClient();
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [viewTarget, setViewTarget] = useState<Purchase | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Purchase | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: purchases = [], isLoading } = useQuery({
    queryKey: ["purchases", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Purchase[]>>("/purchases", {
        params: { month: selectedMonth, year: selectedYear, limit: 500 },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const { data: stats } = useQuery({
    queryKey: ["purchases", "stats", { month: selectedMonth, year: selectedYear }],
    queryFn: async () => {
      const r = await api.get<ApiResponse<PurchaseStats>>("/purchases/stats", {
        params: { month: selectedMonth, year: selectedYear },
      });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return purchases.filter((p) => {
      if (q && !p.vendor.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [purchases, search]);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const prevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12);
      setSelectedYear((y) => y - 1);
    } else setSelectedMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (selectedMonth === 12) {
      setSelectedMonth(1);
      setSelectedYear((y) => y + 1);
    } else setSelectedMonth((m) => m + 1);
  };

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error("No purchase selected");
      return api.patch(`/purchases/${deleteTarget.id}`, {
        action: "SOFT_DELETE",
        reason: deleteReason,
      });
    },
    onSuccess: () => {
      toast.success("Purchase deleted");
      setDeleteTarget(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["purchases"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to delete purchase"),
  });

  return (
    <StaggerGroup className="space-y-5">
      {/* Header */}
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingCart className="h-6 w-6 text-primary" />
              Purchases & Shopping
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Multi-item purchase records. Each purchase auto-creates a linked expense so your expense totals stay in sync.
            </p>
          </div>
          <GlassButton size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            New Purchase
          </GlassButton>
        </div>
      </StaggerItem>

      {/* Month picker */}
      <StaggerItem>
        <GlassCard className="p-3 flex items-center justify-between" hover={false}>
          <GlassButton variant="ghost" size="sm" onClick={prevMonth}>
            ←
          </GlassButton>
          <p className="font-semibold">
            {monthNames[selectedMonth - 1]} {selectedYear}
          </p>
          <GlassButton variant="ghost" size="sm" onClick={nextMonth}>
            →
          </GlassButton>
        </GlassCard>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Calendar className="h-3.5 w-3.5" /> Today&apos;s Purchases
            </div>
            <p className="text-2xl font-bold tabular-nums">
              {formatINR(stats?.todayTotal ?? 0)}
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <TrendingUp className="h-3.5 w-3.5" /> This Month
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              {formatINR(stats?.monthTotal ?? 0)}
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <ShoppingCart className="h-3.5 w-3.5" /> Purchase Count
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={stats?.monthCount ?? 0} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <PackageIcon className="h-3.5 w-3.5" /> Top Product
            </div>
            <p className="text-sm font-semibold truncate">
              {stats?.topProducts?.[0]?.name ?? "—"}
            </p>
            {stats?.topProducts?.[0] && (
              <p className="text-[10px] text-muted-foreground">
                {formatINR(stats.topProducts[0].totalSpend)}
              </p>
            )}
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Top products / categories strip */}
      {stats && stats.topCategories.length > 0 && (
        <StaggerItem>
          <GlassCard className="p-4" hover={false}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Top Categories This Month
            </p>
            <div className="flex gap-2 flex-wrap">
              {stats.topCategories.map((c) => (
                <div
                  key={c.category}
                  className="px-3 py-1.5 rounded-2xl glass-soft flex items-center gap-2"
                >
                  <span className="text-sm font-medium">{c.category}</span>
                  <span className="text-xs text-muted-foreground">{formatINR(c.totalSpend)}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </StaggerItem>
      )}

      {/* Search */}
      <StaggerItem>
        <GlassCard className="p-3" hover={false}>
          <GlassInput
            placeholder="Search by vendor…"
            icon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </GlassCard>
      </StaggerItem>

      {/* Purchases list */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-24 rounded-3xl" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <ShoppingCart className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No purchases this month</p>
            <p className="text-sm text-muted-foreground mb-4">
              Record a shopping trip to track items, quantities, and vendor spending.
            </p>
            <GlassButton size="sm" onClick={() => setFormOpen(true)}>
              <Plus className="h-4 w-4" />
              New Purchase
            </GlassButton>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {filtered.map((p) => (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                >
                  <GlassCard className="p-4" hover>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="grid place-items-center h-10 w-10 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Store className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold truncate">{p.vendor}</p>
                            {p.items && p.items.length > 0 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                                {p.items.length} item{p.items.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(p.purchaseDate), "d MMM yyyy")}
                            {p.user && ` · by ${p.user.name}`}
                          </p>
                          {p.items && p.items.length > 0 && (
                            <p className="text-xs text-muted-foreground mt-1 truncate">
                              {p.items.slice(0, 4).map((it) => `${it.productName} (${it.quantity}${it.unit})`).join(", ")}
                              {p.items.length > 4 && ` +${p.items.length - 4} more`}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <p className="font-bold tabular-nums text-lg">{formatINR(p.totalAmount)}</p>
                        <GlassButton variant="ghost" size="sm" onClick={() => setViewTarget(p)}>
                          <Eye className="h-3.5 w-3.5" />
                        </GlassButton>
                        <GlassButton
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      {/* New Purchase dialog */}
      <NewPurchaseDialog open={formOpen} onOpenChange={setFormOpen} />

      {/* View Purchase dialog */}
      <ViewPurchaseDialog target={viewTarget} onClose={() => setViewTarget(null)} />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Delete Purchase
            </DialogTitle>
            <DialogDescription>
              This will soft-delete the purchase and its linked expense. They will enter the deletion queue and can be restored within 7 days.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="glass-soft rounded-2xl p-3 space-y-1">
              <p className="text-sm font-semibold">{deleteTarget.vendor}</p>
              <p className="text-xs text-muted-foreground">
                {formatINR(deleteTarget.totalAmount)} · {deleteTarget.items?.length ?? 0} item(s)
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="del-reason">Reason (required)</Label>
            <GlassInput
              id="del-reason"
              placeholder="e.g. Duplicate entry, incorrect amount"
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="danger"
              loading={deleteMutation.isPending}
              disabled={!deleteReason.trim()}
              onClick={() => deleteMutation.mutate()}
            >
              Delete Purchase
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// New Purchase Dialog (multi-item)
// ─────────────────────────────────────────────────────────────

type DraftItem = {
  productId: string | null;
  productName: string;
  category: string;
  quantity: string;
  unit: string;
  rate: string;
  total: number;
};

function NewPurchaseDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const [vendor, setVendor] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([
    { productId: null, productName: "", category: "GENERAL", quantity: "1", unit: "piece", rate: "0", total: 0 },
  ]);

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Product[]>>("/products");
      return r.data;
    },
    enabled: open,
  });

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Unit[]>>("/units");
      return r.data;
    },
    enabled: open,
  });

  const activeProducts = products.filter((p) => p.isActive);
  const activeUnits = units.filter((u) => u.isActive);

  const totalAmount = items.reduce((s, it) => s + it.total, 0);

  const updateItem = (idx: number, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        // recompute total
        const qty = parseFloat(next.quantity) || 0;
        const rate = parseFloat(next.rate) || 0;
        next.total = Math.round(qty * rate * 100) / 100;
        return next;
      })
    );
  };

  const onProductSelect = (idx: number, productId: string) => {
    if (productId === "custom") {
      updateItem(idx, { productId: null, productName: "", category: "GENERAL" });
      return;
    }
    const p = activeProducts.find((x) => x.id === productId);
    if (p) {
      updateItem(idx, {
        productId: p.id,
        productName: p.name,
        category: p.category,
        unit: p.defaultUnit?.name ?? "piece",
      });
    }
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { productId: null, productName: "", category: "GENERAL", quantity: "1", unit: "piece", rate: "0", total: 0 },
    ]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const mutation = useMutation({
    mutationFn: () => {
      // Validate
      if (!vendor.trim()) throw new Error("Vendor is required");
      if (items.length === 0) throw new Error("At least one item is required");
      for (const it of items) {
        if (!it.productName.trim()) throw new Error("All items need a product name");
        const qty = parseFloat(it.quantity);
        if (!qty || qty <= 0) throw new Error("All quantities must be positive");
      }
      return api.post("/purchases", {
        vendor: vendor.trim(),
        purchaseDate,
        notes: notes.trim() || null,
        items: items.map((it) => ({
          productId: it.productId,
          productName: it.productName.trim(),
          category: it.category,
          quantity: parseFloat(it.quantity),
          unit: it.unit,
          rate: parseFloat(it.rate) || 0,
          total: it.total,
        })),
      });
    },
    onSuccess: () => {
      toast.success(`Purchase of ${formatINR(totalAmount)} recorded`);
      // Reset form
      setVendor("");
      setNotes("");
      setItems([{ productId: null, productName: "", category: "GENERAL", quantity: "1", unit: "piece", rate: "0", total: 0 }]);
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create purchase"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" />
            New Purchase
          </DialogTitle>
          <DialogDescription>
            Record a shopping trip with multiple items. Each purchase also creates a linked expense so your totals stay in sync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Vendor + date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vendor">Vendor / Shop *</Label>
              <GlassInput
                id="vendor"
                placeholder="e.g. Local Market, Big Bazaar"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdate">Purchase Date *</Label>
              <GlassInput
                id="pdate"
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
            </div>
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <GlassButton variant="ghost" size="sm" onClick={addItem}>
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </GlassButton>
            </div>
            <div className="space-y-2">
              {items.map((it, idx) => (
                <div key={idx} className="glass-soft rounded-2xl p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <Label className="text-[10px]">Product</Label>
                      <Select
                        value={it.productId ?? "custom"}
                        onValueChange={(v) => onProductSelect(idx, v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select product or type custom" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">— Custom (type name) —</SelectItem>
                          {activeProducts.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} · {p.category}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {it.productId === null && (
                      <div className="flex-1">
                        <Label className="text-[10px]">Product Name</Label>
                        <GlassInput
                          placeholder="e.g. Fish, Rice"
                          value={it.productName}
                          onChange={(e) => updateItem(idx, { productName: e.target.value })}
                          className="h-9"
                        />
                      </div>
                    )}
                    <GlassButton
                      variant="ghost"
                      size="sm"
                      className="mt-5 text-destructive hover:text-destructive"
                      onClick={() => removeItem(idx)}
                      disabled={items.length === 1}
                    >
                      <X className="h-3.5 w-3.5" />
                    </GlassButton>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-[10px]">Qty</Label>
                      <GlassInput
                        type="number"
                        step="0.01"
                        value={it.quantity}
                        onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Unit</Label>
                      <Select value={it.unit} onValueChange={(v) => updateItem(idx, { unit: v })}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activeUnits.map((u) => (
                            <SelectItem key={u.id} value={u.name}>
                              {u.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px]">Rate (₹)</Label>
                      <GlassInput
                        type="number"
                        step="0.01"
                        value={it.rate}
                        onChange={(e) => updateItem(idx, { rate: e.target.value })}
                        className="h-9"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px]">Total</Label>
                      <div className="h-9 grid place-items-center font-semibold tabular-nums text-sm">
                        {formatINR(it.total)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes (optional)</Label>
            <GlassInput
              id="notes"
              placeholder="e.g. Morning market run, weekly groceries"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Total */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <span className="text-sm font-medium text-muted-foreground">Purchase Total</span>
            <span className="text-xl font-bold tabular-nums flex items-center">
              <IndianRupee className="h-4 w-4" />
              {Math.round(totalAmount).toLocaleString("en-IN")}
            </span>
          </div>
        </div>

        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </GlassButton>
          <GlassButton
            loading={mutation.isPending}
            disabled={!vendor.trim() || items.length === 0}
            onClick={() => mutation.mutate()}
          >
            Record Purchase
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// View Purchase Dialog
// ─────────────────────────────────────────────────────────────

function ViewPurchaseDialog({
  target,
  onClose,
}: {
  target: Purchase | null;
  onClose: () => void;
}) {
  const { data: fullPurchase } = useQuery({
    queryKey: ["purchase", target?.id],
    queryFn: async () => {
      if (!target) return null;
      const r = await api.get<ApiResponse<Purchase & { items: PurchaseItem[] }>>(
        `/purchases/${target.id}`
      );
      return r.data;
    },
    enabled: !!target,
  });

  return (
    <Dialog open={!!target} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            {target?.vendor}
          </DialogTitle>
          <DialogDescription>
            {target && format(new Date(target.purchaseDate), "d MMMM yyyy")}
          </DialogDescription>
        </DialogHeader>
        {fullPurchase && (
          <div className="space-y-3">
            {fullPurchase.notes && (
              <p className="text-sm text-muted-foreground italic">&ldquo;{fullPurchase.notes}&rdquo;</p>
            )}
            <div className="space-y-1.5">
              {fullPurchase.items?.map((it) => (
                <div key={it.id} className="flex items-center justify-between p-2.5 rounded-xl glass-soft">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{it.productName}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {it.quantity} {it.unit} × {formatINR(it.rate)} · {it.category}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums text-sm shrink-0">{formatINR(it.total)}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between p-3 rounded-2xl bg-primary/10">
              <span className="font-semibold text-sm">Total</span>
              <span className="font-bold tabular-nums">{formatINR(fullPurchase.totalAmount)}</span>
            </div>
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
