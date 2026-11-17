import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, LAYOUT_SECTIONS, storefrontLayout } from './layout.js';

describe('storefrontLayout', () => {
  it('is the default layout when nothing is stored', () => {
    expect(storefrontLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(storefrontLayout({})).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps the chosen order, adds blocks it does not list, and never hides the product grid', () => {
    const layout = storefrontLayout({
      sections: [
        { id: 'shop', visible: false },
        { id: 'hero', visible: false },
      ],
      columns: 4,
      sidebar: 'right',
    });
    expect(layout.sections.map((s) => s.id)).toEqual([
      'shop',
      'hero',
      ...LAYOUT_SECTIONS.filter((id) => id !== 'shop' && id !== 'hero'),
    ]);
    expect(layout.sections[0]).toEqual({ id: 'shop', visible: true });
    expect(layout.sections[1]).toEqual({ id: 'hero', visible: false });
    expect(layout.columns).toBe(4);
    expect(layout.sidebar).toBe('right');
    expect(layout.productView).toBe('grid');
  });

  it('refuses unknown blocks, repeats and values', () => {
    expect(() => storefrontLayout({ sections: [{ id: 'banner' }] })).toThrow();
    expect(() => storefrontLayout({ sections: [{ id: 'hero' }, { id: 'hero' }] })).toThrow();
    expect(() => storefrontLayout({ columns: 9 })).toThrow();
    expect(() => storefrontLayout({ sidebar: 'top' })).toThrow();
    expect(() => storefrontLayout({ announcementBar: 'yes' })).toThrow();
    expect(() => storefrontLayout('grid')).toThrow();
  });
});
