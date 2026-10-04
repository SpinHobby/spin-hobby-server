import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { AdminLog } from './admin-log.service.js';
import { AppError, notFound } from '../../common/errors.js';
import { jsonBody, stringValue } from '../../common/validation.js';
import { Db, type Queryable } from '../../database/db.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  is_visible: boolean;
}

export function categoryId(value: unknown): string | null {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string' || !UUID.test(value)) throw new AppError('Invalid category.');
  return value;
}

function name(value: unknown) {
  const text = stringValue(value, 'name', 80).replace(/\s+/g, ' ');
  return text;
}

/** Postgres unique violation on the sibling-name index -> friendly message. */
function duplicate(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new AppError('A category with that name already exists here.', 409);
  throw error;
}

@Controller('admin/categories')
@Access('staff')
export class AdminCategoriesController {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** Every category (hidden too) with how many products sit directly in it. */
  @Get()
  async list() {
    const rows = await this.db.many(
      `select c.id, c.parent_id as "parentId", c.name, c.sort_order as "sortOrder", c.is_visible as "isVisible",
              (select count(*)::int from public.storefront_products p where p.category_id = c.id) as "productCount"
         from public.store_categories c order by c.sort_order, c.name`,
    );
    return { success: true, categories: rows };
  }

  private async assertParent(parentId: string | null, selfId?: string, tx?: Queryable) {
    if (!parentId) return;
    const all = await this.db.many<CategoryRow>(
      'select id, parent_id from public.store_categories',
      [],
      tx,
    );
    if (!all.some((c) => c.id === parentId)) throw new AppError('Parent category not found.', 404);
    if (selfId) {
      // Walk up from the new parent; reaching self would create a loop.
      for (
        let at: string | null = parentId;
        at;
        at = all.find((c) => c.id === at)?.parent_id ?? null
      ) {
        if (at === selfId) throw new AppError("A category can't be moved inside itself.");
      }
    }
  }

  @Post()
  @HttpCode(200)
  async create(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const p = jsonBody(body);
    const parentId = categoryId(p.parentId);
    const label = name(p.name);
    await this.assertParent(parentId);
    const next = await this.db.one<{ n: number }>(
      'select coalesce(max(sort_order) + 1, 0)::int as n from public.store_categories where parent_id is not distinct from $1',
      [parentId],
    );
    const category = await this.db
      .one(
        `insert into public.store_categories (parent_id, name, sort_order, is_visible) values ($1, $2, $3, $4)
       returning id, parent_id as "parentId", name, sort_order as "sortOrder", is_visible as "isVisible"`,
        [parentId, label, next?.n ?? 0, p.isVisible !== false],
      )
      .catch(duplicate);
    await this.log.write(admin.id, 'category.created', category!.id, { name: label, parentId });
    return { success: true, category: { ...category, productCount: 0 } };
  }

  @Put('reorder')
  async reorder(@CurrentUser() admin: AppUser, @Body() body: unknown) {
    const ids = jsonBody(body).ids;
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== 'string' || !UUID.test(id))
    )
      throw new AppError('ids is required.');
    await this.db.transaction(async (tx) => {
      for (const [i, id] of (ids as string[]).entries())
        await this.db.exec(
          'update public.store_categories set sort_order = $2 where id = $1',
          [id, i],
          tx,
        );
      await this.log.write(
        admin.id,
        'category.reordered',
        'store_categories',
        { count: ids.length },
        tx,
      );
    });
    return { success: true };
  }

  @Put(':id')
  async update(
    @CurrentUser() admin: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const p = jsonBody(body);
    const current = await this.db.one<CategoryRow>(
      'select * from public.store_categories where id = $1',
      [id],
    );
    if (!current) throw notFound('Category');
    const changes: Record<string, unknown> = {};
    if ('name' in p) changes.name = name(p.name);
    if ('isVisible' in p) changes.is_visible = p.isVisible === true;
    if ('parentId' in p) {
      const parentId = categoryId(p.parentId);
      await this.assertParent(parentId, id);
      if (parentId !== current.parent_id) {
        changes.parent_id = parentId;
        const next = await this.db.one<{ n: number }>(
          'select coalesce(max(sort_order) + 1, 0)::int as n from public.store_categories where parent_id is not distinct from $1',
          [parentId],
        );
        changes.sort_order = next?.n ?? 0; // moved categories go to the end of their new siblings
      }
    }
    const keys = Object.keys(changes);
    if (keys.length) {
      await this.db
        .exec(
          `update public.store_categories set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`,
          [id, ...keys.map((k) => changes[k])],
        )
        .catch(duplicate);
      await this.log.write(admin.id, 'category.updated', id, changes);
    }
    return { success: true };
  }

  /** Deletes the category and all of its subcategories; their products become uncategorised. */
  @Delete(':id')
  async remove(@CurrentUser() admin: AppUser, @Param('id', new ParseUUIDPipe()) id: string) {
    const all = await this.db.many<CategoryRow>(
      'select id, parent_id, name from public.store_categories',
    );
    const target = all.find((c) => c.id === id);
    if (!target) throw notFound('Category');
    const subtree = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of all)
        if (c.parent_id && subtree.has(c.parent_id) && !subtree.has(c.id)) {
          subtree.add(c.id);
          grew = true;
        }
    }
    const affected = await this.db.one<{ n: number }>(
      'select count(*)::int as n from public.product_metadata where category_id = any($1::uuid[])',
      [[...subtree]],
    );
    await this.db.exec('delete from public.store_categories where id = $1', [id]); // cascades to subcategories; products set null
    await this.log.write(admin.id, 'category.deleted', id, {
      name: target.name,
      subcategories: subtree.size - 1,
      products: affected?.n ?? 0,
    });
    return {
      success: true,
      deletedCategories: subtree.size,
      uncategorisedProducts: affected?.n ?? 0,
    };
  }
}
