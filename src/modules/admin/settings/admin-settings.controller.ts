import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminSettingsService } from './admin-settings.service.js';
import { TaxRateDto } from './dto/tax-rate.dto.js';
import { UpdateSettingsDto } from './dto/update-settings.dto.js';

/** Shop settings (staff can read, only the owner can change) and tax rates (owner only). */
@ApiTags('Admin: settings')
@Controller('admin')
@Access('staff')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('settings')
  async get() {
    return { success: true, settings: await this.settings.get() };
  }

  /** Changes any subset of the settings. */
  @Put('settings')
  @Access('owner')
  async update(@CurrentUser() admin: AppUser, @Body() dto: UpdateSettingsDto) {
    return { success: true, settings: await this.settings.update(admin.id, dto) };
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
