import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../../common/errors.js';
import { Db, type Queryable } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import { sentFields } from '../dto/defined-fields.js';
import type { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto.js';

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
}

/** Postgres unique violation on the sibling-name index -> a friendly message. */
function duplicate(error: unknown): never {
  if ((error as { code?: string })?.code === '23505')
    throw new AppError('A category with that name already exists here.', 409);
  throw error;
}

/** The shop category tree (Figures > Scale Figures, ...) that products are filed under. */
@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  /** Every category (hidden too) with how many products sit directly in it. */
  list() {
    return this.db.many(
      `select c.id, c.parent_id as "parentId", c.name, c.sort_order as "sortOrder", c.is_visible as "isVisible",
              (select count(*)::int from public.storefront_products p where p.category_id = c.id) as "productCount"
         from public.store_categories c order by c.sort_order, c.name`,
    );
  }

  /** The parent must exist, and a category can't be moved inside itself or one of its own descendants. */
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

  /** The position after the last sibling under this parent. */
  private async nextPosition(parentId: string | null) {
    const next = await this.db.one<{ n: number }>(
      'select coalesce(max(sort_order) + 1, 0)::int as n from public.store_categories where parent_id is not distinct from $1',
      [parentId],
    );
    return next?.n ?? 0;
  }

  async create(adminId: string, dto: CreateCategoryDto) {
    await this.assertParent(dto.parentId);
    const position = await this.nextPosition(dto.parentId);
    const category = await this.db
      .one<{
        id: string;
        parentId: string | null;
        name: string;
        sortOrder: number;
        isVisible: boolean;
      }>(
        `insert into public.store_categories (parent_id, name, sort_order, is_visible) values ($1, $2, $3, $4)
         returning id, parent_id as "parentId", name, sort_order as "sortOrder", is_visible as "isVisible"`,
        [dto.parentId, dto.name, position, dto.isVisible],
      )
      .catch(duplicate);
    await this.log.write(adminId, 'category.created', category!.id, {
      name: dto.name,
      parentId: dto.parentId,
    });
    return { ...category, productCount: 0 };
  }

  async update(adminId: string, id: string, dto: UpdateCategoryDto) {
    const current = await this.db.one<CategoryRow>(
      'select * from public.store_categories where id = $1',
      [id],
    );
    if (!current) throw notFound('Category');
    const changes: Record<string, unknown> = {};
    const sent = sentFields(dto);
    if ('name' in sent) changes.name = sent.name;
    if ('isVisible' in sent) changes.is_visible = sent.isVisible;
    if ('parentId' in sent) {
      const parentId = sent.parentId as string | null;
      await this.assertParent(parentId, id);
      if (parentId !== current.parent_id) {
        changes.parent_id = parentId;
        changes.sort_order = await this.nextPosition(parentId); // moved categories go to the end of their new siblings
      }
    }
    const columns = Object.keys(changes);
    if (columns.length) {
      await this.db
        .exec(
          `update public.store_categories set ${columns.map((c, i) => `${c} = $${i + 2}`).join(', ')} where id = $1`,
          [id, ...columns.map((c) => changes[c])],
        )
        .catch(duplicate);
      await this.log.write(adminId, 'category.updated', id, changes);
    }
  }

  /** Saves a new order: the first id becomes position 0, and so on. */
  async reorder(adminId: string, ids: string[]) {
    await this.db.transaction(async (tx) => {
      for (const [position, id] of ids.entries()) {
        await this.db.exec(
          'update public.store_categories set sort_order = $2 where id = $1',
          [id, position],
          tx,
        );
      }
      await this.log.write(
        adminId,
        'category.reordered',
        'store_categories',
        { count: ids.length },
        tx,
      );
    });
  }

  /** Deletes the category and all of its subcategories; their products become uncategorised. */
  async remove(adminId: string, id: string) {
    const all = await this.db.many<CategoryRow>(
      'select id, parent_id, name from public.store_categories',
    );
    const target = all.find((c) => c.id === id);
    if (!target) throw notFound('Category');
    const subtree = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const c of all) {
        if (c.parent_id && subtree.has(c.parent_id) && !subtree.has(c.id)) {
          subtree.add(c.id);
          grew = true;
        }
      }
    }
    const affected = await this.db.one<{ n: number }>(
      'select count(*)::int as n from public.product_metadata where category_id = any($1::uuid[])',
      [[...subtree]],
    );
    await this.db.exec('delete from public.store_categories where id = $1', [id]); // cascades to subcategories; products set null
    await this.log.write(adminId, 'category.deleted', id, {
      name: target.name,
      subcategories: subtree.size - 1,
      products: affected?.n ?? 0,
    });
    return { deletedCategories: subtree.size, uncategorisedProducts: affected?.n ?? 0 };
  }
}
