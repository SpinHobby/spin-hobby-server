import { Injectable, Logger } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import { AppError, errorText, notFound } from '../../common/errors.js';
import { googleServiceAccountJson } from '../../config/google.config.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_URL = 'https://www.googleapis.com/drive/v3';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const FIELDS = 'id,name,mimeType,parents,size,modifiedTime';
/** Files larger than this aren't shown in the admin (they'd be slow to pass through the API); open them in Drive. */
export const MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024;
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  /** Bytes, as text (Drive's format); absent for Google Docs, Sheets and folders. */
  size?: string;
  modifiedTime: string;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

const unreachable = () =>
  new AppError("Google Drive couldn't be reached. Try again in a moment.", 502);

/**
 * Reads Google Drive as the shop's service account (read only), for Admin > Audit. No Google library: the account signs a short
 * token request with its key (jose), and Drive's REST API does the rest. Works with folders in My Drive and in shared drives.
 */
@Injectable()
export class GoogleDriveClient {
  private readonly logger = new Logger(GoogleDriveClient.name);
  private cached: { token: string; expires: number } | null = null;

  isConfigured() {
    return !!this.account();
  }

  /** The folder's contents (one level), all pages. */
  async list(folderId: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        q: `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false`,
        fields: `nextPageToken,files(${FIELDS})`,
        pageSize: '1000',
        orderBy: 'folder,name',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
      });
      if (pageToken) q.set('pageToken', pageToken);
      const page = (await (await this.call(`/files?${q}`)).json()) as {
        files?: DriveFile[];
        nextPageToken?: string;
      };
      files.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async get(fileId: string): Promise<DriveFile> {
    const q = new URLSearchParams({ fields: FIELDS, supportsAllDrives: 'true' });
    return (await (
      await this.call(`/files/${encodeURIComponent(fileId)}?${q}`)
    ).json()) as DriveFile;
  }

  /** The file's bytes. Google Docs, Sheets and Slides come out as PDF. */
  async download(file: DriveFile): Promise<{ body: Buffer; mimeType: string; name: string }> {
    if (Number(file.size ?? 0) > MAX_DOWNLOAD_BYTES)
      throw new AppError(
        'This file is too large to show here. Open it in Google Drive instead.',
        413,
      );
    const native = file.mimeType.startsWith('application/vnd.google-apps.');
    const id = encodeURIComponent(file.id);
    const path = native
      ? `/files/${id}/export?mimeType=application%2Fpdf`
      : `/files/${id}?alt=media&supportsAllDrives=true`;
    const response = await this.call(path);
    const body = Buffer.from(await response.arrayBuffer());
    return {
      body,
      mimeType: native ? 'application/pdf' : file.mimeType,
      name: native && !/\.pdf$/i.test(file.name) ? `${file.name}.pdf` : file.name,
    };
  }

  private account(): ServiceAccount | null {
    const raw = googleServiceAccountJson();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      return parsed.client_email && parsed.private_key ? (parsed as ServiceAccount) : null;
    } catch {
      return null;
    }
  }

  private async call(path: string): Promise<Response> {
    const response = await fetch(`${DRIVE_URL}${path}`, {
      headers: { Authorization: `Bearer ${await this.token()}` },
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => {
      this.logger.warn(`Drive request failed: ${errorText(error)}`);
      throw unreachable();
    });
    if (response.status === 404) throw notFound('Document');
    if (!response.ok) {
      this.logger.warn(
        `Drive answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
      if (response.status === 401 || response.status === 403)
        throw new AppError(
          "The shop's Google account can't read that. Check the folder is shared with it.",
          502,
        );
      throw unreachable();
    }
    return response;
  }

  /** An access token for the service account, reused until a minute before it expires. */
  private async token(): Promise<string> {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.token;
    const account = this.account();
    if (!account) throw new AppError('Google Drive is not connected.', 503);
    const key = await importPKCS8(account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({
        alg: 'RS256',
        typ: 'JWT',
        ...(account.private_key_id ? { kid: account.private_key_id } : {}),
      })
      .setIssuer(account.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {
      throw unreachable();
    });
    if (!response.ok) {
      this.logger.warn(
        `Google sign-in failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
      );
      throw new AppError(
        "The shop's Google account couldn't sign in. Check GOOGLE_SERVICE_ACCOUNT_JSON.",
        502,
      );
    }
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.cached = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
