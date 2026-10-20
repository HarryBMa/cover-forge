import { writePsd, type Layer, type Psd } from 'ag-psd';
import { FabricImage, StaticCanvas, type FabricObject } from 'fabric';
import type { MediaItem } from '../types/media';
import type { StudioFrame, StudioObject, StudioText } from '../types/studio';
import { STUDIO_FONTS } from '../types/studio';
import { canvasSizePx } from '../templates';
import { paintRect } from '../templates/geometry';
import { preloadItem, renderCover } from '../engine/CanvasRenderer';
import { drawGuides } from '../engine/GuideOverlays';
import { buildObject, loadImageEl, objectImageUrl, shapeObject } from '../studio/fabricObjects';
import { frameCrop, objectLabel, shownText, studioOf } from '../studio/doc';
import { loadStudioFonts } from '../studio/render';
import { getStamp, loadStamps } from '../studio/stamps';
import type { SceneBase } from './rasterExport';

/**
 * A layered Photoshop file of one cover, for finishing by hand:
 *  - Cover: the built-in layout, one layer per panel (front, spines, back, flaps…), cut at the bleed.
 *  - Studio: every Studio object as its own layer, in stacking order. A frame is a group: its shape, with the whole
 *    picture clipped to it (move the picture in Photoshop to recrop). Text is an editable text layer (Photoshop asks to
 *    update it on opening; the fonts are Exo 2, Rajdhani, Orbitron… from Google Fonts) above a hidden copy as drawn.
 *  - Guides (hidden): cut and fold lines.
 * 300 DPI, RGB, at the template's full size including bleed.
 */

type Rendered = { canvas: HTMLCanvasElement; left: number; top: number };

/** Draws one Fabric object on a canvas just big enough for it. */
function renderAlone(fo: FabricObject): Rendered | null {
  fo.setCoords();
  const b = fo.getBoundingRect();
  // Room for a glow, which reaches past the object's box.
  const pad = 2 + (fo.shadow ? Math.ceil(fo.shadow.blur * 1.5 + Math.max(Math.abs(fo.shadow.offsetX), Math.abs(fo.shadow.offsetY))) : 0);
  const left = Math.floor(b.left) - pad;
  const top = Math.floor(b.top) - pad;
  const w = Math.ceil(b.width) + 2 * pad;
  const h = Math.ceil(b.height) + 2 * pad;
  if (w < 1 || h < 1 || w * h > 12000 * 12000) return null;
  const el = document.createElement('canvas');
  const sc = new StaticCanvas(el, { width: w, height: h, enableRetinaScaling: false, renderOnAddRemove: false });
  sc.setViewportTransform([1, 0, 0, 1, -left, -top]);
  sc.add(fo);
  sc.renderAll();
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(sc.getElement(), 0, 0);
  sc.remove(fo);
  void sc.dispose();
  return { canvas: out, left, top };
}

const hexRgb = (hex: string) => {
  const n = parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** An editable Photoshop text layer for a text object (box text, rotated with it). */
function textLayer(o: StudioText, item: MediaItem, U: number, name: string, raster: Rendered | null): Layer {
  const f = STUDIO_FONTS[o.font] ?? STUDIO_FONTS.rajdhani;
  const w = o.w * U;
  const h = Math.max(o.h * U, o.size * U * o.lineHeight);
  const a = (o.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // The box's top-left corner, turned about the centre.
  const tx = o.x * U + (-w / 2) * cos - (-h / 2) * sin;
  const ty = o.y * U + (-w / 2) * sin + (-h / 2) * cos;
  return {
    name,
    opacity: o.opacity,
    ...(raster && { canvas: raster.canvas, left: raster.left, top: raster.top }),
    text: {
      text: shownText(o, item),
      transform: [cos, sin, -sin, cos, tx, ty],
      shapeType: 'box',
      boxBounds: [0, 0, w, h],
      style: {
        font: { name: f.ps },
        fontSize: o.size * U,
        fillColor: hexRgb(o.color),
        tracking: o.spacing,
        autoLeading: false,
        leading: o.size * U * o.lineHeight,
      },
      paragraphStyle: { justification: o.align },
    },
    // The outline and glow as layer styles, so they survive Photoshop redrawing the text.
    ...((o.outline || o.glow) && {
      effects: {
        ...(o.outline && { stroke: [{ enabled: true, present: true, size: { units: 'Pixels' as const, value: o.outline.width * U }, position: 'outside' as const, fillType: 'color' as const, color: hexRgb(o.outline.color), opacity: 1, blendMode: 'normal' as const }] }),
        ...(o.glow && { outerGlow: { enabled: true, present: true, size: { units: 'Pixels' as const, value: o.size * U * 0.6 }, color: hexRgb(o.glow), opacity: 0.75, blendMode: 'screen' as const } }),
      },
    }),
  };
}

/** A frame as Photoshop does it: the shape, and the whole picture above it as a clipping layer. */
async function frameLayers(o: StudioFrame, item: MediaItem, U: number, name: string): Promise<Layer | null> {
  const url = objectImageUrl(o, item);
  const img = url ? await loadImageEl(url) : null;
  if (!img) return null;
  const c = frameCrop(o, img.naturalWidth, img.naturalHeight);
  const k = c.scale * U;
  const lx = (img.naturalWidth / 2 - (c.cropX + c.cropW / 2)) * k;
  const ly = (img.naturalHeight / 2 - (c.cropY + c.cropH / 2)) * k;
  const a = (o.angle * Math.PI) / 180;
  const full = new FabricImage(img, { left: o.x * U + lx * Math.cos(a) - ly * Math.sin(a), top: o.y * U + lx * Math.sin(a) + ly * Math.cos(a), scaleX: k, scaleY: k, angle: o.angle, flipX: !!o.flipX, flipY: !!o.flipY });
  const shape = shapeObject(o.shape, o.w * U, o.h * U, o.radius * U, { left: o.x * U, top: o.y * U, angle: o.angle, fill: '#ffffff' });
  const s = renderAlone(shape);
  const p = renderAlone(full);
  if (!s || !p) return null;
  const children: Layer[] = [
    { name: 'Frame shape', ...s },
    { name: 'Picture (move to recrop)', ...p, clipping: true },
  ];
  if (o.border) {
    const b = renderAlone(shapeObject(o.shape, o.w * U, o.h * U, o.radius * U, { left: o.x * U, top: o.y * U, angle: o.angle, fill: '', stroke: o.border.color, strokeWidth: o.border.width * U }));
    if (b) children.push({ name: 'Border', ...b });
  }
  return { name, opacity: o.opacity, opened: false, children };
}

async function studioLayers(item: MediaItem, U: number, t: SceneBase['template']): Promise<Layer[]> {
  const objs = studioOf(item).objects;
  await Promise.all([loadStamps(), loadStudioFonts(objs)]);
  const layers: Layer[] = [];
  for (const o of objs as StudioObject[]) {
    const name = objectLabel(o, item, (id) => getStamp(id)?.name);
    // A filled frame becomes a clipping group (a fitted logo, which doesn't fill its frame, stays a plain layer).
    if (o.kind === 'frame' && o.image && o.fit !== 'contain') {
      const g = await frameLayers(o, item, U, name);
      if (g) layers.push({ ...g, hidden: !!o.hidden });
      continue;
    }
    const fo = await buildObject(o, { U, item, editing: false });
    if (!fo) continue;
    fo.set({ opacity: 1, visible: true });
    const r = renderAlone(fo);
    if (o.kind === 'text') {
      layers.push({ name: `${name} (as drawn)`, hidden: true, opacity: o.opacity, ...(r ?? {}) });
      layers.push({ ...textLayer(o, item, U, name, r), hidden: !!o.hidden });
      continue;
    }
    if (r) layers.push({ name, opacity: o.opacity, hidden: !!o.hidden, ...r });
  }
  void t;
  return layers;
}

/** Builds the PSD for one item. */
export async function buildItemPsd(base: SceneBase, item: MediaItem): Promise<Blob> {
  const t = base.template;
  const U = t.dpiScale;
  const { width, height } = canvasSizePx(t);
  await preloadItem({ ...base, item, template: t });

  const draw = (opts: { skipStudio: boolean; guides: boolean }) => {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    renderCover(c.getContext('2d')!, { ...base, item, showGuides: opts.guides, skipStudio: opts.skipStudio }, U);
    return c;
  };
  const cover = draw({ skipStudio: true, guides: false });
  const composite = draw({ skipStudio: false, guides: false });

  // The built-in layout, one layer per panel (paint area: trim plus bleed).
  const panels: Layer[] = t.panels.map((p) => {
    const a = paintRect(t, p);
    const left = Math.max(0, Math.floor(a.xMm * U));
    const top = Math.max(0, Math.floor(a.yMm * U));
    const w = Math.min(width - left, Math.ceil((a.xMm + a.widthMm) * U) - left);
    const h = Math.min(height - top, Math.ceil((a.yMm + a.heightMm) * U) - top);
    const c = document.createElement('canvas');
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    c.getContext('2d')!.drawImage(cover, left, top, w, h, 0, 0, w, h);
    return { name: p.label, canvas: c, left, top };
  });

  const guides = document.createElement('canvas');
  guides.width = width;
  guides.height = height;
  drawGuides(guides.getContext('2d')!, t, U);

  const white = document.createElement('canvas');
  white.width = width;
  white.height = height;
  const wg = white.getContext('2d')!;
  wg.fillStyle = '#ffffff';
  wg.fillRect(0, 0, width, height);

  const studio = await studioLayers(item, U, t);
  const psd: Psd = {
    width,
    height,
    canvas: composite,
    imageResources: { resolutionInfo: { horizontalResolution: 300, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: 300, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } },
    children: [
      { name: 'Paper', canvas: white, left: 0, top: 0 },
      { name: 'Cover (built-in layout)', opened: false, children: panels },
      ...(studio.length ? [{ name: 'Studio', opened: true, children: studio }] : []),
      { name: 'Guides (cut and fold)', hidden: true, children: [{ name: 'Cut and fold lines', canvas: guides, left: 0, top: 0 }] },
    ],
  };
  const buf = writePsd(psd, { generateThumbnail: true });
  return new Blob([buf], { type: 'image/vnd.adobe.photoshop' });
}
