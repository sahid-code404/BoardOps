"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { format, isAfter, isBefore, parseISO } from "date-fns";
import {
  Megaphone,
  Plus,
  Trash2,
  Pin,
  PinOff,
  AlertTriangle,
  Info,
  Wrench,
  PartyPopper,
  Users,
  Shield,
  X,
  Clock,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput, GlassTextarea } from "@/components/glass/glass-input";
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
import { useAuthStore } from "@/stores/use-auth-store";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Announcement = {
  id: string;
  title: string;
  body: string;
  type: string;
  priority: string;
  targetAudience: string;
  isPinned: boolean;
  status: string;
  publishedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  user: { name: string } | null;
};

type ApiResponse<T> = { success: boolean; data: T };

const TYPE_META: Record<string, { label: string; icon: typeof Info; color: string; ring: string }> = {
  INFO: { label: "Info", icon: Info, color: "bg-info/15 text-info", ring: "ring-info/30" },
  WARNING: { label: "Warning", icon: AlertTriangle, color: "bg-warning/15 text-warning", ring: "ring-warning/30" },
  MAINTENANCE: { label: "Maintenance", icon: Wrench, color: "bg-muted text-muted-foreground", ring: "ring-border" },
  EVENT: { label: "Event", icon: PartyPopper, color: "bg-primary/15 text-primary", ring: "ring-primary/30" },
};

const PRIORITY_COLORS: Record<string, string> = {
  NORMAL: "bg-muted text-muted-foreground",
  HIGH: "bg-warning/15 text-warning",
  URGENT: "bg-destructive/15 text-destructive",
};

const AUDIENCE_META: Record<string, { label: string; icon: typeof Users }> = {
  ALL: { label: "Everyone", icon: Users },
  RESIDENTS: { label: "Residents", icon: Users },
  ADMINS: { label: "Admins", icon: Shield },
};

export function AnnouncementsView() {
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN";
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ["announcements", { archived: showArchived }],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (isAdmin && showArchived) params.status = "ARCHIVED";
      const r = await api.get<ApiResponse<Announcement[]>>("/announcements", { params });
      return r.data;
    },
    placeholderData: (prev) => prev,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/announcements/${id}`),
    onSuccess: () => {
      toast.success("Announcement archived");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["announcements"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to archive"),
  });

  const togglePinMutation = useMutation({
    mutationFn: ({ id, isPinned }: { id: string; isPinned: boolean }) =>
      api.patch(`/announcements/${id}`, { isPinned: !isPinned }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
    onError: (e: Error) => toast.error(e.message || "Failed to toggle pin"),
  });

  const pinned = announcements.filter((a) => a.isPinned && a.status === "PUBLISHED");
  const now = new Date();

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-primary" />
              Announcements
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Institution-wide announcements. Pinned items appear on resident dashboards until expiry.
            </p>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                <Switch checked={showArchived} onCheckedChange={setShowArchived} />
                Show archived
              </label>
              <GlassButton size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="h-4 w-4" />
                New Announcement
              </GlassButton>
            </div>
          )}
        </div>
      </StaggerItem>

      {/* KPIs */}
      <StaggerItem>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Megaphone className="h-3.5 w-3.5" /> Total
            </div>
            <p className="text-2xl font-bold tabular-nums">
              <AnimatedCounter value={announcements.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Pin className="h-3.5 w-3.5" /> Pinned
            </div>
            <p className="text-2xl font-bold tabular-nums text-primary">
              <AnimatedCounter value={pinned.length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <AlertTriangle className="h-3.5 w-3.5" /> High Priority
            </div>
            <p className="text-2xl font-bold tabular-nums text-warning">
              <AnimatedCounter value={announcements.filter((a) => a.priority === "HIGH" || a.priority === "URGENT").length} />
            </p>
          </GlassCard>
          <GlassCard className="p-4" hover={false}>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock className="h-3.5 w-3.5" /> Expiring Soon
            </div>
            <p className="text-2xl font-bold tabular-nums text-destructive">
              <AnimatedCounter value={announcements.filter((a) => {
                if (!a.expiresAt) return false;
                const exp = parseISO(a.expiresAt);
                return isAfter(exp, now) && isBefore(exp, new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
              }).length} />
            </p>
          </GlassCard>
        </div>
      </StaggerItem>

      {/* Announcements list */}
      <StaggerItem>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-32 rounded-3xl" />
            ))}
          </div>
        ) : announcements.length === 0 ? (
          <GlassCard className="p-12 text-center" hover={false}>
            <Megaphone className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
            <p className="font-semibold mb-1">No announcements</p>
            <p className="text-sm text-muted-foreground">
              {isAdmin ? "Create an announcement to notify all residents." : "Check back later for institution-wide updates."}
            </p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            <AnimatePresence mode="popLayout">
              {announcements.map((a) => {
                const meta = TYPE_META[a.type] || TYPE_META.INFO;
                const Icon = meta.icon;
                const audMeta = AUDIENCE_META[a.targetAudience] || AUDIENCE_META.ALL;
                const AudIcon = audMeta.icon;
                const isExpired = a.expiresAt && isBefore(parseISO(a.expiresAt), now);
                return (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <GlassCard className={cn("p-4", a.isPinned && a.status === "PUBLISHED" && "ring-2 ring-primary/30")} hover={isAdmin}>
                      <div className="flex items-start gap-3">
                        <div className={cn("grid place-items-center h-10 w-10 rounded-xl shrink-0", meta.color)}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            {a.isPinned && a.status === "PUBLISHED" && (
                              <Pin className="h-3 w-3 text-primary shrink-0" />
                            )}
                            <p className="font-semibold truncate">{a.title}</p>
                            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", meta.color)}>
                              {meta.label}
                            </span>
                            <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", PRIORITY_COLORS[a.priority])}>
                              {a.priority}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground flex items-center gap-0.5">
                              <AudIcon className="h-2.5 w-2.5" /> {audMeta.label}
                            </span>
                            {a.status === "ARCHIVED" && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                                Archived
                              </span>
                            )}
                            {isExpired && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                                Expired
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</p>
                          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                            {a.publishedAt && <span>Published {format(parseISO(a.publishedAt), "d MMM yyyy, h:mm a")}</span>}
                            {a.expiresAt && <span>· Expires {format(parseISO(a.expiresAt), "d MMM yyyy")}</span>}
                            {a.user && <span>· by {a.user.name}</span>}
                          </div>
                        </div>
                        {isAdmin && (
                          <div className="flex items-center gap-1 shrink-0">
                            {a.status === "PUBLISHED" && (
                              <GlassButton
                                variant="ghost"
                                size="sm"
                                onClick={() => togglePinMutation.mutate({ id: a.id, isPinned: a.isPinned })}
                              >
                                {a.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                              </GlassButton>
                            )}
                            <GlassButton
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(a)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </GlassButton>
                          </div>
                        )}
                      </div>
                    </GlassCard>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </StaggerItem>

      {/* Create dialog */}
      <AnnouncementFormDialog open={formOpen} onOpenChange={setFormOpen} />

      {/* Delete confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              Archive Announcement
            </DialogTitle>
            <DialogDescription>
              This announcement will be archived. It remains in history but is no longer visible to residents.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="glass-soft rounded-2xl p-3">
              <p className="text-sm font-semibold">{deleteTarget.title}</p>
              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{deleteTarget.body}</p>
            </div>
          )}
          <DialogFooter>
            <GlassButton variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</GlassButton>
            <GlassButton variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              Archive
            </GlassButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  );
}

function AnnouncementFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("INFO");
  const [priority, setPriority] = useState("NORMAL");
  const [targetAudience, setTargetAudience] = useState("ALL");
  const [isPinned, setIsPinned] = useState(true);
  const [expiresAt, setExpiresAt] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      return api.post("/announcements", {
        title, body, type, priority, targetAudience, isPinned,
        status: "PUBLISHED",
        expiresAt: expiresAt || null,
      });
    },
    onSuccess: () => {
      toast.success("Announcement published");
      setTitle(""); setBody(""); setExpiresAt("");
      qc.invalidateQueries({ queryKey: ["announcements"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Failed to create announcement"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" />
            New Announcement
          </DialogTitle>
          <DialogDescription>
            This will be visible to all targeted users and pinned on their dashboards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="a-title">Title *</Label>
            <GlassInput id="a-title" placeholder="e.g. Mess closed tomorrow for maintenance" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="a-body">Message *</Label>
            <GlassTextarea id="a-body" placeholder="Write your announcement..." value={body} onChange={(e) => setBody(e.target.value)} rows={4} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Priority</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NORMAL">Normal</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="URGENT">Urgent</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Target</Label>
              <Select value={targetAudience} onValueChange={setTargetAudience}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(AUDIENCE_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="a-expiry">Expiry Date (optional)</Label>
              <GlassInput id="a-expiry" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
            </div>
            <label className="flex items-center justify-between p-3 rounded-xl glass-soft cursor-pointer mt-5">
              <div>
                <p className="text-sm font-medium">Pin to dashboard</p>
              </div>
              <Switch checked={isPinned} onCheckedChange={setIsPinned} />
            </label>
          </div>
        </div>
        <DialogFooter>
          <GlassButton variant="ghost" onClick={() => onOpenChange(false)}>Cancel</GlassButton>
          <GlassButton loading={mutation.isPending} disabled={!title.trim() || !body.trim()} onClick={() => mutation.mutate()}>
            <Megaphone className="h-4 w-4" />
            Publish
          </GlassButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
