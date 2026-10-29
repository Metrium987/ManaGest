import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Save, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { SectionCard } from '@/components/ui/Layout';
import { useToast } from '@/components/ui/Toast';

interface MailForm {
  provider: 'manual' | 'resend' | 'brevo' | 'smtp';
  sender_name: string;
  sender_email: string;
  reply_to: string;
  has_api_key: boolean;
  has_smtp_password: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_security: 'starttls' | 'implicit_tls';
  smtp_username: string;
  invoice_subject: string;
  invoice_body: string;
  quote_subject: string;
  quote_body: string;
  credit_subject: string;
  credit_body: string;
}

const emptyForm: MailForm = {
  provider: 'manual', sender_name: '', sender_email: '', reply_to: '',
  has_api_key: false, has_smtp_password: false, smtp_host: '', smtp_port: 587,
  smtp_security: 'starttls', smtp_username: '',
  invoice_subject: '', invoice_body: '', quote_subject: '', quote_body: '', credit_subject: '', credit_body: '',
};

export function EmailSettingsPanel() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<MailForm>(emptyForm);
  const [apiKey, setApiKey] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [testRecipient, setTestRecipient] = useState('');

  const settings = useQuery({
    queryKey: ['email-settings'],
    queryFn: () => api.get<{ config: MailForm }>('/settings/email'),
  });
  useEffect(() => {
    if (settings.data) setForm(settings.data.config);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () => api.put('/settings/email', {
      ...form,
      api_key: apiKey || undefined,
      smtp_password: smtpPassword || undefined,
    }),
    onSuccess: () => {
      setApiKey('');
      setSmtpPassword('');
      toast.success(t('email.saved'));
      queryClient.invalidateQueries({ queryKey: ['email-settings'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const test = useMutation({
    mutationFn: () => api.post('/settings/email/test', { recipient: testRecipient }),
    onSuccess: () => toast.success(t('email.testSent')),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = <K extends keyof MailForm>(key: K, value: MailForm[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate(); };

  if (settings.isLoading) return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (settings.isError) return <p role="alert" className="text-sm text-danger-700">{errorMessage(settings.error)}</p>;

  return (
    <form onSubmit={submit} className="space-y-5">
      <SectionCard title={t('email.deliveryTitle')} subtitle={t('email.deliveryHint')} bodyClassName="space-y-4 p-5">
        <Field label={t('email.provider')} htmlFor="mail_provider" required>
          <Select id="mail_provider" value={form.provider} onChange={(event) => update('provider', event.target.value as MailForm['provider'])}>
            <option value="manual">{t('email.manual')}</option>
            <option value="resend">Resend</option>
            <option value="brevo">Brevo</option>
            <option value="smtp">{t('email.customSmtp')}</option>
          </Select>
        </Field>
        <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t(`email.providerHelp.${form.provider}`)}</p>
        {form.provider !== 'manual' ? (
          <>
            <FormGrid>
              <Field label={t('email.senderName')} htmlFor="mail_sender_name" required>
                <Input id="mail_sender_name" value={form.sender_name} onChange={(event) => update('sender_name', event.target.value)} required />
              </Field>
              <Field label={t('email.senderAddress')} htmlFor="mail_sender_email" required>
                <Input id="mail_sender_email" type="email" value={form.sender_email} onChange={(event) => update('sender_email', event.target.value)} required />
              </Field>
              <Field label={t('email.replyTo')} htmlFor="mail_reply_to">
                <Input id="mail_reply_to" type="email" value={form.reply_to} onChange={(event) => update('reply_to', event.target.value)} />
              </Field>
            </FormGrid>
            {form.provider === 'resend' || form.provider === 'brevo' ? (
              <Field label={t('email.apiKey')} htmlFor="mail_api_key" hint={form.has_api_key ? t('email.keyStored') : t('email.keyRequired')}>
                <Input id="mail_api_key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={form.has_api_key ? t('email.keepKey') : ''} />
              </Field>
            ) : null}
            {form.provider === 'smtp' ? (
              <>
                <FormGrid>
                  <Field label={t('email.smtpHost')} htmlFor="smtp_host" required><Input id="smtp_host" value={form.smtp_host} onChange={(event) => update('smtp_host', event.target.value)} required /></Field>
                  <Field label={t('email.smtpPort')} htmlFor="smtp_port" required><Input id="smtp_port" type="number" min="1" max="65535" value={form.smtp_port} onChange={(event) => update('smtp_port', Number(event.target.value))} required /></Field>
                  <Field label={t('email.smtpSecurity')} htmlFor="smtp_security" required>
                    <Select id="smtp_security" value={form.smtp_security} onChange={(event) => update('smtp_security', event.target.value as MailForm['smtp_security'])}>
                      <option value="starttls">STARTTLS</option>
                      <option value="implicit_tls">{t('email.implicitTls')}</option>
                    </Select>
                  </Field>
                  <Field label={t('email.smtpUsername')} htmlFor="smtp_username" required><Input id="smtp_username" autoComplete="username" value={form.smtp_username} onChange={(event) => update('smtp_username', event.target.value)} required /></Field>
                </FormGrid>
                <Field label={t('email.smtpPassword')} htmlFor="smtp_password" hint={form.has_smtp_password ? t('email.keyStored') : t('email.keyRequired')}>
                  <Input id="smtp_password" type="password" autoComplete="new-password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder={form.has_smtp_password ? t('email.keepKey') : ''} />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </SectionCard>

      <SectionCard title={t('email.templatesTitle')} subtitle={t('email.templatesHint')} bodyClassName="space-y-4 p-5">
        <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('email.placeholders')}</p>
        <FormGrid>
          <Field label={t('email.invoiceSubject')} htmlFor="invoice_subject"><Input id="invoice_subject" value={form.invoice_subject} onChange={(event) => update('invoice_subject', event.target.value)} required /></Field>
          <Field label={t('email.quoteSubject')} htmlFor="quote_subject"><Input id="quote_subject" value={form.quote_subject} onChange={(event) => update('quote_subject', event.target.value)} required /></Field>
          <Field label={t('email.creditSubject')} htmlFor="credit_subject"><Input id="credit_subject" value={form.credit_subject} onChange={(event) => update('credit_subject', event.target.value)} required /></Field>
        </FormGrid>
        <Field label={t('email.invoiceBody')} htmlFor="invoice_body"><Textarea id="invoice_body" rows={4} value={form.invoice_body} onChange={(event) => update('invoice_body', event.target.value)} required /></Field>
        <Field label={t('email.quoteBody')} htmlFor="quote_body"><Textarea id="quote_body" rows={4} value={form.quote_body} onChange={(event) => update('quote_body', event.target.value)} required /></Field>
        <Field label={t('email.creditBody')} htmlFor="credit_body"><Textarea id="credit_body" rows={4} value={form.credit_body} onChange={(event) => update('credit_body', event.target.value)} required /></Field>
      </SectionCard>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('email.testRecipient')} htmlFor="mail_test_recipient">
            <Input id="mail_test_recipient" type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} />
          </Field>
          <Button type="button" variant="secondary" loading={test.isPending} disabled={!testRecipient || form.provider === 'manual'} onClick={() => test.mutate()} icon={<Send className="h-4 w-4" aria-hidden="true" />}>
            {t('email.sendTest')}
          </Button>
        </div>
        <Button type="submit" loading={save.isPending} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
          {t('common.save')}
        </Button>
      </div>
      <p className="text-xs text-muted"><Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{t('email.noTestWithoutClick')}</p>
    </form>
  );
}
