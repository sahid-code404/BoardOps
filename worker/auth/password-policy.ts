export type PasswordValidation = {
  valid: boolean;
  errors: string[];
  strength: "weak" | "fair" | "good" | "strong";
};

const DEFAULTS = {
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
} as const;

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

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const strength = score >= 5 ? "strong" : score >= 4 ? "good" : score >= 3 ? "fair" : "weak";
  return { valid: errors.length === 0, errors, strength };
}
