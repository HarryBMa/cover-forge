import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../templates';
import type { MediaItem } from '../types/media';
import { initialState, reducer } from '../context/AppContext';
import { restoreSession, serializeSession } from '../context/session';
import { drawGamePak, sleeveImageUrls, sleeveOf, wrapText } from './gamepak';
import { resolvePanel } from './resolve';
import { computeCodePlacement, sleeveCodeSlot } from './code';
import { DEFAULT_CODE } from '../types/editor';

const game: MediaItem = {
  id: 'steam-413150',
  type: 'game',
  title: 'Stardew Valley',
  assets: { cover: 'cover.jpg', hero: 'hero.jpg', logo: 'logo.png', screenshots: ['s0.jpg', 's1.jpg', 's2.jpg', 's3.jpg'] },
};

/** A stand-in 2D context: records what is drawn, measures text at 0.5 px per character per px of font size. */
function fakeContext() {
  const calls: { name: string; args: unknown[] }[] = [];
  let fontPx = 10;
  const ctx = new Proxy(
    {},
    {
      get(_, key: string) {
        if (key === 'calls') return calls;
        if (key === 'measureText') return (s: string) => ({ width: s.length * fontPx * 0.5, actualBoundingBoxAscent: fontPx * 0.7 });
        if (key === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...args: unknown[]) => calls.push({ name: key, args });
      },
      set(_, key: string, value) {
        if (key === 'font') fontPx = Number(/([\d.]+)px/.exec(String(value))?.[1] ?? 10);
        calls.push({ name: `set:${key}`, args: [value] });
        return true;
      },
    },
  );
  return ctx as unknown as CanvasRenderingContext2D & { calls: typeof calls };
}

const fakeImage = { naturalWidth: 400, naturalHeight: 200, width: 400, height: 200 } as HTMLImageElement;

describe('PC GamePak sleeve', () => {
  it('fills in a new game: its title as the headline, its first screenshots as a strip, no rating yet', () => {
    const s = sleeveOf(game);
    expect(s.headline).toBe('STARDEW VALLEY');
    expect(s.rows.map((r) => r.image)).toEqual(['screenshot:0', 'screenshot:1', 'screenshot:2']);
    expect(s.rows.every((r) => !r.title && !r.text && !r.logo)).toBe(true);
    expect([s.titleLogo, s.rating, s.blurb]).toEqual([null, null, '']);
  });

  it('keeps what the item sets, including an explicit "none"', () => {
    const s = sleeveOf({ ...game, sleeve: { rating: '12', titleLogo: 'logo', rows: [], headline: 'A\nB' } });
    expect([s.rating, s.titleLogo, s.rows.length, s.headline]).toEqual(['12', 'logo', 0, 'A\nB']);
    expect(sleeveOf({ ...game, sleeve: { rating: null } }).rating).toBeNull();
  });

  it('lists the images it draws, so they load before a render (the item logo too: flap and spine fall back to it)', () => {
    const urls = sleeveImageUrls({ ...game, sleeve: { footerLogos: ['screenshot:3'] } });
    expect(urls).toEqual(['logo.png', 's0.jpg', 's1.jpg', 's2.jpg', 's3.jpg']);
  });

  it('wraps text to a width and keeps line breaks', () => {
    const measure = (s: string) => s.length;
    expect(wrapText(measure, 'one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText(measure, 'THREE CAMPAIGNS.\nONE WAR', 40)).toEqual(['THREE CAMPAIGNS.', 'ONE WAR']);
  });

  it('draws on the cartridge only, panel by panel, without throwing', () => {
    const t = buildTemplate('cartridge', 'pc-gamepak');
    const ctx = fakeContext();
    const item = { ...game, sleeve: { rating: '12' as const, blurb: 'A farm.', rows: [{ image: 'screenshot:0' as const, logo: null, title: 'Farm', text: 'Grow crops.' }], footerLogos: [] } };
    drawGamePak(ctx, t, item, 2, () => fakeImage);
    const texts = ctx.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(texts).toEqual(expect.arrayContaining(['STARDEW VALLEY', 'A farm.', 'FARM', 'Grow crops.', '12', 'PC-GAMEPAK', 'PC', 'GAMES']));
    const other = fakeContext();
    drawGamePak(other, buildTemplate('vhs'), item, 2, () => fakeImage);
    expect(other.calls).toEqual([]);
  });

  it('is kept on the item through edits and a save', () => {
    let s = reducer(initialState, { type: 'addItem', item: game });
    s = reducer(s, { type: 'updateSleeve', id: game.id, patch: { headline: 'TRADE THE CITY' } });
    s = reducer(s, { type: 'updateSleeve', id: game.id, patch: { rating: '12' } });
    expect(s.items[0].sleeve).toEqual({ headline: 'TRADE THE CITY', rating: '12' });
    const back = restoreSession(JSON.parse(JSON.stringify(serializeSession(s))), initialState);
    expect(back.items[0].sleeve).toEqual({ headline: 'TRADE THE CITY', rating: '12' });
  });

  it('gives an added barcode its own spot in the footer: bottom left, at the smallest GS1 size, clear of the safe edge', () => {
    const t = buildTemplate('cartridge', 'pc-gamepak');
    const back = t.panels.find((p) => p.id === 'back')!;
    const pl = computeCodePlacement(t, back, { ...DEFAULT_CODE, kind: 'ean13' })!;
    expect(pl.fits).toBe(true);
    expect(pl.area.xMm + pl.xMm).toBeCloseTo(back.xMm + 3);
    expect(pl.widthMm).toBeCloseTo((37.29 + 3) * 0.8);
    expect(pl.area.yMm + pl.yMm + pl.heightMm).toBeCloseTo(back.yMm + back.heightMm - 3);
    // The layout moves the small print beside it rather than under it.
    const ctx = fakeContext();
    drawGamePak(ctx, t, { ...game, sleeve: { legal: 'Small print.' } }, 2, () => fakeImage, sleeveCodeSlot(back, 'ean13'));
    const legal = ctx.calls.find((c) => c.name === 'fillText' && c.args[0] === 'Small print.')!;
    expect((legal.args[1] as number) / 2).toBeGreaterThan(back.xMm + 3 + pl.widthMm);
  });

  it('puts no barcode on a sleeve unless one is added', () => {
    expect(resolvePanel({ panels: {}, spine: initialState.shared.spine }, game, 'back', 'cartridge').code.kind).toBe('none');
  });
});
