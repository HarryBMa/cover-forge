import type { MediaItem } from '../types/media';
import type { ImageRef } from '../types/editor';
import type { PanelId, PanelRect, TemplateConfig } from '../types/template';
import type { FrameShape, StudioObject } from '../types/studio';
import { paintRect } from '../templates/geometry';
import { sleeveOf } from '../engine/gamepak';
import { makeFrame, makeShape, makeStamp, makeText } from './doc';
import { getStamp } from './stamps';

/**
 * Layout templates: sets of frames, text and stamps placed on a panel in one go, the way Canva's templates start a
 * design. Positions are fractions of the panel, so a layout fits any case size. Frames come pre-filled with the item's
 * pictures (its cover, screenshots…) and text uses `{title}`-style fields, so a layout reads right for every game.
 */

type Box = { x: number; y: number; w: number; h: number };
interface Area {
  /** Trim box (what's seen once cut and folded). */
  trim: Box;
  /** Trim plus bleed on the edges that are cut. */
  paint: Box;
}

export interface LayoutCtx {
  t: TemplateConfig;
  item: MediaItem | null;
}

export interface LayoutDef {
  id: string;
  name: string;
  /** The panels it's made for; 'sleeve' = the whole cover at once. */
  target: 'front' | 'back' | 'spine' | 'sleeve';
  description: string;
  build(ctx: LayoutCtx): StudioObject[];
}

const toBox = (p: { xMm: number; yMm: number; widthMm: number; heightMm: number }): Box => ({ x: p.xMm + p.widthMm / 2, y: p.yMm + p.heightMm / 2, w: p.widthMm, h: p.heightMm });

function area(t: TemplateConfig, p: PanelRect): Area {
  return { trim: toBox(p), paint: toBox(paintRect(t, p)) };
}

/** A box from fractions of another (x0, y0 = top-left; x1, y1 = bottom-right; 0–1). */
export function frac(b: Box, x0: number, y0: number, x1: number, y1: number): Box {
  const L = b.x - b.w / 2;
  const T = b.y - b.h / 2;
  return { x: L + ((x0 + x1) / 2) * b.w, y: T + ((y0 + y1) / 2) * b.h, w: (x1 - x0) * b.w, h: (y1 - y0) * b.h };
}
/** Insets a box by mm on every side. */
const inset = (b: Box, mm: number): Box => ({ ...b, w: b.w - 2 * mm, h: b.h - 2 * mm });

const panel = (t: TemplateConfig, id: PanelId) => t.panels.find((p) => p.id === id);
/** The spine panels, the one with the title first. */
const spines = (t: TemplateConfig) => t.panels.filter((p) => p.id === 'spine' || p.id === 'spineRight').sort((a, b) => Number(!!b.text) - Number(!!a.text));

/** Screenshot refs the item has (the first `n`), falling back to its other pictures. */
function shots(item: MediaItem | null, n: number): ImageRef[] {
  const s = item?.assets.screenshots ?? [];
  const refs: ImageRef[] = s.slice(0, n).map((_, i) => `screenshot:${i}` as ImageRef);
  while (refs.length < n) refs.push(refs.length % 2 ? 'cover' : 'hero');
  return refs;
}

const DARK = '#0b0f26';
const ACCENT = '#6ed7ff';
const SAFE = 2.5;

/** A text object across a box, with a heading style. */
const heading = (text: string, b: Box, size: number, color = '#f5f7fc', extra = {}) => makeText(text, b, { font: 'exo-black', size, color, lineHeight: 1, ...extra });
const body = (text: string, b: Box, size = 2.3, color = '#dbe1ee') => makeText(text, b, { font: 'rajdhani', size, color, lineHeight: 1.15 });

/** A stamp that keeps its own aspect ratio, `w` mm wide, centred on (x, y) — or of height `h` when given. */
function stamp(id: string, x: number, y: number, w: number, h?: number) {
  const def = getStamp(id);
  const ratio = def ? def.h / def.w : 1;
  const W = h !== undefined ? h / ratio : w;
  return makeStamp(id, { x, y, w: W, h: W * ratio }, def?.name);
}

/** The PEGI label for a rating: the official one when it's among the local stamps, else a plain age badge. */
function ratingStamp(rating: string | null, x: number, y: number, h: number) {
  if (!rating) return [];
  const official = getStamp(`local:pegi/pegi-${rating}`);
  if (official) return [stamp(official.id, x, y, 0, h)];
  const generic = getStamp(`badge-${rating}plus`);
  return generic ? [stamp(generic.id, x, y, 0, h * 0.6)] : [];
}

// ------------------------------------------------------------------ front

function frontLayouts(): LayoutDef[] {
  const on = (t: TemplateConfig) => {
    const p = panel(t, 'front');
    return p ? area(t, p) : null;
  };
  return [
    {
      id: 'front-full',
      name: 'Full-bleed art',
      target: 'front',
      description: 'The cover art fills the front, bleed included.',
      build: ({ t }) => {
        const a = on(t);
        return a ? [makeFrame('rect', a.paint, 'cover', 'Front art')] : [];
      },
    },
    {
      id: 'front-art-title',
      name: 'Art + title band',
      target: 'front',
      description: 'Full art with a dark band and the title at the bottom.',
      build: ({ t }) => {
        const a = on(t);
        if (!a) return [];
        const band = frac(a.paint, 0, 0.78, 1, 1);
        return [
          makeFrame('rect', a.paint, 'cover', 'Front art'),
          { ...makeShape('rect', band, DARK, 'Title band'), opacity: 0.85 },
          heading('{title}', frac(inset(a.trim, SAFE), 0, 0.82, 1, 0.94), a.trim.w * 0.085, '#ffffff', { align: 'center', uppercase: true }),
        ];
      },
    },
    {
      id: 'front-inset',
      name: 'Framed art',
      target: 'front',
      description: 'A dark cover with the art in a bordered frame and the title on top.',
      build: ({ t }) => {
        const a = on(t);
        if (!a) return [];
        const f = makeFrame('rounded', frac(inset(a.trim, 4), 0, 0.2, 1, 0.86), 'cover', 'Front art');
        f.border = { color: ACCENT, width: 0.5 };
        return [makeShape('rect', a.paint, DARK, 'Background'), f, heading('{title}', frac(inset(a.trim, 4), 0, 0.03, 1, 0.17), a.trim.w * 0.09, '#ffffff', { align: 'center', uppercase: true })];
      },
    },
    {
      id: 'front-circle',
      name: 'Round window',
      target: 'front',
      description: 'A circular window onto the art, on a coloured background.',
      build: ({ t }) => {
        const a = on(t);
        if (!a) return [];
        const d = a.trim.w * 0.82;
        const c = makeFrame('circle', { x: a.trim.x, y: a.trim.y - a.trim.h * 0.04, w: d, h: d }, 'cover', 'Front art');
        c.border = { color: '#ffffff', width: 0.6 };
        return [makeShape('rect', a.paint, '#1b1f4a', 'Background'), c, heading('{title}', frac(inset(a.trim, 4), 0, 0.8, 1, 0.93), a.trim.w * 0.08, '#ffffff', { align: 'center', uppercase: true })];
      },
    },
    {
      id: 'front-split',
      name: 'Art + screenshot',
      target: 'front',
      description: 'Cover art above, a slanted screenshot strip below.',
      build: ({ t, item }) => {
        const a = on(t);
        if (!a) return [];
        const [s0] = shots(item, 1);
        return [
          makeShape('rect', a.paint, DARK, 'Background'),
          makeFrame('rect', frac(a.paint, 0, 0, 1, 0.66), 'cover', 'Front art'),
          makeFrame('slant', frac(a.paint, -0.05, 0.62, 1.05, 0.84), s0, 'Screenshot'),
          heading('{title}', frac(inset(a.trim, SAFE), 0, 0.86, 1, 0.97), a.trim.w * 0.075, '#ffffff', { align: 'center', uppercase: true }),
        ];
      },
    },
  ];
}

// ------------------------------------------------------------------ back

function backLayouts(): LayoutDef[] {
  const on = (t: TemplateConfig) => {
    const p = panel(t, 'back');
    return p ? area(t, p) : null;
  };
  return [
    {
      id: 'back-rows',
      name: 'Headline + 3 rows',
      target: 'back',
      description: 'Headline, blurb, and three screenshots each with a line of text.',
      build: ({ t, item }) => {
        const a = on(t);
        if (!a) return [];
        const s = inset(a.trim, SAFE + 0.5);
        const shotRefs = shots(item, 3);
        const rows = item ? sleeveOf(item).rows : [];
        const out: StudioObject[] = [
          makeShape('rect', a.paint, DARK, 'Background'),
          heading('{headline}', frac(s, 0, 0, 1, 0.12), s.w * 0.065, '#f5f7fc', { glow: ACCENT }),
          body('{blurb}', frac(s, 0, 0.13, 1, 0.3)),
        ];
        shotRefs.forEach((ref, i) => {
          const y0 = 0.32 + i * 0.17;
          const f = makeFrame('rect', frac(s, 0, y0, 0.42, y0 + 0.15), ref, `Row ${i + 1} picture`);
          f.border = { color: ACCENT, width: 0.25 };
          out.push(f, heading(rows[i]?.title || 'FEATURE', frac(s, 0.46, y0, 1, y0 + 0.05), 2.4, '#ffffff', { uppercase: true }), body(rows[i]?.text || 'One line about it.', frac(s, 0.46, y0 + 0.055, 1, y0 + 0.15), 2.1));
        });
        return out;
      },
    },
    {
      id: 'back-grid',
      name: 'Headline + grid',
      target: 'back',
      description: 'Headline and blurb over a 2×2 grid of screenshots.',
      build: ({ t, item }) => {
        const a = on(t);
        if (!a) return [];
        const s = inset(a.trim, SAFE + 0.5);
        const r = shots(item, 4);
        const g = 0.02;
        return [
          makeShape('rect', a.paint, DARK, 'Background'),
          heading('{headline}', frac(s, 0, 0, 1, 0.12), s.w * 0.065, '#f5f7fc', { glow: ACCENT }),
          body('{blurb}', frac(s, 0, 0.13, 1, 0.32)),
          makeFrame('rounded', frac(s, 0, 0.34, 0.5 - g, 0.56), r[0], 'Screenshot 1'),
          makeFrame('rounded', frac(s, 0.5 + g, 0.34, 1, 0.56), r[1], 'Screenshot 2'),
          makeFrame('rounded', frac(s, 0, 0.58, 0.5 - g, 0.8), r[2], 'Screenshot 3'),
          makeFrame('rounded', frac(s, 0.5 + g, 0.58, 1, 0.8), r[3], 'Screenshot 4'),
        ];
      },
    },
    {
      id: 'back-hero',
      name: 'Hero + strip',
      target: 'back',
      description: 'A wide picture across the top, blurb, and a strip of three screenshots.',
      build: ({ t, item }) => {
        const a = on(t);
        if (!a) return [];
        const s = inset(a.trim, SAFE + 0.5);
        const r = shots(item, 3);
        const g = 0.015;
        return [
          makeShape('rect', a.paint, DARK, 'Background'),
          makeFrame('rect', frac(a.paint, 0, 0, 1, 0.4), 'hero', 'Hero picture'),
          heading('{headline}', frac(s, 0, 0.41, 1, 0.52), s.w * 0.062, '#f5f7fc', { glow: ACCENT }),
          body('{blurb}', frac(s, 0, 0.53, 1, 0.68)),
          ...[0, 1, 2].map((i) => makeFrame('rect', frac(s, i / 3 + (i ? g : 0), 0.7, (i + 1) / 3 - (i < 2 ? g : 0), 0.82), r[i], `Screenshot ${i + 1}`)),
        ];
      },
    },
  ];
}

// ------------------------------------------------------------------ spine

function spineLayouts(): LayoutDef[] {
  const title = (sp: PanelRect, size: number, color = '#ffffff') => {
    const tb = toBox(sp);
    // Turned a quarter clockwise so it reads top to bottom, the convention on a standing box.
    return { ...heading('{title}', { x: tb.x, y: tb.y, w: tb.h * 0.62, h: size * 1.2 }, size, color, { align: 'center', uppercase: true }), angle: 90 };
  };
  return [
    {
      id: 'spine-art',
      name: 'Art spine',
      target: 'spine',
      description: 'The wide art down the spine with the title over it.',
      build: ({ t }) => {
        const sp = spines(t)[0];
        if (!sp) return [];
        const a = area(t, sp);
        return [makeFrame('rect', a.paint, 'hero', 'Spine art'), { ...makeShape('rect', a.paint, '#000000', 'Shade'), opacity: 0.35 }, title(sp, Math.min(sp.widthMm * 0.42, 6))];
      },
    },
    {
      id: 'spine-classic',
      name: 'Stripes spine',
      target: 'spine',
      description: 'A dark spine with colour stripes at the open end, the title, and the planet.',
      build: ({ t }) => {
        const out: StudioObject[] = [];
        spines(t).forEach((sp, i) => {
          const a = area(t, sp);
          const tb = toBox(sp);
          // Stripes across the top (the open end of a cartridge sleeve), running out into the bleed.
          const top = a.paint.y - a.paint.h / 2;
          const bottom = tb.y - tb.h / 2 + 6.6;
          out.push(makeShape('rect', a.paint, DARK, `Spine ${i + 1}`), makeStamp('stripes-flag', { x: a.paint.x, y: (top + bottom) / 2, w: a.paint.w, h: bottom - top }, 'Stripes'));
          if (i === 0) out.push(title(sp, Math.min(sp.widthMm * 0.36, 5.5)));
          out.push(stamp('gp-planet', tb.x, tb.y + tb.h / 2 - 7, Math.min(10, sp.widthMm * 0.6)));
        });
        return out;
      },
    },
  ];
}

// ------------------------------------------------------------------ whole sleeve

function sleeveLayouts(): LayoutDef[] {
  return [
    {
      id: 'sleeve-classic',
      name: 'PC GamePak classic',
      target: 'sleeve',
      description: 'The whole PC GamePak box as editable pieces: art, badges, rating, headline, rows, stripes and spines. Replaces the built-in Branded layout.',
      build: (ctx) => {
        const { t, item } = ctx;
        const s = item ? sleeveOf(item) : null;
        const out: StudioObject[] = [];
        const front = panel(t, 'front');
        if (front) {
          const a = area(t, front);
          const tr = inset(a.trim, SAFE);
          out.push(makeFrame('rect', a.paint, 'cover', 'Front art'));
          const L = tr.x - tr.w / 2;
          const B = tr.y + tr.h / 2;
          out.push(...ratingStamp(s?.rating ?? null, L + 5, B - 6, 12));
          out.push(stamp('badge-pc-games', L + (s?.rating ? 16 : 6), B - 6, 11));
          out.push(stamp('gp-logo', tr.x + tr.w / 2 - 14, B - 3, 26));
        }
        out.push(...spineLayouts()[1].build(ctx));
        const back = backLayouts()[0].build(ctx);
        out.push(...back);
        const bp = panel(t, 'back');
        if (bp) {
          const a = area(t, bp);
          const tr = inset(a.trim, SAFE);
          out.push(makeText('{features}', frac(tr, 0, 0.84, 1, 0.88), { font: 'rajdhani-bold', size: 2.1, color: '#e6ebf5', uppercase: true }));
          out.push(makeStamp('stripes-flag', { ...frac(a.paint, 0, 0.885, 1, 0.915) }, 'Stripes'));
          const L = tr.x - tr.w / 2;
          const R = tr.x + tr.w / 2;
          const B = tr.y + tr.h / 2;
          out.push(stamp('badge-pc-games', L + 5, B - 5, 9.5));
          out.push(stamp('gp-logo', L + 25, B - 7, 22));
          out.push(...ratingStamp(s?.rating ?? null, R - 4.5, B - 5.5, 10));
        }
        const flap = panel(t, 'bottom') ?? panel(t, 'top');
        if (flap) {
          const a = area(t, flap);
          out.push(makeShape('rect', a.paint, DARK, 'Flap'), { ...makeFrame('rect', inset(a.trim, 2), 'logo', 'Flap logo'), fit: 'contain' as const });
        }
        return out;
      },
    },
  ];
}

export const LAYOUTS: LayoutDef[] = [...sleeveLayouts(), ...frontLayouts(), ...backLayouts(), ...spineLayouts()];

/** Layouts that fit a template: they need the panels they're for. */
export function layoutsFor(t: TemplateConfig): LayoutDef[] {
  const has = (id: PanelId) => t.panels.some((p) => p.id === id);
  return LAYOUTS.filter((l) => (l.target === 'sleeve' ? has('front') && has('back') : l.target === 'spine' ? has('spine') : has(l.target)));
}

/** Frame shapes offered on their own, to drop anywhere. */
export const FRAME_PRESETS: { shape: FrameShape; name: string; ratio: number }[] = [
  { shape: 'rect', name: 'Square', ratio: 1 },
  { shape: 'rect', name: 'Landscape', ratio: 9 / 16 },
  { shape: 'rect', name: 'Portrait', ratio: 4 / 3 },
  { shape: 'rounded', name: 'Rounded', ratio: 9 / 16 },
  { shape: 'circle', name: 'Circle', ratio: 1 },
  { shape: 'hexagon', name: 'Hexagon', ratio: 0.87 },
  { shape: 'slant', name: 'Slanted', ratio: 0.45 },
  { shape: 'diamond', name: 'Diamond', ratio: 1 },
  { shape: 'star', name: 'Star', ratio: 1 },
  { shape: 'triangle', name: 'Triangle', ratio: 0.87 },
];

/** Text presets for the Text tab. */
export const TEXT_PRESETS = [
  { id: 'title', name: 'Title', text: '{title}', style: { font: 'exo-black' as const, size: 7, uppercase: true, lineHeight: 1 }, w: 60 },
  { id: 'headline', name: 'Headline', text: 'HEADLINE', style: { font: 'exo-black' as const, size: 4.5, glow: ACCENT, lineHeight: 1 }, w: 60 },
  { id: 'subheading', name: 'Subheading', text: 'Subheading', style: { font: 'rajdhani-bold' as const, size: 3.2, uppercase: true, spacing: 80 }, w: 50 },
  { id: 'body', name: 'Body text', text: 'A few lines about the game. Double-click to edit.', style: { font: 'rajdhani' as const, size: 2.3 }, w: 55 },
  { id: 'quote', name: 'Quote', text: '“A STUNNING RIDE. 10/10”\n— PC GAMER', style: { font: 'exo-black' as const, size: 2.8, lineHeight: 1.15 }, w: 45 },
  { id: 'retro', name: 'Retro pixel', text: 'PRESS START', style: { font: 'pixel' as const, size: 2.6, color: '#facd28' }, w: 45 },
  { id: 'scifi', name: 'Sci-fi', text: 'SECTOR 7', style: { font: 'orbitron' as const, size: 4, spacing: 120, color: '#6ed7ff' }, w: 50 },
  { id: 'poster', name: 'Poster', text: 'BIG TITLE', style: { font: 'anton' as const, size: 8, uppercase: true }, w: 55 },
];
