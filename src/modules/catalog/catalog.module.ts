import { Module } from '@nestjs/common';
import { StorageModule } from '../../integrations/storage/storage.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { PhotoCleanupService } from './photo-cleanup.service.js';

/** The public storefront catalog: products, facets, homepage content, categories. */
@Module({
  imports: [StorageModule],
  controllers: [CatalogController],
  providers: [CatalogService, PhotoCleanupService],
  exports: [CatalogService, PhotoCleanupService],
})
export class CatalogModule {}
