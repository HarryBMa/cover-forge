import type { MediaItem } from '../types/media';
import type { PanelRect, TemplateConfig } from '../types/template';
import type { ImageRef } from '../types/editor';
import { MAX_SLEEVE_ROWS, type PegiRating, type SleeveCopy, type SleeveRow } from '../types/sleeve';
import { resolveImageRef } from './imageLibrary';
import { paintRect } from '../templates/geometry';

/**
 * The PC GamePak sleeve: the cartridge template's Branded layout, drawn in the style of a classic PC big box. The
 * front gets a title logo and tagline over the cover art, a PEGI label and a PC badge; each spine a band of colour
 * stripes at the open end (the thumb notch cuts through it), a PC badge, and the rating and PC-GAMEPAK mark at the
 * closed end; the back a headline, blurb, feature rows with screenshots, a features line, a stripe rule and a footer.
 * The words and pictures come from the item (see SleeveCopy), so editing a sleeve is editing text and picking images.
 */

/** The six colour bars of the PC-GAMEPAK mark. */
export const GAMEPAK_STRIPES = ['#e83246', '#f78c1e', '#facd28', '#3cb95a', '#1e96eb', '#8c50c8'];

const LOGO_FONT = '"Exo 2", "Arial Black", Impact, sans-serif';
const TEXT_FONT = 'Rajdhani, "Arial Narrow", Helvetica, Arial, sans-serif';
/** Keep text and logos this far inside the trim. */
const SAFE_MM = 2.5;
const PEGI_COLOR: Record<PegiRating, string> = { '3': '#56b947', '7': '#56b947', '12': '#f6a41b', '16': '#f6a41b', '18': '#e2001a' };

/** Where the spine title may run: clear of the stripes and badge at the top and the rating and mark at the bottom. */
export const GAMEPAK_TITLE_FROM = 0.22;

/** The item's sleeve with every unset field defaulted: a new game already reads like a box. */
export function sleeveOf(item: MediaItem): SleeveCopy {
  const s = item.sleeve ?? {};
  const shots: SleeveRow[] = item.assets.screenshots.slice(0, MAX_SLEEVE_ROWS).map((_, i) => ({ image: `screenshot:${i}`, logo: null, title: '', text: '' }));
  return {
    titleLogo: s.titleLogo !== undefined ? s.titleLogo : null,
    tagline: s.tagline ?? '',
    headline: s.headline ?? item.title.toUpperCase(),
    blurb: s.blurb ?? '',
    rows: (s.rows ?? shots).slice(0, MAX_SLEEVE_ROWS),
    features: s.features ?? '1 PLAYER  ·  WINDOWS',
    rating: s.rating !== undefined ? s.rating : null,
    descriptor: s.descriptor ?? '',
    footerLogos: s.footerLogos ?? [],
    legal: s.legal ?? '',
    accent: s.accent ?? '#6ed7ff',
  };
}

/** Every image the sleeve draws, so they can be loaded before a render. */
export function sleeveImageUrls(item: MediaItem): string[] {
  const s = sleeveOf(item);
  // 'logo' too: the flap and outer spine fall back to the item's own logo.
  const refs: (ImageRef | null)[] = [s.titleLogo, 'logo', ...s.rows.flatMap((r) => [r.image, r.logo]), ...s.footerLogos];
  return refs.flatMap((r) => {
    const url = r ? resolveImageRef(item, r) : null;
    return url ? [url] : [];
  });
}

/** The sleeve's typefaces (bundled, see main.tsx), loaded before a render so the canvas doesn't fall back. */
export function loadGamePakFonts(): Promise<unknown> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all(['italic 900 20px "Exo 2"', '500 20px Rajdhani', '600 20px Rajdhani', '700 20px Rajdhani'].map((f) => document.fonts.load(f).catch(() => null)));
}

type Img = HTMLImageElement;
type Lookup = (url: string | null | undefined) => Img | null;

interface Pen {
  ctx: CanvasRenderingContext2D;
  px: number;
}

const font = (size: number, px: number, family: string, weight: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size * px}px ${family}`;

/** Splits text into lines no wider than `widthMm` (explicit line breaks are kept). */
export function wrapText(measure: (s: string) => number, text: string, widthMm: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && measure(next) > widthMm) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
  }
  return out;
}

function lines({ ctx, px }: Pen, text: string, widthMm: number): string[] {
  return wrapText((s) => ctx.measureText(s).width / px, text, widthMm);
}

/** Draws an image fitted (`contain`) or cropped to fill (`cover`) a box, in mm. */
function drawImage({ ctx, px }: Pen, img: Img, x: number, y: number, w: number, h: number, mode: 'contain' | 'cover', align: 'left' | 'center' | 'right' = 'center'): { w: number; h: number } {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return { w: 0, h: 0 };
  const k = mode === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  const dx = mode === 'cover' || align === 'center' ? x + (w - dw) / 2 : align === 'right' ? x + w - dw : x;
  ctx.save();
  if (mode === 'cover') {
    ctx.beginPath();
    ctx.rect(x * px, y * px, w * px, h * px);
    ctx.clip();
  }
  ctx.drawImage(img, dx * px, (y + (h - dh) / 2) * px, dw * px, dh * px);
  ctx.restore();
  return { w: dw, h: dh };
}

/**
 * A logo that reads on the dark footer: its dark parts (black lettering) are turned white and its colours kept, so a
 * black-and-orange mark becomes white-and-orange and a red-and-white one stays as it is. Cached per image.
 */
const footerCache = new WeakMap<Img, CanvasImageSource>();
function onDark(img: Img): CanvasImageSource {
  const hit = footerCache.get(img);
  if (hit) return hit;
  if (typeof document === 'undefined') return img;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g || !c.width || !c.height) return img;
  g.drawImage(img, 0, 0);
  try {
    const pixels = g.getImageData(0, 0, c.width, c.height);
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] && 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2] < 70) d[i] = d[i + 1] = d[i + 2] = 255;
    }
    g.putImageData(pixels, 0, 0);
  } catch {
    footerCache.set(img, img); // a cross-origin image can't be read: it is drawn as it is
    return img;
  }
  footerCache.set(img, c);
  return c;
}

/** Stacked horizontal colour bars filling a box (the VHS-label rule). */
function stripeBand({ ctx, px }: Pen, x: number, y: number, w: number, h: number) {
  const bh = h / GAMEPAK_STRIPES.length;
  GAMEPAK_STRIPES.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(x * px, (y + i * bh) * px, w * px, Math.ceil(bh * px));
  });
}

/** The slanted colour bars of the PC-GAMEPAK mark, `h` tall from (x, y). Returns its width. */
function stripeMark({ ctx, px }: Pen, x: number, y: number, h: number): number {
  const bar = h * 0.16;
  const gap = h * 0.035;
  const off = h * 0.45;
  GAMEPAK_STRIPES.forEach((c, i) => {
    const bx = x + i * (bar + gap);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo((bx + off) * px, y * px);
    ctx.lineTo((bx + off + bar) * px, y * px);
    ctx.lineTo((bx + bar) * px, (y + h) * px);
    ctx.lineTo(bx * px, (y + h) * px);
    ctx.closePath();
    ctx.fill();
  });
  return GAMEPAK_STRIPES.length * (bar + gap) + off;
}

/** The PC-GAMEPAK logo: the colour bars and the wordmark, `h` tall with its top at `y`. Returns its width. */
function gamepakLogo(pen: Pen, x: number, y: number, h: number, align: 'left' | 'right' = 'left'): number {
  const { ctx, px } = pen;
  ctx.save();
  ctx.font = font(h * 1.02, px, LOGO_FONT, 900, true);
  const tw = ctx.measureText('PC-GAMEPAK').width / px;
  const markW = h * 1.43;
  const total = markW + h * 0.18 + tw;
  const x0 = align === 'right' ? x - total : x;
  stripeMark(pen, x0, y, h);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('PC-GAMEPAK', (x0 + markW + h * 0.18) * px, (y + h) * px);
  ctx.restore();
  return total;
}

/** A PEGI age label `h` tall: the coloured square with the age, and the pegi.info strip under it. Returns its width. */
function pegiBadge({ ctx, px }: Pen, rating: PegiRating, x: number, y: number, h: number): number {
  const w = h * 0.82;
  const strip = h * 0.2;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x * px, y * px, w * px, h * px);
  ctx.fillStyle = PEGI_COLOR[rating];
  const m = h * 0.03;
  ctx.fillRect((x + m) * px, (y + m) * px, (w - 2 * m) * px, (h - strip - m) * px);
  ctx.fillStyle = '#000000';
  ctx.fillRect((x + m) * px, (y + h - strip) * px, (w - 2 * m) * px, (strip - m) * px);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font(h * (rating.length > 1 ? 0.56 : 0.62), px, 'Helvetica, Arial, sans-serif', 800);
  ctx.fillText(rating, (x + w / 2) * px, (y + (h - strip) / 2 + h * 0.03) * px);
  ctx.font = font(strip * 0.55, px, 'Helvetica, Arial, sans-serif', 600);
  ctx.fillText('www.pegi.info', (x + w / 2) * px, (y + h - strip / 2 - m / 2) * px);
  ctx.restore();
  return w;
}

/** A "PC GAMES" platform badge `h` tall (black, white lettering, a white rule). Returns its width. */
function pcBadge({ ctx, px }: Pen, x: number, y: number, h: number): number {
  const w = h * 1.02;
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.fillRect(x * px, y * px, w * px, h * px);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(h * 0.56, px, '"Arial Black", Helvetica, Arial, sans-serif', 900);
  ctx.fillText('PC', (x + w / 2) * px, (y + h * 0.56) * px);
  ctx.fillRect((x + w * 0.1) * px, (y + h * 0.64) * px, w * 0.8 * px, h * 0.05 * px);
  ctx.font = font(h * 0.22, px, '"Arial Black", Helvetica, Arial, sans-serif', 900);
  ctx.fillText('GAMES', (x + w / 2) * px, (y + h * 0.93) * px);
  ctx.restore();
  return w;
}

function glowText(pen: Pen, text: string, x: number, y: number, glow: string | null, fill: string) {
  const { ctx, px } = pen;
  ctx.save();
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 0.6 * px;
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x * px, y * px);
  ctx.restore();
}

function clipTo({ ctx, px }: Pen, t: TemplateConfig, p: PanelRect) {
  const a = paintRect(t, p);
  ctx.beginPath();
  ctx.rect(a.xMm * px, a.yMm * px, a.widthMm * px, a.heightMm * px);
  ctx.clip();
}

function drawFront(pen: Pen, p: PanelRect, s: SleeveCopy, image: (r: ImageRef | null) => Img | null) {
  const { ctx, px } = pen;
  const x0 = p.xMm + SAFE_MM;
  const x1 = p.xMm + p.widthMm - SAFE_MM;
  const y1 = p.yMm + p.heightMm - SAFE_MM;
  let y = p.yMm + 5.5;
  const logo = image(s.titleLogo);
  if (logo) y += drawImage(pen, logo, x0 + 3.5, y, x1 - x0 - 7, 13, 'contain').h + 2.6;
  if (s.tagline) {
    ctx.save();
    ctx.font = font(2.6, px, TEXT_FONT, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const line of lines(pen, s.tagline.toUpperCase(), x1 - x0)) {
      glowText(pen, line, (x0 + x1) / 2, y, s.accent, '#ebf5ff');
      y += 2.9;
    }
    ctx.restore();
  }
  // Classic European corner: the rating, then the platform badge; the PC-GAMEPAK mark bottom right.
  const bh = 11.8;
  let bx = x0 + 0.5;
  if (s.rating) bx += pegiBadge(pen, s.rating, bx, y1 - 0.7 - bh, bh) + 1.35;
  pcBadge(pen, bx, y1 - 0.7 - bh, bh);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 0.8 * px;
  gamepakLogo(pen, x1 - 0.7, y1 - 1.9 - 2.9, 2.9, 'right');
  ctx.font = font(2.0, px, TEXT_FONT, 700);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(235,238,245,0.9)';
  ctx.fillText('A PC-GAMEPAK CLASSIC', (x1 - 0.7) * px, (y1 - 1.9 - 2.9 - 0.7) * px);
  ctx.restore();
}

/** The outer spine (no title text of its own): the logos stacked along it, reading top to bottom. */
function drawSpineLogos(pen: Pen, p: PanelRect, s: SleeveCopy, image: (r: ImageRef | null) => Img | null) {
  const { ctx, px } = pen;
  const list = sleeveLogos(s, image);
  if (!list.length) return;
  const across = p.widthMm - 2 * SAFE_MM - 1;
  const from = p.yMm + p.heightMm * GAMEPAK_TITLE_FROM;
  const room = p.heightMm * (1 - 2 * GAMEPAK_TITLE_FROM);
  const gap = 3.4;
  // Each logo turned a quarter clockwise, as large as the spine's width allows, then all scaled to fit the length.
  const sizes = list.map((img) => {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const k = across / ih;
    return { img, len: iw * k, th: across };
  });
  const total = sizes.reduce((a, b) => a + b.len, 0) + gap * (sizes.length - 1);
  const k = Math.min(1, room / total);
  let y = from + (room - total * k) / 2;
  for (const { img, len, th } of sizes) {
    const L = len * k;
    const T = th * k;
    ctx.save();
    ctx.translate((p.xMm + p.widthMm / 2) * px, (y + L / 2) * px);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, (-L / 2) * px, (-T / 2) * px, L * px, T * px);
    ctx.restore();
    y += L + gap * k;
  }
}

function drawSpine(pen: Pen, t: TemplateConfig, p: PanelRect, s: SleeveCopy) {
  const { ctx, px } = pen;
  const a = paintRect(t, p);
  const cx = p.xMm + p.widthMm / 2;
  // The open end: colour stripes running out into the bleed; the thumb notch is cut through them.
  stripeBand(pen, a.xMm, a.yMm, a.widthMm, p.yMm - a.yMm + 6.6);
  const bw = Math.min(10, p.widthMm - 2 * SAFE_MM);
  pcBadge(pen, cx - (bw * 1.02) / 2, p.yMm + 6.6 + 1.9, bw);
  // The closed end: the rating over the PC-GAMEPAK mark.
  const base = p.yMm + p.heightMm - SAFE_MM - 0.2;
  ctx.save();
  ctx.font = font(1.6, px, LOGO_FONT, 900, true);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#f0f2f8';
  ctx.fillText('PC-GAMEPAK', cx * px, base * px);
  ctx.restore();
  const mh = 3.4;
  stripeMark(pen, cx - (mh * 1.43) / 2, base - 2.2 - mh, mh);
  if (s.rating) {
    const h = 7.1 / 0.82;
    pegiBadge(pen, s.rating, cx - 7.1 / 2, base - 2.2 - mh - 1.2 - h, h);
  }
}

function drawBack(pen: Pen, t: TemplateConfig, p: PanelRect, s: SleeveCopy, image: (r: ImageRef | null) => Img | null) {
  const { ctx, px } = pen;
  const a = paintRect(t, p);
  // A dark scrim over whatever the back shows, so the words read: the art becomes a backdrop.
  const g = ctx.createLinearGradient(0, a.yMm * px, 0, (a.yMm + a.heightMm) * px);
  g.addColorStop(0, 'rgba(4,6,22,0.45)');
  g.addColorStop(1, 'rgba(4,6,22,0.85)');
  ctx.fillStyle = g;
  ctx.fillRect(a.xMm * px, a.yMm * px, a.widthMm * px, a.heightMm * px);

  const x0 = p.xMm + SAFE_MM;
  const w = p.widthMm - 2 * SAFE_MM;
  const bottom = p.yMm + p.heightMm - SAFE_MM;
  let y = p.yMm + SAFE_MM + 0.7;

  // Headline: white, the last line in the accent colour.
  ctx.save();
  ctx.font = font(4.75, px, LOGO_FONT, 900, true);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const head = lines(pen, s.headline, w);
  head.forEach((line, i) => glowText(pen, line, x0, y + i * 4.75, s.accent, head.length > 1 && i === head.length - 1 ? s.accent : '#f5f7fc'));
  y += head.length * 4.75 + (head.length ? 1.5 : 0);
  ctx.font = font(2.3, px, TEXT_FONT, 500);
  ctx.fillStyle = '#cdd4e1';
  for (const line of lines(pen, s.blurb, w)) {
    ctx.fillText(line, x0 * px, y * px);
    y += 2.45;
  }
  if (s.blurb) y += 1.4;
  ctx.restore();

  // Footer, from the bottom up: small print, then the badges and logos, then a colour rule and the features line.
  ctx.save();
  ctx.font = font(1.45, px, TEXT_FONT, 500);
  const legal = lines(pen, s.legal, w);
  ctx.restore();
  const legalTop = bottom - legal.length * 1.55;
  const rowH = 9.5;
  const footTop = legalTop - (legal.length ? 1.2 : 0) - rowH;
  const ruleH = 3;
  const ruleTop = footTop - 1.5 - ruleH;
  const featTop = ruleTop - 1.3 - 2.3;

  ctx.save();
  ctx.font = font(1.45, px, TEXT_FONT, 500);
  ctx.fillStyle = '#96a0b4';
  ctx.textBaseline = 'top';
  legal.forEach((line, i) => ctx.fillText(line, x0 * px, (legalTop + i * 1.55) * px));
  ctx.restore();

  const badge = pcBadge(pen, x0, footTop, rowH);
  const lx = x0 + badge + 2;
  gamepakLogo(pen, lx, footTop + 0.3, 2.55);
  let fx = lx;
  for (const ref of s.footerLogos) {
    const img = image(ref);
    if (!img) continue;
    const sil = onDark(img) as unknown as Img;
    fx += drawImage(pen, sil, fx, footTop + rowH - 4.2, 12.7, 4.2, 'contain', 'left').w + 1.9;
  }
  if (s.rating) {
    const pw = pegiBadge(pen, s.rating, x0 + w - rowH * 0.82, footTop, rowH);
    if (s.descriptor) {
      ctx.save();
      ctx.font = font(1.9, px, TEXT_FONT, 600);
      ctx.fillStyle = '#bec6d7';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s.descriptor, (x0 + w - pw - 1.2) * px, (footTop + rowH) * px);
      ctx.restore();
    }
  }

  stripeBand(pen, a.xMm, ruleTop, a.widthMm, ruleH);

  if (s.features) {
    ctx.save();
    ctx.font = font(2.15, px, TEXT_FONT, 600);
    ctx.fillStyle = '#e6ebf5';
    ctx.textBaseline = 'top';
    ctx.fillText(s.features.toUpperCase(), x0 * px, featTop * px, w * px);
    ctx.restore();
  }

  // Feature rows (or a strip of screenshots) fill what's left between the blurb and the features line.
  const area = featTop - 1.2 - y;
  const filled = s.rows.filter((r) => r.logo || r.title || r.text);
  if (area <= 4) return;
  if (filled.length === 0) {
    const shots = s.rows.map((r) => image(r.image)).filter((i): i is Img => !!i);
    if (!shots.length) return;
    const gap = 1.2;
    const sw = (w - gap * (shots.length - 1)) / shots.length;
    const sh = Math.min(area, sw * 0.5625);
    shots.forEach((img, i) => frame(pen, img, x0 + i * (sw + gap), y, sw, sh, s.accent));
    return;
  }
  const rh = Math.min(15.7, area / filled.length);
  const ih = rh - 1.2;
  const iw = Math.min(ih * 1.78, w * 0.42);
  filled.forEach((row, i) => {
    const ry = y + i * rh;
    const shot = image(row.image);
    const hasShot = !!shot;
    if (shot) frame(pen, shot, x0, ry + 0.6, iw, ih, s.accent);
    const tx = hasShot ? x0 + iw + 1.9 : x0;
    const tw = x0 + w - tx;
    let ty = ry + 0.7;
    const logo = image(row.logo);
    if (logo) ty += drawImage(pen, logo, tx, ty, Math.min(tw, 25.4), 5.4, 'contain', 'left').h + 0.7;
    else if (row.title) {
      ctx.save();
      ctx.font = font(2.6, px, LOGO_FONT, 900, true);
      ctx.fillStyle = '#f5f7fc';
      ctx.textBaseline = 'top';
      ctx.fillText(row.title.toUpperCase(), tx * px, ty * px, tw * px);
      ctx.restore();
      ty += 3.3;
    }
    ctx.save();
    ctx.font = font(2.1, px, TEXT_FONT, 500);
    ctx.fillStyle = '#e1e6f0';
    ctx.textBaseline = 'top';
    for (const line of lines(pen, row.text, tw)) {
      if (ty + 2.2 > ry + rh) break;
      ctx.fillText(line, tx * px, ty * px);
      ty += 2.2;
    }
    ctx.restore();
  });
}

/** A screenshot cropped to a box with a thin accent frame. */
function frame(pen: Pen, img: Img, x: number, y: number, w: number, h: number, accent: string) {
  const { ctx, px } = pen;
  const f = 0.25;
  ctx.fillStyle = accent;
  ctx.fillRect(x * px, y * px, w * px, h * px);
  drawImage(pen, img, x + f, y + f, w - 2 * f, h - 2 * f, 'cover');
}

/** The logos the flap and the outer spine show: the rows' logos, else the title logo, else the item's own logo. */
function sleeveLogos(s: SleeveCopy, image: (r: ImageRef | null) => Img | null): Img[] {
  const logos = s.rows.map((r) => image(r.logo)).filter((i): i is Img => !!i);
  if (logos.length) return logos;
  return [image(s.titleLogo) ?? image('logo')].filter((i): i is Img => !!i);
}

/** The closed end's flap: the logos side by side. */
function drawFlap(pen: Pen, p: PanelRect, s: SleeveCopy, image: (r: ImageRef | null) => Img | null) {
  const list = sleeveLogos(s, image);
  if (!list.length) return;
  const gap = 2.5;
  const cw = (p.widthMm - 2 * SAFE_MM - gap * (list.length - 1)) / list.length;
  const ch = p.heightMm - 2 * SAFE_MM - 1.7;
  list.forEach((img, i) => drawImage(pen, img, p.xMm + SAFE_MM + i * (cw + gap), p.yMm + (p.heightMm - ch) / 2, cw, ch, 'contain'));
}

/** Draws the PC GamePak layout for an item (the cartridge template with Branded on). */
export function drawGamePak(ctx: CanvasRenderingContext2D, t: TemplateConfig, item: MediaItem, px: number, getImage: Lookup): void {
  if (t.kind !== 'cartridge') return;
  const s = sleeveOf(item);
  const image = (r: ImageRef | null) => (r ? getImage(resolveImageRef(item, r)) : null);
  const pen: Pen = { ctx, px };
  for (const p of t.panels) {
    if (p.follows) continue;
    ctx.save();
    clipTo(pen, t, p);
    if (p.id === 'front') drawFront(pen, p, s, image);
    else if (p.id === 'back') drawBack(pen, t, p, s, image);
    else if (p.id === 'spine' || p.id === 'spineRight') {
      drawSpine(pen, t, p, s);
      if (!p.text) drawSpineLogos(pen, p, s, image);
    }
    else if (p.id === 'bottom') drawFlap(pen, p, s, image);
    ctx.restore();
  }
}
