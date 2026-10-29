import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { dispatchMail, expandMailTemplate, readMailConfig, type MailProvider, type MailSecrets } from './email';
import type { CompanyRow } from '../types';

export type EmailedDocumentKind = 'invoice' | 'quote' | 'credit';

export async function sendDocumentEmail(input: {
  db: D1Database;
  secrets: MailSecrets;
  company: CompanyRow;
  userId: string;
  kind: EmailedDocumentKind;
  documentId: string;
  documentNumber: string | null;
  clientName: string;
  recipient: string | null;
  pdf: Uint8Array;
}): Promise<{ messageId: string | null }> {
  const config = await readMailConfig(input.db);
  if (config.provider === 'manual') return fail(409, 'EMAIL_NOT_CONFIGURED');
  if (!input.recipient) return fail(409, 'EMAIL_RECIPIENT_MISSING');

  const templateKey = input.kind === 'invoice' ? 'invoice' : input.kind === 'quote' ? 'quote' : 'credit';
  const values = {
    client_name: input.clientName,
    document_number: input.documentNumber ?? '',
    company_name: input.company.name,
  };
  const subject = expandMailTemplate(config[`${templateKey}_subject`], values);
  const text = expandMailTemplate(config[`${templateKey}_body`], values);
  let result: { messageId: string | null };
  try {
    result = await dispatchMail(config, {
      to: input.recipient,
      subject,
      text,
      attachment: {
        filename: `${input.documentNumber ?? templateKey}.pdf`,
        content: input.pdf,
        mimeType: 'application/pdf',
      },
    }, input.secrets);
  } catch (error) {
    if (error instanceof Error && ['EMAIL_NOT_CONFIGURED', 'MAIL_ENCRYPTION_KEY_MISSING', 'EMAIL_SMTP_PORT_BLOCKED'].includes(error.message)) {
      return fail(409, error.message);
    }
    return fail(502, 'EMAIL_DELIVERY_FAILED');
  }

  await logActivity(input.db, {
    userId: input.userId,
    action: 'sent',
    entityType: input.kind,
    entityId: input.documentId,
    summary: `activity.${input.kind}_emailed`,
    meta: { number: input.documentNumber, provider: config.provider, recipient: input.recipient, message_id: result.messageId },
  });
  return result;
}

export function isMailProvider(value: unknown): value is MailProvider {
  return value === 'manual' || value === 'resend' || value === 'brevo' || value === 'smtp';
}
