import { env } from './env.js';

/** A Google Cloud service account's JSON key, on one line. Audit reads Drive as this account (read only). */
export const googleServiceAccountJson = () => env('GOOGLE_SERVICE_ACCOUNT_JSON');
/** The Drive folder Admin > Audit shows. Share it with the service account's email as Viewer. */
export const auditDriveFolderId = () => env('AUDIT_DRIVE_FOLDER_ID');
