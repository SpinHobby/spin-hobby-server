import { Module } from '@nestjs/common';
import { SampleImagesController } from './sample.controller.js';
import { SampleDataService } from './sample.service.js';

/** Sample catalog and pictures for staging and local development (never loaded in production). */
@Module({
  controllers: [SampleImagesController],
  providers: [SampleDataService],
})
export class SampleModule {}
