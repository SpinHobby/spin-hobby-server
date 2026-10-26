import { afterAll, describe, expect, it } from 'vitest';
import { startShop } from '../support/shop.js';

const shop = await startShop();
afterAll(shop.close);
const { http, owner, staff } = shop;
const ID = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';

describe('shop playlist', () => {
  it('is off until the owner sets a YouTube playlist, then the storefront gets its id', async () => {
    expect((await http.get('/checkout/config').expect(200)).body.musicPlaylistId).toBeNull();

    await http
      .put('/admin/settings')
      .set('Authorization', staff.auth)
      .send({ music_playlist_id: ID })
      .expect(403);
    const saved = await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ music_playlist_id: `https://www.youtube.com/playlist?list=${ID}` })
      .expect(200);
    expect(saved.body.settings.music_playlist_id).toBe(ID);
    expect((await http.get('/checkout/config').expect(200)).body.musicPlaylistId).toBe(ID);

    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ music_playlist_id: 'https://example.com/not-youtube' })
      .expect(400);

    await http
      .put('/admin/settings')
      .set('Authorization', owner.auth)
      .send({ music_playlist_id: '' })
      .expect(200);
    expect((await http.get('/checkout/config').expect(200)).body.musicPlaylistId).toBeNull();
  });
});
