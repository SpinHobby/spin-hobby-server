import { Controller, Get, Param, Query } from '@nestjs/common';
import { notFound } from '../../common/errors.js';
import { CatalogService } from './catalog.service.js';
import { RecommendationsService } from './recommendations.service.js';
import { ProductQuery } from './dto/product-query.dto.js';
import { publicProduct } from './product.mapper.js';
import { squareApplicationId, squareLocationId } from '../../config/square.config.js';

@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly recommendations: RecommendationsService,
  ) {}

  @Get('products')
  products(@Query() query: ProductQuery) {
    return this.catalog.productPage(query);
  }

  @Get('products/facets')
  facets() {
    return this.catalog.facets();
  }

  /** All visible products with their descriptions and JAN codes, for the website's sitemap, product pages and Google Shopping feed. */
  @Get('products/feed')
  async feed() {
    const rows = await this.catalog.feed();
    return {
      success: true,
      items: rows.map((row) => ({
        ...publicProduct(row),
        description: row.description ?? null,
        janCode: row.jan_code ?? null,
        manufacturer: row.manufacturer ?? null,
        categoryPath: row.category_path ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  }

  /** "Frequently bought together": items in the same paid orders as this one (at most 3; none until orders share items). */
  @Get('products/:id/bought-together')
  async boughtTogether(@Param('id') id: string) {
    const rows = await this.recommendations.boughtTogether(id.slice(0, 120));
    return { success: true, items: rows.map(publicProduct) };
  }

  /** Cheap add-ons for a cart: `?ids=<item id>,<item id>` (at most 50). Bought with these first, then the best sellers. */
  @Get('products/add-ons')
  async addOns(@Query('ids') ids = '') {
    const itemIds = ids
      .split(',')
      .map((id) => id.trim().slice(0, 120))
      .filter(Boolean)
      .slice(0, 50);
    const rows = await this.recommendations.addOns(itemIds);
    return { success: true, items: rows.map(publicProduct) };
  }

  @Get('products/preorders')
  preorders(@Query() query: ProductQuery) {
    return this.catalog.productPage({ ...query, status: 'pre', sort: 'release' });
  }

  @Get('products/ranking')
  async ranking(@Query() query: ProductQuery) {
    const page = await this.catalog.productPage({ ...query, sort: 'pop' });
    return { ...page, items: page.items.filter((item) => item.rank !== null) };
  }

  @Get('products/new-in-stock')
  newInStock(@Query() query: ProductQuery) {
    return this.catalog.productPage({ ...query, status: 'in,low', sort: 'new' });
  }

  @Get('categories')
  async categories() {
    return { success: true, categories: await this.catalog.categories() };
  }

  @Get('homepage')
  homepage() {
    return this.catalog.homepage();
  }

  // ---- Compatibility routes kept from the earlier Square-backed API ----

  @Get('square/config')
  squareConfig() {
    return {
      success: true,
      applicationId: squareApplicationId() ?? null,
      locationId: squareLocationId() ?? null,
    };
  }

  @Get('square/display-categories')
  async displayCategories() {
    const facets = await this.catalog.facets();
    return {
      success: true,
      categories: facets.categories.map((c) => ({ name: c.name, categoryIds: [c.name] })),
    };
  }

  @Get('square/inventory')
  async inventory(@Query('ids') ids = '') {
    return {
      success: true,
      quantities: await this.catalog.inventory(ids.split(',').filter(Boolean)),
    };
  }

  @Get('square/catalog')
  squareCatalog(@Query() query: ProductQuery) {
    return this.catalog.productPage(query);
  }

  @Get('square/catalog/:id')
  async squareItem(@Param('id') id: string) {
    const row = await this.catalog.product(id);
    if (!row) throw notFound('Catalog item');
    // The product page also gets the description, JAN code and maker (left out of list responses to keep them small).
    return {
      success: true,
      item: {
        ...publicProduct(row),
        description: row.description ?? null,
        janCode: row.jan_code ?? null,
        manufacturer: row.manufacturer ?? null,
      },
    };
  }
}
