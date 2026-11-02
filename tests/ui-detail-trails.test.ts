import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS, type Role } from '@shared/domain';
import { ActivityTrail } from '@/components/domain/ActivityTrail';
import { RecordDetailBody, type RecordDetail } from '@/components/ui/RecordDrawer';

const state = vi.hoisted(() => ({
  permissions: [] as string[],
  calls: [] as { enabled?: boolean; queryKey?: unknown[] }[],
}));

vi.mock('@/lib/session', () => ({
  useSession: () => ({ can: (permission: string) => state.permissions.includes(permission) }),
}));

const entry = {
  id: 'a1',
  user_id: 'u1',
  action: 'updated',
  entity_type: 'product',
  entity_id: 'e1',
  summary: 'activity.product_updated',
  meta: JSON.stringify({ name: 'Perle de culture' }),
  before_json: null,
  after_json: null,
  ip: null,
  hash: null,
  created_at: '2026-11-02T09:00:00.000Z',
  first_name: 'Teva',
  last_name: 'Rai',
};

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { enabled?: boolean; queryKey?: unknown[] }) => {
    state.calls.push(options);
    return { isLoading: false, data: { data: [entry] }, isError: false };
  },
}));

/** Every module whose detail surface now carries a trail. */
const ENTITIES = [
  'invoice',
  'quote',
  'client',
  'product',
  'stock_count',
  'expense',
  'vendor',
  'purchase_order',
  'project',
  'task',
  'recurring',
  'user',
  'payment',
  'bank_transaction',
  'credit',
];

const AUTHORITY: Role[] = ['owner', 'admin', 'accountant'];
const DENIED: Role[] = ['sales', 'viewer'];

function renderTrail(entityType: string): string {
  return renderToStaticMarkup(createElement(ActivityTrail, { entityType, entityId: 'e1' }));
}

describe('record trail on every instrumented module', () => {
  it.each(ENTITIES)('shows the author and the action on %s for authority roles', (entityType) => {
    for (const role of AUTHORITY) {
      state.permissions = ROLE_PERMISSIONS[role];
      const html = renderTrail(entityType);
      expect(html, `${role} → ${entityType}`).toContain('Teva Rai');
      expect(html, `${role} → ${entityType}`).toContain('activity.product_updated');
    }
  });

  it.each(ENTITIES)('renders nothing and requests nothing on %s for sales and read-only', (entityType) => {
    for (const role of DENIED) {
      state.permissions = ROLE_PERMISSIONS[role];
      state.calls = [];
      const html = renderTrail(entityType);
      expect(html, `${role} → ${entityType}`).toBe('');
      const trailCall = state.calls.at(-1);
      expect(trailCall, `${role} → ${entityType} made no query at all`).toBeTruthy();
      expect(trailCall!.enabled, `${role} → ${entityType} must not fetch`).toBe(false);
    }
  });

  it('hides the trail when the record has no identifier', () => {
    state.permissions = ROLE_PERMISSIONS.owner;
    const html = renderToStaticMarkup(createElement(ActivityTrail, { entityType: 'product', entityId: '' }));
    expect(html).toBe('');
  });
});

describe('shared detail drawer', () => {
  const detail: RecordDetail = {
    title: 'Perle de culture',
    fields: [{ label: 'Prix', value: '32 000 F' }],
    trace: { entityType: 'product', entityId: 'e1' },
  };

  it('includes the trail for authority roles', () => {
    for (const role of AUTHORITY) {
      state.permissions = ROLE_PERMISSIONS[role];
      const html = renderToStaticMarkup(createElement(RecordDetailBody, { detail }));
      expect(html, role).toContain('Teva Rai');
    }
  });

  it('omits both the section and the fetch for sales and read-only', () => {
    for (const role of DENIED) {
      state.permissions = ROLE_PERMISSIONS[role];
      state.calls = [];
      const html = renderToStaticMarkup(createElement(RecordDetailBody, { detail }));
      expect(html, role).toContain('32 000 F');
      expect(html, role).not.toContain('Teva Rai');
      expect(state.calls.at(-1)?.enabled, role).toBe(false);
    }
  });
});
