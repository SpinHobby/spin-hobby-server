import { exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { GoogleDriveClient, MAX_DOWNLOAD_BYTES } from './google-drive.client.js';

const fetchMock = vi.fn();
let key = '';
beforeAll(async () => {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  key = JSON.stringify({
    client_email: 'audit@shop.iam.gserviceaccount.com',
    private_key: await exportPKCS8(privateKey),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});
const connect = () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = key;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('oauth2')
      ? Response.json({ access_token: 't', expires_in: 3600 })
      : new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
  );
};

describe('GoogleDriveClient', () => {
  it('is not configured without a usable key', () => {
    expect(new GoogleDriveClient().isConfigured()).toBe(false);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = '{not json';
    expect(new GoogleDriveClient().isConfigured()).toBe(false);
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = key;
    expect(new GoogleDriveClient().isConfigured()).toBe(true);
  });

  it('exports Google Docs as PDF and downloads other files as they are', async () => {
    connect();
    const drive = new GoogleDriveClient();
    const doc = await drive.download({
      id: 'D1',
      name: 'Ledger',
      mimeType: 'application/vnd.google-apps.document',
      modifiedTime: '',
    });
    expect(doc).toMatchObject({ mimeType: 'application/pdf', name: 'Ledger.pdf' });
    expect(fetchMock.mock.calls.at(-1)![0]).toContain(
      '/files/D1/export?mimeType=application%2Fpdf',
    );

    const pdf = await drive.download({
      id: 'P1',
      name: 'Invoice.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '',
      size: '4',
    });
    expect(pdf).toMatchObject({ mimeType: 'application/pdf', name: 'Invoice.pdf' });
    expect(pdf.body.toString()).toBe('%PDF');
    expect(fetchMock.mock.calls.at(-1)![0]).toContain('/files/P1?alt=media');
  });

  it('refuses files too large to pass through', async () => {
    connect();
    const big = {
      id: 'B',
      name: 'Scan.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '',
      size: String(MAX_DOWNLOAD_BYTES + 1),
    };
    await expect(new GoogleDriveClient().download(big)).rejects.toMatchObject({ status: 413 });
  });

  it("explains a folder that isn't shared with the shop's account", async () => {
    connect();
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('oauth2')
        ? Response.json({ access_token: 't', expires_in: 3600 })
        : new Response('{}', { status: 403 }),
    );
    await expect(new GoogleDriveClient().list('F')).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('shared'),
    });
  });
});
