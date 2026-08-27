"use client";

import {
  LayoutDashboard,
  UtensilsCrossed,
  BarChart3,
  Wallet,
  Receipt,
  Bell,
  Users,
  Settings,
  User,
  CreditCard,
  PiggyBank,
  CalendarCheck,
  Sigma,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useAppStore, type ViewKey } from "@/stores/use-app-store";
import { useAuthStore, type Role } from "@/stores/use-auth-store";
import { useEffect } from "react";
import { motion } from "framer-motion";

type PaletteItem = {
  view: ViewKey;
  label: string;
  icon: LucideIcon;
  keywords: string[];
  roles: Role[];
  group: string;
};

const ITEMS: PaletteItem[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: ["home", "overview"], roles: ["ADMIN", "USER"], group: "Workspace" },
  { view: "meals", label: "Meal Configuration", icon: UtensilsCrossed, keywords: ["meals", "config", "menu"], roles: ["ADMIN"], group: "Workspace" },
  { view: "kitchen", label: "Meal Counts", icon: BarChart3, keywords: ["kitchen", "counts", "meals", "chart"], roles: ["ADMIN"], group: "Workspace" },
  { view: "billing", label: "Billing & Closing", icon: Wallet, keywords: ["billing", "invoice", "bills", "monthly closing", "settle", "snapshot"], roles: ["ADMIN", "USER"], group: "Finance" },
  { view: "payments", label: "Payments & Wallet", icon: CreditCard, keywords: ["payment", "wallet", "pay", "deposit"], roles: ["ADMIN", "USER"], group: "Finance" },
  { view: "expenses", label: "Expenses & Procurement", icon: Receipt, keywords: ["expense", "procurement", "spend", "purchase", "shopping", "vendor", "product", "catalog", "ingredient", "unit"], roles: ["ADMIN"], group: "Finance" },
  { view: "funds", label: "Funds Overview", icon: PiggyBank, keywords: ["fund", "balance", "deposit", "deficit"], roles: ["ADMIN"], group: "Finance" },
  { view: "monthly-closing", label: "Monthly Closing", icon: CalendarCheck, keywords: ["closing", "settle", "snapshot", "freeze", "lock", "finalize"], roles: ["ADMIN"], group: "Finance" },
  { view: "formula-engine", label: "Formula Engine", icon: Sigma, keywords: ["formula", "variable", "expression", "calculation", "rate", "config", "billing formula"], roles: ["ADMIN"], group: "Admin" },
  { view: "users", label: "User Management", icon: Users, keywords: ["user", "member", "account", "resident", "approve"], roles: ["ADMIN"], group: "Admin" },
  { view: "notifications", label: "Notifications & Announcements", icon: Bell, keywords: ["notification", "alert", "bell", "announcement", "broadcast", "notice", "pinned", "message"], roles: ["ADMIN", "USER"], group: "Admin" },
  { view: "settings", label: "Settings & Policies", icon: Settings, keywords: ["setting", "config", "policy", "policies", "rules", "behavior", "grace", "cutoff", "threshold", "theme", "color", "accent", "appearance", "holiday", "calendar", "festival"], roles: ["ADMIN"], group: "Admin" },
  { view: "system", label: "System (Audit & Tasks)", icon: ScrollText, keywords: ["audit", "log", "history", "trace", "changes", "timeline", "task", "background", "job", "queue", "async", "cleanup", "session"], roles: ["ADMIN"], group: "Admin" },
  { view: "profile", label: "My Profile", icon: User, keywords: ["profile", "me", "account"], roles: ["ADMIN", "USER"], group: "Account" },
];

export function CommandPalette() {
  const setView = useAppStore((s) => s.setView);
  const open = useAppStore((s) => s.commandOpen);
  const setOpen = useAppStore((s) => s.setCommandOpen);
  const user = useAuthStore((s) => s.user);
  const role = (user?.role as Role) || "USER";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(!open);
      }
      if (e.key === "F8") {
        e.preventDefault();
        setOpen(!open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, setOpen]);

  const filtered = ITEMS.filter((i) => i.roles.includes(role));

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search navigation and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {Array.from(new Set(filtered.map((i) => i.group))).map((group) => (
          <CommandGroup key={group} heading={group}>
            {filtered
              .filter((i) => i.group === group)
              .map((item) => (
                <CommandItem
                  key={item.view}
                  onSelect={() => {
                    setView(item.view);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>{item.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {item.keywords.slice(0, 2).join(", ")}
                  </span>
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
      </CommandList>
    </CommandDialog>
  );
}
