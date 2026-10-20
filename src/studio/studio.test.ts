import { describe, expect, it } from 'vitest';
import { buildTemplate } from '../templates';
import type { MediaItem } from '../types/media';
import type { StudioDoc } from '../types/studio';
import { initialState, reducer } from '../context/AppContext';
import { restoreSession, serializeSession } from '../context/session';
import { arrange, containsPoint, cropFromPlacement, duplicateObjects, fillTokens, frameAt, frameCrop, makeFrame, makeShape, makeStamp, makeText, moveToIndex, removeObjects, shownText } from './doc';
import { LAYOUTS, layoutsFor } from './layouts';
import { placePayload } from './place';
import { registerStamps, searchStamps, stampSrc, type StampDef } from './stamps';
import { BUILTIN_STAMPS } from './stamps.generated';
import { hasHolo } from './holo';

const game: MediaItem = {
  id: 'steam-413150',
  type: 'game',
  title: 'Stardew Valley',
  year: '2016',
  assets: { cover: 'cover.jpg', hero: 'hero.jpg', logo: 'logo.png', screenshots: ['s0.jpg', 's1.jpg', 's2.jpg', 's3.jpg'] },
  sleeve: { headline: 'TRADE THE CITY', rating: '12' },
};
const t = buildTemplate('cartridge', 'pc-gamepak');
registerStamps(BUILTIN_STAMPS);

describe('frames', () => {
  it('cover a frame with the picture, centred, and keep the crop inside the picture', () => {
    // A 40×20 mm frame and a 1000×1000 px picture: the picture is scaled to 40 mm wide and cropped top and bottom.
    const c = frameCrop({ w: 40, h: 20, zoom: 1, cx: 0.5, cy: 0.5 }, 1000, 1000);
    expect(c.scale).toBeCloseTo(0.04);
    expect([c.cropX, c.cropY, c.cropW, c.cropH]).toEqual([0, 250, 1000, 500]);
    // Off-centre focus is clamped so the crop never leaves the picture.
    expect(frameCrop({ w: 40, h: 20, zoom: 1, cx: 0.5, cy: 0 }, 1000, 1000).cropY).toBe(0);
  });

  it('fit a picture inside the frame when asked (for logos)', () => {
    const c = frameCrop({ w: 40, h: 20, zoom: 1, cx: 0.5, cy: 0.5, fit: 'contain' }, 1000, 1000);
    expect(c.scale).toBeCloseTo(0.02);
    expect([c.cropW, c.cropH]).toEqual([1000, 1000]);
  });

  it('turn a dragged picture back into zoom and focus (crop mode), and round-trip', () => {
    const f = { w: 40, h: 20 };
    // Picture at 1.5× the cover scale, its centre 5 mm left of the frame's centre.
    const r = cropFromPlacement(f, 1000, 1000, 0.04 * 1.5, -5, 0);
    expect(r.zoom).toBeCloseTo(1.5);
    expect(r.cx).toBeCloseTo(0.5 + 5 / 0.06 / 1000);
    const c = frameCrop({ ...f, ...r }, 1000, 1000);
    expect(c.cropX + c.cropW / 2).toBeCloseTo(r.cx * 1000);
    // Can't zoom out past covering the frame.
    expect(cropFromPlacement(f, 1000, 1000, 0.01, 0, 0).zoom).toBe(1);
  });

  it('take a dropped picture: the topmost frame under the point', () => {
    const a = makeFrame('rect', { x: 50, y: 50, w: 20, h: 20 });
    const b = { ...makeFrame('circle', { x: 55, y: 55, w: 20, h: 20 }), angle: 45 };
    const doc: StudioDoc = { objects: [a, b] };
    expect(frameAt(doc, 55, 55)?.id).toBe(b.id);
    expect(frameAt(doc, 42, 42)?.id).toBe(a.id);
    expect(frameAt(doc, 10, 10)).toBeUndefined();
    // Rotation counts: a 45° square doesn't reach its unrotated corner.
    expect(containsPoint(b, 64.5, 45.5)).toBe(false);
  });
});

describe('document operations', () => {
  const a = makeShape('rect', { x: 0, y: 0, w: 1, h: 1 }, '#000');
  const b = makeShape('rect', { x: 0, y: 0, w: 1, h: 1 }, '#111');
  const c = makeShape('rect', { x: 0, y: 0, w: 1, h: 1 }, '#222');
  const doc: StudioDoc = { objects: [a, b, c] };
  const ids = (d: StudioDoc) => d.objects.map((o) => o.id);

  it('restack', () => {
    expect(ids(arrange(doc, [a.id], 'front'))).toEqual([b.id, c.id, a.id]);
    expect(ids(arrange(doc, [c.id], 'back'))).toEqual([c.id, a.id, b.id]);
    expect(ids(arrange(doc, [a.id], 'forward'))).toEqual([b.id, a.id, c.id]);
    expect(ids(arrange(doc, [c.id], 'backward'))).toEqual([a.id, c.id, b.id]);
    expect(ids(moveToIndex(doc, c.id, 0))).toEqual([c.id, a.id, b.id]);
  });

  it('duplicate just above the original, offset, and remove', () => {
    const r = duplicateObjects(doc, [a.id]);
    expect(r.doc.objects).toHaveLength(4);
    expect(r.doc.objects[1].id).toBe(r.ids[0]);
    expect(r.doc.objects[1].x).toBe(3);
    expect(ids(removeObjects(r.doc, [a.id, r.ids[0]]))).toEqual([b.id, c.id]);
  });

  it('fill {fields} from the game, leaving unknown ones', () => {
    expect(fillTokens('{title} ({year}) {nope}', game)).toBe('Stardew Valley (2016) {nope}');
    expect(fillTokens('{headline}', game)).toBe('TRADE THE CITY');
    expect(shownText({ ...makeText('{title}', { x: 0, y: 0, w: 10, h: 2 }), uppercase: true }, game)).toBe('STARDEW VALLEY');
  });
});

describe('layouts', () => {
  it('offers every layout for the cartridge sleeve, each inside the canvas', () => {
    expect(layoutsFor(t).map((l) => l.id)).toEqual(LAYOUTS.map((l) => l.id));
    for (const l of LAYOUTS) {
      const objs = l.build({ t, item: game });
      expect(objs.length, l.id).toBeGreaterThan(0);
      for (const o of objs) {
        expect(o.x, `${l.id} ${o.name}`).toBeGreaterThanOrEqual(0);
        expect(o.x, `${l.id} ${o.name}`).toBeLessThanOrEqual(t.totalWidthMm);
        expect(o.y, `${l.id} ${o.name}`).toBeGreaterThanOrEqual(-1);
        expect(o.y, `${l.id} ${o.name}`).toBeLessThanOrEqual(t.totalHeightMm + 1);
        expect(o.w > 0 && o.h > 0, `${l.id} ${o.name}`).toBe(true);
      }
    }
  });

  it('fill frames with the game’s own pictures and name it with {fields}', () => {
    const objs = LAYOUTS.find((l) => l.id === 'back-rows')!.build({ t, item: game });
    expect(objs.filter((o) => o.kind === 'frame').map((o) => (o.kind === 'frame' ? o.image : null))).toEqual(['screenshot:0', 'screenshot:1', 'screenshot:2']);
    expect(objs.some((o) => o.kind === 'text' && o.text === '{headline}')).toBe(true);
  });

  it('the whole-sleeve layout uses the rating and replaces the built-in layout', async () => {
    const r = await placePayload({ kind: 'layout', id: 'sleeve-classic' }, null, { doc: { objects: [] }, item: game, template: t, panel: 'front' });
    expect(r!.doc.hideBranded).toBe(true);
    expect(r!.doc.objects.some((o) => o.kind === 'stamp' && o.stamp === 'badge-12plus')).toBe(true);
  });

  it('go under what is already there', async () => {
    const sticker = makeStamp('gp-logo', { x: 100, y: 50, w: 20, h: 4 });
    const r = await placePayload({ kind: 'layout', id: 'front-full' }, null, { doc: { objects: [sticker] }, item: game, template: t, panel: 'front' });
    expect(r!.doc.objects.at(-1)!.id).toBe(sticker.id);
  });
});

describe('placing from the drawer', () => {
  const ctx = { doc: { objects: [] } as StudioDoc, item: game, template: t, panel: 'front' as const };
  const front = t.panels.find((p) => p.id === 'front')!;

  it('adds a stamp at its own size and proportions, centred on the panel', async () => {
    const r = await placePayload({ kind: 'stamp', id: 'badge-pc-game' }, null, ctx);
    const o = r!.doc.objects[0];
    expect(o.kind).toBe('stamp');
    expect([o.x, o.y]).toEqual([front.xMm + front.widthMm / 2, front.yMm + front.heightMm / 2]);
    expect(o.w).toBe(14);
    expect(o.h).toBe(14);
    expect(r!.select).toEqual([o.id]);
  });

  it('drops a frame or text where it was dropped', async () => {
    const r = await placePayload({ kind: 'frame', shape: 'hexagon', ratio: 0.87 }, { x: 40, y: 30 }, ctx);
    expect([r!.doc.objects[0].x, r!.doc.objects[0].y]).toEqual([40, 30]);
    const tx = await placePayload({ kind: 'text', preset: 'title' }, { x: 40, y: 30 }, ctx);
    expect(tx!.doc.objects[0].kind).toBe('text');
  });

  it('puts a picture dropped on a frame into the frame', async () => {
    const f = makeFrame('rect', { x: 40, y: 30, w: 20, h: 20 });
    const r = await placePayload({ kind: 'image', ref: 'screenshot:2' }, { x: 41, y: 31 }, { ...ctx, doc: { objects: [f] } });
    expect(r!.doc.objects).toHaveLength(1);
    expect(r!.doc.objects[0]).toMatchObject({ id: f.id, image: 'screenshot:2', zoom: 1 });
  });
});

describe('stamps', () => {
  it('are unique, searchable and sized', () => {
    const ids = BUILTIN_STAMPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BUILTIN_STAMPS.length).toBeGreaterThan(100);
    for (const s of BUILTIN_STAMPS) {
      expect(s.svg!.startsWith('<svg'), s.id).toBe(true);
      expect(s.svg!.includes('NaN'), s.id).toBe(false);
      expect(s.w > 0 && s.h > 0 && s.mm > 0, s.id).toBe(true);
    }
    expect(searchStamps(BUILTIN_STAMPS, 'genre horror').map((s) => s.id)).toEqual(['genre-horror']);
  });

  it('draw built-in SVGs larger than their own size (sharp when recoloured); local ones from their file', () => {
    const s = BUILTIN_STAMPS.find((x) => x.id === 'gp-planet')!;
    const url = decodeURIComponent(stampSrc(s));
    expect(url).toContain(`width="${s.w * 4}"`);
    const local: StampDef = { id: 'local:pegi/pegi-18', name: 'PEGI 18', category: 'PEGI', tags: '', mm: 12, tint: false, url: 'local-stamps/pegi/pegi-18.svg', w: 1, h: 1, local: true };
    expect(stampSrc(local)).toBe('local-stamps/pegi/pegi-18.svg');
  });
});

describe('Studio state', () => {
  const doc1: StudioDoc = { objects: [makeShape('rect', { x: 1, y: 1, w: 1, h: 1 }, '#000')] };
  const doc2: StudioDoc = { objects: [...doc1.objects, makeShape('circle', { x: 2, y: 2, w: 1, h: 1 }, '#fff')] };

  it('undoes and redoes per game', () => {
    let s = reducer(initialState, { type: 'addItem', item: game });
    s = reducer(s, { type: 'studioSet', id: game.id, doc: doc1 });
    s = reducer(s, { type: 'studioSet', id: game.id, doc: doc2, select: [doc2.objects[1].id] });
    expect(s.studioSelection).toEqual([doc2.objects[1].id]);
    s = reducer(s, { type: 'studioUndo', id: game.id });
    expect(s.items[0].studio).toBe(doc1);
    expect(s.studioSelection).toEqual([]); // the selected object is gone
    s = reducer(s, { type: 'studioUndo', id: game.id });
    expect(s.items[0].studio).toEqual({ objects: [] });
    s = reducer(s, { type: 'studioRedo', id: game.id });
    s = reducer(s, { type: 'studioRedo', id: game.id });
    expect(s.items[0].studio).toBe(doc2);
  });

  it('merges a run of edits with the same key into one step', () => {
    let s = reducer(initialState, { type: 'addItem', item: game });
    for (let i = 0; i < 5; i++) s = reducer(s, { type: 'studioSet', id: game.id, doc: { objects: [{ ...doc1.objects[0], opacity: i / 5 }] }, coalesce: 'opacity' });
    expect(s.studioHistory[game.id].past).toHaveLength(1);
  });

  it('copies a design to other games, and saves and loads it', () => {
    const other: MediaItem = { ...game, id: 'steam-1145360', title: 'Hades', studio: undefined };
    let s = reducer(initialState, { type: 'addItem', item: game });
    s = reducer(s, { type: 'addItem', item: other });
    s = reducer(s, { type: 'studioSet', id: game.id, doc: doc2 });
    s = reducer(s, { type: 'studioCopyTo', from: game.id, to: [other.id] });
    expect(s.items.find((i) => i.id === other.id)!.studio).toEqual(doc2);
    const back = restoreSession(JSON.parse(JSON.stringify(serializeSession(s))), initialState);
    expect(back.items.find((i) => i.id === game.id)!.studio).toEqual(doc2);
  });
});

describe('holo foil', () => {
  const b = { x: 30, y: 40, w: 20, h: 12 };
  it('starts the holographic sticker as foil, and nothing else', () => {
    expect(makeStamp('gp-holo', b).holo).toBe('light');
    expect(makeStamp('gp-seal', b).holo).toBeUndefined();
  });
  it('finds visible foil in a design, and keeps it through save and load', () => {
    const foil = { ...makeShape('rect', b, '#ffffff'), holo: 'full' as const };
    expect(hasHolo({ ...game, studio: { objects: [makeText('{title}', b)] } })).toBe(false);
    expect(hasHolo({ ...game, studio: { objects: [{ ...foil, hidden: true }] } })).toBe(false);
    const doc: StudioDoc = { objects: [foil], foil: 'glitter' };
    expect(hasHolo({ ...game, studio: doc })).toBe(true);
    let s = reducer(initialState, { type: 'addItem', item: game });
    s = reducer(s, { type: 'studioSet', id: game.id, doc });
    const back = restoreSession(JSON.parse(JSON.stringify(serializeSession(s))), initialState);
    expect(back.items[0].studio).toEqual(doc);
  });
});
