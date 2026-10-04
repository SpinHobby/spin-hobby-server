import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapRole, firstNameFrom } from './auth.service.js';

const SAVED = { ...process.env };
beforeEach(() => {
  process.env.OWNER_EMAILS = 'Boss@Shop.com, second@shop.com';
  process.env.STAFF_EMAILS = 'help@shop.com';
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe('bootstrapRole (OWNER_EMAILS / STAFF_EMAILS)', () => {
  it('promotes listed emails, ignoring case and spaces in the list', () => {
    expect(bootstrapRole('boss@shop.com', 'customer')).toBe('owner');
    expect(bootstrapRole('BOSS@SHOP.COM', 'customer')).toBe('owner');
    expect(bootstrapRole('second@shop.com', 'customer')).toBe('owner');
    expect(bootstrapRole('help@shop.com', 'customer')).toBe('staff');
  });

  it('never demotes a role that was set by hand', () => {
    expect(bootstrapRole('help@shop.com', 'owner')).toBe('owner');
    expect(bootstrapRole('fan@shop.com', 'staff')).toBe('staff');
    expect(bootstrapRole('fan@shop.com', 'owner')).toBe('owner');
  });

  it('lets an owner-listed email become owner even when it is also listed as staff', () => {
    process.env.STAFF_EMAILS = 'boss@shop.com';
    expect(bootstrapRole('boss@shop.com', 'staff')).toBe('owner');
  });

  it('leaves everyone else alone, and does nothing when the lists are empty', () => {
    expect(bootstrapRole('fan@shop.com', 'customer')).toBe('customer');
    delete process.env.OWNER_EMAILS;
    delete process.env.STAFF_EMAILS;
    expect(bootstrapRole('boss@shop.com', 'customer')).toBe('customer');
  });
});

describe('firstNameFrom (the name shown in greetings)', () => {
  const token = (user_metadata?: unknown) => ({ user_metadata }) as never;

  it('prefers the name typed at sign-up, then Google/Discord names', () => {
    expect(firstNameFrom(token({ first_name: 'Aki', given_name: 'Akira' }))).toBe('Aki');
    expect(firstNameFrom(token({ given_name: 'Akira' }))).toBe('Akira');
    expect(firstNameFrom(token({ full_name: 'Aki Tanaka' }))).toBe('Aki');
    expect(firstNameFrom(token({ name: 'Mika Sato' }))).toBe('Mika');
  });

  it('skips blank values and trims', () => {
    expect(firstNameFrom(token({ first_name: '   ', given_name: '  Aki ' }))).toBe('Aki');
  });

  it('is null when the token carries no usable name', () => {
    expect(firstNameFrom(token())).toBeNull();
    expect(firstNameFrom(token({ first_name: 42 }))).toBeNull();
  });

  it('caps very long names at 80 characters', () => {
    expect(firstNameFrom(token({ first_name: 'a'.repeat(200) }))).toHaveLength(80);
  });
});
