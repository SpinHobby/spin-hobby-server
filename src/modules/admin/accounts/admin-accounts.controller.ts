import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access, CurrentUser } from '../../auth/access.js';
import type { AppUser } from '../../auth/auth.service.js';
import { AdminAccountsService } from './admin-accounts.service.js';
import { AccountsQuery, RestrictionDto, RoleDto } from './dto/accounts.dto.js';

/** Admin > Accounts: every account, its role, suspensions and bans. Owner only. */
@ApiTags('Admin: accounts')
@Controller('admin/accounts')
@Access('owner')
export class AdminAccountsController {
  constructor(private readonly accounts: AdminAccountsService) {}

  /** The roles, lowest first, with what each can do. */
  @Get('roles')
  roles() {
    return { success: true, roles: this.accounts.roles() };
  }

  /** Accounts, highest role first then newest. Filter by text, role or status; paged. */
  @Get()
  async list(@Query() query: AccountsQuery) {
    return { success: true, ...(await this.accounts.list(query)) };
  }

  /** One account with the changes made to it. */
  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return { success: true, account: await this.accounts.get(id) };
  }

  /** Promote or demote. */
  @Put(':id/role')
  async setRole(
    @CurrentUser() owner: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RoleDto,
  ) {
    return { success: true, account: await this.accounts.setRole(owner.id, id, dto.role) };
  }

  /** Suspend until a day, ban for good, or lift either. */
  @Put(':id/restriction')
  async restrict(
    @CurrentUser() owner: AppUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RestrictionDto,
  ) {
    return { success: true, account: await this.accounts.restrict(owner.id, id, dto) };
  }
}
