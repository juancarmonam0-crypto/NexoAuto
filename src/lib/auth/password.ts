import bcrypt from "bcryptjs";

/**
 * Password hashing. bcrypt with cost 12.
 *
 * The database stores only the hash. No plaintext password is ever logged,
 * returned in a payload, or written to the audit log.
 */
const BCRYPT_COST = 12;

/** Minimum acceptable password policy, enforced server-side. */
export const PASSWORD_MIN_LENGTH = 10;

export function validatePasswordStrength(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > 200) {
    return "Password must be 200 characters or fewer.";
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) {
    return "Password must include at least three of: lowercase, uppercase, digit, symbol.";
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/** Constant-time comparison via bcryptjs. Returns false rather than throwing. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}
