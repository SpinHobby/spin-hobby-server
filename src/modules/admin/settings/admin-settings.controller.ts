import { easypostApiKey } from '../../../config/shipping.config.js';
import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { ExchangeRateService } from '../../../integrations/fx/exchange-rate.service.js';
import { TaxRateDto } from './dto/tax-rate.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

/** Shop settings (staff can read, only the owner can change) and tax rates (owner only). */
@ApiTags('Admin: settings')
@Controller('admin')
@Access('staff')
export class AdminSettingsController {
  constructor(
    private readonly settings: AdminSettingsService,
    private readonly fx: ExchangeRateService,
  ) {}

  /** `liveFx`: the Bank of Canada rate the shop is using for US dollar estimates (null: unreachable, so `fx_cad_usd` is used). */
  @Get('settings')
  async get() {
    const [settings, liveFx] = await Promise.all([this.settings.get(), this.fx.cadToUsd()]);
    // whether EASYPOST_API_KEY is set: live courier rates need it and the ship-from postal code (a secret, so only yes or no)
    return {
      success: true,
      settings: { ...settings, easypost_configured: !!easypostApiKey() },
      liveFx,
    };
  }

  /** Changes any subset of the settings. */
  @Put('settings')
  @Access('owner')
  async update(@CurrentUser() admin: AppUser, @Body() dto: UpdateSettingsDto) {
    const settings = await this.settings.update(admin.id, dto);
    return { success: true, settings: { ...settings, easypost_configured: !!easypostApiKey() } };
  }

  @Get('tax-rates')
  @Access('owner')
  async taxRates() {
    return { success: true, taxRates: await this.settings.taxRates() };
  }

  /** Adds or replaces the tax rate for one province or state. */
  @Put('tax-rates')
  @Access('owner')
  async setTaxRate(@CurrentUser() admin: AppUser, @Body() dto: TaxRateDto) {
    return { success: true, taxRate: await this.settings.setTaxRate(admin.id, dto) };
  }
}
