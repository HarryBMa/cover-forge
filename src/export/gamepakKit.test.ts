import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../templates';
import type { MediaItem } from '../types/media';
import { buildKit, canExportKit, KIT_FACES } from './gamepakKit';

const game: MediaItem = {
  id: 'steam-413150',
  type: 'game',
  title: 'Stardew Valley',
  assets: { cover: 'cover.jpg', hero: 'hero.jpg', logo: 'logo.png', screenshots: [] },
};

describe('canExportKit', () => {
  it('is the PC GamePak sleeve, with all four faces, and nothing else', () => {
    const t = buildTemplate('cartridge', 'pc-gamepak');
    expect(canExportKit(t)).toBe(true);
    expect(KIT_FACES.map((id) => t.panels.find((p) => p.id === id)!.widthMm)).toEqual([71.5, 71.5, 16, 16]);
    expect(canExportKit(buildTemplate('bluray', 'us-11'))).toBe(false);
  });
});

describe('buildKit', () => {
  it('carries the faces given and the format the launcher reads', () => {
    const kit = buildKit(game, { front: 'data:image/jpeg;base64,AAAA' });
    expect(kit).toEqual({ format: 'pc-gamepak-sleeve', version: 1, faces: { front: 'data:image/jpeg;base64,AAAA' } });
  });

  it('carries only the words the item has, not the printed defaults', () => {
    const kit = buildKit(game, {});
    expect(kit.headline).toBeUndefined(); // sleeveOf would print STARDEW VALLEY
    expect(kit.features).toBeUndefined(); // sleeveOf would print 1 PLAYER · WINDOWS
    expect(kit.accent).toBeUndefined();
  });

  it('copies the sleeve words, trimmed, and drops values the launcher would refuse', () => {
    const item: MediaItem = {
      ...game,
      sleeve: { headline: ' A FARM.\nA LIFE. ', blurb: 'Grow crops.', tagline: '  ', rating: '12', descriptor: 'Mild violence', accent: '#6ED7FF', legal: '© 2016' },
    };
    expect(buildKit(item, {})).toEqual({
      format: 'pc-gamepak-sleeve',
      version: 1,
      faces: {},
      headline: 'A FARM.\nA LIFE.',
      blurb: 'Grow crops.',
      rating: '12',
      descriptor: 'Mild violence',
      accent: '#6ed7ff',
      legal: '© 2016',
    });
    const odd = { ...game, sleeve: { rating: null, accent: 'red' } } as MediaItem;
    expect(buildKit(odd, {})).toEqual({ format: 'pc-gamepak-sleeve', version: 1, faces: {} });
  });
});
