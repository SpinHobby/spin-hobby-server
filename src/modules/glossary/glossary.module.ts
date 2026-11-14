import { Module } from '@nestjs/common';
import { AdminGlossaryController, GlossaryController } from './glossary.controller.js';
import { GlossaryService } from './glossary.service.js';

/** The collector's glossary: terms shoppers meet on product pages, listed for everyone and added by staff. */
@Module({
  controllers: [GlossaryController, AdminGlossaryController],
  providers: [GlossaryService],
})
export class GlossaryModule {}
