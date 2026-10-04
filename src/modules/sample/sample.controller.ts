import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SkipRateLimit } from '../../common/guards/rate-limit.guard.js';
import { sampleImageFor } from './images.js';
import { sampleImagesEnabled } from './sample.service.js';

/** Pictures for the sample catalog, drawn on request: /sample-images/<product slug>.svg and banner-<n>.svg. */
@SkipRateLimit()
@Controller('sample-images')
export class SampleImagesController {
  @Get(':file')
  image(@Param('file') file: string, @Res() res: Response) {
    const svg = sampleImagesEnabled() ? sampleImageFor(file) : undefined;
    if (!svg) {
      res.status(404).json({ success: false, error: 'Not found.' });
      return;
    }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(svg);
  }
}
