import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const DEFAULT_THEME = {
  primary: "#8b5cf6",
  primaryForeground: "#ffffff",
  accent: "#10b981",
  radius: "1.25rem",
  mode: "system",
  preset: "violet",
  glassMode: "on",
  blurIntensity: "normal",
  transparency: "medium",
};

/**
 * GET /api/theme
 * Public — returns the global UI theme config for ALL users
 * (including unauthenticated visitors on the login screen).
 */
export async function GET() {
  try {
    const setting = await db.setting.findUnique({
      where: { key: "ui.theme" },
    });
    if (!setting) return ok(DEFAULT_THEME);
    try {
      return ok({ ...DEFAULT_THEME, ...JSON.parse(setting.value) });
    } catch {
      return ok(DEFAULT_THEME);
    }
  } catch (e) {
    return handleApiError(e);
  }
}

const themeSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color"),
  primaryForeground: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color"),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color"),
  radius: z.string().min(4).max(20),
  mode: z.enum(["system", "light", "dark"]),
  preset: z.string(),
  glassMode: z.enum(["on", "off"]).default("on"),
  blurIntensity: z.enum(["light", "normal", "heavy"]).default("normal"),
  transparency: z.enum(["low", "medium", "high"]).default("medium"),
});

/**
 * PUT /api/theme
 * Admin-only — updates the global UI theme for ALL users.
 */
export async function PUT(req: Request) {
  try {
    const user = await requireRole("ADMIN");
    const body = await req.json();
    const data = themeSchema.parse(body);

    await db.setting.upsert({
      where: { key: "ui.theme" },
      update: {
        value: JSON.stringify(data),
        type: "JSON",
        category: "UI",
        isPublic: true,
        description: "Global UI theme — applies to all users",
      },
      create: {
        key: "ui.theme",
        value: JSON.stringify(data),
        type: "JSON",
        category: "UI",
        isPublic: true,
        description: "Global UI theme — applies to all users",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "THEME_UPDATE",
      entity: "Setting",
      entityId: "ui.theme",
      newValue: data,
    });

    return ok(data);
  } catch (e) {
    return handleApiError(e);
  }
}
