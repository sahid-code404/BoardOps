"use client";

import { useState, useMemo, memo, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow, format } from "date-fns";
import {
  Users as UsersIcon,
  UserCheck,
  UserPlus,
  UserX,
  Search,
  MoreVertical,
  CheckCircle2,
  Ban,
  Power,
  Archive,
  RotateCcw,
  ShieldCheck,
  Shield,
  Trash2,
  X,
  Mail,
  Phone,
  DoorOpen,
  Pencil,
  KeyRound,
  Eye,
  EyeOff,
  Clock,
  AlertTriangle,
  BadgeCheck,
  MessageSquareWarning,
  Building2,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Resident360Dialog } from "@/components/features/users/resident-360-dialog";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
import { AnimatedCounter } from "@/components/glass/animated-counter";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
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
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useAuthStore, type Role } from "@/stores/use-auth-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDeletionCountdown } from "@/lib/user-cleanup";
import { Checkbox } from "@/components/ui/checkbox";

type UserStatus = "PENDING" | "APPROVED" | "ACTIVE" | "INACTIVE" | "SUSPENDED" | "ARCHIVED";

type ManagedUser = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: Role;
  status: UserStatus;
  room?: string | null;
  gender?: string | null;
  emergencyContact?: string | null;
  avatarUrl?: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
  deletedAt?: string | null;
  deletionReason?: string | null;
  // PRD Module 03 — registration review metadata
  emailVerified?: boolean;
  institutionName?: string | null;
  institutionUserId?: string | null;
  changesRequested?: string | null; // JSON string
  changesRequestReason?: string | null;
  changesRequestedAt?: string | null;
  rejectionReason?: string | null;
};

type Action =
  | "APPROVE"
  | "SUSPEND"
  | "ACTIVATE"
  | "DEACTIVATE"
  | "ARCHIVE"
  | "RESTORE"
  | "ASSIGN_ROLE"
  | "EDIT_USER"
  | "DELETE_USER"
  | "RESTORE_DELETED"
  // PRD Module 03 — DEC-015 review workflow
  | "REQUEST_CHANGES"
  | "REJECT";

const STATUS_META: Record<UserStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-warning/15 text-warning" },
  APPROVED: { label: "Approved", className: "bg-success/15 text-success" },
  ACTIVE: { label: "Active", className: "bg-success/15 text-success" },
  INACTIVE: { label: "Inactive", className: "bg-muted text-muted-foreground" },
  SUSPENDED: { label: "Suspended", className: "bg-destructive/15 text-destructive" },
  ARCHIVED: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

const ROLE_META: Record<Role, { label: string; className: string }> = {
  ADMIN: { label: "Admin", className: "bg-primary/15 text-primary" },
  USER: { label: "Resident", className: "bg-muted text-muted-foreground" },
};

const STATUS_FILTERS: { key: UserStatus | "ALL" | "DELETED"; label: string; short: string }[] = [
  { key: "ALL", label: "All", short: "All" },
  { key: "PENDING", label: "Pending", short: "Pending" },
  { key: "ACTIVE", label: "Active", short: "Active" },
  { key: "SUSPENDED", label: "Suspended", short: "Suspended" },
  { key: "ARCHIVED", label: "Archived", short: "Archived" },
  { key: "DELETED", label: "Deletion Queue", short: "Deletion Queue" },
];

const ACTIONS_NEED_REASON: Action[] = ["SUSPEND", "DEACTIVATE", "ARCHIVE", "REJECT"];
const REQUEST_CHANGES_FIELDS = [
  { key: "name", label: "Full Name" },
  { key: "institutionUserId", label: "Institution User ID" },
  { key: "phone", label: "Mobile Number" },
  { key: "email", label: "Email" },
  { key: "room", label: "Room Number" },
  { key: "gender", label: "Gender" },
] as const;

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = await promise;
  if (res && typeof res === "object" && "success" in res && "data" in (res as Record<string, unknown>)) {
    return (res as { data: T }).data;
  }
  return res as T;
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_GRADIENTS = [
  "from-violet-500 to-fuchsia-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-rose-500 to-pink-500",
  "from-cyan-500 to-blue-500",
  "from-indigo-500 to-purple-500",
];

function gradientFor(name: string) {
  const idx = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx];
}

export function UsersView() {
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === "ADMIN";
  const qc = useQueryClient();
  // Debounced search — `searchInput` drives the input field; `search` is the
  // debounced value (200ms after the user stops typing) used for both the API
  // queryKey (`q: search`) and the client-side filter. Prevents refetching and
  // re-filtering on every keystroke.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 200);
    return () => clearTimeout(t);
  }, [searchInput]);
  const [status, setStatus] = useState<UserStatus | "ALL" | "DELETED">("ALL");
  const [confirm, setConfirm] = useState<{ user: ManagedUser; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [assignRole, setAssignRole] = useState<ManagedUser | null>(null);
  const [newRole, setNewRole] = useState<Role>("USER");
  const [assignReason, setAssignReason] = useState("");
  const [editUser, setEditUser] = useState<ManagedUser | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    email: "",
    phone: "",
    room: "",
    gender: "",
    emergencyContact: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // PRD Module 03 — Request Changes / Reject dialog state
  const [requestChangesTarget, setRequestChangesTarget] = useState<ManagedUser | null>(null);
  const [requestChangesFields, setRequestChangesFields] = useState<string[]>([]);
  const [requestChangesReason, setRequestChangesReason] = useState("");
  const [rejectTarget, setRejectTarget] = useState<ManagedUser | null>(null);
  const [view360Target, setView360Target] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: users = [], isLoading, isFetching } = useQuery({
    queryKey: ["users", { search }],
    queryFn: () =>
      unwrap<ManagedUser[]>(
        api.get("/users", {
          params: { q: search || undefined },
        })
      ),
    enabled: isAdmin,
    placeholderData: (prev) => prev,
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action, role: r, reason: rs }: { id: string; action: Action; role?: Role; reason?: string }) =>
      unwrap<ManagedUser>(api.patch(`/users/${id}`, { action, role: r, reason: rs })),
    onMutate: async ({ id, action, role: r }) => {
      await qc.cancelQueries({ queryKey: ["users"] });
      const prev = qc.getQueryData<ManagedUser[]>(["users", { search, status }]);
      if (prev) {
        const next = prev.map((u) => {
          if (u.id !== id) return u;
          let nextStatus = u.status;
          let nextRole = u.role;
          if (action === "APPROVE" || action === "ACTIVATE" || action === "RESTORE") nextStatus = "ACTIVE";
          if (action === "SUSPEND") nextStatus = "SUSPENDED";
          if (action === "DEACTIVATE") nextStatus = "INACTIVE";
          if (action === "ARCHIVE") nextStatus = "ARCHIVED";
          if (action === "ASSIGN_ROLE" && r) nextRole = r;
          return { ...u, status: nextStatus, role: nextRole };
        });
        qc.setQueryData<ManagedUser[]>(["users", { search, status }], next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["users", { search, status }], ctx.prev);
      toast.error("Action failed");
    },
    onSuccess: (_u, vars) => {
      const labels: Record<Action, string> = {
        APPROVE: "approved",
        SUSPEND: "suspended",
        ACTIVATE: "activated",
        DEACTIVATE: "deactivated",
        ARCHIVE: "archived",
        RESTORE: "restored",
        ASSIGN_ROLE: "role updated",
        EDIT_USER: "updated",
        DELETE_USER: "moved to deletion queue",
        RESTORE_DELETED: "restored",
        REQUEST_CHANGES: "requested changes for",
        REJECT: "rejected",
      };
      toast.success(`User ${labels[vars.action]}`);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await api.put<{ success: boolean; data: ManagedUser }>(`/users/${id}`, data);
      return res.data;
    },
    onSuccess: () => {
      toast.success("User updated successfully");
      setEditUser(null);
      setEditForm({ name: "", email: "", phone: "", room: "", gender: "", emergencyContact: "", password: "" });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to update user");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await api.delete<{ success: boolean; data: ManagedUser }>(`/users/${id}`, { body: JSON.stringify({ reason }) });
      return res.data;
    },
    onSuccess: () => {
      toast.success("User moved to deletion queue (7 days)");
      setDeleteTarget(null);
      setDeleteReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to delete user");
    },
  });

  const restoreDeletedMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.post<{ success: boolean; data: ManagedUser }>(`/users/${id}/restore`);
      return res.data;
    },
    onSuccess: () => {
      toast.success("User restored successfully");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to restore user");
    },
  });

  // PRD Module 03 — Request Changes mutation (PATCH /api/users/[id]/request-changes)
  const requestChangesMutation = useMutation({
    mutationFn: async ({ id, fields, reason }: { id: string; fields: string[]; reason: string }) => {
      const res = await api.patch<{ success: boolean; data: { id: string; status: string; changesRequested: string[] } }>(
        `/users/${id}/request-changes`,
        { fields, reason }
      );
      return res.data;
    },
    onSuccess: () => {
      toast.success("Changes requested — user notified");
      setRequestChangesTarget(null);
      setRequestChangesFields([]);
      setRequestChangesReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to request changes");
    },
  });

  // PRD Module 03 — Reject mutation (PATCH /api/users/[id]/reject)
  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await api.patch<{ success: boolean; data: { id: string; status: string } }>(
        `/users/${id}/reject`,
        { reason }
      );
      return res.data;
    },
    onSuccess: () => {
      toast.success("Registration rejected");
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => {
      toast.error(e.message || "Failed to reject user");
    },
  });

  const kpis = useMemo(() => {
    // Total Users includes everyone (admins + residents, excluding deleted)
    const total = users.filter((u) => !u.deletedAt).length;
    // Active/Pending/Suspended exclude admins — these are resident-facing metrics
    const residents = users.filter((u) => u.role !== "ADMIN");
    const active = residents.filter((u) => u.status === "ACTIVE" && !u.deletedAt).length;
    const pending = residents.filter((u) => u.status === "PENDING").length;
    const suspended = residents.filter((u) => u.status === "SUSPENDED").length;
    const inQueue = residents.filter((u) => u.deletedAt).length;
    return { total, active, pending, suspended, inQueue };
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (status === "DELETED") return users.filter((u) => u.deletedAt);
    if (status === "ALL") return users.filter((u) => !u.deletedAt);
    return users.filter((u) => !u.deletedAt && u.status === status);
  }, [users, status]);

  // Event handlers — declared BEFORE the `if (!isAdmin)` early return so they
  // can be wrapped in `useCallback` (rules of hooks: hooks must be called
  // unconditionally, in the same order, every render).
  const handleAction = useCallback((user: ManagedUser, action: Action) => {
    if (action === "EDIT_USER") {
      setEditForm({
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        room: user.room || "",
        gender: user.gender || "",
        emergencyContact: user.emergencyContact || "",
        password: "",
      });
      setShowPassword(false);
      setEditUser(user);
      return;
    }
    if (action === "DELETE_USER") {
      setDeleteReason("");
      setDeleteTarget(user);
      return;
    }
    if (action === "RESTORE_DELETED") {
      restoreDeletedMutation.mutate(user.id);
      return;
    }
    if (action === "ASSIGN_ROLE") {
      setNewRole(user.role);
      setAssignReason("");
      setAssignRole(user);
      return;
    }
    // PRD Module 03 — Request Changes uses its own dialog with a
    // field multi-select + reason textarea.
    if (action === "REQUEST_CHANGES") {
      setRequestChangesFields([]);
      setRequestChangesReason("");
      setRequestChangesTarget(user);
      return;
    }
    if (ACTIONS_NEED_REASON.includes(action)) {
      setReason("");
      setConfirm({ user, action });
      return;
    }
    actionMutation.mutate({ id: user.id, action });
  }, [actionMutation, restoreDeletedMutation]);

  const submitEdit = useCallback(() => {
    if (!editUser) return;
    if (editForm.name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    const data: Record<string, unknown> = {
      name: editForm.name,
      email: editForm.email,
      phone: editForm.phone || null,
      room: editForm.room || null,
      gender: editForm.gender || null,
      emergencyContact: editForm.emergencyContact || null,
    };
    if (editForm.password) data.password = editForm.password;
    editMutation.mutate({ id: editUser.id, data });
  }, [editUser, editForm, editMutation]);

  const submitConfirm = useCallback(() => {
    if (!confirm) return;
    if (ACTIONS_NEED_REASON.includes(confirm.action) && !reason.trim()) {
      toast.error("A reason is required for this action");
      return;
    }
    // PRD Module 03 — REJECT is routed to the new /api/users/[id]/reject
    // endpoint (sets status=ARCHIVED with rejectionReason) instead of the
    // generic PATCH /api/users/[id] action enum.
    if (confirm.action === "REJECT") {
      rejectMutation.mutate({ id: confirm.user.id, reason });
      setConfirm(null);
      setReason("");
      return;
    }
    actionMutation.mutate({ id: confirm.user.id, action: confirm.action, reason });
    setConfirm(null);
    setReason("");
  }, [confirm, reason, actionMutation, rejectMutation]);

  const submitRequestChanges = useCallback(() => {
    if (!requestChangesTarget) return;
    if (requestChangesFields.length === 0) {
      toast.error("Select at least one field to correct");
      return;
    }
    if (requestChangesReason.trim().length < 3) {
      toast.error("A reason is required (min 3 characters)");
      return;
    }
    requestChangesMutation.mutate({
      id: requestChangesTarget.id,
      fields: requestChangesFields,
      reason: requestChangesReason.trim(),
    });
  }, [requestChangesTarget, requestChangesFields, requestChangesReason, requestChangesMutation]);

  const submitAssignRole = useCallback(() => {
    if (!assignRole) return;
    actionMutation.mutate({
      id: assignRole.id,
      action: "ASSIGN_ROLE",
      role: newRole,
      reason: assignReason || undefined,
    });
    setAssignRole(null);
    setAssignReason("");
  }, [assignRole, newRole, assignReason, actionMutation]);

  const submitDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteReason.trim().length < 3) {
      toast.error("A reason is required (min 3 characters)");
      return;
    }
    deleteMutation.mutate({ id: deleteTarget.id, reason: deleteReason });
  }, [deleteTarget, deleteReason, deleteMutation]);

  if (!isAdmin) {
    return (
      <GlassCard className="p-10 text-center" hover={false}>
        <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold">Admins only</h3>
        <p className="text-sm text-muted-foreground mt-1">
          You need administrator privileges to manage users.
        </p>
      </GlassCard>
    );
  }

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Subtle refetch indicator — thin animated bar at the top of the list.
          Shows on every refetch (search debounced trigger, mutation
          invalidation) but NOT on the initial load (the full skeleton handles
          that). */}
      <AnimatePresence>
        {isFetching && (
          <motion.div
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            style={{ transformOrigin: "left" }}
            className="h-0.5 rounded-full bg-primary/60 shadow-sm shadow-primary/30"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>
      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-3 gap-3">
          <KpiCard label="Total Users" value={kpis.total} icon={UsersIcon} color="primary" sub="All members" />
          <KpiCard label="Active" value={kpis.active} icon={UserCheck} color="success" sub="Approved" />
          <KpiCard label="Pending Approval" value={kpis.pending} icon={UserPlus} color="warning" sub={kpis.pending > 0 ? "Awaiting" : "All clear"} />
        </div>
      </StaggerItem>

      {/* Search + filter */}
      <StaggerItem>
        <div className="space-y-3">
          <GlassInput
            placeholder="Search by name, email, phone, or room…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            icon={<Search />}
          />
          {/* Filter pills — scrollable, all visible left-to-right */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
            {STATUS_FILTERS.map((f) => {
              const active = status === f.key;
              const pendingBadge = f.key === "PENDING" && kpis.pending > 0 ? kpis.pending : null;
              const queueBadge = f.key === "DELETED" && kpis.inQueue > 0 ? kpis.inQueue : null;
              const badge = pendingBadge ?? queueBadge;
              const isQueueBadge = queueBadge !== null;
              return (
                <motion.button
                  key={f.key}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => setStatus(f.key)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-xl text-[11px] font-medium transition-all whitespace-nowrap shrink-0",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : "glass-soft text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span>{f.short}</span>
                  {badge !== null && (
                    <span className={cn(
                      "text-[9px] rounded-full px-1.5 py-0.5 leading-none font-bold min-w-[16px] text-center",
                      active
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : isQueueBadge
                          ? "bg-destructive text-white"
                          : "bg-warning text-white"
                    )}>
                      {badge}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      </StaggerItem>

      {/* User list */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-24" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <UsersIcon className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {status === "DELETED" ? "No users in the deletion queue." : "No users match your search."}
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredUsers.map((u) => (
                <motion.div
                  key={u.id}
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: "spring", stiffness: 280, damping: 26 }}
                >
                  <UserRow
                    user={u}
                    onAction={(action) => handleAction(u, action)}
                    canEditRole={role === "ADMIN"}
                    onView360={setView360Target}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Confirm dialog */}
      <Dialog open={!!confirm} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg capitalize">
              {confirm?.action.toLowerCase()} {confirm?.user.name}?
            </DialogTitle>
            <DialogDescription>
              This action will change the user's status to{" "}
              <span className="font-medium text-foreground">
                {confirm && actionResultStatus(confirm.action)}
              </span>
              . A reason is required and will be logged.
            </DialogDescription>
          </DialogHeader>
          <GlassTextarea
            label="Reason"
            rows={3}
            placeholder={`Reason for ${confirm?.action.toLowerCase()}…`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <DialogFooter className="gap-2">
            <GlassButton variant="ghost" size="md" onClick={() => setConfirm(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant={confirm?.action === "SUSPEND" || confirm?.action === "ARCHIVE" || confirm?.action === "REJECT" ? "danger" : "primary"}
              size="md"
              onClick={submitConfirm}
              loading={actionMutation.isPending || rejectMutation.isPending}
            >
              Confirm
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign role dialog */}
      <Dialog open={!!assignRole} onOpenChange={(v) => !v && setAssignRole(null)}>
        <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Role</DialogTitle>
            <DialogDescription>
              Change the role for{" "}
              <span className="font-medium text-foreground">{assignRole?.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Role</label>
              <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                <SelectTrigger className="w-full glass-soft border-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USER">Resident</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <GlassTextarea
              label="Reason (optional)"
              rows={2}
              placeholder="Why is this role being assigned?"
              value={assignReason}
              onChange={(e) => setAssignReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2">
            <GlassButton variant="ghost" size="md" onClick={() => setAssignRole(null)}>
              Cancel
            </GlassButton>
            <GlassButton variant="primary" size="md" onClick={submitAssignRole} loading={actionMutation.isPending}>
              <Shield className="h-4 w-4" />
              Assign Role
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit user dialog */}
      <Dialog open={!!editUser} onOpenChange={(v) => !v && setEditUser(null)}>
        <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-lg max-h-[90vh] overflow-y-auto no-scrollbar">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update credentials for{" "}
              <span className="font-medium text-foreground">{editUser?.name}</span>.
              The user will be notified of the changes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <GlassInput
              label="Full Name"
              value={editForm.name}
              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              icon={<Pencil className="h-4 w-4" />}
            />
            <div className="grid grid-cols-2 gap-3">
              <GlassInput
                label="Email"
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                icon={<Mail className="h-4 w-4" />}
              />
              <GlassInput
                label="Phone"
                value={editForm.phone}
                onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                icon={<Phone className="h-4 w-4" />}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <GlassInput
                label="Room"
                value={editForm.room}
                onChange={(e) => setEditForm({ ...editForm, room: e.target.value })}
                icon={<DoorOpen className="h-4 w-4" />}
              />
              <div>
                <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Gender</label>
                <Select
                  value={editForm.gender}
                  onValueChange={(v) => setEditForm({ ...editForm, gender: v })}
                >
                  <SelectTrigger className="glass-soft rounded-2xl h-12 border-0">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <GlassInput
              label="Emergency Contact"
              value={editForm.emergencyContact}
              onChange={(e) => setEditForm({ ...editForm, emergencyContact: e.target.value })}
              icon={<Shield className="h-4 w-4" />}
              placeholder="Phone number"
            />
            <div className="glass-soft rounded-2xl p-3 border border-warning/20">
              <p className="text-xs font-medium text-warning flex items-center gap-1.5 mb-2">
                <KeyRound className="h-3.5 w-3.5" />
                Reset Password (optional)
              </p>
              <GlassInput
                type={showPassword ? "text" : "password"}
                placeholder="Enter new password (min 8 chars)"
                value={editForm.password}
                onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                trailing={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                }
                hint="Leave blank to keep the current password"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 mt-4">
            <GlassButton variant="ghost" size="md" onClick={() => setEditUser(null)}>
              Cancel
            </GlassButton>
            <GlassButton variant="primary" size="md" onClick={submitEdit} loading={editMutation.isPending}>
              <CheckCircle2 className="h-4 w-4" />
              Save Changes
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete {deleteTarget?.name}?
            </DialogTitle>
            <DialogDescription>
              This will move the user to the <strong className="text-foreground">deletion queue</strong>.
              The account will be permanently deleted after{" "}
              <strong className="text-foreground">7 days</strong> unless restored.
              All active sessions will be revoked immediately.
            </DialogDescription>
          </DialogHeader>
          <GlassTextarea
            label="Reason for deletion (required)"
            rows={3}
            placeholder="Why is this user being deleted?"
            value={deleteReason}
            onChange={(e) => setDeleteReason(e.target.value)}
          />
          <div className="glass-soft rounded-2xl p-3 flex items-start gap-2 border border-destructive/20">
            <Clock className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              The user will receive a notification about the scheduled deletion.
              You can restore the user from the <strong>Deletion Queue</strong> tab
              within 7 days.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <GlassButton variant="ghost" size="md" onClick={() => setDeleteTarget(null)}>
              Cancel
            </GlassButton>
            <GlassButton variant="danger" size="md" onClick={submitDelete} loading={deleteMutation.isPending}>
              <Trash2 className="h-4 w-4" />
              Move to Deletion Queue
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PRD Module 03 — Request Changes dialog (multi-select fields + reason) */}
      <Dialog open={!!requestChangesTarget} onOpenChange={(v) => !v && setRequestChangesTarget(null)}>
        <DialogContent className="glass-strong border-border/60 rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg flex items-center gap-2">
              <MessageSquareWarning className="h-5 w-5 text-warning" />
              Request Changes — {requestChangesTarget?.name}
            </DialogTitle>
            <DialogDescription>
              Select the fields the resident needs to correct and provide a
              reason. The resident will be notified and can update the
              selected fields, then resubmit for review.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground ml-1">
              Fields needing correction
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              {REQUEST_CHANGES_FIELDS.map((f) => {
                const checked = requestChangesFields.includes(f.key);
                return (
                  <label
                    key={f.key}
                    className={cn(
                      "flex items-center gap-2.5 glass-soft rounded-2xl px-3 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors",
                      checked && "border-2 border-primary/40 bg-primary/5"
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        if (v === true) {
                          setRequestChangesFields([...requestChangesFields, f.key]);
                        } else {
                          setRequestChangesFields(requestChangesFields.filter((k) => k !== f.key));
                        }
                      }}
                    />
                    <span className="text-sm text-foreground/90 select-none">{f.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <GlassTextarea
            label="Reason (required)"
            rows={3}
            placeholder="Explain what needs to be corrected and why…"
            value={requestChangesReason}
            onChange={(e) => setRequestChangesReason(e.target.value)}
          />

          <DialogFooter className="gap-2">
            <GlassButton variant="ghost" size="md" onClick={() => setRequestChangesTarget(null)}>
              Cancel
            </GlassButton>
            <GlassButton
              variant="primary"
              size="md"
              onClick={submitRequestChanges}
              loading={requestChangesMutation.isPending}
            >
              <MessageSquareWarning className="h-4 w-4" />
              Request Changes
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resident 360° View Dialog */}
      <Resident360Dialog
        userId={view360Target}
        open={!!view360Target}
        onClose={() => setView360Target(null)}
      />
    </StaggerGroup>
  );
}

function actionResultStatus(action: Action): string {
  switch (action) {
    case "APPROVE":
    case "ACTIVATE":
    case "RESTORE":
      return "Active";
    case "SUSPEND":
      return "Suspended";
    case "DEACTIVATE":
      return "Inactive";
    case "ARCHIVE":
    case "REJECT":
      return "Archived";
    default:
      return "";
  }
}

function KpiCard({
  label,
  value,
  icon: Icon,
  color,
  sub,
}: {
  label: string;
  value: number;
  icon: typeof UsersIcon;
  color: "primary" | "success" | "warning" | "danger";
  sub?: string;
}) {
  const colorVar =
    color === "primary"
      ? "var(--primary)"
      : color === "success"
        ? "var(--success)"
        : color === "warning"
          ? "var(--warning)"
          : "var(--destructive)";
  return (
    <GlassCard className="p-4 relative overflow-hidden" glow={color} whileHover={{ y: -2 }}>
      <div
        className="absolute -top-8 -right-8 h-24 w-24 rounded-full blur-3xl opacity-30"
        style={{ background: colorVar }}
      />
      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <div
            className="grid place-items-center h-9 w-9 rounded-2xl"
            style={{
              background: `color-mix(in oklch, ${colorVar} 18%, transparent)`,
              color: colorVar,
            }}
          >
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="text-2xl font-bold tracking-tight tabular-nums">
          <AnimatedCounter value={value} />
        </div>
        {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
      </div>
    </GlassCard>
  );
}

const UserRow = memo(function UserRow({
  user,
  onAction,
  canEditRole,
  onView360,
}: {
  user: ManagedUser;
  onAction: (a: Action) => void;
  canEditRole: boolean;
  onView360?: (userId: string) => void;
}) {
  const sMeta = STATUS_META[user.status];
  const rMeta = ROLE_META[user.role];

  const actions: { action: Action; label: string; icon: typeof CheckCircle2; variant?: "destructive" }[] = [];

  // If user is in deletion queue, only show Restore
  if (user.deletedAt) {
    actions.push({ action: "RESTORE_DELETED", label: "Restore User", icon: RotateCcw });
  } else {
    // Edit User is always available for all statuses
    actions.push({ action: "EDIT_USER", label: "Edit User", icon: Pencil });
    switch (user.status) {
      case "PENDING":
        actions.push({ action: "APPROVE", label: "Approve", icon: CheckCircle2 });
        actions.push({ action: "REQUEST_CHANGES", label: "Request Changes", icon: MessageSquareWarning });
        actions.push({ action: "REJECT", label: "Reject", icon: Ban, variant: "destructive" });
        break;
      case "ACTIVE":
        actions.push({ action: "SUSPEND", label: "Suspend", icon: Ban, variant: "destructive" });
        actions.push({ action: "DEACTIVATE", label: "Deactivate", icon: Power });
        actions.push({ action: "ARCHIVE", label: "Archive", icon: Archive });
        if (canEditRole) actions.push({ action: "ASSIGN_ROLE", label: "Assign Role", icon: Shield });
        break;
      case "SUSPENDED":
        actions.push({ action: "ACTIVATE", label: "Activate", icon: Power });
        actions.push({ action: "ARCHIVE", label: "Archive", icon: Archive });
        break;
      case "INACTIVE":
        actions.push({ action: "ACTIVATE", label: "Activate", icon: Power });
        actions.push({ action: "ARCHIVE", label: "Archive", icon: Archive });
        break;
      case "ARCHIVED":
        actions.push({ action: "RESTORE", label: "Restore", icon: RotateCcw });
        break;
      case "APPROVED":
        actions.push({ action: "ACTIVATE", label: "Activate", icon: Power });
        break;
    }
    // Delete is available for all non-deleted users (except other admins)
    if (user.role !== "ADMIN") {
      actions.push({ action: "DELETE_USER", label: "Delete", icon: Trash2, variant: "destructive" });
    }
  }

  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12 rounded-2xl">
          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
          <AvatarFallback className={cn("rounded-2xl bg-gradient-to-br text-white font-semibold", gradientFor(user.name))}>
            {initials(user.name) || "U"}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className={cn("font-semibold truncate", user.deletedAt && "text-muted-foreground line-through")}>
                  {user.name}
                </h3>
                {user.deletedAt ? (
                  <Badge variant="outline" className="text-[10px] bg-destructive/15 text-destructive border-destructive/30">
                    <Clock className="h-2.5 w-2.5" /> {formatDeletionCountdown(new Date(user.deletedAt))}
                  </Badge>
                ) : (
                  <>
                    <Badge variant="outline" className={cn("text-[10px]", rMeta.className)}>
                      {rMeta.label}
                    </Badge>
                    <Badge variant="outline" className={cn("text-[10px]", sMeta.className)}>
                      {sMeta.label}
                    </Badge>
                    {/* PRD Module 03 — Email verified + Changes Requested indicators */}
                    {user.status === "PENDING" && user.emailVerified && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-success/15 text-success border-success/30"
                        title="Email verified"
                      >
                        <BadgeCheck className="h-2.5 w-2.5" /> Verified
                      </Badge>
                    )}
                    {user.status === "PENDING" && !user.emailVerified && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-muted text-muted-foreground border-border"
                        title="Email not verified yet"
                      >
                        <Clock className="h-2.5 w-2.5" /> Unverified
                      </Badge>
                    )}
                    {user.status === "PENDING" && user.changesRequested && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-warning/15 text-warning border-warning/30"
                        title={user.changesRequestReason || "Changes requested"}
                      >
                        <MessageSquareWarning className="h-2.5 w-2.5" /> Changes Requested
                      </Badge>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3" /> {user.email}
                </span>
                {user.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {user.phone}
                  </span>
                )}
                {user.institutionUserId && (
                  <span className="inline-flex items-center gap-1">
                    <BadgeCheck className="h-3 w-3" /> {user.institutionUserId}
                  </span>
                )}
                {user.room && (
                  <span className="inline-flex items-center gap-1">
                    <DoorOpen className="h-3 w-3" /> {user.room}
                  </span>
                )}
                {user.institutionName && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-3 w-3" /> {user.institutionName}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
                <span>Joined {format(new Date(user.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                {user.lastLoginAt && !user.deletedAt && (
                  <span>Last login {formatDistanceToNow(new Date(user.lastLoginAt), { addSuffix: true })}</span>
                )}
              </div>
              {user.deletedAt && user.deletionReason && (
                <div className="mt-1.5 text-[11px] text-destructive/80 flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>Reason: {user.deletionReason}</span>
                </div>
              )}
              {user.status === "PENDING" && user.changesRequested && user.changesRequestReason && (
                <div className="mt-1.5 text-[11px] text-warning/90 flex items-start gap-1 rounded-lg bg-warning/5 border border-warning/20 p-2">
                  <MessageSquareWarning className="h-3 w-3 shrink-0 mt-0.5" />
                  <span className="leading-snug">
                    <span className="font-medium">Changes requested:</span>{" "}
                    {user.changesRequestReason}
                  </span>
                </div>
              )}
              {user.status === "PENDING" && user.emailVerified === false && (
                <div className="mt-1.5 text-[11px] text-muted-foreground flex items-start gap-1">
                  <Clock className="h-3 w-3 shrink-0 mt-0.5" />
                  <span>Awaiting email verification</span>
                </div>
              )}
            </div>
            {onView360 && (
              <GlassButton
                variant="ghost"
                size="icon"
                className="shrink-0"
                aria-label="View 360"
                onClick={() => onView360(user.id)}
              >
                <Eye className="h-4 w-4" />
              </GlassButton>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <GlassButton variant="ghost" size="icon" className="shrink-0" aria-label="User actions">
                  <MoreVertical className="h-4 w-4" />
                </GlassButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 rounded-2xl">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {actions.map((a) => {
                  const Icon = a.icon;
                  return (
                    <DropdownMenuItem
                      key={a.action}
                      onClick={() => onAction(a.action)}
                      variant={a.variant}
                      className="rounded-xl cursor-pointer"
                    >
                      <Icon className="h-4 w-4" />
                      {a.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </GlassCard>
  );
});
