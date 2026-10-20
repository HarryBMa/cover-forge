import { StaticCanvas, type FabricObject } from 'fabric';
import type { MediaItem } from '../types/media';
import type { TemplateConfig } from '../types/template';
import type { StudioObject } from '../types/studio';
import { STUDIO_FONTS } from '../types/studio';
import { canvasSizePx } from '../templates';
import { setStudioOverlay } from '../engine/studioCache';
import { buildObject, type BuildCtx } from './fabricObjects';
import { studioOf } from './doc';
import { loadStamps } from './stamps';

/** Loads the typefaces the objects use, so text isn't drawn in a fallback face. */
export async function loadStudioFonts(objs: StudioObject[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const used = new Set(objs.flatMap((o) => (o.kind === 'text' ? [o.font] : [])));
  await Promise.all(
    [...used].map((k) => {
      const f = STUDIO_FONTS[k];
      return f ? document.fonts.load(`${f.italic ? 'italic ' : ''}${f.weight} 32px ${f.family}`).catch(() => null) : null;
    }),
  );
}

/** Builds every visible object of an item's Studio design, as for print (no empty-frame placeholders). */
export async function buildAll(item: MediaItem, template: TemplateConfig, objs = studioOf(item).objects): Promise<FabricObject[]> {
  await Promise.all([loadStamps(), loadStudioFonts(objs)]);
  const ctx: BuildCtx = { U: template.dpiScale, item, editing: false };
  const built = await Promise.all(objs.filter((o) => !o.hidden).map((o) => buildObject(o, ctx)));
  return built.filter((o): o is NonNullable<typeof o> => !!o);
}

/** A transparent canvas of the template's full size (300 DPI) with the item's Studio objects drawn on it. */
export async function renderStudioLayer(item: MediaItem, template: TemplateConfig): Promise<HTMLCanvasElement | null> {
  const objs = studioOf(item).objects;
  if (!objs.length) return null;
  const { width, height } = canvasSizePx(template);
  const el = document.createElement('canvas');
  const sc = new StaticCanvas(el, { width, height, enableRetinaScaling: false, renderOnAddRemove: false });
  for (const fo of await buildAll(item, template, objs)) sc.add(fo);
  sc.renderAll();
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d')!.drawImage(sc.getElement(), 0, 0);
  void sc.dispose();
  return out;
}

/** Renders the item's Studio layer and caches it, so the synchronous cover renderer can draw it. */
export async function prepareStudioOverlay(item: MediaItem, template: TemplateConfig): Promise<void> {
  setStudioOverlay(item, template, await renderStudioLayer(item, template));
}
