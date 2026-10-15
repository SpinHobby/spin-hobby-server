import { Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors.js';
import { Db } from '../../../database/db.service.js';
import { AdminLog } from '../admin-log.service.js';
import { STANDARD_TREE, suggestCategory } from './standard-tree.js';

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
}

const key = (name: string) => name.trim().toLowerCase();

/**
 * The ready-made category tree (modelled on AmiAmi's) and sorting products into it. Adding the tree only creates the
 * categories the shop doesn't have yet; suggestions are shown to a person, and only the ones they apply change anything.
 */
@Injectable()
export class CategorySortingService {
  constructor(
    private readonly db: Db,
    private readonly log: AdminLog,
  ) {}

  private all() {
    return this.db.many<CategoryRow>(
      'select id, parent_id, name from public.store_categories order by sort_order, name',
    );
  }

  /** The ready-made tree, saying which categories the shop already has (same name in the same place). */
  async standardTree() {
    const all = await this.all();
    return STANDARD_TREE.map((top) => {
      const parent = all.find((c) => !c.parent_id && key(c.name) === key(top.name));
      return {
        name: top.name,
        exists: !!parent,
        children: top.children.map((name) => ({
          name,
          exists:
            !!parent && all.some((c) => c.parent_id === parent.id && key(c.name) === key(name)),
        })),
      };
    });
  }

  /** Creates the categories of the ready-made tree that are missing, after the shop's own. Returns their names. */
  async addStandardTree(adminId: string) {
    const created: string[] = [];
    await this.db.transaction(async (tx) => {
      const all = await this.db.many<CategoryRow>(
        'select id, parent_id, name from public.store_categories',
        [],
        tx,
      );
      const position = async (parentId: string | null) =>
        (
          await this.db.one<{ n: number }>(
            'select coalesce(max(sort_order) + 1, 0)::int as n from public.store_categories where parent_id is not distinct from $1',
            [parentId],
            tx,
          )
        )?.n ?? 0;
      const insert = async (name: string, parentId: string | null) =>
        (await this.db.one<{ id: string }>(
          'insert into public.store_categories (parent_id, name, sort_order) values ($1, $2, $3) returning id',
          [parentId, name, await position(parentId)],
          tx,
        ))!.id;

      for (const top of STANDARD_TREE) {
        let parentId = all.find((c) => !c.parent_id && key(c.name) === key(top.name))?.id;
        if (!parentId) {
          parentId = await insert(top.name, null);
          created.push(top.name);
        }
        for (const name of top.children) {
          if (all.some((c) => c.parent_id === parentId && key(c.name) === key(name))) continue;
          await insert(name, parentId);
          created.push(`${top.name} › ${name}`);
        }
      }
      if (created.length)
        await this.log.write(
          adminId,
          'category.standard_tree',
          'store_categories',
          { created },
          tx,
        );
    });
    return created;
  }

  /**
   * A suggested category for each product without one (or every product when `all`), from its name and Square
   * category. Suggestions point at a category the shop has with that name, preferring the one in the ready-made tree.
   */
  async suggestions(all: boolean) {
    const categories = await this.all();
    const idFor = (name: string) => {
      const matches = categories.filter((c) => key(c.name) === key(name));
      const parentName = STANDARD_TREE.find((t) => t.children.includes(name))?.name;
      const standard = matches.find((c) => {
        const parent = categories.find((p) => p.id === c.parent_id);
        return parent && parentName && key(parent.name) === key(parentName);
      });
      return (standard ?? matches[0])?.id ?? null;
    };
    const products = await this.db.many<{
      id: string;
      name: string;
      square_category: string | null;
      category_id: string | null;
      image: string | null;
    }>(
      `select p.square_item_id as id, p.name, p.category as square_category, m.category_id,
              (select pi.image_url from public.product_images pi where pi.square_item_id = p.square_item_id order by pi.sort_order limit 1) as image
         from public.catalog_products p
         left join public.product_metadata m on m.square_item_id = p.square_item_id
        where p.is_active and p.replaced_by is null and ($1::boolean or m.category_id is null)
        order by lower(p.name)
        limit 3000`,
      [all],
    );
    const items = products.map((p) => {
      const s = suggestCategory(p.name, p.square_category);
      const suggestedId = s?.category ? idFor(s.category) : null;
      return {
        id: p.id,
        name: p.name,
        image: p.image,
        squareCategory: p.square_category,
        currentCategoryId: p.category_id,
        suggestedCategoryId: suggestedId,
        choices: (s?.choices ?? []).map(idFor).filter((id): id is string => !!id),
        reason: s?.reason ?? null,
      };
    });
    return { items, total: items.length };
  }

  /** Puts products in categories: one category per product, as a person chose them. */
  async assign(adminId: string, assignments: { id: string; categoryId: string }[]) {
    const ids = [...new Set(assignments.map((a) => a.categoryId))];
    const found = await this.db.many<{ id: string }>(
      'select id from public.store_categories where id = any($1::uuid[])',
      [ids],
    );
    if (found.length !== ids.length)
      throw new AppError('One of the categories no longer exists.', 404);
    return this.db.transaction(async (tx) => {
      let updated = 0;
      for (const a of assignments) {
        const row = await this.db.one<{ square_item_id: string }>(
          `insert into public.product_metadata (square_item_id, category_id)
           select square_item_id, $2::uuid from public.catalog_products where square_item_id = $1
           on conflict (square_item_id) do update set category_id = excluded.category_id returning square_item_id`,
          [a.id, a.categoryId],
          tx,
        );
        if (row) updated += 1;
      }
      await this.log.write(
        adminId,
        'product.categories_assigned',
        'store_categories',
        { count: updated },
        tx,
      );
      return updated;
    });
  }
}
