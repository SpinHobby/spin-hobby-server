import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { OrderIdParam } from './order-id.dto.js';
import { OrderLookupQuery } from './order-lookup.dto.js';

const pipe = new AppValidationPipe();

describe('OrderIdParam', () => {
  const param = (value: unknown) =>
    pipe.transform(value, { type: 'param', metatype: OrderIdParam });

  it('turns the path segment into a number', async () => {
    expect(await param({ id: '42' })).toMatchObject({ id: 42 });
  });

  it.each(['0', '-3', '1.5', 'abc'])('rejects %s', async (id) => {
    await expect(param({ id })).rejects.toMatchObject({
      message: 'orderId must be between 1 and 9007199254740991.',
    });
  });
});

describe('OrderLookupQuery', () => {
  const query = (value: unknown) =>
    pipe.transform(value, { type: 'query', metatype: OrderLookupQuery });

  it('reads the order number and lowercases the email', async () => {
    expect(await query({ order: '42', email: ' Fan@Example.com ' })).toMatchObject({
      order: 42,
      email: 'fan@example.com',
    });
  });

  it('asks for the order number first, then a real email', async () => {
    await expect(query({})).rejects.toMatchObject({
      message: 'order must be between 1 and 2147483647.',
    });
    await expect(query({ order: '42' })).rejects.toMatchObject({ message: 'email is required.' });
    await expect(query({ order: '42', email: 'nope' })).rejects.toMatchObject({
      message: 'Enter a valid email address.',
    });
  });
});
