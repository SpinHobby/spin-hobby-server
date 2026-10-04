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

  it('lowercases the email', async () => {
    expect(await query({ paymentId: 'PAY-1', email: ' Fan@Example.com ' })).toMatchObject({
      paymentId: 'PAY-1',
      email: 'fan@example.com',
    });
  });

  it('asks for the payment id first, then the email', async () => {
    await expect(query({})).rejects.toMatchObject({ message: 'paymentId is required.' });
    await expect(query({ paymentId: 'PAY-1' })).rejects.toMatchObject({
      message: 'email is required.',
    });
  });
});
