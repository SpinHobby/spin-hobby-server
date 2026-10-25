/**
 * Every account role, lowest to highest. A role can do everything the roles below it can (`@Access('staff')` lets staff and every
 * role above in). Guards, sign-in promotion and the admin's Accounts screen all read this list, so a new role is two steps:
 *
 *   1. a migration: `alter type public.app_role add value 'manager' before 'owner';`
 *   2. a line here, in its place in the order.
 *
 * A role the database has but this list doesn't (step 2 forgotten) counts as below every role here, so it can't reach anything.
 */
export const ROLES = [
  {
    key: 'customer',
    label: 'Customer',
    description: 'Shops, checks out, keeps a wishlist and sees their own orders.',
  },
  {
    key: 'staff',
    label: 'Staff',
    description:
      'Runs the admin: products, photos, orders and the homepage. Can read the settings but not change them.',
  },
  {
    key: 'owner',
    label: 'Owner',
    description: 'Everything, including settings, payments, tax rates and accounts.',
  },
] as const;

export type AppRole = (typeof ROLES)[number]['key'];

export const isRole = (value: unknown): value is AppRole => ROLES.some((r) => r.key === value);

/** The role's place in the order (customer 0, staff 1, ...); -1 for a role this code doesn't know. */
export const rankOf = (role: string | null | undefined) => ROLES.findIndex((r) => r.key === role);

/** Whether `role` is `min` or above. */
export const atLeast = (role: string | null | undefined, min: AppRole) =>
  rankOf(role) >= 0 && rankOf(role) >= rankOf(min);

/** The roles from `min` up, e.g. for `where role::text = any($1::text[])`. */
export const rolesFrom = (min: AppRole): AppRole[] =>
  ROLES.filter((r) => atLeast(r.key, min)).map((r) => r.key);

/** The higher of two roles. */
export const higherRole = (a: AppRole, b: AppRole): AppRole => (rankOf(a) >= rankOf(b) ? a : b);
