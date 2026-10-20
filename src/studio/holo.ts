import { StaticCanvas } from 'fabric';
import type { MediaItem } from '../types/media';
import type { TemplateConfig } from '../types/template';
import { canvasSizePx } from '../templates';
import { buildObject, type BuildCtx } from './fabricObjects';
import { studioOf } from './doc';
import { loadStudioFonts } from './render';
import { loadStamps } from './stamps';

/** Whether an item's Studio design has any visible holo foil. */
export const hasHolo = (item: MediaItem | null | undefined): boolean => !!item && studioOf(item).objects.some((o) => o.holo && !o.hidden);

/**
 * Where the foil shows, over the whole template: white is foil, transparent is print. Objects are laid down in
 * stacking order: a holo object adds its light parts ('light') or its whole shape ('full'); anything above it covers
 * the foil again. Rendered at most `maxPx` on the long side (the 3D view needs no more).
 */
export async function renderHoloMask(item: MediaItem, template: TemplateConfig, maxPx = 2048): Promise<HTMLCanvasElement | null> {
  const objs = studioOf(item).objects.filter((o) => !o.hidden);
  const first = objs.findIndex((o) => o.holo);
  if (first < 0) return null;
  const used = objs.slice(first);
  await Promise.all([loadStamps(), loadStudioFonts(used)]);

  const full = canvasSizePx(template);
  const k = Math.min(1, maxPx / Math.max(full.width, full.height));
  const width = Math.max(1, Math.round(full.width * k));
  const height = Math.max(1, Math.round(full.height * k));
  const sc = new StaticCanvas(document.createElement('canvas'), { width, height, enableRetinaScaling: false, renderOnAddRemove: false });
  sc.setViewportTransform([k, 0, 0, k, 0, 0]);

  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const m = mask.getContext('2d')!;
  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  const t = tmp.getContext('2d')!;

  const ctx: BuildCtx = { U: template.dpiScale, item, editing: false };
  for (const o of used) {
    const fo = await buildObject(o, ctx);
    if (!fo) continue;
    sc.add(fo);
    sc.renderAll();
    const el = sc.getElement();
    if (!o.holo) {
      // Print over the foil hides it.
      m.globalCompositeOperation = 'destination-out';
      m.drawImage(el, 0, 0);
    } else {
      t.globalCompositeOperation = 'copy';
      if (o.holo === 'full') {
        t.drawImage(el, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = '#ffffff';
        t.fillRect(0, 0, width, height);
      } else {
        // Light parts become foil: the object in grey, so white is all foil and black is all ink.
        t.filter = 'grayscale(1)';
        t.drawImage(el, 0, 0);
        t.filter = 'none';
      }
      m.globalCompositeOperation = 'source-over';
      m.drawImage(tmp, 0, 0);
    }
    sc.remove(fo);
  }
  void sc.dispose();
  return mask;
}
