export type MailProvider = 'manual' | 'resend' | 'brevo' | 'smtp';
export type SmtpSecurity = 'starttls' | 'implicit_tls';

export interface MailConfig {
  provider: MailProvider;
  sender_name: string;
  sender_email: string;
  reply_to: string;
  has_api_key: boolean;
  has_smtp_password: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: SmtpSecurity;
  smtp_username: string;
  invoice_subject: string;
  invoice_body: string;
  quote_subject: string;
  quote_body: string;
  credit_subject: string;
  credit_body: string;
}

export interface StoredMailConfig extends Omit<MailConfig, 'has_api_key' | 'has_smtp_password'> {
  api_key_ciphertext: string | null;
  api_key_provider: MailProvider | null;
  smtp_password_ciphertext: string | null;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachment?: { filename: string; content: Uint8Array; mimeType: string };
}

export interface MailSecrets {
  /** Required to encrypt or decrypt a stored credential (≥ 32 characters). */
  MAIL_CONFIG_ENCRYPTION_KEY?: string;
  /** Optional platform secrets: they take precedence over the stored ciphertext. */
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  SMTP_PASSWORD?: string;
}

export async function readMailConfig(database: D1Database): Promise<StoredMailConfig> {
  const row = await database.prepare(`SELECT * FROM email_settings WHERE id = 'workspace'`).first<Record<string, unknown>>();
  if (!row) return { ...DEFAULT_MAIL_CONFIG };
  return {
    provider: row.provider as MailProvider,
    sender_name: String(row.sender_name ?? ''),
    sender_email: String(row.sender_email ?? ''),
    reply_to: String(row.reply_to ?? ''),
    api_key_ciphertext: (row.api_key_ciphertext as string | null) ?? null,
    api_key_provider: (row.api_key_provider as MailProvider | null) ?? null,
    smtp_password_ciphertext: (row.smtp_password_ciphertext as string | null) ?? null,
    smtp_host: String(row.smtp_host ?? ''),
    smtp_port: Number(row.smtp_port ?? 587),
    smtp_security: row.smtp_security === 'implicit_tls' ? 'implicit_tls' : 'starttls',
    smtp_username: String(row.smtp_username ?? ''),
    invoice_subject: String(row.invoice_subject ?? DEFAULT_MAIL_CONFIG.invoice_subject),
    invoice_body: String(row.invoice_body ?? DEFAULT_MAIL_CONFIG.invoice_body),
    quote_subject: String(row.quote_subject ?? DEFAULT_MAIL_CONFIG.quote_subject),
    quote_body: String(row.quote_body ?? DEFAULT_MAIL_CONFIG.quote_body),
    credit_subject: String(row.credit_subject ?? DEFAULT_MAIL_CONFIG.credit_subject),
    credit_body: String(row.credit_body ?? DEFAULT_MAIL_CONFIG.credit_body),
  };
}

export async function ensureMailConfig(database: D1Database): Promise<void> {
  const config = DEFAULT_MAIL_CONFIG;
  await database.prepare(
    `INSERT OR IGNORE INTO email_settings (
      id, provider, sender_name, sender_email, reply_to,
      smtp_host, smtp_port, smtp_security, smtp_username,
      invoice_subject, invoice_body, quote_subject, quote_body, credit_subject, credit_body, updated_at
    ) VALUES ('workspace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    config.provider, config.sender_name, config.sender_email, config.reply_to,
    config.smtp_host, config.smtp_port, config.smtp_security, config.smtp_username,
    config.invoice_subject, config.invoice_body, config.quote_subject, config.quote_body,
    config.credit_subject, config.credit_body, new Date().toISOString(),
  ).run();
}

export function publicMailConfig(config: StoredMailConfig): MailConfig {
  const { api_key_ciphertext, api_key_provider, smtp_password_ciphertext, ...visible } = config;
  return {
    ...visible,
    has_api_key: Boolean(api_key_ciphertext && api_key_provider === config.provider),
    has_smtp_password: Boolean(smtp_password_ciphertext),
  };
}

export function validateSmtpHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  if (!value || value.length > 253 || value.includes('://') || value.includes('/') || value.includes(':')) return false;
  if (value === 'localhost' || value.endsWith('.localhost') || value.endsWith('.local') || value.endsWith('.internal')) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(value) || value.includes('[') || value.includes(']')) return false;
  return value.includes('.') && value.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export const DEFAULT_MAIL_CONFIG: StoredMailConfig = {
  provider: 'manual',
  sender_name: '',
  sender_email: '',
  reply_to: '',
  api_key_ciphertext: null,
  api_key_provider: null,
  smtp_password_ciphertext: null,
  smtp_host: '',
  smtp_port: 587,
  smtp_security: 'starttls',
  smtp_username: '',
  invoice_subject: 'Facture {{document_number}} — {{company_name}}',
  invoice_body: 'Bonjour {{client_name}},\n\nVeuillez trouver ci-joint la facture {{document_number}}.\n\nCordialement,\n{{company_name}}',
  quote_subject: 'Devis {{document_number}} — {{company_name}}',
  quote_body: 'Bonjour {{client_name}},\n\nVeuillez trouver ci-joint le devis {{document_number}}.\n\nCordialement,\n{{company_name}}',
  credit_subject: 'Avoir {{document_number}} — {{company_name}}',
  credit_body: 'Bonjour {{client_name}},\n\nVeuillez trouver ci-joint l’avoir {{document_number}}.\n\nCordialement,\n{{company_name}}',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function unbase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('MAIL_CONFIG_ENCRYPTION_KEY_INVALID');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptMailSecret(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), encoder.encode(value));
  return `v1.${base64(iv)}.${base64(new Uint8Array(ciphertext))}`;
}

export async function decryptMailSecret(value: string, secret: string): Promise<string> {
  const [version, iv, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !ciphertext) throw new Error('MAIL_CONFIG_CIPHERTEXT_INVALID');
  const cleartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64(iv) }, await encryptionKey(secret), unbase64(ciphertext));
  return decoder.decode(cleartext);
}

export function expandMailTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(client_name|document_number|company_name)\}\}/g, (_, key: string) => values[key] ?? '');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export async function dispatchMail(
  config: StoredMailConfig,
  mail: OutgoingMail,
  secrets: MailSecrets,
  request: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  if (config.provider === 'manual') throw new Error('EMAIL_NOT_CONFIGURED');
  const sender = config.sender_name ? `${config.sender_name} <${config.sender_email}>` : config.sender_email;
  const html = mail.html ?? `<p>${escapeHtml(mail.text).replace(/\n/g, '<br>')}</p>`;
  const attachments = mail.attachment ? [{
    name: mail.attachment.filename,
    content: base64(mail.attachment.content),
  }] : undefined;

  if (config.provider === 'resend' || config.provider === 'brevo') {
    const isResend = config.provider === 'resend';
    if (!config.api_key_ciphertext || config.api_key_provider !== config.provider) throw new Error('EMAIL_NOT_CONFIGURED');
    if (!secrets.MAIL_CONFIG_ENCRYPTION_KEY) throw new Error('MAIL_ENCRYPTION_KEY_MISSING');
    const providerKey = config.provider === 'resend' ? secrets.RESEND_API_KEY : secrets.BREVO_API_KEY;
    const apiKey = providerKey ?? await decryptMailSecret(config.api_key_ciphertext, secrets.MAIL_CONFIG_ENCRYPTION_KEY);
    const response = await request(isResend ? 'https://api.resend.com/emails' : 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(isResend ? { Authorization: `Bearer ${apiKey}` } : { 'api-key': apiKey }),
      },
      body: JSON.stringify(isResend ? {
        from: sender,
        to: [mail.to],
        reply_to: config.reply_to || undefined,
        subject: mail.subject,
        text: mail.text,
        html,
        attachments: mail.attachment ? [{ filename: mail.attachment.filename, content: base64(mail.attachment.content) }] : undefined,
      } : {
        sender: { name: config.sender_name || undefined, email: config.sender_email },
        to: [{ email: mail.to }],
        replyTo: config.reply_to ? { email: config.reply_to } : undefined,
        subject: mail.subject,
        textContent: mail.text,
        htmlContent: html,
        attachment: attachments,
      }),
    });
    if (!response.ok) throw new Error(`EMAIL_PROVIDER_${response.status}`);
    const body = await response.json().catch(() => ({})) as { id?: string; messageId?: string };
    return { messageId: body.id ?? body.messageId ?? null };
  }

  if (!config.smtp_host || !config.smtp_port || !config.smtp_username || !config.smtp_password_ciphertext) {
    throw new Error('EMAIL_NOT_CONFIGURED');
  }
  if (!secrets.MAIL_CONFIG_ENCRYPTION_KEY) throw new Error('MAIL_ENCRYPTION_KEY_MISSING');
  const smtpPassword = secrets.SMTP_PASSWORD;
  const password = smtpPassword ?? await decryptMailSecret(config.smtp_password_ciphertext, secrets.MAIL_CONFIG_ENCRYPTION_KEY);
  const port = config.smtp_port;
  if (port !== 465 && port !== 587) throw new Error('EMAIL_SMTP_PORT_BLOCKED');
  const { WorkerMailer } = await import('worker-mailer');
  await WorkerMailer.send({
    host: config.smtp_host,
    port,
    secure: config.smtp_security === 'implicit_tls',
    startTls: config.smtp_security === 'starttls',
    credentials: { username: config.smtp_username, password },
    authType: ['plain', 'login', 'cram-md5'],
    logLevel: 4,
  }, {
    from: { name: config.sender_name || undefined, email: config.sender_email },
    to: mail.to,
    reply: config.reply_to || undefined,
    subject: mail.subject,
    text: mail.text,
    html,
    attachments: mail.attachment ? [{
      filename: mail.attachment.filename,
      content: base64(mail.attachment.content),
      mimeType: mail.attachment.mimeType,
    }] : undefined,
  });
  return { messageId: null };
}
