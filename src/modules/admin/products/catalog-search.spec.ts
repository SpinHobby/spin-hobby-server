import { describe, expect, it } from 'vitest';
import type { Db } from '../../../database/db.service.js';
import { CatalogSearchService, MAX_PAGE } from './catalog-search.service.js';

/** A database that records the page query's LIMIT and returns nothing. */
function fakeDb() {
  const limits: number[] = [];
  const db = {
    many: async (sql: string) => {
      const m = / limit (\d+) offset /.exec(sql);
      if (m) limits.push(Number(m[1]));
      return [];
    },
    one: async () => ({ total: 0 }),
  } as unknown as Db;
  return { db, limits };
}

describe('CatalogSearchService page size', () => {
  it.each([
    [undefined, 50],
    ['500', 500],
    ['100000', MAX_PAGE],
    ['0', 50],
  ])('limit=%s gives a page of %i', async (limit, expected) => {
    const { db, limits } = fakeDb();
    await new CatalogSearchService(db).search({ limit });
    expect(limits).toEqual([expected]);
  });
});
