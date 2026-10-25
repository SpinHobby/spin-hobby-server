import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AuditAccessDto, SalesQuery } from './dto/audit.dto.js';

/** Admin > Audit: the shop's audit documents (a Google Drive folder) and sales records. Owners and allowed staff only. */
@ApiTags('Admin: audit')
@Controller('admin/audit')
@Access('auditor')
export class AdminAuditController {
  constructor(private readonly audit: AdminAuditService) {}

  /** The top of the audit folder. `connected: false` when Google Drive isn't set up. */
  @Get('documents')
  async root() {
    return { success: true, ...(await this.audit.folder()) };
  }

  /** A folder inside the audit folder. */
  @Get('folders/:id')
  async folder(@Param('id') id: string) {
    return { success: true, ...(await this.audit.folder(id)) };
  }

  /** A document's bytes (PDF, image...), shown in the admin. Google Docs come as PDF. Logged as viewed. */
  @Get('documents/:id')
  async document(
    @CurrentUser() user: AppUser,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.audit.document(user.id, id);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.body, {
      type: file.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    });
  }

  /** Orders paid and refunds made in a period (both days included), with totals and tax by province. */
  @Get('sales')
  async sales(@Query() query: SalesQuery) {
    return { success: true, ...(await this.audit.sales(query.from, query.to)) };
  }

  /** Staff and owners, and who may open Audit. Owner only. */
  @Get('access')
  @Access('owner')
  async access() {
    return { success: true, accounts: await this.audit.access() };
  }

  /** Lets a staff account into Audit, or takes it away. Owner only. */
  @Put('access/:id')
  @Access('owner')
  async setAccess(
    @CurrentUser() owner: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AuditAccessDto,
  ) {
    return { success: true, account: await this.audit.setAccess(owner.id, id, dto.canAudit) };
  }
}
