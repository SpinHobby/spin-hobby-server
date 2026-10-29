import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RateLimit } from '../../common/guards/rate-limit.guard.js';
import { Access } from '../auth/access.js';
import { AssistantService } from './assistant.service.js';
import { AskDto } from './dto/assistant.dto.js';

/**
 * The storefront's talking shop assistant: anyone may ask it something. It is answered by the shop's Gleamshelf app when that is on (its
 * routes are in GleamshelfController), else by the shop's own text answer.
 */
@ApiTags('Shop assistant')
@Controller('assistant')
@Access('public')
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  /** Whether the assistant is on the site, whether it is answering now, its name, and whether it has a voice and a portrait. */
  @Get()
  status() {
    return { success: true, ...this.assistant.status() };
  }

  /** A visitor's question. Waits up to about 20 seconds for the assistant; the shop answers with text if it is away or too slow. */
  @Post('ask')
  @HttpCode(200)
  @RateLimit({ limit: 8, windowMs: 60_000 })
  async ask(@Body() dto: AskDto) {
    return { success: true, ...(await this.assistant.ask(dto.question, dto.history)) };
  }

  /** An answer in the assistant's voice (a WAV), for about ten minutes after it was given. */
  @Get('audio/:id')
  audio(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    res
      .type('audio/wav')
      .set('Cache-Control', 'private, max-age=600')
      .send(this.assistant.audioClip(id));
  }

  /** The assistant's portrait. */
  @Get('portrait')
  portrait(@Res() res: Response) {
    const bytes = this.assistant.portrait();
    res
      .type(bytes[0] === 0x89 ? 'image/png' : 'image/jpeg')
      .set('Cache-Control', 'public, max-age=300')
      .send(bytes);
  }
}
