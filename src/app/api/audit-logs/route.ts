import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { ok, handleApiError } from "@/lib/api-response";

/**
 * GET /api/audit-logs
 * Enhanced audit log query with filters:
 *   - entity: filter by entity type (User, Bill, Payment, etc.)
 *   - entityId: filter by specific entity ID (for per-entity timeline)
 *   - action: filter by action (e.g. PAYMENT_APPROVED)
 *   - actorId: filter by who performed the action
 *   - search: free-text search on action/entity/reason
 *   - limit: pagination (default 50, max 200)
 *   - offset: pagination offset
 */
export async function GET(req: Request) {
  try {
    await requireRole("ADMIN");
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") || 50), 200);
    const offset = Number(url.searchParams.get("offset") || 0);
    const entity = url.searchParams.get("entity");
    const entityId = url.searchParams.get("entityId");
    const action = url.searchParams.get("action");
    const actorId = url.searchParams.get("actorId");
    const search = url.searchParams.get("search");

    const where: Record<string, unknown> = {};
    if (entity) where.entity = entity;
    if (entityId) where.entityId = entityId;
    if (action) where.action = { contains: action };
    if (actorId) where.actorId = actorId;
    if (search) {
      where.OR = [
        { action: { contains: search } },
        { entity: { contains: search } },
        { reason: { contains: search } },
      ];
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
      db.auditLog.count({ where }),
    ]);

    // Get distinct entities + actions for filter dropdowns
    const [entities, actions] = await Promise.all([
      db.auditLog.findMany({
        where: {},
        distinct: ["entity"],
        select: { entity: true },
        orderBy: { entity: "asc" },
      }),
      db.auditLog.findMany({
        where: {},
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ]);

    return ok({
      logs,
      total,
      pagination: { limit, offset, hasMore: offset + logs.length < total },
      filters: {
        entities: entities.map((e) => e.entity),
        actions: actions.map((a) => a.action),
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
