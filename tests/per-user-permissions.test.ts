import { describe, expect, it } from 'vitest';
import { restrictToActor } from '../server/services/roles';
import { ROLE_PERMISSIONS, type Permission } from '../shared/domain';

describe('restrictToActor', () => {
  it('accepts a grant the actor already holds', () => {
    const requested: Permission[] = ['clients.read', 'invoices.write'];
    expect(restrictToActor(ROLE_PERMISSIONS.sales, requested)).toEqual(requested);
  });

  it('refuses a permission the actor does not hold', () => {
    // A sales account must not be able to hand out accounting access, even if it
    // can manage users.
    expect(restrictToActor(ROLE_PERMISSIONS.sales, ['accounting.read'])).toBeNull();
  });

  it('lets an empty grant through, the caller rejects it', () => {
    expect(restrictToActor(ROLE_PERMISSIONS.viewer, [])).toEqual([]);
  });

  it('lets an owner grant anything', () => {
    const requested: Permission[] = ['accounting.write', 'users.write', 'clients.delete'];
    expect(restrictToActor(ROLE_PERMISSIONS.owner, requested)).toEqual(requested);
  });
});
