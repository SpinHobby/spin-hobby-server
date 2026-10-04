import { describe, expect, it } from 'vitest';
import { AppValidationPipe } from '../../../../common/validation/validation.pipe.js';
import { sentFields } from '../../dto/defined-fields.js';
import { TaxRateDto } from './tax-rate.dto.js';
import { UpdateSettingsDto } from './update-settings.dto.js';

const pipe = new AppValidationPipe();
const body = (metatype: new () => object, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe('UpdateSettingsDto', () => {
  it('only carries the fields that were sent', async () => {
    const dto = await body(UpdateSettingsDto, { low_stock_threshold: 5, ignored: 'x' });
    expect(sentFields(dto)).toEqual({ low_stock_threshold: 5 });
  });

  it('accepts an empty update', async () => {
    expect(sentFields(await body(UpdateSettingsDto, {}))).toEqual({});
  });

  it('cleans the maintenance message and requires a real boolean for the switch', async () => {
    expect(
      sentFields(
        await body(UpdateSettingsDto, {
          maintenance_message: '  Back soon  ',
          maintenance_mode: true,
        }),
      ),
    ).toEqual({
      maintenance_message: 'Back soon',
      maintenance_mode: true,
    });
    expect(sentFields(await body(UpdateSettingsDto, { maintenance_message: '' }))).toEqual({
      maintenance_message: null,
    });
    await expect(body(UpdateSettingsDto, { maintenance_mode: 'yes' })).rejects.toMatchObject({
      message: 'maintenance_mode must be true or false.',
    });
  });

  it.each([
    [{ payment_provider: 'stripe' }, 'Invalid payment provider.'],
    [{ shipping_standard_cents: -1 }, 'Invalid shipping_standard_cents.'],
    [{ free_shipping_threshold_cents: 1.5 }, 'Invalid free_shipping_threshold_cents.'],
    [{ low_stock_threshold: 'lots' }, 'Invalid low_stock_threshold.'],
    [{ handling_days_min: -2 }, 'Invalid handling_days_min.'],
    [{ fx_cad_usd: 0 }, 'Invalid fx_cad_usd.'],
  ])('rejects %j', async (input, message) => {
    await expect(body(UpdateSettingsDto, input)).rejects.toMatchObject({ message, status: 400 });
  });

  it('accepts whole numbers sent as text, as the admin form does', async () => {
    expect(
      sentFields(
        await body(UpdateSettingsDto, { shipping_express_cents: '1999', fx_cad_usd: '0.73' }),
      ),
    ).toEqual({
      shipping_express_cents: '1999',
      fx_cad_usd: '0.73',
    });
  });
});

describe('TaxRateDto', () => {
  it('upper-cases the province, converts the rate and defaults to enabled', async () => {
    expect(await body(TaxRateDto, { country: 'CA', province: ' ab ', rate: '0.05' })).toMatchObject(
      {
        country: 'CA',
        province: 'AB',
        rate: 0.05,
        enabled: true,
      },
    );
    expect(
      await body(TaxRateDto, { country: 'US', province: 'WA', rate: 0, enabled: false }),
    ).toMatchObject({ enabled: false });
  });

  it.each([
    [{ country: 'MX', province: 'AB', rate: 0.05 }, 'Invalid tax rate.'],
    [{ country: 'CA', province: 'AB', rate: 1.5 }, 'Invalid tax rate.'],
    [{ country: 'CA', province: 'AB', rate: 'free' }, 'Invalid tax rate.'],
    [{ country: 'CA', rate: 0.05 }, 'province is required.'],
  ])('rejects %j', async (input, message) => {
    await expect(body(TaxRateDto, input)).rejects.toMatchObject({ message });
  });
});
