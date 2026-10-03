import { HttpException, Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from './errors.js';
import { JsonErrorFilter } from './http-exception.filter.js';

function run(exception: unknown, requestId?: string) {
  const json = vi.fn();
  const res = { locals: requestId ? { requestId } : {}, status: vi.fn((_code: number) => ({ json })) };
  new JsonErrorFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost);
  return { status: res.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

describe('JsonErrorFilter', () => {
  beforeEach(() => { vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined); });
  afterEach(() => vi.restoreAllMocks());

  it('keeps the storefront error shape for expected errors', () => {
    expect(run(new AppError('Nope.', 409, 'CODE'))).toEqual({ status: 409, body: { success: false, error: 'Nope.', code: 'CODE' } });
    expect(run(new HttpException('x', 404))).toEqual({ status: 404, body: { success: false, error: 'Route not found.' } });
  });

  it('hides internals from 500s but gives the caller a request id to quote, and logs it', () => {
    const { status, body } = run(new Error('relation "secret" does not exist'), 'req-123456');
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: 'An unexpected server error occurred.', requestId: 'req-123456' });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(vi.mocked(Logger.prototype.error).mock.calls[0][0]).toContain('[req-123456]');
  });

  it('still answers 500s when there is no request id', () => {
    expect(run(new Error('boom')).body).toEqual({ success: false, error: 'An unexpected server error occurred.' });
  });
});
