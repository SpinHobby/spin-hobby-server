import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AppError } from '../../common/errors.js';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { escapeHtml as escape } from '../../common/html.js';
import { email as emailValue } from '../../common/validation/rules.js';
import { storefrontUrl } from '../../config/app.config.js';
import { Access, CurrentUser } from '../auth/access.js';
import type { AppUser } from '../auth/auth.service.js';
import { publicProduct } from '../catalog/product.mapper.js';
import { CartReminderService, type SavedLine } from './cart-reminder.service.js';
import { FollowService } from './follow.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stop page's button: a link with `confirm=1`, so opening the email's link alone (mail scanners do) stops nothing. */
const button = (token: string, text: string) =>
  `<p><a class="btn" href="?token=${encodeURIComponent(token)}&amp;confirm=1">${escape(text)}</a></p>`;

/** A tiny page on the API for the stop links in emails (works even when the website is down). */
function page(res: Response, title: string, body: string, status = 200) {
  const shop = storefrontUrl().replace(/\/$/, '');
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<meta name="robots" content="noindex"><title>${escape(title)} | Spin Hobby</title>` +
        `<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}.btn{display:inline-block;padding:.6rem 1.2rem;border:1px solid;border-radius:8px;text-decoration:none}</style>` +
        `</head><body><h1>${escape(title)}</h1>${body}<p><a href="${escape(shop)}">Back to Spin Hobby</a></p></body></html>`,
    );
}

/**
 * Emails a shopper asks for: "email me my cart if I don't finish" (ticked at checkout) and "email me new pre-orders from this
 * series / maker" (product page). Plus the links in those emails: open the saved cart, stop.
 */
@ApiTags('Reminders')
@Controller()
export class RemindersController {
  constructor(
    private readonly carts: CartReminderService,
    private readonly follows: FollowService,
  ) {}

  /** Saves the cart for one reminder: `{ email, lines: [{ variationId, quantity }] }`. Empty `lines` removes it (box unticked). */
  @Post('checkout/cart-reminder')
  @HttpCode(200)
  @Access('public')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  async saveCart(@Body() body: unknown) {
    const b = (body ?? {}) as { email?: unknown; lines?: unknown };
    const email = emailValue(b.email);
    if (!Array.isArray(b.lines) || b.lines.length > 50)
      throw new AppError('Send 0 to 50 cart lines.');
    const lines: SavedLine[] = b.lines.map((l) => {
      const { variationId, quantity } = (l ?? {}) as { variationId?: unknown; quantity?: unknown };
      const q = Number(quantity);
      if (
        typeof variationId !== 'string' ||
        !variationId ||
        variationId.length > 120 ||
        !Number.isInteger(q) ||
        q < 1 ||
        q > 99
      )
        throw new AppError('Each line needs a variationId and a quantity from 1 to 99.');
      return { variationId, quantity: q };
    });
    return { success: true, ...(await this.carts.save(email, lines)) };
  }

  /** The cart behind a reminder email's link, to put back in the shopper's cart: products still for sale and their quantities. */
  @Get('checkout/cart-reminder/:token')
  @Access('public')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  async openCart(@Param('token', ParseUUIDPipe) token: string) {
    const items = await this.carts.open(token);
    return {
      success: true,
      items: items.map((i) => ({ product: publicProduct(i.product), quantity: i.quantity })),
    };
  }

  /** A cart reminder's stop link: a page with a button first, then stopped (`&confirm=1`). */
  @Get('reminders/stop')
  @Access('public')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async stopCart(
    @Query('token') token: string | undefined,
    @Query('confirm') confirm: string | undefined,
    @Res() res: Response,
  ) {
    if (!token || !UUID.test(token))
      return page(res, 'Link not recognised', '<p>This link is incomplete.</p>', 400);
    if (confirm !== '1')
      return page(
        res,
        'Stop cart reminders?',
        `<p>We won't email you about carts you leave behind.</p>${button(token, 'Stop cart reminders')}`,
      );
    await this.carts.stop(token);
    return page(
      res,
      'Cart reminders stopped',
      "<p>Done. You won't get cart reminders from Spin Hobby.</p>",
    );
  }

  /** "Email me new pre-orders": `{ email, kind: "series" | "maker", name }`. Open to guests; signed-in customers are linked. */
  @Post('follows')
  @HttpCode(200)
  @Access('public')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async follow(@CurrentUser() user: AppUser | null, @Body() body: unknown) {
    const b = (body ?? {}) as { email?: unknown; kind?: unknown; name?: unknown };
    const email = emailValue(b.email);
    if (b.kind !== 'series' && b.kind !== 'maker')
      throw new AppError('kind must be "series" or "maker".');
    const name = typeof b.name === 'string' ? b.name.trim().slice(0, 120) : '';
    if (!name) throw new AppError('name is required.');
    return { success: true, ...(await this.follows.follow(email, b.kind, name, user?.id ?? null)) };
  }

  /** A pre-order news email's stop link (one per follow): a page with a button first, then stopped (`&confirm=1`). */
  @Get('follows/stop')
  @Access('public')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  async stopFollow(
    @Query('token') token: string | undefined,
    @Query('confirm') confirm: string | undefined,
    @Res() res: Response,
  ) {
    if (!token || !UUID.test(token))
      return page(res, 'Link not recognised', '<p>This link is incomplete.</p>', 400);
    if (confirm !== '1')
      return page(res, 'Stop this pre-order news?', button(token, 'Stop these emails'));
    const stopped = await this.follows.stop(token);
    return page(
      res,
      'Stopped',
      stopped
        ? `<p>Done. No more pre-order news about ${escape(stopped.name)}.</p>`
        : '<p>These emails were already stopped.</p>',
    );
  }
}
