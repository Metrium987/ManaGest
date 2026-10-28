/**
 * RFC 6238 TOTP (time-based one-time passwords) built on WebCrypto only, so it
 * runs unchanged in Workers and in the Node-based unit tests. Compatible with
 * Google Authenticator, Authy, 1Password and similar apps (SHA-1, 6 digits,
 * 30-second step, as required by the standard for broad app support).
 */
import { constantTimeEqual } from './crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** 160-bit secret, base32 encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(SECRET_BYTES);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

/** Displays a secret in blocks of four so a person can type it into an app. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}

async function counterBytes(counter: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, Math.floor(counter / 4_294_967_296));
  view.setUint32(4, counter >>> 0);
  return buffer;
}

/** The one-time code for a given 30-second step. */
export async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, await counterBytes(counter)));
  const offset = mac[19] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 1_000_000).padStart(DIGITS, '0');
}

/**
 * Accepts the previous, current and next step to tolerate clock drift between
 * the server and the phone, without opening a wider replay window.
 */
export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  const normalized = (code ?? '').replace(/\D/g, '');
  if (normalized.length !== DIGITS) return false;
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = await totpAt(secret, counter + offset);
    if (constantTimeEqual(expected, normalized)) return true;
  }
  return false;
}

/** Deep link usable by authenticator apps, plus a manual-entry fallback. */
export function otpauthUri(secret: string, accountName: string, issuer = 'ManaGest'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return (
    `otpauth://totp/${label}?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
  );
}

/**
 * Recovery codes are compared and stored without case or separator noise, so
 * a user typing the code with or without the hyphen still succeeds.
 */
export function normalizeRecoveryCode(code: string): string {
  return (code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Human-readable recovery codes: one per line, shown exactly once. */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  while (codes.length < count) {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    let raw = '';
    for (const byte of bytes) raw += alphabet[byte % alphabet.length];
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}
