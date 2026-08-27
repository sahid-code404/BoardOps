"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Users,
  Receipt,
  CreditCard,
  Database,
  Loader2,
} from "lucide-react";
import { GlassCard } from "@/components/glass/glass-card";
import { GlassButton } from "@/components/glass/glass-button";
import {
  StaggerGroup,
  StaggerItem,
} from "@/components/glass/page-transition";
import { api } from "@/lib/api-client";

type ApiResponse<T> = { success: boolean; data: T };

type UserRow = {
  id: string;
  name: string;
  email: string;
  room?: string | null;
  role: string;
  status: string;
  createdAt: string;
};

type BillRow = {
  id: string;
  billNumber?: string | null;
  periodMonth: number;
  periodYear: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
  user: { name: string; email: string; room: string | null };
};

type PaymentRow = {
  id: string;
  amount: number;
  method: string;
  status: string;
  createdAt: string;
  user: { name: string; email: string; room: string | null };
};

// ─────────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────────

function escapeCsv(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map((r) => headers.map((h) => escapeCsv(r[h])).join(","));
  return [headerLine, ...dataLines].join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function DataExportView() {
  const [exporting, setExporting] = useState<string | null>(null);

  const exportUsers = async () => {
    setExporting("users");
    try {
      const resp = await api.get<ApiResponse<UserRow[]>>("/users");
      const users = resp.data ?? [];
      const csv = toCsv(
        ["Name", "Email", "Room", "Role", "Status", "CreatedAt"],
        users.map((u) => ({
          Name: u.name,
          Email: u.email,
          Room: u.room || "",
          Role: u.role,
          Status: u.status,
          CreatedAt: formatDate(u.createdAt),
        }))
      );
      downloadCsv(`users-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${users.length} users`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export users");
    } finally {
      setExporting(null);
    }
  };

  const exportBills = async () => {
    setExporting("bills");
    try {
      const resp = await api.get<ApiResponse<BillRow[]>>("/bills", {
        params: { limit: 5000 },
      });
      const bills = resp.data ?? [];
      const csv = toCsv(
        ["Resident", "Email", "Room", "Period", "BillNumber", "Total", "Paid", "Due", "Status"],
        bills.map((b) => ({
          Resident: b.user.name,
          Email: b.user.email,
          Room: b.user.room || "",
          Period: `${b.periodMonth + 1}/${b.periodYear}`,
          BillNumber: b.billNumber || "",
          Total: b.totalAmount,
          Paid: b.paidAmount,
          Due: b.dueAmount,
          Status: b.status,
        }))
      );
      downloadCsv(`bills-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${bills.length} bills`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export bills");
    } finally {
      setExporting(null);
    }
  };

  const exportPayments = async () => {
    setExporting("payments");
    try {
      const resp = await api.get<ApiResponse<PaymentRow[]>>("/payments", {
        params: { limit: 5000 },
      });
      const payments = resp.data ?? [];
      const csv = toCsv(
        ["Resident", "Email", "Room", "Amount", "Method", "Status", "Date"],
        payments.map((p) => ({
          Resident: p.user.name,
          Email: p.user.email,
          Room: p.user.room || "",
          Amount: p.amount,
          Method: p.method,
          Status: p.status,
          Date: formatDate(p.createdAt),
        }))
      );
      downloadCsv(`payments-${new Date().toISOString().slice(0, 10)}.csv`, csv);
      toast.success(`Exported ${payments.length} payments`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to export payments");
    } finally {
      setExporting(null);
    }
  };

  const backupDatabase = async () => {
    setExporting("backup");
    try {
      const resp = await api.post<ApiResponse<{ output: string }>>("/system/backup");
      toast.success("Database backup completed", {
        description: resp.data?.output,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to backup database");
    } finally {
      setExporting(null);
    }
  };

  const buttons = [
    {
      key: "users",
      label: "Export Users",
      description: "Name, email, room, role, status, created date",
      icon: Users,
      onClick: exportUsers,
    },
    {
      key: "bills",
      label: "Export Bills",
      description: "Resident, period, total, paid, due, status",
      icon: Receipt,
      onClick: exportBills,
    },
    {
      key: "payments",
      label: "Export Payments",
      description: "Resident, amount, method, status, date",
      icon: CreditCard,
      onClick: exportPayments,
    },
    {
      key: "backup",
      label: "Backup Database",
      description: "Run SQLite backup script (saved to /backups)",
      icon: Database,
      onClick: backupDatabase,
    },
  ];

  return (
    <StaggerGroup className="space-y-4">
      <StaggerItem>
        <GlassCard className="p-5" hover={false}>
          <div className="flex items-center gap-2 mb-1">
            <Download className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">Data Export</h3>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Export system data as CSV files or trigger a database backup. All exports respect your admin role.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {buttons.map((b) => {
              const Icon = b.icon;
              const isLoading = exporting === b.key;
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={b.onClick}
                  disabled={exporting !== null}
                  className="group flex items-start gap-3 p-3.5 rounded-2xl glass-soft hover:ring-1 hover:ring-primary/40 transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="grid place-items-center h-9 w-9 rounded-xl bg-primary/15 text-primary shrink-0">
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{b.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                      {b.description}
                    </p>
                  </div>
                  <Download className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-primary transition-colors shrink-0 mt-1" />
                </button>
              );
            })}
          </div>
        </GlassCard>
      </StaggerItem>
    </StaggerGroup>
  );
}
