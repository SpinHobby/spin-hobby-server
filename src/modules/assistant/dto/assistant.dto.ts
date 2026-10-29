import { AppError } from '../../../common/errors.js';
import { Flag, OptionalText, Rule, Text } from '../../../common/validation/decorators.js';

const turns = (v: unknown) => {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 6) throw new AppError('history must be a short list.');
  return v.map((t) => {
    const q = (t as { question?: unknown })?.question,
      a = (t as { answer?: unknown })?.answer;
    if (typeof q !== 'string' || typeof a !== 'string' || q.length > 300 || a.length > 1000)
      throw new AppError('history must be questions and answers.');
    return { question: q, answer: a };
  });
};

/** A visitor's question for the shop assistant. */
export class AskDto {
  /** What the visitor asked, up to 300 characters. */
  @Text('question', 300)
  question!: string;

  /** The last few questions and answers of this chat, oldest first, so the assistant can follow it. */
  @Rule(turns)
  history: { question: string; answer: string }[] = [];
}

/** The Gleamshelf app waiting for a visitor's question. */
export class AssistantClaimDto {
  /** How long to wait for one, in seconds (1-25; default 25). */
  @Rule((v) => {
    if (v === undefined || v === null) return 25;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 1 || n > 25) throw new AppError('wait must be 1 to 25 seconds.');
    return n;
  })
  wait = 25;
}

/** The Gleamshelf app's answer to a visitor's question. */
export class AssistantAnswerDto {
  /** The words to show (and say), up to 1000 characters. */
  @Text('answer', 1000)
  answer!: string;

  /** The products the answer is about: id, name, price text and status, at most 6. */
  @Rule((v) => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 6) throw new AppError('products must be a short list.');
    return v.map((p) => {
      const { id, name, price, status } = (p ?? {}) as Record<string, unknown>;
      if ([id, name, price, status].some((x) => typeof x !== 'string' || x.length > 200))
        throw new AppError('products must be id, name, price and status.');
      return { id, name, price, status } as {
        id: string;
        name: string;
        price: string;
        status: string;
      };
    });
  })
  products: { id: string; name: string; price: string; status: string }[] = [];

  /** The answer said in the assistant's voice: a WAV file as base64, up to about 2 MB; none for a text-only answer. */
  @Rule((v) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || v.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(v))
      throw new AppError('audio must be a WAV file as base64.');
    return v;
  })
  audio: string | null = null;
}

/** What the shop's Gleamshelf app says about its assistant: on or off, its name, its portrait, whether it talks. */
export class AssistantProfileDto {
  /** Whether it answers the shop's visitors now. */
  @Flag('on')
  on!: boolean;

  /** The assistant's name, as visitors see it (up to 30 characters). */
  @Text('name', 30)
  name!: string;

  /** Whether its answers come with its voice. */
  @Flag('voice')
  voice!: boolean;

  /** Its portrait: a PNG or JPEG as base64, up to about 400 KB; none keeps the last one. */
  @OptionalText(560_000)
  portrait: string | null = null;
}
