import { Module } from '@nestjs/common';
import { StorageService } from './storage.service.js';

/** Uploads product and banner photos to Supabase Storage (or local disk in development). */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
