import { ApiError } from './errors';

const MIN_LENGTH = 12;
const MAX_LENGTH = 128;

const COMMON = new Set([
  'password', 'password1', 'motdepasse', 'azerty123456', 'qwerty123456',
  '123456789012', 'administrateur', 'managest2024', 'managest2025', 'managest2026',
  'polynesie2024', 'tahiti2024', 'tahiti2025', 'tahiti2026', 'letmein12345',
  'changeme1234', 'welcome12345', '000000000000', '111111111111',
]);

export interface PasswordPolicyInput {
  password: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Validates a new password. Length over composition, per NIST SP 800-63B:
 * no character-class rules, no forced rotation, allow long passphrases.
 */
export function validatePassword(input: PasswordPolicyInput): void {
  const password = input.password ?? '';
  if (password.length < MIN_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', { password: 'too_small' });
  }
  if (password.length > MAX_LENGTH) {
    throw new ApiError(422, 'VALIDATION_ERROR', { password: 'too_big' });
  }
  const normalised = password.trim().toLowerCase();
  if (COMMON.has(normalised)) {
    throw new ApiError(422, 'VALIDATION_ERROR', { password: 'common_password' });
  }
  const identity = [input.email?.split('@')[0], input.firstName, input.lastName]
    .filter(Boolean)
    .map((value) => value!.toLowerCase())
    .filter((value) => value.length >= 3);
  if (identity.some((value) => normalised === value || normalised === `${value}1234`)) {
    throw new ApiError(422, 'VALIDATION_ERROR', { password: 'too_similar' });
  }
}

export const PASSWORD_MIN_LENGTH = MIN_LENGTH;
