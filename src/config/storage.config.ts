import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from './env.js';

/** Where uploads go on a machine without Supabase Storage (local development). */
export const localUploadDir = () => env('LOCAL_UPLOAD_DIR') ?? join(tmpdir(), 'spinhobby-uploads');
