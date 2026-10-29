import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError, notFound } from '../../common/errors.js';
import { shopAssistantEnabled } from '../../config/app.config.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { awayAnswer, matchProducts, priceText } from './match.js';

/**
 * The talking shop assistant on the storefront. A visitor's question waits here, in memory, for the shop's Gleamshelf app (on the shop's own
 * computer, which runs the models for free) to take it and answer, with the assistant's voice. When no Gleamshelf app is answering, or it
 * does not answer in time, the shop answers with text itself: the products that match, and that the talking assistant is away.
 *
 * Questions are short-lived and nothing is stored: a restart forgets the queue, and the app sends its profile again when it next connects.
 * There is one queue per server, so this needs the single server Spin Hobby runs.
 */

export interface Turn {
  question: string;
  answer: string;
}

export interface AssistantReply {
  answer: string;
  products: { id: string; name: string; price: string; status: string }[];
  /** Where the answer in the assistant's voice can be played from, or null for text only. */
  audio: string | null;
  /** Who answered: the assistant (the Gleamshelf app), or the shop's own text answer while the assistant is away. */
  by: 'assistant' | 'shop';
}

interface Waiting {
  id: string;
  question: string;
  history: Turn[];
  done: (
    reply: { answer: string; products: AssistantReply['products']; audio: Buffer | null } | null,
  ) => void;
}

interface Profile {
  on: boolean;
  name: string;
  voice: boolean;
  portrait: Buffer | null;
  at: number;
}

/** How long a visitor waits for the assistant before the shop answers with text. */
const ANSWER_MS = 20_000;
/** An app that has not asked for a question for this long is taken to be gone. */
const ONLINE_MS = 40_000;
/** How long an answer's voice can be played. */
const AUDIO_MS = 10 * 60_000;
const MAX_QUEUE = 20;

@Injectable()
export class AssistantService {
  private readonly queue: Waiting[] = [];
  private readonly claimers: ((w: Waiting | null) => void)[] = [];
  private readonly seen = new Map<string, number>();
  private readonly profiles = new Map<string, Profile>();
  private readonly audio = new Map<string, { bytes: Buffer; at: number }>();

  constructor(private readonly catalog: CatalogService) {}

  /** The newest profile of an app that is on and has asked for questions lately: the assistant visitors meet. */
  private answering(): Profile | null {
    const now = Date.now();
    let best: Profile | null = null;
    for (const [token, p] of this.profiles)
      if (p.on && now - (this.seen.get(token) ?? 0) < ONLINE_MS && (!best || p.at > best.at))
        best = p;
    return best;
  }

  /** What the storefront shows: whether the assistant is on the site at all, whether it is answering now, its name and whether it talks. */
  status() {
    const p = this.answering();
    const last = [...this.profiles.values()].sort((a, b) => b.at - a.at)[0] ?? null;
    return {
      enabled: shopAssistantEnabled(),
      online: !!p,
      name: (p ?? last)?.name ?? 'Shop assistant',
      voice: !!p?.voice,
      portrait: !!(p ?? last)?.portrait,
    };
  }

  portrait(): Buffer {
    const p = this.answering() ?? [...this.profiles.values()].sort((a, b) => b.at - a.at)[0];
    if (!p?.portrait) throw notFound('Portrait');
    return p.portrait;
  }

  /** A visitor's question: answered by the assistant when it is answering, else (or if it is too slow) by the shop's text answer. */
  async ask(question: string, history: Turn[]): Promise<AssistantReply> {
    if (!shopAssistantEnabled()) throw new AppError('The shop assistant is not on.', 404);
    if (this.answering() && this.queue.length < MAX_QUEUE) {
      const reply = await new Promise<Parameters<Waiting['done']>[0]>((done) => {
        const w: Waiting = { id: randomUUID(), question, history, done };
        const timer = setTimeout(() => {
          const i = this.queue.indexOf(w);
          if (i >= 0) this.queue.splice(i, 1);
          w.done = () => {};
          done(null);
        }, ANSWER_MS);
        const finish = w.done;
        w.done = (r) => {
          clearTimeout(timer);
          finish(r);
        };
        this.offer(w);
      });
      if (reply) {
        let audio: string | null = null;
        if (reply.audio) {
          const id = randomUUID();
          this.audio.set(id, { bytes: reply.audio, at: Date.now() });
          audio = `/assistant/audio/${id}`;
        }
        this.prune();
        return { answer: reply.answer, products: reply.products, audio, by: 'assistant' };
      }
    }
    return this.awayReply(question);
  }

  private async awayReply(question: string): Promise<AssistantReply> {
    const rows = await this.catalog.feed();
    const products = rows
      .filter((r) => r.status !== 'closed')
      .map((r) => ({
        id: r.id,
        name: r.name,
        series: r.series,
        character: r.character,
        category: r.category,
        categoryPath: r.category_path,
        status: r.status,
        priceCents: r.price_cents,
        stockCount: r.stock_count,
      }));
    const found = matchProducts(question, products);
    return {
      answer: awayAnswer(found),
      products: found.map((p) => ({
        id: p.id,
        name: p.name,
        price: priceText(p.priceCents),
        status: p.status,
      })),
      audio: null,
      by: 'shop',
    };
  }

  /** A question to the first app waiting for one, or into the queue. */
  private offer(w: Waiting) {
    const claimer = this.claimers.shift();
    if (claimer) claimer(w);
    else this.queue.push(w);
  }

  /** The Gleamshelf app waiting (up to `waitSeconds`) for a visitor's question; null when none came. Waiting counts as being online. */
  async claim(
    tokenId: string,
    waitSeconds: number,
  ): Promise<{ id: string; question: string; history: Turn[] } | null> {
    this.seen.set(tokenId, Date.now());
    const ready = this.queue.shift();
    const w =
      ready ??
      (await new Promise<Waiting | null>((resolve) => {
        const timer = setTimeout(() => {
          const i = this.claimers.indexOf(take);
          if (i >= 0) this.claimers.splice(i, 1);
          resolve(null);
        }, waitSeconds * 1000);
        const take = (got: Waiting | null) => {
          clearTimeout(timer);
          resolve(got);
        };
        this.claimers.push(take);
      }));
    this.seen.set(tokenId, Date.now());
    if (!w) return null;
    this.taken.set(w.id, w);
    return { id: w.id, question: w.question, history: w.history };
  }

  private readonly taken = new Map<string, Waiting>();

  /** The app's answer to a question it took. */
  answer(
    id: string,
    reply: { answer: string; products: AssistantReply['products']; audio: string | null },
  ) {
    const w = this.taken.get(id);
    if (!w) throw new AppError('That question was already answered or waited too long.', 409);
    this.taken.delete(id);
    const audio = reply.audio ? Buffer.from(reply.audio, 'base64') : null;
    if (audio && audio.subarray(0, 4).toString('latin1') !== 'RIFF')
      throw new AppError('audio must be a WAV file.');
    w.done({ answer: reply.answer, products: reply.products, audio });
  }

  /** The app saying it is on or off, and how its assistant looks and talks. */
  setProfile(
    tokenId: string,
    p: { on: boolean; name: string; voice: boolean; portrait: string | null },
  ) {
    const before = this.profiles.get(tokenId);
    let portrait = before?.portrait ?? null;
    if (p.portrait) {
      const bytes = Buffer.from(p.portrait, 'base64');
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!png && !jpeg) throw new AppError('portrait must be a PNG or JPEG.');
      if (bytes.length > 420_000) throw new AppError('portrait must be 400 KB or less.');
      portrait = bytes;
    }
    this.profiles.set(tokenId, {
      on: p.on,
      name: p.name,
      voice: p.voice,
      portrait,
      at: Date.now(),
    });
    this.seen.set(tokenId, Date.now());
    return this.status();
  }

  audioClip(id: string): Buffer {
    this.prune();
    const a = this.audio.get(id);
    if (!a) throw notFound('Recording');
    return a.bytes;
  }

  private prune() {
    const now = Date.now();
    for (const [id, a] of this.audio) if (now - a.at > AUDIO_MS) this.audio.delete(id);
  }
}
