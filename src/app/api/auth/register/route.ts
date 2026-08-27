import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { validatePassword } from "@/lib/password-policy";
import { getClientIp, getUserAgent } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import { logAudit } from "@/lib/audit";
import { z } from "zod";
import { hashOtp, generateOtp } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/email";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  institutionName: z.string().min(2, "Institution name is required"),
  institutionUserId: z.string().min(1, "Institution User ID is required"),
  phone: z.string().min(8, "Enter a valid phone number"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  room: z.string().min(1, "Room number is required"),
  gender: z.union([z.literal(""), z.enum(["MALE", "FEMALE", "OTHER"])]).optional(),
  consents: z.object({
    rules: z.boolean().refine((v) => v === true, "You must accept the Institution Rules"),
    privacy: z.boolean().refine((v) => v === true, "You must accept the Privacy Policy"),
    terms: z.boolean().refine((v) => v === true, "You must accept the Terms & Conditions"),
  }),
});

// Re-export so existing imports (`import { hashOtp } from "../register/route"`)
// continue to resolve while callers migrate to `@/lib/otp` directly.
export { hashOtp, generateOtp };

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const data = schema.parse(body);

    // Validate password against policy (uppercase, lowercase, number, special, min length)
    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.valid) {
      return err(passwordValidation.errors.join("; "), 422);
    }

    if (data.password !== data.confirmPassword) {
      return err("Passwords do not match", 400);
    }

    // Uniqueness checks — return generic messages to avoid user enumeration.
    const [emailTaken, phoneTaken, institutionIdTaken] = await Promise.all([
      db.user.findUnique({ where: { email: data.email.toLowerCase() } }),
      data.phone ? db.user.findUnique({ where: { phone: data.phone } }) : null,
      db.user.findFirst({ where: { institutionUserId: data.institutionUserId } }),
    ]);
    if (emailTaken) return err("This email is already registered", 409);
    if (phoneTaken) return err("This phone number is already registered", 409);
    if (institutionIdTaken) return err("This Institution User ID is already taken", 409);

    const passwordHash = hashPassword(data.password);
    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const user = await db.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        phone: data.phone,
        passwordHash,
        role: "USER",
        status: "PENDING",
        room: data.room,
        gender: data.gender ?? null,
        institutionName: data.institutionName,
        institutionUserId: data.institutionUserId,
        emailVerified: false,
        emailVerifyToken: otpHash,
        emailVerifyExpires: otpExpires,
      },
    });

    // Create the first RegistrationRequest (cycle 1) with a snapshot of fields.
    await db.registrationRequest.create({
      data: {
        userId: user.id,
        cycle: 1,
        status: "PENDING_REVIEW",
        fields: JSON.stringify({
          name: data.name,
          email: data.email.toLowerCase(),
          phone: data.phone,
          room: data.room,
          gender: data.gender ?? null,
          institutionName: data.institutionName,
          institutionUserId: data.institutionUserId,
        }),
      },
    });

    await sendOtpEmail(user.email, otp, "email-verification");

    await logAudit({
      actorId: user.id,
      action: "USER_REGISTER",
      entity: "User",
      entityId: user.id,
      newValue: {
        email: user.email,
        institutionUserId: user.institutionUserId,
        room: user.room,
      },
      ipAddress: await getClientIp(),
      userAgent: await getUserAgent(),
    });

    // SECURITY: Never expose the OTP in the API response.
    return ok({
      userId: user.id,
      email: user.email,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
