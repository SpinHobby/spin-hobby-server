import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AssistantController } from './assistant.controller.js';
import { AssistantService } from './assistant.service.js';

/** The storefront's talking shop assistant: visitors' questions, answered by the shop's Gleamshelf app or with a text answer while it is away. */
@Module({
  imports: [CatalogModule],
  controllers: [AssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
