"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mail,
  Lock,
  User,
  Phone,
  Eye,
  EyeOff,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Zap,
  Layers,
  Building2,
  BadgeCheck,
  Clock3,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  DoorOpen,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput } from "@/components/glass/glass-input";
import { AnimatedBackground } from "@/components/glass/animated-background";
import { useAuthStore } from "@/stores/use-auth-store";
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { z } from "zod";
import { GlassNav } from "@/components/glass/glass-nav";
import { Checkbox } from "@/components/ui/checkbox";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// DEC-016: pre-filled institution name for single-institution deployments.
const DEFAULT_INSTITUTION = "BoardOps Institute";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z
  .object({
    name: z.string().min(2, "Name too short"),
    institutionName: z.string().min(2, "Institution name is required"),
    institutionUserId: z.string().min(1, "Institution User ID is required"),
    email: z.string().email("Enter a valid email"),
    phone: z.string().min(8, "Enter a valid phone"),
    room: z.string().min(1, "Room number is required"),
    password: z.string().min(8, "At least 8 characters"),
    confirmPassword: z.string(),
    // Allow empty string (user didn't select) OR a valid enum value. Normalize "" to undefined.
    gender: z.union([z.literal(""), z.enum(["MALE", "FEMALE", "OTHER"])]).optional(),
    consents: z.object({
      rules: z.boolean().refine((v) => v, "You must accept the Institution Rules"),
      privacy: z.boolean().refine((v) => v, "You must accept the Privacy Policy"),
      terms: z.boolean().refine((v) => v, "You must accept the Terms & Conditions"),
    }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type Mode = "login" | "register" | "verify" | "pending" | "forgot" | "forgot-otp" | "reset";
type LoginTwoFactorMethod = "EMAIL" | "TOTP";

type RegistrationStatus = {
  exists: boolean;
  status?: string;
  emailVerified?: boolean;
  name?: string;
  email?: string;
  institutionName?: string | null;
  institutionUserId?: string | null;
  phone?: string | null;
  room?: string | null;
  gender?: string | null;
  changesRequested?: string[] | null;
  changesRequestReason?: string | null;
  changesRequestedAt?: string | null;
  rejectionReason?: string | null;
  cycle?: number | null;
  reviewStatus?: string | null;
  reviewedAt?: string | null;
  submittedAt?: string | null;
};

type LoginResponseData = {
  token?: string;
  user?: any;
  requiresTwoFactor?: boolean;
  pendingToken?: string;
  method?: LoginTwoFactorMethod;
  expiresAt?: string;
};

const FIELD_LABELS: Record<string, string> = {
  name: "Full Name",
  institutionUserId: "Institution User ID",
  phone: "Mobile Number",
  email: "Email",
  room: "Room Number",
  gender: "Gender",
};

export function AuthScreen() {
  const [mode, setMode] = useState<Mode>("login");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    email: "",
    password: "",
    name: "",
    institutionName: DEFAULT_INSTITUTION,
    institutionUserId: "",
    phone: "",
    room: "",
    confirmPassword: "",
    gender: "" as "" | "MALE" | "FEMALE" | "OTHER",
    consents: { rules: false, privacy: false, terms: false },
  });

  // Verify mode state. loginPendingToken distinguishes login 2FA from registration verification.
  const [verifyEmail, setVerifyEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loginPendingToken, setLoginPendingToken] = useState("");
  const [loginTwoFactorMethod, setLoginTwoFactorMethod] = useState<LoginTwoFactorMethod>("EMAIL");

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotOtp, setForgotOtp] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");

  // Pending mode state
  const [pendingEmail, setPendingEmail] = useState("");

  const setUser = useAuthStore((s) => s.setUser);
  const setToken = useAuthStore((s) => s.setToken);
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      setLoading(true);
      if (mode === "login") {
        const data = loginSchema.parse({ email: form.email, password: form.password });
        const res = await api.post<{ success: boolean; data: LoginResponseData }>("/auth/login", data);

        if (res.data.requiresTwoFactor) {
          if (!res.data.pendingToken) throw new Error("Two-factor challenge could not be created");
          const method = res.data.method ?? "EMAIL";
          setLoginPendingToken(res.data.pendingToken);
          setLoginTwoFactorMethod(method);
          setVerifyEmail(data.email);
          setOtp("");
          setMode("verify");
          toast.success(
            method === "TOTP"
              ? "Enter the code from your authenticator app."
              : "Verification code sent to your email."
          );
          return;
        }

        if (!res.data.token || !res.data.user) throw new Error("Invalid login response");
        qc.clear();
        setToken(res.data.token);
        setUser(res.data.user);
        toast.success(`Welcome back, ${res.data.user.name.split(" ")[0]}!`);
      } else {
        const data = registerSchema.parse(form);
        const res = await api.post<{ success: boolean; data: { userId: string; email: string } }>(
          "/auth/register",
          {
            name: data.name,
            institutionName: data.institutionName,
            institutionUserId: data.institutionUserId,
            email: data.email,
            phone: data.phone,
            password: data.password,
            confirmPassword: data.confirmPassword,
            room: data.room,
            gender: data.gender,
            consents: data.consents,
          }
        );
        setVerifyEmail(res.data.email);
        setPendingEmail(res.data.email);
        setLoginPendingToken("");
        setLoginTwoFactorMethod("EMAIL");
        setOtp("");
        setMode("verify");
        toast.success("Account created — verify your email next.");
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        err.issues.forEach((i) => {
          const key = i.path[0];
          if (typeof key === "string") fieldErrors[key] = i.message;
        });
        setErrors(fieldErrors);
      } else {
        toast.error(err.message || "Something went wrong");
      }
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async () => {
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    try {
      setLoading(true);

      if (loginPendingToken) {
        const res = await api.post<{ success: boolean; data: { token: string; user: any } }>(
          "/auth/verify-otp",
          { pendingToken: loginPendingToken, code: otp }
        );
        qc.clear();
        setToken(res.data.token);
        setUser(res.data.user);
        setLoginPendingToken("");
        setLoginTwoFactorMethod("EMAIL");
        setOtp("");
        toast.success(`Welcome back, ${res.data.user.name.split(" ")[0]}!`);
        return;
      }

      await api.post("/auth/verify-email", { email: verifyEmail, otp });
      toast.success("Email verified! Your registration is now pending review.");
      setMode("pending");
    } catch (err: any) {
      toast.error(err.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  const resendOtp = async () => {
    if (loginPendingToken && loginTwoFactorMethod === "TOTP") {
      toast.info("Use the current code from your authenticator app.");
      return;
    }

    try {
      setLoading(true);

      if (loginPendingToken) {
        await api.post<{ success: boolean; data: { resent: boolean } }>(
          "/auth/resend-otp",
          { pendingToken: loginPendingToken }
        );
      } else {
        await api.post<{ success: boolean; data: { sent: boolean } }>(
          "/auth/send-verification",
          { email: verifyEmail }
        );
      }

      toast.success("A new code has been sent.");
    } catch (err: any) {
      toast.error(err.message || "Could not resend code");
    } finally {
      setLoading(false);
    }
  };

  const resetToLogin = () => {
    setMode("login");
    setOtp("");
    setVerifyEmail("");
    setLoginPendingToken("");
    setLoginTwoFactorMethod("EMAIL");
    setPendingEmail("");
    setForgotEmail("");
    setForgotOtp("");
    setResetToken("");
    setNewPassword("");
    setConfirmNewPassword("");
    setErrors({});
    setForm({
      email: "",
      password: "",
      name: "",
      institutionName: DEFAULT_INSTITUTION,
      institutionUserId: "",
      phone: "",
      room: "",
      confirmPassword: "",
      gender: "",
      consents: { rules: false, privacy: false, terms: false },
    });
  };

  // ────────────────────────────────────────────────────────────
  // Forgot password handlers (PRD 03.12)
  // ────────────────────────────────────────────────────────────

  const submitForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    try {
      setLoading(true);
      await api.post<{ success: boolean; data: { sent: boolean } }>(
        "/auth/forgot-password",
        { email: forgotEmail }
      );
      setMode("forgot-otp");
      toast.success("Reset code sent to your email");
    } catch (err: any) {
      toast.error(err.message || "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  const submitForgotOtp = async () => {
    if (forgotOtp.length !== 6) {
      toast.error("Enter the 6-digit code");
      return;
    }
    try {
      setLoading(true);
      const res = await api.post<{ success: boolean; data: { verified: boolean; resetToken: string } }>(
        "/auth/verify-reset-otp",
        { email: forgotEmail, otp: forgotOtp }
      );
      setResetToken(res.data.resetToken);
      setMode("reset");
      toast.success("Code verified. Set your new password.");
    } catch (err: any) {
      toast.error(err.message || "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  const submitResetPassword = async () => {
    if (newPassword !== confirmNewPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    try {
      setLoading(true);
      await api.post("/auth/reset-password", {
        email: forgotEmail,
        resetToken,
        newPassword,
      });
      toast.success("Password reset successfully. Please sign in.");
      resetToLogin();
    } catch (err: any) {
      toast.error(err.message || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  // ────────────────────────────────────────────────────────────
  // Pending mode — poll registration status every 10s.
  // ────────────────────────────────────────────────────────────
  const statusQuery = useQuery({
    queryKey: ["registration-status", pendingEmail],
    queryFn: async () => {
      const res = await api.get<{ success: boolean; data: RegistrationStatus }>(
        "/auth/registration-status",
        { params: { email: pendingEmail } }
      );
      return res.data;
    },
    enabled: mode === "pending" && !!pendingEmail,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });

  const status: RegistrationStatus | undefined = statusQuery.data;
  const isApproved = status?.status === "ACTIVE";
  const isRejected = status?.status === "ARCHIVED" && !!status?.rejectionReason;
  const hasChangesRequested = !!status?.changesRequested && status.changesRequested.length > 0;

  // ────────────────────────────────────────────────────────────
  // Render modes
  // ────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────
  // FORGOT PASSWORD mode — email entry to send reset OTP
  // ────────────────────────────────────────────────────────────
  if (mode === "forgot") {
    return (
      <AuthLayout>
        <GlassCard strong className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-6">
            <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
              <KeyRound className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold">Reset Password</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enter your email</p>
            </div>
          </div>
          <form onSubmit={submitForgotPassword} className="space-y-4">
            <GlassInput
              label="Email"
              placeholder="you@example.com"
              type="email"
              icon={<Mail />}
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              error={errors.email}
            />
            <GlassButton type="submit" size="lg" className="w-full" loading={loading}>
              Send Reset Code
              <ArrowRight className="h-4 w-4" />
            </GlassButton>
            <button
              type="button"
              onClick={() => setMode("login")}
              className="text-xs text-muted-foreground hover:text-primary text-center w-full"
            >
              <ArrowLeft className="h-3 w-3 inline" /> Back to sign in
            </button>
          </form>
        </GlassCard>
      </AuthLayout>
    );
  }

  // ────────────────────────────────────────────────────────────
  // FORGOT-OTP mode — enter the 6-digit reset code
  // ────────────────────────────────────────────────────────────
  if (mode === "forgot-otp") {
    return (
      <AuthLayout>
        <GlassCard strong className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-6">
            <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
              <KeyRound className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold">Verify Code</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Enter 6-digit code</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            We sent a 6-digit code to <span className="font-medium text-foreground">{forgotEmail}</span>.
            Enter it below to continue.
          </p>
          <div className="space-y-4">
            <InputOTP maxLength={6} value={forgotOtp} onChange={(v) => setForgotOtp(v)}>
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-12 w-12 text-lg first:rounded-l-2xl last:rounded-r-2xl" />
                <InputOTPSlot index={1} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={2} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={3} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={4} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={5} className="h-12 w-12 text-lg" />
              </InputOTPGroup>
            </InputOTP>
            <GlassButton size="lg" className="w-full" loading={loading} onClick={submitForgotOtp}>
              Verify Code
              <ArrowRight className="h-4 w-4" />
            </GlassButton>
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="text-xs text-muted-foreground hover:text-primary text-center w-full"
            >
              <ArrowLeft className="h-3 w-3 inline" /> Use a different email
            </button>
          </div>
        </GlassCard>
      </AuthLayout>
    );
  }

  // ────────────────────────────────────────────────────────────
  // RESET mode — enter new password
  // ────────────────────────────────────────────────────────────
  if (mode === "reset") {
    return (
      <AuthLayout>
        <GlassCard strong className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-6">
            <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
              <ShieldCheck className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold">New Password</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Set a strong password</p>
            </div>
          </div>
          <div className="space-y-4">
            <GlassInput
              label="New Password"
              placeholder="••••••••"
              type="password"
              icon={<Lock />}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <GlassInput
              label="Confirm Password"
              placeholder="••••••••"
              type="password"
              icon={<Lock />}
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground">
              Must be at least 8 characters with uppercase, lowercase, number, and special character.
            </p>
            <GlassButton size="lg" className="w-full" loading={loading} onClick={submitResetPassword}>
              Reset Password
              <ArrowRight className="h-4 w-4" />
            </GlassButton>
          </div>
        </GlassCard>
      </AuthLayout>
    );
  }

  // VERIFY mode — shared by registration email verification and login 2FA.
  if (mode === "verify") {
    const isLoginTwoFactor = Boolean(loginPendingToken);
    const isTotpLogin = isLoginTwoFactor && loginTwoFactorMethod === "TOTP";
    return (
      <AuthLayout>
        <GlassCard strong className="p-6" hover={false}>
          <div className="flex items-center gap-3 mb-5">
            <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
              {isLoginTwoFactor ? (
                <ShieldCheck className="h-5 w-5 text-primary-foreground" />
              ) : (
                <Mail className="h-5 w-5 text-primary-foreground" />
              )}
            </div>
            <div>
              <p className="font-bold">{isLoginTwoFactor ? "Two-factor verification" : "Verify your email"}</p>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {isLoginTwoFactor ? "Security check" : "Step 2 of 3"}
              </p>
            </div>
          </div>

          {isTotpLogin ? (
            <p className="text-sm text-muted-foreground mb-5">
              Open your authenticator app and enter the current 6-digit code to finish signing in.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mb-5">
              We sent a 6-digit {isLoginTwoFactor ? "security" : "verification"} code to{" "}
              <span className="font-medium text-foreground">{verifyEmail}</span>.
              {isLoginTwoFactor
                ? " Enter it below to finish signing in."
                : " Enter it below to confirm your email address."}
            </p>
          )}

          <div className="flex flex-col items-center gap-5 py-2">
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={(v) => setOtp(v)}
              onComplete={() => undefined}
              autoFocus
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} className="h-12 w-12 text-lg first:rounded-l-2xl last:rounded-r-2xl" />
                <InputOTPSlot index={1} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={2} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={3} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={4} className="h-12 w-12 text-lg" />
                <InputOTPSlot index={5} className="h-12 w-12 text-lg" />
              </InputOTPGroup>
            </InputOTP>

            <div className="flex flex-col gap-2 w-full">
              <GlassButton
                type="button"
                size="lg"
                className="w-full"
                loading={loading}
                onClick={submitOtp}
              >
                {isLoginTwoFactor ? "Verify & sign in" : "Verify Email"}
                <ArrowRight className="h-4 w-4" />
              </GlassButton>
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <button
                  type="button"
                  onClick={resetToLogin}
                  className="inline-flex items-center gap-1 hover:text-foreground"
                >
                  <ArrowLeft className="h-3 w-3" /> Back to login
                </button>
                {!isTotpLogin && (
                  <button
                    type="button"
                    onClick={resendOtp}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    disabled={loading}
                  >
                    <RefreshCw className="h-3 w-3" /> Resend code
                  </button>
                )}
              </div>
            </div>
          </div>
        </GlassCard>
      </AuthLayout>
    );
  }

  // PENDING mode — render registration received screen with polling.
  if (mode === "pending") {
    return (
      <PendingScreen
        email={pendingEmail}
        status={status}
        isLoading={statusQuery.isLoading}
        isApproved={isApproved}
        isRejected={isRejected}
        hasChangesRequested={hasChangesRequested}
        onBackToLogin={resetToLogin}
      />
    );
  }

  // LOGIN / REGISTER modes
  return (
    <AuthLayout>
      <GlassCard strong className="p-6" hover={false}>
        {/* Mobile brand */}
        <div className="flex items-center gap-3 mb-6">
          <div className="grid place-items-center h-11 w-11 rounded-2xl bg-gradient-to-br from-primary to-chart-4 shadow-lg shadow-primary/40">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <p className="font-bold">BoardOps</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Operations Suite
            </p>
          </div>
        </div>

        {(["forgot", "forgot-otp", "reset"] as const).includes(mode as "forgot") ? (
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={() => setMode("login")}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" /> Back to sign in
            </button>
          </div>
        ) : (
          <GlassNav
            items={[
              { value: "login", label: "Sign in" },
              { value: "register", label: "Register" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            className="w-full mb-6"
          />
        )}

        <form onSubmit={submit} className="space-y-4">
          {/* In login mode the Email field is rendered here (outside the
              AnimatePresence block, which only shows in register mode). In
              register mode, "Personal Email" is part of the expanded form
              below. */}
          {mode === "login" && (
            <GlassInput
              label="Email"
              placeholder="you@boardops.io"
              type="email"
              icon={<Mail />}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              error={errors.email}
            />
          )}

          <AnimatePresence mode="wait">
            {mode === "register" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <GlassInput
                  label="Full Name"
                  placeholder="Aarav Mehta"
                  icon={<User />}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  error={errors.name}
                />
                <GlassInput
                  label="Institution Name"
                  icon={<Building2 />}
                  value={form.institutionName}
                  disabled
                  hint="Pre-filled for this deployment"
                />
                <GlassInput
                  label="Institution User ID"
                  placeholder="Roll No., Employee ID, Registration No., Hostel ID…"
                  icon={<BadgeCheck />}
                  value={form.institutionUserId}
                  onChange={(e) => setForm({ ...form, institutionUserId: e.target.value })}
                  error={errors.institutionUserId}
                  hint="(Roll No., Employee ID, Registration No., Hostel ID, etc.)"
                />
                <GlassInput
                  label="Mobile Number"
                  placeholder="+91 98765 43210"
                  icon={<Phone />}
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  error={errors.phone}
                />
                <GlassInput
                  label="Personal Email"
                  placeholder="you@example.com"
                  type="email"
                  icon={<Mail />}
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  error={errors.email}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <GlassInput
                    label="Room Number"
                    placeholder="A-101"
                    icon={<DoorOpen />}
                    value={form.room}
                    onChange={(e) => setForm({ ...form, room: e.target.value })}
                    error={errors.room}
                  />
                  <div>
                    <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
                      Gender (optional)
                    </label>
                    <Select
                      value={form.gender || undefined}
                      onValueChange={(v) => setForm({ ...form, gender: v as "MALE" | "FEMALE" | "OTHER" })}
                    >
                      <SelectTrigger className="w-full glass-soft border-0 h-[50px] rounded-2xl">
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
              </motion.div>
            )}
          </AnimatePresence>

          <GlassInput
            label="Password"
            placeholder="••••••••"
            type={showPwd ? "text" : "password"}
            icon={<Lock />}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={mode === "register" ? errors.password : undefined}
            trailing={
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Toggle password visibility"
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
          />

          {mode === "register" && (
            <GlassInput
              label="Confirm Password"
              placeholder="••••••••"
              type={showPwd ? "text" : "password"}
              icon={<Lock />}
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              error={errors.confirmPassword}
            />
          )}

          {mode === "register" && (
            <div className="space-y-2 pt-1">
              <ConsentRow
                checked={form.consents.rules}
                onChange={(v) => setForm({ ...form, consents: { ...form.consents, rules: v } })}
                label="I accept the Institution Rules"
                error={errors.rules}
              />
              <ConsentRow
                checked={form.consents.privacy}
                onChange={(v) => setForm({ ...form, consents: { ...form.consents, privacy: v } })}
                label="I accept the Privacy Policy"
                error={errors.privacy}
              />
              <ConsentRow
                checked={form.consents.terms}
                onChange={(v) => setForm({ ...form, consents: { ...form.consents, terms: v } })}
                label="I accept the Terms & Conditions"
                error={errors.terms}
              />
            </div>
          )}

          <GlassButton type="submit" size="lg" className="w-full" loading={loading}>
            {mode === "login" ? "Sign in" : "Create account"}
            <ArrowRight className="h-4 w-4" />
          </GlassButton>

          {mode === "login" && (
            <button
              type="button"
              onClick={() => setMode("forgot")}
              className="text-xs text-muted-foreground hover:text-primary transition-colors text-center w-full"
            >
              Forgot password?
            </button>
          )}
        </form>
      </GlassCard>
    </AuthLayout>
  );
}

// ────────────────────────────────────────────────────────────
// Pending screen — registration received, awaiting admin review.
// Polls /api/auth/registration-status and shows updates in real time.
// Renders the "Update & Resubmit" form when changesRequested is set.
// ────────────────────────────────────────────────────────────

function PendingScreen({
  email,
  status,
  isLoading,
  isApproved,
  isRejected,
  hasChangesRequested,
  onBackToLogin,
}: {
  email: string;
  status?: RegistrationStatus;
  isLoading: boolean;
  isApproved: boolean;
  isRejected: boolean;
  hasChangesRequested: boolean;
  onBackToLogin: () => void;
}) {
  const [showResubmit, setShowResubmit] = useState(false);
  const qc = useQueryClient();
  const approvedRef = useRef(false);

  // Once approved, give a celebratory toast and offer to login.
  useEffect(() => {
    if (isApproved && !approvedRef.current) {
      approvedRef.current = true;
      toast.success("Your account has been approved! You can now sign in.");
    }
  }, [isApproved]);

  return (
    <AuthLayout>
      <GlassCard strong className="p-6" hover={false}>
        <div className="flex items-center gap-3 mb-5">
          <div
            className={cn(
              "grid place-items-center h-11 w-11 rounded-2xl shadow-lg",
              isApproved
                ? "bg-gradient-to-br from-success to-emerald-500 shadow-success/40"
                : isRejected
                ? "bg-gradient-to-br from-destructive to-rose-500 shadow-destructive/40"
                : "bg-gradient-to-br from-primary to-chart-4 shadow-primary/40"
            )}
          >
            {isApproved ? (
              <CheckCircle2 className="h-5 w-5 text-success-foreground" />
            ) : isRejected ? (
              <AlertTriangle className="h-5 w-5 text-destructive-foreground" />
            ) : (
              <Clock3 className="h-5 w-5 text-primary-foreground" />
            )}
          </div>
          <div>
            <p className="font-bold">
              {isApproved
                ? "You're approved!"
                : isRejected
                ? "Registration rejected"
                : "Registration received"}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {isApproved ? "Step 3 of 3 complete" : "Step 3 of 3 — awaiting review"}
            </p>
          </div>
        </div>

        {/* Email verified badge */}
        <div className="glass-soft rounded-2xl p-3 mb-4 flex items-start gap-2 border border-success/30 bg-success/5">
          <BadgeCheck className="h-4 w-4 text-success shrink-0 mt-0.5" />
          <div className="text-xs flex-1">
            <p className="font-semibold text-success">Email verified</p>
            <p className="text-muted-foreground mt-0.5 break-all">{email}</p>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2 py-4">
            <div className="h-4 rounded-full bg-secondary/40 animate-pulse" />
            <div className="h-4 rounded-full bg-secondary/40 animate-pulse w-3/4" />
          </div>
        ) : (
          <>
            {/* Approve state */}
            {isApproved ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-success/10 border border-success/30 p-4 text-sm">
                  <p className="font-semibold text-success">Welcome aboard!</p>
                  <p className="text-muted-foreground mt-1">
                    An administrator has approved your registration. You can
                    now sign in with your credentials.
                  </p>
                </div>
                <GlassButton variant="success" size="lg" className="w-full" onClick={onBackToLogin}>
                  Continue to sign in
                  <ArrowRight className="h-4 w-4" />
                </GlassButton>
              </div>
            ) : isRejected ? (
              <div className="space-y-4">
                <div className="rounded-2xl bg-destructive/10 border border-destructive/30 p-4 text-sm">
                  <p className="font-semibold text-destructive">Application rejected</p>
                  <p className="text-muted-foreground mt-1">
                    {status?.rejectionReason ||
                      "Your registration was rejected. Please contact administration for more information."}
                  </p>
                </div>
                <GlassButton variant="ghost" size="lg" className="w-full" onClick={onBackToLogin}>
                  Back to login
                </GlassButton>
              </div>
            ) : hasChangesRequested ? (
              <ChangesRequestedBlock
                status={status!}
                onResubmit={() => setShowResubmit(true)}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl bg-primary/10 border border-primary/30 p-4 text-sm">
                  <p className="font-semibold text-primary flex items-center gap-1.5">
                    <Clock3 className="h-4 w-4" /> In review
                  </p>
                  <p className="text-muted-foreground mt-1">
                    Your registration is awaiting admin approval. We'll check
                    for updates every 10 seconds — keep this page open.
                  </p>
                  {status?.cycle && status.cycle > 1 && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Review cycle #{status.cycle}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <button
                    type="button"
                    onClick={onBackToLogin}
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    <ArrowLeft className="h-3 w-3" /> Back to login
                  </button>
                  <span className="inline-flex items-center gap-1">
                    <RefreshCw className="h-3 w-3 animate-pulse" /> Auto-refreshing
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {showResubmit && status && (
          <ResubmitDialog
            status={status}
            onClose={() => setShowResubmit(false)}
            onDone={() => {
              setShowResubmit(false);
              qc.invalidateQueries({ queryKey: ["registration-status", email] });
            }}
          />
        )}
      </GlassCard>
    </AuthLayout>
  );
}

function ChangesRequestedBlock({
  status,
  onResubmit,
}: {
  status: RegistrationStatus;
  onResubmit: () => void;
}) {
  const fields = status.changesRequested ?? [];
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-warning/10 border border-warning/40 p-4 text-sm">
        <p className="font-semibold text-warning flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Changes requested
        </p>
        <p className="text-muted-foreground mt-1">
          An administrator reviewed your registration and asked for the
          following updates:
        </p>
        {status.changesRequestReason && (
          <p className="text-foreground/90 mt-2 italic border-l-2 border-warning/50 pl-3">
            “{status.changesRequestReason}”
          </p>
        )}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {fields.map((f) => (
            <Badge
              key={f}
              variant="outline"
              className="text-[11px] bg-warning/15 text-warning border-warning/30"
            >
              {FIELD_LABELS[f] ?? f}
            </Badge>
          ))}
        </div>
      </div>
      <GlassButton variant="primary" size="lg" className="w-full" onClick={onResubmit}>
        <RefreshCw className="h-4 w-4" />
        Update & Resubmit
      </GlassButton>
    </div>
  );
}

function ResubmitDialog({
  status,
  onClose,
  onDone,
}: {
  status: RegistrationStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const fields = status.changesRequested ?? [];
  const [form, setForm] = useState({
    name: status.name ?? "",
    institutionUserId: status.institutionUserId ?? "",
    phone: status.phone ?? "",
    room: status.room ?? "",
    gender: (status.gender as "" | "MALE" | "FEMALE" | "OTHER") || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErrors({});
    if (!form.name || form.name.length < 2) {
      setErrors({ name: "Name too short" });
      return;
    }
    if (!form.institutionUserId) {
      setErrors({ institutionUserId: "Institution User ID is required" });
      return;
    }
    if (!form.phone || form.phone.length < 8) {
      setErrors({ phone: "Enter a valid phone" });
      return;
    }
    if (!form.room) {
      setErrors({ room: "Room number is required" });
      return;
    }
    try {
      setLoading(true);
      await api.post("/auth/resubmit", {
        email: status.email,
        name: form.name,
        institutionUserId: form.institutionUserId,
        phone: form.phone,
        room: form.room,
        gender: form.gender || undefined,
      });
      toast.success("Resubmitted for review!");
      onDone();
    } catch (err: any) {
      toast.error(err.message || "Could not resubmit");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border-2 border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm">Update fields & resubmit</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <GlassInput
        label="Full Name"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        error={errors.name}
        icon={<User className="h-4 w-4" />}
      />
      <GlassInput
        label="Institution User ID"
        value={form.institutionUserId}
        onChange={(e) => setForm({ ...form, institutionUserId: e.target.value })}
        error={errors.institutionUserId}
        icon={<BadgeCheck className="h-4 w-4" />}
      />
      <GlassInput
        label="Mobile Number"
        value={form.phone}
        onChange={(e) => setForm({ ...form, phone: e.target.value })}
        error={errors.phone}
        icon={<Phone className="h-4 w-4" />}
      />
      <GlassInput
        label="Room Number"
        value={form.room}
        onChange={(e) => setForm({ ...form, room: e.target.value })}
        error={errors.room}
        icon={<DoorOpen className="h-4 w-4" />}
      />
      <div>
        <label className="mb-1.5 ml-1 block text-xs font-medium text-muted-foreground">
          Gender
        </label>
        <Select
          value={form.gender || undefined}
          onValueChange={(v) => setForm({ ...form, gender: v as "MALE" | "FEMALE" | "OTHER" })}
        >
          <SelectTrigger className="w-full glass-soft border-0 h-[50px] rounded-2xl">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MALE">Male</SelectItem>
            <SelectItem value="FEMALE">Female</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <GlassButton variant="primary" size="md" className="w-full" loading={loading} onClick={submit}>
        <RefreshCw className="h-4 w-4" />
        Submit updated registration
      </GlassButton>
    </div>
  );
}

function ConsentRow({
  checked,
  onChange,
  label,
  error,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  error?: string;
}) {
  return (
    <div>
      <label
        className={cn(
          "flex items-center gap-2.5 glass-soft rounded-2xl px-3 py-2.5 cursor-pointer hover:bg-secondary/40 transition-colors",
          error && "border-2 border-destructive/60"
        )}
      >
        <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} />
        <span className="text-xs text-foreground/90 select-none">{label}</span>
      </label>
      {error && <p className="mt-1 ml-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

// Shared layout — AnimatedBackground + hero column on lg screens.
function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 safe-top safe-bottom">
      <AnimatedBackground />
      <div className="w-full max-w-md mx-auto flex flex-col gap-6 items-center">
        {/* Hero side — hidden on small screens. Kept for visual continuity. */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
          className="hidden flex-col gap-6 p-8"
        >
          <div className="flex items-center gap-3">
            <div className="grid place-items-center h-12 w-12 rounded-3xl bg-gradient-to-br from-primary to-chart-4 shadow-xl shadow-primary/40">
              <Sparkles className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-xl font-bold">BoardOps</p>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Configurable Operations Suite
              </p>
            </div>
          </div>
          <h1 className="text-5xl font-bold leading-[1.1] tracking-tight">
            Run your institution
            <br />
            like a{" "}
            <span className="gradient-text">premium product.</span>
          </h1>
          <p className="text-muted-foreground text-lg max-w-md">
            Configure meals, billing, variables, and reports — nothing hardcoded.
            Built for hostels, PGs, colleges, and residential institutions.
          </p>
          <div className="grid gap-3 mt-2">
            {[
              { icon: Layers, title: "Dynamic Meal Engine", desc: "Unlimited meals, cutoffs, and service dates — all DB-driven." },
              { icon: Zap, title: "Formula & Variable Engine", desc: "Recalculate bills automatically on any change." },
              { icon: ShieldCheck, title: "Permission-controlled", desc: "RBAC, audit logs, soft-delete — enterprise-grade." },
            ].map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <GlassCard className="p-4 flex items-start gap-3" hover={false}>
                  <div className="grid place-items-center h-10 w-10 rounded-2xl bg-primary/15 shrink-0">
                    <f.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
