import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_MAIL_CONFIG,
  decryptMailSecret,
  dispatchMail,
  encryptMailSecret,
  expandMailTemplate,
  publicMailConfig,
  validateSmtpHost,
  type StoredMailConfig,
} from '../server/services/email';
import { isMailProvider } from '../server/services/email-documents';

const SECRET = 'a-sufficiently-long-test-secret-for-aes-gcm';

function stored(overrides: Partial<StoredMailConfig> = {}): StoredMailConfig {
  return { ...DEFAULT_MAIL_CONFIG, ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** Each provider answers with its own field: Resend sends `id`, Brevo `messageId`. */
function capture(body: Record<string, string>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return jsonResponse(body);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

// The provider adapters are the only place a third-party payload is built; a wrong
// field name there is silent in production, so every field is asserted by name.

describe('mail templates (R-A: no user-facing text hard-coded in the service)', () => {
  const values = { client_name: 'Teva SARL', document_number: 'FAC-2026-0001', company_name: 'ManaGest' };

  it('expands every documented placeholder', () => {
    expect(expandMailTemplate('Facture {{document_number}} — {{company_name}}', values))
      .toBe('Facture FAC-2026-0001 — ManaGest');
    expect(expandMailTemplate('Bonjour {{client_name}},', values)).toBe('Bonjour Teva SARL,');
  });

  it('expands repeated placeholders, not just the first occurrence', () => {
    expect(expandMailTemplate('{{client_name}} / {{client_name}}', values)).toBe('Teva SARL / Teva SARL');
  });

  it('removes a placeholder whose value is absent instead of printing the braces', () => {
    expect(expandMailTemplate('Devis {{document_number}}', { company_name: 'ManaGest' })).toBe('Devis ');
  });

  it('leaves an unknown placeholder untouched, so a typo is visible', () => {
    expect(expandMailTemplate('{{client_nom}}', values)).toBe('{{client_nom}}');
  });

  it('ships a default template for all three document kinds', () => {
    for (const kind of ['invoice', 'quote', 'credit'] as const) {
      expect(DEFAULT_MAIL_CONFIG[`${kind}_subject`]).toContain('{{document_number}}');
      expect(DEFAULT_MAIL_CONFIG[`${kind}_body`]).toContain('{{client_name}}');
    }
  });
});

describe('SMTP host validation (a relay address must be a real hostname)', () => {
  it('accepts a normal relay hostname', () => {
    expect(validateSmtpHost('smtp.example.pf')).toBe(true);
    expect(validateSmtpHost('mail.entreprise.co.uk')).toBe(true);
    expect(validateSmtpHost('  SMTP.Example.PF  ')).toBe(true);
  });

  it('refuses empty, scheme-bearing and path-bearing values', () => {
    expect(validateSmtpHost('')).toBe(false);
    expect(validateSmtpHost('https://smtp.example.pf')).toBe(false);
    expect(validateSmtpHost('smtp.example.pf/path')).toBe(false);
  });

  it('refuses a host carrying a port, a bracketed IPv6 or a bare IPv4', () => {
    expect(validateSmtpHost('smtp.example.pf:587')).toBe(false);
    expect(validateSmtpHost('[::1]')).toBe(false);
    expect(validateSmtpHost('192.168.1.10')).toBe(false);
    expect(validateSmtpHost('127.0.0.1')).toBe(false);
  });

  it('refuses internal names, so a workspace cannot be pointed at the platform itself', () => {
    expect(validateSmtpHost('localhost')).toBe(false);
    expect(validateSmtpHost('relay.localhost')).toBe(false);
    expect(validateSmtpHost('relay.local')).toBe(false);
    expect(validateSmtpHost('relay.internal')).toBe(false);
  });

  it('refuses malformed labels', () => {
    expect(validateSmtpHost('smtp')).toBe(false);
    expect(validateSmtpHost('smtp..example.pf')).toBe(false);
    expect(validateSmtpHost('-smtp.example.pf')).toBe(false);
    expect(validateSmtpHost('smtp-.example.pf')).toBe(false);
    expect(validateSmtpHost(`${'a'.repeat(250)}.pf`)).toBe(false);
  });
});

describe('stored credentials (never returned, never stored in clear)', () => {
  it('round-trips a secret through AES-GCM', async () => {
    const ciphertext = await encryptMailSecret('re_very_secret', SECRET);
    expect(ciphertext.startsWith('v1.')).toBe(true);
    expect(ciphertext).not.toContain('re_very_secret');
    await expect(decryptMailSecret(ciphertext, SECRET)).resolves.toBe('re_very_secret');
  });

  it('produces a different ciphertext each time (random IV)', async () => {
    const first = await encryptMailSecret('same', SECRET);
    const second = await encryptMailSecret('same', SECRET);
    expect(first).not.toBe(second);
  });

  it('refuses to encrypt under a key shorter than 32 characters', async () => {
    await expect(encryptMailSecret('x', 'too-short')).rejects.toThrowError('MAIL_CONFIG_ENCRYPTION_KEY_INVALID');
  });

  it('refuses a ciphertext decrypted with another key, and a malformed one', async () => {
    const ciphertext = await encryptMailSecret('re_very_secret', SECRET);
    await expect(decryptMailSecret(ciphertext, 'another-sufficiently-long-key-value')).rejects.toThrow();
    await expect(decryptMailSecret('not-a-ciphertext', SECRET)).rejects.toThrowError('MAIL_CONFIG_CIPHERTEXT_INVALID');
    await expect(decryptMailSecret('v2.a.b', SECRET)).rejects.toThrowError('MAIL_CONFIG_CIPHERTEXT_INVALID');
  });

  it('never exposes the ciphertexts through the public shape', () => {
    const visible = publicMailConfig(stored({
      provider: 'resend',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
      smtp_password_ciphertext: 'v1.iv.smtp',
    }));
    const serialised = JSON.stringify(visible);
    expect(serialised).not.toContain('v1.iv.body');
    expect(serialised).not.toContain('v1.iv.smtp');
    expect(visible.has_api_key).toBe(true);
    expect(visible.has_smtp_password).toBe(true);
  });

  it('reports the API key as usable only for the provider it was saved for', () => {
    const forResend = stored({ provider: 'brevo', api_key_ciphertext: 'v1.a.b', api_key_provider: 'resend' });
    expect(publicMailConfig(forResend).has_api_key).toBe(false);
    expect(publicMailConfig(stored({ provider: 'brevo', api_key_ciphertext: 'v1.a.b', api_key_provider: 'brevo' })).has_api_key).toBe(true);
  });

  it('recognises exactly the four supported providers', () => {
    for (const provider of ['manual', 'resend', 'brevo', 'smtp']) expect(isMailProvider(provider)).toBe(true);
    for (const other of ['sendgrid', 'MAILGUN', '', null, 3]) expect(isMailProvider(other)).toBe(false);
  });
});

describe('provider dispatch (payload, credentials, failure)', () => {
  it('refuses to send while the provider is manual', async () => {
    await expect(dispatchMail(stored(), { to: 'a@b.pf', subject: 's', text: 't' }, {}))
      .rejects.toThrowError('EMAIL_NOT_CONFIGURED');
  });

  it('posts a Resend payload with the sender, the reply-to and the PDF attachment', async () => {
    const { calls, fetchImpl } = capture({ id: 'resend-1' });
    const result = await dispatchMail(stored({
      provider: 'resend',
      sender_name: 'ManaGest',
      sender_email: 'facture@example.pf',
      reply_to: 'contact@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
    }), {
      to: 'client@example.pf',
      subject: 'Facture FAC-2026-0001',
      text: 'Bonjour',
      attachment: { filename: 'FAC-2026-0001.pdf', content: new TextEncoder().encode('PDF'), mimeType: 'application/pdf' },
    }, { MAIL_CONFIG_ENCRYPTION_KEY: SECRET, RESEND_API_KEY: 're_env_key' }, fetchImpl);

    expect(result.messageId).toBe('resend-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_env_key');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.from).toBe('ManaGest <facture@example.pf>');
    expect(body.to).toEqual(['client@example.pf']);
    expect(body.reply_to).toBe('contact@example.pf');
    expect(body.subject).toBe('Facture FAC-2026-0001');
    expect(body.text).toBe('Bonjour');
    expect(body.html).toBe('<p>Bonjour</p>');
    expect(body.attachments).toEqual([{ filename: 'FAC-2026-0001.pdf', content: 'UERG' }]);
  });

  it('decrypts a stored Resend key when no environment key overrides it', async () => {
    const { calls, fetchImpl } = capture({ id: 'resend-1' });
    await dispatchMail(stored({
      provider: 'resend',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: await encryptMailSecret('re_stored_key', SECRET),
      api_key_provider: 'resend',
    }), { to: 'client@example.pf', subject: 's', text: 't' }, { MAIL_CONFIG_ENCRYPTION_KEY: SECRET }, fetchImpl);

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_stored_key');
  });

  it('posts a Brevo payload with its own auth header and attachment naming', async () => {
    const { calls, fetchImpl } = capture({ messageId: 'brevo-1' });
    const result = await dispatchMail(stored({
      provider: 'brevo',
      sender_name: 'ManaGest',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'brevo',
    }), {
      to: 'client@example.pf',
      subject: 'Devis DEV-2026-0002',
      text: 'Ligne 1\nLigne 2',
      attachment: { filename: 'DEV-2026-0002.pdf', content: new TextEncoder().encode('PDF'), mimeType: 'application/pdf' },
    }, { MAIL_CONFIG_ENCRYPTION_KEY: SECRET, BREVO_API_KEY: 'xkeysib-1' }, fetchImpl);

    expect(result.messageId).toBe('brevo-1');
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-1');
    expect(headers.Authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.sender).toEqual({ name: 'ManaGest', email: 'facture@example.pf' });
    expect(body.to).toEqual([{ email: 'client@example.pf' }]);
    expect(body.textContent).toBe('Ligne 1\nLigne 2');
    expect(body.htmlContent).toBe('<p>Ligne 1<br>Ligne 2</p>');
    expect(body.attachment).toEqual([{ name: 'DEV-2026-0002.pdf', content: 'UERG' }]);
  });

  it('escapes the text it renders as HTML, so a client name cannot inject markup', async () => {
    const { calls, fetchImpl } = capture({ id: 'resend-1' });
    await dispatchMail(stored({
      provider: 'resend',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
    }), { to: 'client@example.pf', subject: 's', text: '<b>Teva & Fils</b>' }, {
      MAIL_CONFIG_ENCRYPTION_KEY: SECRET,
      RESEND_API_KEY: 're_env_key',
    }, fetchImpl);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.html).toBe('<p>&lt;b&gt;Teva &amp; Fils&lt;/b&gt;</p>');
  });

  it('reports the provider status instead of claiming success', async () => {
    const failing = (async () => jsonResponse({ message: 'nope' }, 422)) as unknown as typeof fetch;
    await expect(dispatchMail(stored({
      provider: 'resend',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
    }), { to: 'client@example.pf', subject: 's', text: 't' }, {
      MAIL_CONFIG_ENCRYPTION_KEY: SECRET,
      RESEND_API_KEY: 're_env_key',
    }, failing)).rejects.toThrowError('EMAIL_PROVIDER_422');
  });

  it('refuses a provider whose key belongs to another provider', async () => {
    await expect(dispatchMail(stored({
      provider: 'brevo',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
    }), { to: 'client@example.pf', subject: 's', text: 't' }, {
      MAIL_CONFIG_ENCRYPTION_KEY: SECRET,
      BREVO_API_KEY: 'xkeysib-1',
    })).rejects.toThrowError('EMAIL_NOT_CONFIGURED');
  });

  it('refuses to send without the encryption key', async () => {
    await expect(dispatchMail(stored({
      provider: 'resend',
      sender_email: 'facture@example.pf',
      api_key_ciphertext: 'v1.iv.body',
      api_key_provider: 'resend',
    }), { to: 'client@example.pf', subject: 's', text: 't' }, { RESEND_API_KEY: 're_env_key' }))
      .rejects.toThrowError('MAIL_ENCRYPTION_KEY_MISSING');
  });

  it('refuses an incomplete SMTP configuration', async () => {
    await expect(dispatchMail(stored({ provider: 'smtp' }), { to: 'a@b.pf', subject: 's', text: 't' }, { MAIL_CONFIG_ENCRYPTION_KEY: SECRET }))
      .rejects.toThrowError('EMAIL_NOT_CONFIGURED');
  });

  it('refuses an SMTP port other than 465 or 587 before opening a connection', async () => {
    const smtp = stored({
      provider: 'smtp',
      sender_email: 'facture@example.pf',
      smtp_host: 'smtp.example.pf',
      smtp_port: 2525,
      smtp_username: 'user',
      smtp_password_ciphertext: 'v1.iv.body',
    });
    await expect(dispatchMail(smtp, { to: 'a@b.pf', subject: 's', text: 't' }, {
      MAIL_CONFIG_ENCRYPTION_KEY: SECRET,
      SMTP_PASSWORD: 'relay-password',
    })).rejects.toThrowError('EMAIL_SMTP_PORT_BLOCKED');
  });

  it('does not call the network at all when the configuration is incomplete', async () => {
    const spy = vi.fn();
    await expect(dispatchMail(stored(), { to: 'a@b.pf', subject: 's', text: 't' }, {}, spy as unknown as typeof fetch))
      .rejects.toThrowError('EMAIL_NOT_CONFIGURED');
    expect(spy).not.toHaveBeenCalled();
  });
});
