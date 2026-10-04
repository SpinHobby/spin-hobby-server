import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import {
  EmailAddress,
  Flag,
  NonNegativeInt,
  OptionalText,
  PositiveInt,
  Text,
} from './decorators.js';
import { AppValidationPipe } from './validation.pipe.js';

class SampleDto {
  @Text('name', 10) name!: string;
  @OptionalText(20) note: string | null = null;
  @PositiveInt('quantity', 5) quantity!: number;
  @NonNegativeInt('stock') stock: number | null = null;
  @EmailAddress() email!: string;
  @Flag('visible') visible!: boolean;
}

const pipe = new AppValidationPipe();
const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SampleDto });
const good = { name: ' Rem ', quantity: '3', email: ' Fan@Example.com ', visible: true };

describe('DTO validation', () => {
  it('cleans values the same way the rule functions do', async () => {
    const dto = (await run({ ...good, note: '  hi ', stock: '4' })) as SampleDto;
    expect(dto).toMatchObject({
      name: 'Rem',
      note: 'hi',
      quantity: 3,
      stock: 4,
      email: 'fan@example.com',
    });
  });

  it('turns missing optional fields into null', async () => {
    const dto = (await run(good)) as SampleDto;
    expect(dto.note).toBeNull();
    expect(dto.stock).toBeNull();
  });

  it('drops fields the DTO does not declare instead of rejecting them', async () => {
    expect(await run({ ...good, isAdmin: true })).not.toHaveProperty('isAdmin');
  });

  it.each([
    [{ ...good, name: '   ' }, 'name is required.'],
    [{ ...good, name: 'x'.repeat(11) }, 'name is required.'],
    [{ ...good, note: 5 }, 'Invalid text value.'],
    [{ ...good, quantity: 0 }, 'quantity must be between 1 and 5.'],
    [{ ...good, quantity: 'many' }, 'quantity must be between 1 and 5.'],
    [{ ...good, stock: -1 }, 'Invalid stock.'],
    [{ ...good, email: 'nope' }, 'Enter a valid email address.'],
    [{ ...good, visible: 'true' }, 'visible must be true or false.'],
  ])('rejects %j with the original message', async (body, message) => {
    await expect(run(body)).rejects.toMatchObject({ message, status: 400 });
    await expect(run(body)).rejects.toBeInstanceOf(AppError);
  });

  it('reports a missing required field by name', async () => {
    const { name: _name, ...withoutName } = good;
    await expect(run(withoutName)).rejects.toMatchObject({ message: 'name is required.' });
  });

  it.each([null, undefined, 'text', 7, [good]])(
    'refuses a body that is not an object: %j',
    async (body) => {
      await expect(run(body)).rejects.toMatchObject({
        message: 'Expected a JSON object.',
        status: 400,
      });
    },
  );
});
