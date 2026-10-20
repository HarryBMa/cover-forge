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
 */

export const KIT_FORMAT = 'pc-gamepak-sleeve';
export const KIT_VERSION = 1;

/** The kit's faces, by the template panel each is cut from. `spine` is the left side as the front faces you. */
export const KIT_FACES = ['front', 'back', 'spine', 'spineRight'] as const satisfies readonly PanelId[];
export type KitFace = (typeof KIT_FACES)[number];

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
}

/** Whether a template's panels make a sleeve kit: the cartridge sleeve has all four faces. */
export function canExportKit(t: TemplateConfig): boolean {
  return t.kind === 'cartridge' && KIT_FACES.every((id) => t.panels.some((p) => p.id === id));
}

/** The kit's description: the faces given (as data URIs) and the item's own words. */
export function buildKit(item: MediaItem, faces: Partial<Record<KitFace, string>>): SleeveKit {
  const s = item.sleeve ?? {};
  const kit: SleeveKit = { format: KIT_FORMAT, version: KIT_VERSION, faces };
  for (const field of TEXT_FIELDS) {
    const value = s[field]?.trim();
    if (value) kit[field] = value;
  }
  if (s.rating && (PEGI_RATINGS as readonly string[]).includes(s.rating)) kit.rating = s.rating;
  if (s.accent && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.accent)) kit.accent = s.accent.toLowerCase();
  return kit;
}

/** Renders the item's sleeve once and downloads its kit as `<title>-sleeve.json`. */
export async function exportGamePakKit(base: SceneBase, item: MediaItem, quality = 0.9): Promise<void> {
  const t = base.template;
  if (!canExportKit(t)) throw new Error('Only the PC GamePak cartridge sleeve makes a sleeve kit.');
  const canvas = await renderItemCanvas(base, item, false);
  const faces: Partial<Record<KitFace, string>> = {};
  for (const id of KIT_FACES) {
    const p = t.panels.find((panel) => panel.id === id)!;
    // The trim only: the launcher's box has no bleed to hide.
    faces[id] = cropCanvas(canvas, p, t.dpiScale).toDataURL('image/jpeg', quality);
  }
  const json = JSON.stringify(buildKit(item, faces), null, 2);
  saveAs(new Blob([json], { type: 'application/json' }), `${slug(item.title)}-sleeve.json`);
}
