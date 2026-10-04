/** The fields of a DTO that were actually sent (not `undefined`), ready to become a SQL `set` list. */
export function sentFields(dto: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined));
}
