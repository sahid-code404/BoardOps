import { verifySync } from "otplib";

const TOTP_CONFIG = {
  period: 30,
  digits: 6,
  algorithm: "sha1" as const,
  epochTolerance: 1,
};

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
