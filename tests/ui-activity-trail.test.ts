import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ActivityTrail } from '@/components/domain/ActivityTrail';

const session = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@/lib/session', () => ({
  useSession: () => ({ can: (permission: string) => session.permissions.includes(permission) }),
}));

const entry = {
  id: 'a1',
  user_id: 'u1',
  action: 'created',
  entity_type: 'invoice',
  entity_id: 'i1',
  summary: 'activity.invoice_created',
  meta: null,
  before_json: null,
  after_json: null,
  ip: null,
  hash: null,
  created_at: '2026-11-02T09:00:00.000Z',
  first_name: 'Teva',
  last_name: 'Rai',
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ isLoading: false, data: { data: [entry] }, isError: false }),
}));

const render = () => renderToStaticMarkup(
  createElement(ActivityTrail, { entityType: 'invoice', entityId: 'i1' }),
);

describe('activity trail on a detail screen', () => {
  it('shows who did what to an account allowed to read the journal', () => {
    session.permissions = ['invoices.read', 'activity.read'];
    const html = render();
    expect(html).toContain('Teva Rai');
  });

  it('renders nothing at all for sales and read-only accounts', () => {
    for (const permissions of [[], ['invoices.read'], ['reports.read']]) {
      session.permissions = permissions;
      expect(render(), permissions.join(',')).toBe('');
    }
  });
});
