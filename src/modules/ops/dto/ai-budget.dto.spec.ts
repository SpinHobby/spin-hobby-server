import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../common/validation/validation.pipe.js';
import { AiBudgetDto } from './ai-budget.dto.js';

const pipe = new AppValidationPipe();
const body = (value: unknown) => pipe.transform(value, { type: 'body', metatype: AiBudgetDto });

describe('AiBudgetDto', () => {
  it('turns text into numbers and allows zero', async () => {
    expect(await body({ warnThresholdUsd: '20', stopThresholdUsd: 0 })).toMatchObject({
      warnThresholdUsd: 20,
      stopThresholdUsd: 0,
    });
  });

  it.each([
    [{ warnThresholdUsd: 'lots', stopThresholdUsd: 30 }],
    [{ warnThresholdUsd: -1, stopThresholdUsd: 30 }],
    [{ warnThresholdUsd: 20 }],
    [{ stopThresholdUsd: 30 }],
  ])('rejects %j', async (input) => {
    await expect(body(input)).rejects.toMatchObject({
      message: 'Invalid threshold values',
      status: 400,
    });
  });
});
