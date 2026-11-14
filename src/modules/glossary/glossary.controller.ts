import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Access } from '../auth/access.js';
import { CreateGlossaryTermDto } from './dto/glossary.dto.js';
import { GlossaryService } from './glossary.service.js';

/** The collector's glossary for the shop: anyone may read it. */
@ApiTags('Glossary')
@Controller('glossary')
@Access('public')
export class GlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  /** Every term with its meaning, A to Z. */
  @Get()
  async list() {
    return { success: true, terms: await this.glossary.list() };
  }
}

/** Staff add terms to the glossary. */
@ApiTags('Admin: glossary')
@Controller('admin/glossary')
@Access('staff')
export class AdminGlossaryController {
  constructor(private readonly glossary: GlossaryService) {}

  /** Adds a term. Answers 409 when the term is already there. */
  @Post()
  @HttpCode(200)
  async create(@Body() dto: CreateGlossaryTermDto) {
    return { success: true, term: await this.glossary.create(dto.term, dto.meaning) };
  }
}
