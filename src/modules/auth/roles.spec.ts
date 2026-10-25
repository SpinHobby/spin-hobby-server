import { afterEach, describe, expect, it } from 'vitest';
import { bootstrapRole, envRoleFor } from './auth.service.js';
import { atLeast, higherRole, rankOf, rolesFrom } from './roles.js';

const SAVED = { ...process.env };
afterEach(() => {
  process.env = { ...SAVED };
});

describe('roles', () => {
  it('orders roles lowest to highest; each includes the ones below', () => {
    expect(rolesFrom('staff')).toEqual(['staff', 'owner']);
    expect(atLeast('owner', 'staff')).toBe(true);
    expect(atLeast('staff', 'owner')).toBe(false);
    expect(atLeast('customer', 'customer')).toBe(true);
    expect(higherRole('staff', 'owner')).toBe('owner');
  });

  it("treats a role this code doesn't know as below everything", () => {
    expect(rankOf('manager')).toBe(-1);
    expect(atLeast('manager', 'customer')).toBe(false);
    expect(atLeast(undefined, 'customer')).toBe(false);
  });

  it('raises env-listed emails to their role but never lowers one', () => {
    process.env.OWNER_EMAILS = 'Boss@Shop.com';
    process.env.STAFF_EMAILS = 'help@shop.com, boss@shop.com';
    expect(envRoleFor('boss@shop.com')).toBe('owner');
    expect(bootstrapRole('help@shop.com', 'customer')).toBe('staff');
    expect(bootstrapRole('help@shop.com', 'owner')).toBe('owner');
    expect(bootstrapRole('nobody@shop.com', 'staff')).toBe('staff');
  });
});
