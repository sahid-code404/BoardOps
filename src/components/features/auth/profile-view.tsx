"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format, formatDistanceToNow } from "date-fns";
import {
  Mail,
  Phone,
  DoorOpen,
  ShieldCheck,
  CalendarDays,
  Clock,
  Globe,
  Palette,
  Languages,
  Activity,
  Pencil,
  User,
  Sparkles,
  CheckCircle2,
  Camera,
  KeyRound,
  Smartphone,
  Monitor,
  Tablet,
  X,
  Download,
  Copy,
  RefreshCw,
  Lock,
  Eye,
  EyeOff,
  ShieldAlert,
  QrCode,
  Loader2,
  Trash2,
  LogOut,
  Sun,
  Moon,
  Check,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput } from "@/components/glass/glass-input";
import { StaggerGroup, StaggerItem } from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuthStore, type Role, type CurrentUser } from "@/stores/use-auth-store";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

type UserStatus = "ACTIVE" | "PENDING" | "SUSPENDED" | "ARCHIVED" | "INACTIVE";

const STATUS_META: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: "Active", className: "bg-success/15 text-success" },
  PENDING: { label: "Pending", className: "bg-warning/15 text-warning" },
  SUSPENDED: { label: "Suspended", className: "bg-destructive/15 text-destructive" },
  ARCHIVED: { label: "Archived", className: "bg-muted text-muted-foreground" },
  INACTIVE: { label: "Inactive", className: "bg-muted text-muted-foreground" },
};

const ROLE_META: Record<Role, { label: string; className: string }> = {
  SUPER_ADMIN: { label: "Super Admin", className: "bg-primary/20 text-primary" },
  ADMIN: { label: "Admin", className: "bg-primary/15 text-primary" },
  MANAGER: { label: "Manager", className: "bg-secondary/20 text-secondary-foreground" },
  USER: { label: "Resident", className: "bg-muted text-muted-foreground" },
};

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

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  const res = await promise;
  if (res && typeof res === "object" && "success" in res && "data" in (res as Record<string, unknown>)) {
    return (res as unknown as { data: T }).data;
  }
  return res as T;
}

type MeUser = CurrentUser & {
  status: UserStatus;
  createdAt?: string;
  lastLoginAt?: string | null;
  theme?: string | null;
  gender?: string | null;
  emergencyContact?: string | null;
  twoFactorEnabled?: boolean;
};

type SessionInfo = {
  id: string;
  current: boolean;
  device: string;
  browser: string;
  os: string;
  ipAddress: string;
  createdAt: string;
  expiresAt: string;
};

const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "hi", label: "हिन्दी (Hindi)" },
  { value: "ta", label: "தமிழ் (Tamil)" },
  { value: "te", label: "తెలుగు (Telugu)" },
  { value: "bn", label: "বাংলা (Bengali)" },
  { value: "mr", label: "मराठी (Marathi)" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "de", label: "Deutsch" },
];

export function ProfileView() {
  const stored = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const logout = useAuthStore((s) => s.logout);
  const qc = useQueryClient();
  const { theme: resolvedTheme, setTheme } = useTheme();
  const isMobile = useIsMobile();

  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [twoFactorOpen, setTwoFactorOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);

  const { data: me, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => unwrap<MeUser>(api.get("/auth/me")),
    initialData: stored as MeUser | undefined,
  });

  const { data: sessions = [] } = useQuery<SessionInfo[]>({
    queryKey: ["auth", "sessions"],
    queryFn: () => unwrap<SessionInfo[]>(api.get("/auth/sessions")),
    enabled: sessionsOpen,
  });

  // Avatar upload mutation
  const avatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("avatar", file);
      const res = await fetch("/api/auth/avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${useAuthStore.getState().token}`,
        },
        body: formData,
      });
      const json = (await res.json()) as { error?: string; data?: { avatarUrl: string } };
      if (!res.ok) throw new Error(json.error || "Upload failed");
      if (!json.data) throw new Error("Upload response was missing avatar data");
      return json.data;
    },
    onSuccess: (data) => {
      if (me) {
        setUser({ ...me, avatarUrl: data.avatarUrl });
      }
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      toast.success("Avatar updated successfully");
    },
    onError: (e: Error) => toast.error(e.message || "Failed to upload avatar"),
  });

  if (isLoading || !me) {
    return (
      <div className="space-y-4">
        <ShimmerSkeleton className="h-44" />
        <div className="grid-cards gap-4">
          <ShimmerSkeleton className="h-48" />
          <ShimmerSkeleton className="h-48" />
        </div>
      </div>
    );
  }

  const sMeta = STATUS_META[me.status] ?? STATUS_META.ACTIVE;
  const rMeta = ROLE_META[me.role];
  const joined = me.createdAt ? format(new Date(me.createdAt), "MMM d, yyyy 'at' h:mm a") : "—";
  const lastLogin = me.lastLoginAt
    ? formatDistanceToNow(new Date(me.lastLoginAt), { addSuffix: true })
    : "First login";

  return (
    <StaggerGroup className="space-y-4 pb-6">
      {/* Profile Header with avatar upload */}
      <StaggerItem>
        <GlassCard className="p-6 relative overflow-hidden" hover={false} glow="primary">
          <div className="absolute inset-0 -z-10 opacity-30 pointer-events-none">
            <div className="absolute top-0 right-0 h-40 w-40 rounded-full bg-primary/40 blur-3xl" />
            <div className="absolute bottom-0 left-0 h-32 w-32 rounded-full bg-success/30 blur-3xl" />
          </div>
          <div className="flex flex-col gap-5">
            <AvatarUpload
              avatarUrl={me.avatarUrl ?? undefined}
              name={me.name}
              onUpload={(file) => avatarMutation.mutate(file)}
              loading={avatarMutation.isPending}
            />
            <div className="flex-1 min-w-0 text-center">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
              >
                <h2 className="text-2xl font-bold truncate">{me.name}</h2>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{me.email}</p>
                <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
                  <Badge variant="outline" className={cn("text-xs", rMeta.className)}>
                    <ShieldCheck className="h-3 w-3" />
                    {rMeta.label}
                  </Badge>
                  <Badge variant="outline" className={cn("text-xs", sMeta.className)}>
                    {sMeta.label}
                  </Badge>
                  {me.twoFactorEnabled && (
                    <Badge variant="outline" className="text-xs bg-success/15 text-success">
                      <Lock className="h-3 w-3" />
                      2FA On
                    </Badge>
                  )}
                  <Badge variant="outline" className="text-xs bg-muted/60 text-muted-foreground">
                    <CalendarDays className="h-3 w-3" />
                    Member since {joined}
                  </Badge>
                </div>
              </motion.div>
            </div>
            <div className="shrink-0 flex gap-2">
              <GlassButton variant="secondary" size="md" onClick={() => setEditOpen(true)}>
                <Pencil className="h-4 w-4" />
                Edit Profile
              </GlassButton>
            </div>
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Quick action cards */}
      <StaggerItem>
        <div className="grid-cards gap-3">
          <QuickActionCard
            icon={KeyRound}
            title="Change Password"
            description="Update your account password"
            color="primary"
            onClick={() => setPasswordOpen(true)}
          />
          <QuickActionCard
            icon={me.twoFactorEnabled ? ShieldCheck : ShieldAlert}
            title={me.twoFactorEnabled ? "Two-Factor Auth" : "Enable 2FA"}
            description={
              me.twoFactorEnabled
                ? "Enabled — your account is protected"
                : "Add an extra layer of security"
            }
            color={me.twoFactorEnabled ? "success" : "warning"}
            onClick={() => setTwoFactorOpen(true)}
            badge={me.twoFactorEnabled ? "Active" : "Recommended"}
          />
          <QuickActionCard
            icon={Smartphone}
            title="Active Sessions"
            description="Manage devices logged into your account"
            color="info"
            onClick={() => setSessionsOpen(true)}
          />
        </div>
      </StaggerItem>

      {/* Info Cards */}
      <div className="grid-cards gap-4">
        <StaggerItem>
          <InfoCard
            title="Contact"
            icon={Mail}
            color="primary"
            rows={[
              { icon: Phone, label: "Phone", value: me.phone || "Not set" },
              { icon: DoorOpen, label: "Room", value: me.room || "Not set" },
              {
                icon: ShieldCheck,
                label: "Emergency",
                value: me.emergencyContact || "Not configured",
              },
            ]}
          />
        </StaggerItem>

        <StaggerItem>
          <InfoCard
            title="Preferences"
            icon={Palette}
            color="success"
            rows={[
              { icon: Languages, label: "Language", value: LANGUAGES.find((l) => l.value === (me.language || "en"))?.label || "English" },
              { icon: Globe, label: "Timezone", value: me.timezone || "UTC" },
              { icon: Clock, label: "Last Login", value: lastLogin },
            ]}
          >
            {/* Theme selector — inside Preferences card */}
            <div className="py-3 border-t border-border/30">
              <div className="flex items-center gap-2 mb-2.5 text-sm text-muted-foreground">
                <Palette className="h-3.5 w-3.5" />
                <span>Theme</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                  { value: "system", label: "System", icon: Monitor },
                ].map((opt) => {
                  const currentTheme = stored?.theme || me.theme || "system";
                  const active = currentTheme === opt.value;
                  const Icon = opt.icon;
                  return (
                    <motion.button
                      key={opt.value}
                      whileTap={{ scale: 0.94 }}
                      whileHover={{ scale: 1.03 }}
                      onClick={() => {
                        setTheme(opt.value);
                        api.put("/auth/profile", { theme: opt.value }).catch(() => {});
                        if (me) setUser({ ...me, theme: opt.value });
                        qc.invalidateQueries({ queryKey: ["auth", "me"] });
                      }}
                      className={cn(
                        "relative flex flex-col items-center gap-1.5 py-2.5 rounded-xl border-2 transition-all",
                        active
                          ? "border-primary bg-primary/15 shadow-md shadow-primary/20"
                          : "border-border/40 glass-soft"
                      )}
                    >
                      <motion.div
                        animate={{ scale: active ? 1.1 : 1, rotate: active ? 0 : 0 }}
                        transition={{ type: "spring", stiffness: 300, damping: 20 }}
                      >
                        <Icon className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")} />
                      </motion.div>
                      <span className={cn("text-[11px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
                        {opt.label}
                      </span>
                      <AnimatePresence>
                        {active && (
                          <motion.div
                            initial={{ scale: 0, rotate: -180, opacity: 0 }}
                            animate={{ scale: 1, rotate: 0, opacity: 1 }}
                            exit={{ scale: 0, rotate: 180, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 20 }}
                            className="absolute -top-1.5 -right-1.5 grid place-items-center h-5 w-5 rounded-full bg-primary shadow-md"
                          >
                            <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </InfoCard>
        </StaggerItem>
      </div>

      {/* Sign out */}
      <StaggerItem>
        <GlassCard className="p-4" hover={false}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="grid place-items-center h-10 w-10 rounded-2xl bg-destructive/15 text-destructive shrink-0">
                <LogOut className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm">Sign Out</h3>
                <p className="text-xs text-muted-foreground truncate">
                  End your session on this device
                </p>
              </div>
            </div>
            <GlassButton
              variant="danger"
              size="sm"
              onClick={() => {
                qc.clear();
                logout();
                toast.success("Signed out successfully");
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </GlassButton>
          </div>
        </GlassCard>
      </StaggerItem>

      {/* Dialogs */}
      <EditProfileDialog
        key={editOpen ? "edit-open" : "edit-closed"}
        open={editOpen}
        onOpenChange={setEditOpen}
        user={me}
        setTheme={setTheme}
        onUpdated={(updated) => {
          setUser({ ...me, ...updated });
          qc.invalidateQueries({ queryKey: ["auth", "me"] });
        }}
      />
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onSuccess={() => {
          setPasswordOpen(false);
          qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
        }}
      />
      <TwoFactorDialog
        key={twoFactorOpen ? "2fa-open" : "2fa-closed"}
        open={twoFactorOpen}
        onOpenChange={setTwoFactorOpen}
        enabled={!!me.twoFactorEnabled}
        onUpdated={(enabled) => {
          setUser({ ...me, twoFactorEnabled: enabled });
          qc.invalidateQueries({ queryKey: ["auth", "me"] });
        }}
      />

      {/* Sessions Sheet */}
      <SessionsSheet
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        sessions={sessions}
        onRevoked={() => qc.invalidateQueries({ queryKey: ["auth", "sessions"] })}
        onRevokeAll={() => {
          qc.invalidateQueries({ queryKey: ["auth", "sessions"] });
        }}
      />
    </StaggerGroup>
  );
}

// ─────────────────────────────────────────────────────────────
// Avatar Upload Component
// ─────────────────────────────────────────────────────────────
function AvatarUpload({
  avatarUrl,
  name,
  onUpload,
  loading,
}: {
  avatarUrl?: string;
  name: string;
  onUpload: (file: File) => void;
  loading: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast.error("Image must be under 4 MB");
      return;
    }
    onUpload(file);
  };

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 18 }}
      className="relative shrink-0 mx-auto"
    >
      <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-primary/40 to-success/40 blur-md" />
      <Avatar className="relative h-24 w-24 rounded-3xl">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback
          className={cn(
            "rounded-3xl bg-gradient-to-br text-white font-bold text-2xl",
            gradientFor(name)
          )}
        >
          {initials(name) || "U"}
        </AvatarFallback>
      </Avatar>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={loading}
        className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full glass-strong grid place-items-center ring-2 ring-background hover:scale-110 transition-transform disabled:opacity-50"
        aria-label="Upload avatar"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <Camera className="h-4 w-4 text-primary" />
        )}
      </button>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick Action Card
// ─────────────────────────────────────────────────────────────
function QuickActionCard({
  icon: Icon,
  title,
  description,
  color,
  onClick,
  badge,
}: {
  icon: typeof Mail;
  title: string;
  description: string;
  color: "primary" | "success" | "warning" | "info";
  onClick: () => void;
  badge?: string;
}) {
  const colorClass = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    info: "bg-info/15 text-info",
  }[color];
  return (
    <motion.button
      whileHover={{ scale: 1.02, y: -2 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="text-left w-full"
    >
      <GlassCard className="p-4 h-full" hover>
        <div className="flex items-start gap-3">
          <div className={cn("grid place-items-center h-10 w-10 rounded-2xl shrink-0", colorClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-sm">{title}</h3>
              {badge && (
                <Badge variant="outline" className={cn("text-[10px] py-0", colorClass)}>
                  {badge}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
      </GlassCard>
    </motion.button>
  );
}

// ─────────────────────────────────────────────────────────────
// Info Card (shared)
// ─────────────────────────────────────────────────────────────
function InfoCard({
  title,
  icon: Icon,
  color,
  rows,
  children,
}: {
  title: string;
  icon: typeof Mail;
  color: "primary" | "success" | "warning";
  rows: { icon: typeof Mail; label: string; value: string }[];
  children?: React.ReactNode;
}) {
  const colorClass = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
  }[color];
  return (
    <GlassCard className="p-4" hover={false}>
      <div className="flex items-center gap-3 mb-4">
        <div className={cn("grid place-items-center h-9 w-9 rounded-xl", colorClass)}>
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      <div className="space-y-2.5">
        {rows.map((row) => {
          const RowIcon = row.icon;
          return (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 py-2 border-b border-border/30 last:border-0"
            >
              <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <RowIcon className="h-3.5 w-3.5" />
                {row.label}
              </span>
              <span className="text-sm font-medium text-right truncate max-w-[60%]">{row.value}</span>
            </div>
          );
        })}
        {children}
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────
// Edit Profile Dialog
// ─────────────────────────────────────────────────────────────
function EditProfileDialog({
  open,
  onOpenChange,
  user,
  onUpdated,
  setTheme,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: MeUser;
  onUpdated: (u: Partial<MeUser>) => void;
  setTheme: (t: string) => void;
}) {
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [form, setForm] = useState({
    name: user.name,
    phone: user.phone || "",
    room: user.room || "",
    gender: user.gender || "",
    emergencyContact: user.emergencyContact || "",
    theme: user.theme || "system",
    language: user.language || "en",
    timezone: user.timezone || "UTC",
  });
  const [loading, setLoading] = useState(false);


  const submit = async () => {
    if (form.name.trim().length < 2) {
      toast.error("Name must be at least 2 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await api.put<{ success: boolean; data: Partial<MeUser> }>("/auth/profile", {
        name: form.name,
        phone: form.phone || undefined,
        room: form.room || null,
        gender: form.gender || null,
        emergencyContact: form.emergencyContact || null,
        theme: form.theme,
        language: form.language,
        timezone: form.timezone,
      });
      onUpdated(res.data);
      qc.invalidateQueries({ queryKey: ["auth", "me"] });
      // Apply theme change immediately
      if (form.theme) setTheme(form.theme);
      toast.success("Profile updated successfully");
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="space-y-4">
      <GlassInput
        label="Full Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        icon={<User />}
      />
      <div className="grid grid-cols-2 gap-3">
        <GlassInput
          label="Phone"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
          icon={<Phone />}
        />
        <GlassInput
          label="Room"
          value={form.room}
          onChange={(e) => setForm({ ...form, room: e.target.value })}
          icon={<DoorOpen />}
        />
      </div>
      <div>
        <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Gender</label>
        <Select value={form.gender} onValueChange={(v) => setForm({ ...form, gender: v })}>
          <SelectTrigger className="glass-soft rounded-2xl h-12 border-0">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MALE">Male</SelectItem>
            <SelectItem value="FEMALE">Female</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <GlassInput
        label="Emergency Contact"
        value={form.emergencyContact}
        onChange={(e) => setForm({ ...form, emergencyContact: e.target.value })}
        icon={<ShieldCheck />}
        placeholder="Phone number of emergency contact"
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Theme</label>
          <Select value={form.theme} onValueChange={(v) => setForm({ ...form, theme: v })}>
            <SelectTrigger className="glass-soft rounded-2xl h-12 border-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Language</label>
          <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v })}>
            <SelectTrigger className="glass-soft rounded-2xl h-12 border-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGES.map((l) => (
                <SelectItem key={l.value} value={l.value}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">Timezone</label>
        <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
          <SelectTrigger className="glass-soft rounded-2xl h-12 border-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex gap-2 pt-2">
        <GlassButton variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
          Cancel
        </GlassButton>
        <GlassButton className="flex-1" loading={loading} onClick={submit}>
          <CheckCircle2 className="h-4 w-4" />
          Save Changes
        </GlassButton>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="glass-strong border-0 max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Edit Profile</SheetTitle>
            <SheetDescription>Update your personal information and preferences</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{content}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-0 max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Profile</DialogTitle>
          <DialogDescription>Update your personal information and preferences</DialogDescription>
        </DialogHeader>
        <div className="mt-2 max-h-[70vh] overflow-y-auto no-scrollbar">{content}</div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Change Password Dialog
// ─────────────────────────────────────────────────────────────
function ChangePasswordDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess: () => void;
}) {
  const isMobile = useIsMobile();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordStrength = (() => {
    const p = form.newPassword;
    if (!p) return { score: 0, label: "", color: "" };
    let score = 0;
    if (p.length >= 8) score++;
    if (/[A-Z]/.test(p)) score++;
    if (/[a-z]/.test(p)) score++;
    if (/[0-9]/.test(p)) score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const labels = ["", "Weak", "Fair", "Good", "Strong", "Excellent"];
    const colors = ["", "bg-destructive", "bg-warning", "bg-warning", "bg-success", "bg-success"];
    return { score, label: labels[score], color: colors[score] };
  })();

  const submit = async () => {
    if (form.newPassword !== form.confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (form.newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      toast.success("Password changed. Other sessions have been signed out.");
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      onSuccess();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to change password");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="space-y-4">
      <GlassInput
        label="Current Password"
        type={showCurrent ? "text" : "password"}
        value={form.currentPassword}
        onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
        icon={<Lock />}
        trailing={
          <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="text-muted-foreground hover:text-foreground">
            {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
      />
      <GlassInput
        label="New Password"
        type={showNew ? "text" : "password"}
        value={form.newPassword}
        onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
        icon={<KeyRound />}
        trailing={
          <button type="button" onClick={() => setShowNew(!showNew)} className="text-muted-foreground hover:text-foreground">
            {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        hint="Min 8 chars with uppercase, lowercase, and a number"
      />
      {form.newPassword && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <motion.div
              className={cn("h-full", passwordStrength.color)}
              initial={{ width: 0 }}
              animate={{ width: `${(passwordStrength.score / 5) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground w-16">{passwordStrength.label}</span>
        </div>
      )}
      <GlassInput
        label="Confirm New Password"
        type={showNew ? "text" : "password"}
        value={form.confirmPassword}
        onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
        icon={<CheckCircle2 />}
        error={
          form.confirmPassword && form.newPassword !== form.confirmPassword
            ? "Passwords don't match"
            : undefined
        }
      />
      <div className="glass-soft rounded-2xl p-3 flex items-start gap-2">
        <ShieldAlert className="h-4 w-4 text-warning shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          For your security, all other active sessions will be signed out after changing your password.
        </p>
      </div>
      <div className="flex gap-2 pt-2">
        <GlassButton variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>
          Cancel
        </GlassButton>
        <GlassButton
          className="flex-1"
          loading={loading}
          onClick={submit}
          disabled={!form.currentPassword || !form.newPassword || !form.confirmPassword}
        >
          <Lock className="h-4 w-4" />
          Change Password
        </GlassButton>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="glass-strong border-0">
          <SheetHeader>
            <SheetTitle>Change Password</SheetTitle>
            <SheetDescription>Choose a strong, unique password</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{content}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-0 max-w-md">
        <DialogHeader>
          <DialogTitle>Change Password</DialogTitle>
          <DialogDescription>Choose a strong, unique password</DialogDescription>
        </DialogHeader>
        <div className="mt-2">{content}</div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Two-Factor Auth Dialog
// ─────────────────────────────────────────────────────────────
function TwoFactorDialog({
  open,
  onOpenChange,
  enabled,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  enabled: boolean;
  onUpdated: (enabled: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [step, setStep] = useState<"main" | "setup" | "verify" | "backup" | "disable">("main");
  const [secret, setSecret] = useState("");
  const [qrCode, setQrCode] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [loading, setLoading] = useState(false);


  const startSetup = async () => {
    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; data: { secret: string; qrCode: string } }>("/auth/2fa/setup");
      setSecret(res.data.secret);
      setQrCode(res.data.qrCode);
      setStep("setup");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to start 2FA setup");
    } finally {
      setLoading(false);
    }
  };

  const verifyAndEnable = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; data: { backupCodes: string[] } }>("/auth/2fa/verify", {
        secret,
        code,
      });
      setBackupCodes(res.data.backupCodes);
      setStep("backup");
      toast.success("Two-factor authentication enabled!");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Invalid code. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const disable2FA = async () => {
    setLoading(true);
    try {
      await api.post("/auth/2fa/disable", { password: disablePassword });
      onUpdated(false);
      toast.success("Two-factor authentication disabled");
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to disable 2FA");
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n"));
    toast.success("Backup codes copied to clipboard");
  };

  const downloadCodes = () => {
    const blob = new Blob([`BoardOps Backup Codes\n\n${backupCodes.join("\n")}\n\nKeep these safe. Each code can only be used once.`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "boardops-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Backup codes downloaded");
  };

  const content = (
    <AnimatePresence mode="wait">
      {step === "main" && (
        <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
          <div className="flex items-center gap-3">
            <div className={cn("grid place-items-center h-14 w-14 rounded-3xl shrink-0", enabled ? "bg-success/15 text-success" : "bg-warning/15 text-warning")}>
              {enabled ? <ShieldCheck className="h-7 w-7" /> : <ShieldAlert className="h-7 w-7" />}
            </div>
            <div>
              <p className="font-semibold">{enabled ? "2FA is Enabled" : "2FA is Disabled"}</p>
              <p className="text-xs text-muted-foreground">
                {enabled
                  ? "Your account requires a verification code from your authenticator app."
                  : "Protect your account with an extra layer of security."}
              </p>
            </div>
          </div>
          {enabled ? (
            <>
              <div className="glass-soft rounded-2xl p-4 space-y-2">
                <p className="text-sm font-medium flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-primary" />
                  Need new backup codes?
                </p>
                <p className="text-xs text-muted-foreground">
                  Generate a fresh set of backup codes using your authenticator app.
                </p>
                <GlassButton variant="secondary" size="sm" className="mt-2" onClick={() => setStep("backup")} loading={loading}>
                  <RefreshCw className="h-4 w-4" />
                  Regenerate Backup Codes
                </GlassButton>
              </div>
              <div className="glass-soft rounded-2xl p-4 border border-destructive/20">
                <p className="text-sm font-medium text-destructive flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Disable 2FA
                </p>
                <p className="text-xs text-muted-foreground mt-1 mb-3">
                  Disabling 2FA makes your account less secure. This requires your password.
                </p>
                <GlassInput
                  type="password"
                  placeholder="Enter your password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  icon={<KeyRound />}
                />
                <GlassButton variant="danger" size="sm" className="mt-3 w-full" loading={loading} onClick={disable2FA} disabled={!disablePassword}>
                  <ShieldAlert className="h-4 w-4" />
                  Disable Two-Factor Authentication
                </GlassButton>
              </div>
            </>
          ) : (
            <GlassButton className="w-full" loading={loading} onClick={startSetup}>
              <ShieldCheck className="h-4 w-4" />
              Set Up Two-Factor Authentication
            </GlassButton>
          )}
          <GlassButton variant="ghost" className="w-full" onClick={() => onOpenChange(false)}>
            Close
          </GlassButton>
        </motion.div>
      )}

      {step === "setup" && (
        <motion.div key="setup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
          <div className="text-center">
            <h3 className="font-semibold text-lg">Scan QR Code</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Use Google Authenticator, Authy, or any TOTP app to scan this code.
            </p>
          </div>
          <div className="flex justify-center">
            {qrCode && (
              <img src={qrCode} alt="2FA QR Code" className="h-48 w-48 rounded-2xl bg-white p-2" />
            )}
          </div>
          <div className="glass-soft rounded-2xl p-3">
            <p className="text-xs text-muted-foreground mb-1">Can't scan? Enter this secret manually:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono break-all">{secret}</code>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(secret);
                  toast.success("Secret copied");
                }}
                className="text-muted-foreground hover:text-foreground shrink-0"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
          <GlassInput
            label="Enter 6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            icon={<KeyRound />}
            className="text-center text-lg tracking-[0.5em] font-mono"
          />
          <div className="flex gap-2">
            <GlassButton variant="ghost" className="flex-1" onClick={() => setStep("main")}>
              Back
            </GlassButton>
            <GlassButton className="flex-1" loading={loading} onClick={verifyAndEnable} disabled={code.length !== 6}>
              <CheckCircle2 className="h-4 w-4" />
              Verify & Enable
            </GlassButton>
          </div>
        </motion.div>
      )}

      {step === "backup" && (
        <motion.div key="backup" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-4">
          <div className="text-center">
            <div className="grid place-items-center h-14 w-14 rounded-3xl bg-success/15 text-success mx-auto mb-3">
              <CheckCircle2 className="h-7 w-7" />
            </div>
            <h3 className="font-semibold text-lg">Save Your Backup Codes</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Store these codes safely. Each can be used once if you lose access to your authenticator.
            </p>
          </div>
          <div className="glass-soft rounded-2xl p-4">
            <div className="grid grid-cols-2 gap-2">
              {backupCodes.map((c, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className="text-center font-mono text-sm font-semibold py-2 px-3 rounded-xl bg-muted/40"
                >
                  {c}
                </motion.div>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <GlassButton variant="secondary" className="flex-1" onClick={copyCodes}>
              <Copy className="h-4 w-4" />
              Copy
            </GlassButton>
            <GlassButton variant="secondary" className="flex-1" onClick={downloadCodes}>
              <Download className="h-4 w-4" />
              Download
            </GlassButton>
          </div>
          <GlassButton
            className="w-full"
            onClick={() => {
              onUpdated(true);
              onOpenChange(false);
            }}
          >
            <CheckCircle2 className="h-4 w-4" />
            I've Saved My Codes
          </GlassButton>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // For backup code regeneration (when already enabled)
  const regenerateContent = (
    <BackupRegenerator
      onDone={(codes) => {
        setBackupCodes(codes);
        setStep("backup");
      }}
      onCancel={() => setStep("main")}
    />
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="glass-strong border-0 max-h-[90vh] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Two-Factor Authentication</SheetTitle>
            <SheetDescription>
              {enabled ? "Manage your 2FA settings" : "Secure your account with TOTP"}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {step === "backup" && enabled && backupCodes.length === 0 ? regenerateContent : content}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-0 max-w-md">
        <DialogHeader>
          <DialogTitle>Two-Factor Authentication</DialogTitle>
          <DialogDescription>
            {enabled ? "Manage your 2FA settings" : "Secure your account with TOTP"}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 max-h-[75vh] overflow-y-auto no-scrollbar">
          {step === "backup" && enabled && backupCodes.length === 0 ? regenerateContent : content}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackupRegenerator({
  onDone,
  onCancel,
}: {
  onDone: (codes: string[]) => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const regenerate = async () => {
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code from your authenticator");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<{ success: boolean; data: { backupCodes: string[] } }>("/auth/2fa/backup-codes", { code });
      onDone(res.data.backupCodes);
      toast.success("New backup codes generated");
    } catch (e: unknown) {
      toast.error((e as Error).message || "Invalid code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="grid place-items-center h-14 w-14 rounded-3xl bg-primary/15 text-primary mx-auto mb-3">
          <RefreshCw className="h-7 w-7" />
        </div>
        <h3 className="font-semibold text-lg">Regenerate Backup Codes</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Enter a code from your authenticator app to generate fresh backup codes.
        </p>
      </div>
      <GlassInput
        label="6-digit code"
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder="000000"
        icon={<KeyRound />}
        className="text-center text-lg tracking-[0.5em] font-mono"
      />
      <div className="flex gap-2">
        <GlassButton variant="ghost" className="flex-1" onClick={onCancel}>
          Cancel
        </GlassButton>
        <GlassButton className="flex-1" loading={loading} onClick={regenerate} disabled={code.length !== 6}>
          <RefreshCw className="h-4 w-4" />
          Generate
        </GlassButton>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sessions Sheet
// ─────────────────────────────────────────────────────────────
function SessionsSheet({
  open,
  onOpenChange,
  sessions,
  onRevoked,
  onRevokeAll,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sessions: SessionInfo[];
  onRevoked: () => void;
  onRevokeAll: () => void;
}) {
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokingAll, setRevokingAll] = useState(false);

  const revokeSession = async (id: string) => {
    setRevokingId(id);
    try {
      await api.delete(`/auth/sessions/${id}`);
      toast.success("Session revoked");
      onRevoked();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to revoke session");
    } finally {
      setRevokingId(null);
    }
  };

  const revokeAll = async () => {
    setRevokingAll(true);
    try {
      await api.delete("/auth/sessions");
      toast.success("All other sessions revoked");
      onRevokeAll();
    } catch (e: unknown) {
      toast.error((e as Error).message || "Failed to revoke sessions");
    } finally {
      setRevokingAll(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="glass-strong border-0 w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Active Sessions</SheetTitle>
          <SheetDescription>
            {sessions.length} device{sessions.length !== 1 ? "s" : ""} currently signed in
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-3 max-h-[70vh] overflow-y-auto no-scrollbar">
          {sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Loading sessions…</p>
            </div>
          ) : (
            sessions.map((s) => {
              const DeviceIcon = s.device === "iPhone" || s.device === "iPad" || s.device === "Android"
                ? Smartphone
                : s.device === "Tablet"
                  ? Tablet
                  : Monitor;
              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className={cn(
                    "glass-soft rounded-2xl p-4 flex items-start gap-3",
                    s.current && "ring-2 ring-primary/40"
                  )}
                >
                  <div className={cn("grid place-items-center h-10 w-10 rounded-2xl shrink-0", s.current ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                    <DeviceIcon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">
                        {s.browser} on {s.os}
                      </p>
                      {s.current && (
                        <Badge variant="outline" className="text-[10px] py-0 bg-primary/15 text-primary">
                          This device
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{s.ipAddress}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Active since {format(new Date(s.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                  {!s.current && (
                    <GlassButton
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8 hover:text-destructive"
                      onClick={() => revokeSession(s.id)}
                      loading={revokingId === s.id}
                      aria-label="Revoke session"
                    >
                      {!revokingId && <Trash2 className="h-4 w-4" />}
                    </GlassButton>
                  )}
                </motion.div>
              );
            })
          )}
          {sessions.filter((s) => !s.current).length > 0 && (
            <GlassButton
              variant="danger"
              className="w-full mt-2"
              onClick={revokeAll}
              loading={revokingAll}
            >
              <LogOut className="h-4 w-4" />
              Sign Out All Other Devices
            </GlassButton>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
