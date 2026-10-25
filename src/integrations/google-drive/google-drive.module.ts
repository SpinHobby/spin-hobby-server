import { Module } from '@nestjs/common';
import { GoogleDriveClient } from './google-drive.client.js';

/** Read-only Google Drive, as the shop's service account (Admin > Audit's documents). */
@Module({
  providers: [GoogleDriveClient],
  exports: [GoogleDriveClient],
})
export class GoogleDriveModule {}
