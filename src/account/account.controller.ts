import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Access, CurrentUser } from '../auth/access.js';
import { AuthService, type AppUser } from '../auth/auth.service.js';
import { AppError, notFound } from '../common/errors.js';
import { email as validEmail, jsonBody, positiveInteger, stringValue } from '../common/validation.js';
import { env } from '../config/env.js';
import { Db } from '../db/db.service.js';
import { publicProduct } from '../catalog/product.mapper.js';

@Controller()
export class AccountController {
  constructor(private readonly db: Db, private readonly auth: AuthService) {}

  @Get('auth/me')
  @Access('user')
  me(@CurrentUser() user: AppUser) {
    return { success: true, user };
  }

  @Post('auth/logout')
  @HttpCode(200)
  @Access('user')
  async logout(@Headers('authorization') authorization: string) {
    // Local dev sign-in has no Supabase session to revoke; the browser just drops its token.
    if (env('NODE_ENV') !== 'production' && env('AUTH_DEV_LOGIN') === 'true') return { success: true };
    await this.auth.signOutEverywhere(authorization);
    return { success: true };
  }

  // ---------------------------------------------------------------- wishlist
  @Get('wishlist')
  @Access('user')
  async wishlist(@CurrentUser() user: AppUser) {
    const rows = await this.db.many(
      `select p.* from public.wishlist_items w
         join public.storefront_products p on p.id = w.square_item_id
        where w.user_id = $1 order by w.created_at desc`,
      [user.id],
    );
    return { success: true, items: rows.map(publicProduct) };
  }

  @Post('wishlist')
  @HttpCode(200)
  @Access('user')
  async addWishlist(@CurrentUser() user: AppUser, @Body() body: unknown) {
    const squareItemId = stringValue(jsonBody(body).squareItemId, 'squareItemId', 120);
    const product = await this.db.one('select id from public.storefront_products where id = $1', [squareItemId]);
    if (!product) throw new AppError('This product is not available.');
    await this.db.exec(
      'insert into public.wishlist_items (user_id, square_item_id) values ($1, $2) on conflict do nothing',
      [user.id, squareItemId],
    );
    return { success: true };
  }

  @Delete('wishlist/:itemId')
  @Access('user')
  async removeWishlist(@CurrentUser() user: AppUser, @Param('itemId') itemId: string) {
    await this.db.exec('delete from public.wishlist_items where user_id = $1 and square_item_id = $2', [user.id, itemId]);
    return { success: true };
  }

  // ---------------------------------------------------------------- restock alerts
  @Post('alerts')
  @HttpCode(200)
  async createAlert(@CurrentUser() user: AppUser | null, @Body() body: unknown) {
    const payload = jsonBody(body);
    const address = validEmail(payload.email);
    const variationId = stringValue(payload.variationId, 'variationId', 120);
    const variation = await this.db.one('select 1 from public.catalog_variations where square_variation_id = $1', [variationId]);
    if (!variation) throw new AppError('This product variation is not available.');
    await this.db.exec(
      `insert into public.stock_alerts (email, square_variation_id, user_id, notified_at)
       values ($1, $2, $3, null)
       on conflict (email, square_variation_id) do update set user_id = coalesce(excluded.user_id, stock_alerts.user_id), notified_at = null`,
      [address, variationId, user?.id ?? null],
    );
    return { success: true };
  }

  // ---------------------------------------------------------------- customer orders
  @Get('orders')
  @Access('user')
  async orders(@CurrentUser() user: AppUser) {
    const items = await this.db.many('select * from public.orders where user_id = $1 order by created_at desc', [user.id]);
    return { success: true, items };
  }

  /** Guest order lookup from the confirmation email: needs both the payment id and the billing email. */
  @Get('orders/lookup')
  async lookup(@Query('paymentId') paymentId: unknown, @Query('email') email: unknown) {
    const order = await this.db.one(
      `select o.*, coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id), '[]') as order_items
         from public.orders o where o.provider_payment_id = $1 and o.billing_email = $2`,
      [stringValue(paymentId, 'paymentId', 200), stringValue(email, 'email', 254).toLowerCase()],
    );
    if (!order) throw notFound('Order');
    return { success: true, order };
  }

  @Get('orders/:id')
  @Access('user')
  async order(@CurrentUser() user: AppUser, @Param('id') id: string) {
    const orderId = positiveInteger(id, 'orderId', Number.MAX_SAFE_INTEGER);
    const order = await this.db.one(
      `select o.*,
              coalesce((select json_agg(i order by i.id) from public.order_items i where i.order_id = o.id), '[]') as order_items,
              coalesce((select json_agg(e order by e.created_at) from public.order_events e where e.order_id = o.id), '[]') as order_events
         from public.orders o
        where o.id = $1 and ($2::boolean or o.user_id = $3)`,
      [orderId, user.role !== 'customer', user.id],
    );
    if (!order) throw notFound('Order');
    return { success: true, order };
  }
}
