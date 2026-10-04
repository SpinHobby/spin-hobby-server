import { describe, expect, it } from 'vitest';
import { bootstrapRole } from './auth.service.js';

describe('bootstrapRole', () => {
  it('promotes listed emails and never demotes', () => {
    process.env.OWNER_EMAILS = 'Boss@Shop.com';
    process.env.STAFF_EMAILS = 'help@shop.com';
    expect(bootstrapRole('boss@shop.com', 'customer')).toBe('owner');
    expect(bootstrapRole('help@shop.com', 'customer')).toBe('staff');
    expect(bootstrapRole('help@shop.com', 'owner')).toBe('owner');
    expect(bootstrapRole('fan@shop.com', 'staff')).toBe('staff');
  });
});
