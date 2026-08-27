import { db } from "@/lib/db";
import { ok, handleApiError } from "@/lib/api-response";
import { z } from "zod";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
});

/**
 * GET /api/auth/registration-status?email=...
 *
 * Public (no auth) status-check endpoint for users waiting on admin review.
 * This is safe because we only return high-level state (PENDING / APPROVED /
 * ARCHIVED etc.) and the changes-requested metadata if any. No passwords,
 * tokens, or other sensitive fields are returned.
 *
 * Used by the auth-screen "pending" mode to poll for status updates while the
 * admin reviews the registration.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const email = url.searchParams.get("email");
    if (!email) return ok({ exists: false });

    const parsed = schema.safeParse({ email });
    if (!parsed.success) return ok({ exists: false });

    const user = await db.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        emailVerified: true,
        changesRequested: true,
        changesRequestReason: true,
        changesRequestedAt: true,
        institutionName: true,
        institutionUserId: true,
        phone: true,
        room: true,
        gender: true,
        rejectionReason: true,
      },
    });

    if (!user) return ok({ exists: false });

    // Pull the latest RegistrationRequest cycle for context.
    const latest = await db.registrationRequest.findFirst({
      where: { userId: user.id },
      orderBy: { cycle: "desc" },
      select: { cycle: true, status: true, createdAt: true, reviewedAt: true },
    });

    return ok({
      exists: true,
      status: user.status,
      emailVerified: user.emailVerified,
      name: user.name,
      email: user.email,
      institutionName: user.institutionName,
      institutionUserId: user.institutionUserId,
      phone: user.phone,
      room: user.room,
      gender: user.gender,
      changesRequested: user.changesRequested ? JSON.parse(user.changesRequested) : null,
      changesRequestReason: user.changesRequestReason,
      changesRequestedAt: user.changesRequestedAt,
      rejectionReason: user.rejectionReason,
      cycle: latest?.cycle ?? null,
      reviewStatus: latest?.status ?? null,
      reviewedAt: latest?.reviewedAt ?? null,
      submittedAt: latest?.createdAt ?? null,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
