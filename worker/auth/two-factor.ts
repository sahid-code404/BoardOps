import { createHash, randomBytes } from "node:crypto";

import {
  generateSecret as otplibGenerateSecret,
  generateURI,
  verifySync,
} from "otplib";
import QRCode from "qrcode";

const TOTP_CONFIG = {
  period: 30,
  digits: 6,
  algorithm: "sha1" as const,
  epochTolerance: 1,
};

export function generateTwoFactorSecret(): string {
  return otplibGenerateSecret({ length: 32 });
}

export function generateOtpAuthUri(
  email: string,
  secret: string,
  issuer = "BoardOps",
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
    }).valid;
  } catch {
    return false;
  }
}

export function hashBackupCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase()).digest("hex");
}

export function generateBackupCodes(): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  const hashes: string[] = [];

  for (let index = 0; index < 8; index += 1) {
    const code = randomBytes(5).toString("hex").toUpperCase().slice(0, 10);
    plain.push(code);
    hashes.push(hashBackupCode(code));
  }

  return { plain, hashes };
}

export function verifyBackupCode(code: string, hashes: string[]): number {
  return hashes.indexOf(hashBackupCode(code));
}
