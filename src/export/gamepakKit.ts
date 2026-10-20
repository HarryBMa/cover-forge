import { saveAs } from 'file-saver';
import type { MediaItem } from '../types/media';
import type { PanelId, TemplateConfig } from '../types/template';
import { PEGI_RATINGS } from '../types/sleeve';
import { cropCanvas, renderItemCanvas, type SceneBase } from './rasterExport';
import { slug } from './zipExport';

/**
 * A PC GamePak sleeve kit: the sleeve's faces cut from the flat render, and its words, for the PC GamePak launcher's
 * TV mode to build the box in 3D (pc-gamepak, core/src/sleeve.rs). One JSON file with each face inlined as a data URI,
 * so it travels as a single download; the PC GamePak wizard unpacks it onto a cartridge (Edit → Sleeve).
 *
 * Only words the item actually has go in: sleeveOf's defaults (the title as headline, "1 PLAYER · WINDOWS") fill a
 * printed box, but a launcher showing them would be showing words nobody wrote.
 *
 * Holo foil (Studio objects marked holo) travels as a mask per face, cut from the same sheet as the art: white and
 * opaque where the foil shows, transparent elsewhere, with the design's foil style. The faces carry the sticker as
 * printed; the launcher lays its own shimmer over them through the masks.
 */

export const KIT_FORMAT = 'pc-gamepak-sleeve';
export const KIT_VERSION = 1;

/** The kit's faces, by the template panel each is cut from. `spine` is the left side as the front faces you. */
export const KIT_FACES = ['front', 'back', 'spine', 'spineRight'] as const satisfies readonly PanelId[];
export type KitFace = (typeof KIT_FACES)[number];

const FOIL_STYLES = ['silver', 'oil', 'glitter', 'pastel'] as const;
export type KitFoilStyle = (typeof FOIL_STYLES)[number];

/** Where the holo foil shows on each face that has any, and how it looks. */
export interface KitFoil extends Partial<Record<KitFace, string>> {
  style: KitFoilStyle;
}

const TEXT_FIELDS = ['tagline', 'headline', 'blurb', 'features', 'descriptor', 'legal'] as const;

export interface SleeveKit {
  format: typeof KIT_FORMAT;
  version: typeof KIT_VERSION;
  faces: Partial<Record<KitFace, string>>;
  tagline?: string;
  headline?: string;
  blurb?: string;
  features?: string;
  rating?: string;
  descriptor?: string;
  accent?: string;
  legal?: string;
  foil?: KitFoil;
}

/** Whether a template's panels make a sleeve kit: the cartridge sleeve has all four faces. */
export function canExportKit(t: TemplateConfig): boolean {
  return t.kind === 'cartridge' && KIT_FACES.every((id) => t.panels.some((p) => p.id === id));
}

/** The kit's description: the faces given (as data URIs), the item's own words, and its foil masks if it has any. */
export function buildKit(item: MediaItem, faces: Partial<Record<KitFace, string>>, foilMasks: Partial<Record<KitFace, string>> = {}): SleeveKit {
  const s = item.sleeve ?? {};
  const kit: SleeveKit = { format: KIT_FORMAT, version: KIT_VERSION, faces };
  for (const field of TEXT_FIELDS) {
    const value = s[field]?.trim();
    if (value) kit[field] = value;
  }
  if (s.rating && (PEGI_RATINGS as readonly string[]).includes(s.rating)) kit.rating = s.rating;
  if (s.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.accent)) kit.accent = s.accent.toLowerCase();
  if (Object.keys(foilMasks).length) {
    const style = item.studio?.foil;
    kit.foil = { style: style && (FOIL_STYLES as readonly string[]).includes(style) ? style : 'pastel', ...foilMasks };
  }
  return kit;
}

/** Renders the item's sleeve once and downloads its kit as `<title>-sleeve.json`. */
export async function exportGamePakKit(base: SceneBase, item: MediaItem, quality = 0.9): Promise<void> {
  const t = base.template;
  if (!canExportKit(t)) throw new Error('Only the PC GamePak cartridge sleeve makes a sleeve kit.');
  const canvas = await renderItemCanvas(base, item, false);
  const { hasHolo, renderHoloMask } = await import('../studio/holo');
  // The same size as the art, so a face's mask is cut from the same rectangle.
  const holo = hasHolo(item) ? await renderHoloMask(item, t, Math.max(canvas.width, canvas.height)) : null;
  const faces: Partial<Record<KitFace, string>> = {};
  const foil: Partial<Record<KitFace, string>> = {};
  for (const id of KIT_FACES) {
    const p = t.panels.find((panel) => panel.id === id)!;
    // The trim only: the launcher's box has no bleed to hide.
    faces[id] = cropCanvas(canvas, p, t.dpiScale).toDataURL('image/jpeg', quality);
    const mask = holo && alphaMask(cropCanvas(holo, p, t.dpiScale));
    if (mask) foil[id] = mask.toDataURL('image/png');
  }
  const json = JSON.stringify(buildKit(item, faces, foil), null, 2);
  saveAs(new Blob([json], { type: 'application/json' }), `${slug(item.title)}-sleeve.json`);
}

/**
 * The holo mask as an alpha mask: white everywhere, opaque as far as the foil shows (renderHoloMask's red times its
 * alpha), which is what a CSS mask reads. `null` for a face with no foil on it.
 */
export function alphaMask(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!;
  const img = ctx.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  let any = false;
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.round((d[i] * d[i + 3]) / 255);
    any ||= a > 8;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = a;
  }
  if (!any) return null;
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  out.getContext('2d')!.putImageData(img, 0, 0);
  return out;
}
