import { db } from "@/lib/db";
import { requireAuth } from "@/lib/session";
import { ok, err, handleApiError } from "@/lib/api-response";
import {
  generateTwoFactorSecret,
  generateOtpAuthUri,
  generateQrCodeDataUrl,
} from "@/lib/two-factor";

/**
 * POST /api/auth/2fa/setup
 * Generates a new TOTP secret and QR code for the user.
 * The secret is NOT saved to the user record until /verify is called.
 * Returns: { secret, qrCode, otpauth }
 */
export async function POST() {
  try {
    const user = await requireAuth();

    const fullUser = await db.user.findUnique({ where: { id: user.id } });
    if (fullUser?.twoFactorEnabled) {
      return err("Two-factor authentication is already enabled", 422);
    }

    const secret = generateTwoFactorSecret();
    const otpauth = generateOtpAuthUri(user.email, secret);
    const qrCode = await generateQrCodeDataUrl(otpauth);

    return ok({ secret, qrCode, otpauth });
  } catch (e) {
    return handleApiError(e);
  }
}
