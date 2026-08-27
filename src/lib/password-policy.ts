/**
 * Password Policy Engine (PRD 03.11 + Module 17 — Policy Engine)
 *
 * Validates passwords against configurable rules loaded from Variables:
 *   policy.auth.passwordMinLength  (default: 8)
 *   policy.auth.passwordRequireUppercase (default: true — not a variable, hardcoded rule)
 *   policy.auth.passwordRequireLowercase (default: true)
 *   policy.auth.passwordRequireNumber (default: true)
 *   policy.auth.passwordRequireSpecial (default: true)
 *
 * For now these are enforced with sensible defaults. In the future they can
 * be loaded from the Variables/Policies system.
 */

import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";

export type PasswordValidation = {
  valid: boolean;
  errors: string[];
  strength: "weak" | "fair" | "good" | "strong";
};

// Default rules (can be overridden by policy.auth.* variables in the future)
const DEFAULTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
};

/** Validate a password against the configured policy. */
export function validatePassword(password: string): PasswordValidation {
  const errors: string[] = [];

  if (password.length < DEFAULTS.minLength) {
    errors.push(`Password must be at least ${DEFAULTS.minLength} characters long`);
  }
  if (DEFAULTS.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (DEFAULTS.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (DEFAULTS.requireNumber && !/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (DEFAULTS.requireSpecial && !/[^A-Za-z0-9]/.test(password)) {
    errors.push("Password must contain at least one special character");
  }

  // Calculate strength
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const strength = score >= 5 ? "strong" : score >= 4 ? "good" : score >= 3 ? "fair" : "weak";

  return { valid: errors.length === 0, errors, strength };
}

/** Re-export hash/verify from auth lib for convenience */
export { hashPassword, verifyPassword };
