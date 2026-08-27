"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Settings as SettingsIcon,
  Building2,
  Shield,
  Save,
  Check,
  ToggleLeft,
  ToggleRight,
  Globe,
  Phone,
  Mail,
  MapPin,
  Clock,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import { GlassInput } from "@/components/glass/glass-input";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { ShimmerSkeleton } from "@/components/glass/shimmer-skeleton";
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

type ApiResponse<T> = { success: boolean; data: T };

type Institution = {
  id: string;
  name: string;
  type: string;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  currency: string;
  timezone: string;
  logoUrl: string | null;
};

type Policy = {
  key: string;
  value: string;
  type: string;
  description: string;
};

type PolicyCategory = {
  category: string;
  label: string;
  policies: Policy[];
};

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  FINANCIAL: Shield,
  MEAL: SettingsIcon,
  BILLING: SettingsIcon,
  PAYMENT: SettingsIcon,
  NOTIFICATION: SettingsIcon,
  AUTH: Shield,
};

export function PoliciesView() {
  const qc = useQueryClient();

  // Institution profile
  const { data: institution, isLoading: instLoading } = useQuery({
    queryKey: ["institution"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<Institution>>("/institution");
      return r.data;
    },
  });

  // Policies
  const { data: policyData, isLoading: policyLoading } = useQuery({
    queryKey: ["policies"],
    queryFn: async () => {
      const r = await api.get<ApiResponse<{ categories: PolicyCategory[] }>>("/policies");
      return r.data;
    },
  });

  const instMutation = useMutation({
    mutationFn: (data: Partial<Institution>) => api.put("/institution", data),
    onSuccess: () => {
      toast.success("Institution profile updated");
      qc.invalidateQueries({ queryKey: ["institution"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update"),
  });

  const policyMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.put("/policies", { key, value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["policies"] });
    },
    onError: (e: Error) => toast.error(e.message || "Failed to update policy"),
  });

  return (
    <StaggerGroup className="space-y-5">
      <StaggerItem>
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="h-6 w-6 text-primary" />
            Settings & Policies
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Institution profile and configurable policies. Separate from Variables (formula inputs).
          </p>
        </div>
      </StaggerItem>

      {/* Institution Profile */}
      <StaggerItem>
        {instLoading || !institution ? (
          <ShimmerSkeleton className="h-64 rounded-3xl" />
        ) : (
          <InstitutionProfileCard
            institution={institution}
            onSave={(data) => instMutation.mutate(data)}
            saving={instMutation.isPending}
          />
        )}
      </StaggerItem>

      {/* Policies */}
      <StaggerItem>
        {policyLoading || !policyData ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <ShimmerSkeleton key={i} className="h-40 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {policyData.categories.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.category] || SettingsIcon;
              return (
                <GlassCard key={cat.category} className="p-4" hover={false}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="font-semibold text-sm">{cat.label}</p>
                  </div>
                  <div className="space-y-2">
                    {cat.policies.map((p) => (
                      <PolicyRow
                        key={p.key}
                        policy={p}
                        onUpdate={(value) => {
                          policyMutation.mutate({ key: p.key, value });
                          toast.success(`${p.key} updated to "${value}"`);
                        }}
                      />
                    ))}
                  </div>
                </GlassCard>
              );
            })}
          </div>
        )}
      </StaggerItem>
    </StaggerGroup>
  );
}

// ─── Institution Profile Card ───

function InstitutionProfileCard({
  institution,
  onSave,
  saving,
}: {
  institution: Institution;
  onSave: (data: Partial<Institution>) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(institution.name);
  const [type, setType] = useState(institution.type);
  const [address, setAddress] = useState(institution.address || "");
  const [contactEmail, setContactEmail] = useState(institution.contactEmail || "");
  const [contactPhone, setContactPhone] = useState(institution.contactPhone || "");
  const [currency, setCurrency] = useState(institution.currency);
  const [timezone, setTimezone] = useState(institution.timezone);

  const hasChanges =
    name !== institution.name ||
    type !== institution.type ||
    address !== (institution.address || "") ||
    contactEmail !== (institution.contactEmail || "") ||
    contactPhone !== (institution.contactPhone || "") ||
    currency !== institution.currency ||
    timezone !== institution.timezone;

  return (
    <GlassCard className="p-5" hover={false}>
      <div className="flex items-center gap-2 mb-4">
        <div className="grid place-items-center h-8 w-8 rounded-xl bg-primary/10 text-primary">
          <Building2 className="h-4 w-4" />
        </div>
        <p className="font-semibold text-sm">Institution Profile</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="inst-name">Institution Name</Label>
          <GlassInput id="inst-name" value={name} onChange={(e) => setName(e.target.value)} icon={<Building2 className="h-4 w-4" />} />
        </div>
        <div className="space-y-1.5">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["HOSTEL", "PG", "COLLEGE", "COMPANY_ACCOMMODATION", "NGO", "TRAINING_INSTITUTE", "RESIDENTIAL_SCHOOL", "BOARDING_HOUSE", "UNIVERSITY"].map((t) => (
                <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="inst-addr">Address</Label>
          <GlassInput id="inst-addr" value={address} onChange={(e) => setAddress(e.target.value)} icon={<MapPin className="h-4 w-4" />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inst-email">Contact Email</Label>
          <GlassInput id="inst-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} icon={<Mail className="h-4 w-4" />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inst-phone">Contact Phone</Label>
          <GlassInput id="inst-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} icon={<Phone className="h-4 w-4" />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inst-currency">Currency</Label>
          <GlassInput id="inst-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} icon={<Globe className="h-4 w-4" />} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inst-tz">Timezone</Label>
          <GlassInput id="inst-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} icon={<Clock className="h-4 w-4" />} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <GlassButton
          size="sm"
          loading={saving}
          disabled={!hasChanges}
          onClick={() => onSave({ name, type, address: address || null, contactEmail: contactEmail || null, contactPhone: contactPhone || null, currency, timezone })}
        >
          <Save className="h-3.5 w-3.5" />
          Save Changes
        </GlassButton>
      </div>
    </GlassCard>
  );
}

// ─── Policy Row ───

function PolicyRow({
  policy,
  onUpdate,
}: {
  policy: Policy;
  onUpdate: (value: string) => void;
}) {
  const isBoolean = policy.type === "BOOLEAN";
  const boolValue = policy.value === "true";
  const [textValue, setTextValue] = useState(policy.value);

  // Extract a readable label from the key
  const label = policy.key
    .replace("policy.", "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\./g, " → ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const handleToggle = () => {
    const newValue = !boolValue ? "true" : "false";
    onUpdate(newValue);
  };

  const handleTextSave = () => {
    if (textValue !== policy.value) {
      onUpdate(textValue);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 p-2.5 rounded-xl glass-soft">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {policy.description && (
          <p className="text-[10px] text-muted-foreground truncate">{policy.description}</p>
        )}
      </div>
      <div className="shrink-0">
        {isBoolean ? (
          <div className="flex items-center gap-2">
            <span className={cn("text-xs font-medium", boolValue ? "text-success" : "text-muted-foreground")}>
              {boolValue ? "Enabled" : "Disabled"}
            </span>
            <Switch checked={boolValue} onCheckedChange={handleToggle} />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type={policy.type === "NUMBER" ? "number" : "text"}
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              onBlur={handleTextSave}
              onKeyDown={(e) => { if (e.key === "Enter") handleTextSave(); }}
              className="w-32 px-2 py-1 text-sm rounded-lg glass-soft border-0 focus:ring-2 focus:ring-primary/40 focus:outline-none font-mono"
            />
            {textValue !== policy.value && (
              <button onClick={handleTextSave} className="text-success">
                <Check className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
