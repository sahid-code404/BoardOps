import { asc, eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { z } from "zod";

import { logAudit } from "../auth/audit";
import {
  databaseDateToIso,
  getAuthUser,
  getClientIp,
  getUserAgent,
} from "../auth/session";
import { createDatabase } from "../db/client";
import { Institution } from "../db/schema";
import type { ApiFailure, ApiSuccess } from "../http";
import type { BoardOpsEnv } from "../types";

type InstitutionErrorStatus = 400 | 401 | 403 | 404;

const institutionType = z.enum([
  "HOSTEL",
  "PG",
  "COLLEGE",
  "COMPANY_ACCOMMODATION",
  "NGO",
  "TRAINING_INSTITUTE",
  "RESIDENTIAL_SCHOOL",
  "BOARDING_HOUSE",
  "UNIVERSITY",
]);

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  type: institutionType.optional(),
  address: z.string().optional().nullable(),
  contactEmail: z.string().email().optional().nullable(),
  contactPhone: z.string().optional().nullable(),
  currency: z.string().default("INR"),
  timezone: z.string().default("UTC"),
  logoUrl: z.string().optional().nullable(),
});

function failure(c: Context<BoardOpsEnv>, error: string, status: InstitutionErrorStatus) {
  return c.json<ApiFailure>(
    { success: false, error, requestId: c.get("requestId") },
    status,
  );
}

function serializeInstitution(record: typeof Institution.$inferSelect) {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    address: record.address,
    contactEmail: record.contactEmail,
    contactPhone: record.contactPhone,
    currency: record.currency,
    timezone: record.timezone,
    logoUrl: record.logoUrl,
    isActive: record.isActive,
    createdAt: databaseDateToIso(record.createdAt),
    updatedAt: databaseDateToIso(record.updatedAt),
  };
}

async function getOrCreateInstitution(c: Context<BoardOpsEnv>) {
  const db = createDatabase(c.env.DB);
  const [existing] = await db
    .select()
    .from(Institution)
    .orderBy(asc(Institution.createdAt))
    .limit(1);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(Institution).values({
    id,
    name: "BoardOps Institute",
    type: "HOSTEL",
    currency: "INR",
    timezone: "UTC",
    isActive: true,
    updatedAt: now,
  });

  const [created] = await db.select().from(Institution).where(eq(Institution.id, id)).limit(1);
  return created ?? null;
}

export function registerInstitutionRoutes(app: Hono<BoardOpsEnv>): void {
  app.get("/api/institution", async (c) => {
    const institution = await getOrCreateInstitution(c);
    if (!institution) return failure(c, "Institution not found", 404);
    const response = serializeInstitution(institution);

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });

  app.put("/api/institution", async (c) => {
    const admin = await getAuthUser(c);
    if (!admin || admin.status !== "ACTIVE") return failure(c, "Not authenticated", 401);
    if (admin.role !== "ADMIN") return failure(c, "Forbidden", 403);

    const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return failure(c, parsed.error.issues[0]?.message ?? "Invalid institution update", 400);
    }

    const institution = await getOrCreateInstitution(c);
    if (!institution) return failure(c, "Institution not found", 404);

    const updates: Partial<typeof Institution.$inferInsert> = {
      updatedAt: new Date().toISOString(),
    };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.type !== undefined) updates.type = parsed.data.type;
    if (parsed.data.address !== undefined) updates.address = parsed.data.address;
    if (parsed.data.contactEmail !== undefined) updates.contactEmail = parsed.data.contactEmail;
    if (parsed.data.contactPhone !== undefined) updates.contactPhone = parsed.data.contactPhone;
    if (parsed.data.currency !== undefined) updates.currency = parsed.data.currency;
    if (parsed.data.timezone !== undefined) updates.timezone = parsed.data.timezone;
    if (parsed.data.logoUrl !== undefined) updates.logoUrl = parsed.data.logoUrl;

    const db = createDatabase(c.env.DB);
    await db.update(Institution).set(updates).where(eq(Institution.id, institution.id));
    const [updated] = await db
      .select()
      .from(Institution)
      .where(eq(Institution.id, institution.id))
      .limit(1);
    if (!updated) return failure(c, "Institution not found", 404);

    const oldValue = serializeInstitution(institution);
    const response = serializeInstitution(updated);
    await logAudit(c, {
      actorId: admin.id,
      action: "INSTITUTION_UPDATE",
      entity: "Institution",
      entityId: updated.id,
      oldValue,
      newValue: response,
      ipAddress: getClientIp(c),
      userAgent: getUserAgent(c),
    });

    return c.json<ApiSuccess<typeof response>>({
      success: true,
      data: response,
      requestId: c.get("requestId"),
    });
  });
}
