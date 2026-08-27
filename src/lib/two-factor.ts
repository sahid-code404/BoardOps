import {
  generateSecret as otplibGenerateSecret,
  generateSync,
  verifySync,
  generateURI,
} from "otplib";
import QRCode from "qrcode";
import { createHash, randomBytes } from "crypto";

const TOTP_CONFIG = {
  period: 30,
  digits: 6,
  algorithm: "sha1" as const,
  epochTolerance: 1, // allow ±30s drift
};

export function generateTwoFactorSecret(): string {
  return otplibGenerateSecret({ length: 32 });
}

export function generateOtpAuthUri(
  email: string,
  secret: string,
  issuer = "BoardOps"
): string {
  return generateURI({
    issuer,
    label: email,
    secret,
    period: TOTP_CONFIG.period,
    digits: TOTP_CONFIG.digits,
    algorithm: TOTP_CONFIG.algorithm,
  });
}

export async function generateQrCodeDataUrl(otpauthUri: string): Promise<string> {
  return QRCode.toDataURL(otpauthUri, {
    width: 240,
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    const cleanToken = token.replace(/\s/g, "");
    return verifySync({
      token: cleanToken,
      secret,
      period: TOTP_CONFIG.period,
      digits: TOTP_CONFIG.digits,
      algorithm: TOTP_CONFIG.algorithm,
      epochTolerance: TOTP_CONFIG.epochTolerance,
    });
  } catch {
    return false;
  }
}

/** Generate 8 single-use backup codes. Returns plain codes + their hashes. */
export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const code = randomBytes(5).toString("hex").toUpperCase().slice(0, 10);
    plain.push(code);
    hashes.push(hashBackupCode(code));
  }
  return { plain, hashes };
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

/** Verify a backup code against a list of stored hashes. Returns the index if matched, -1 otherwise. */
export function verifyBackupCode(code: string, hashedCodes: string[]): number {
  const hash = hashBackupCode(code);
  return hashedCodes.indexOf(hash);
}
