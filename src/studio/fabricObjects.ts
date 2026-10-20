import { Ellipse, FabricImage, FabricObject, FabricText, Group, Polygon, Rect, Shadow, Textbox, util } from 'fabric';
import type { MediaItem } from '../types/media';
import type { FrameShape, StudioFrame, StudioObject, StudioShape, StudioText } from '../types/studio';
import { STUDIO_FONTS } from '../types/studio';
import { resolveImageRef } from '../engine/imageLibrary';
import { srcOf } from '../storage/localImages';
import { frameCrop, shapePoints, shownText } from './doc';
import { getStamp, stampSrc } from './stamps';

/**
 * Turns Studio objects into Fabric objects, for the editor and for rendering. Coordinates are canvas pixels at
 * `U` px per mm; every object is placed by its centre (Fabric 7's default origin).
 */

export interface BuildCtx {
  /** Pixels per mm. */
  U: number;
  item: MediaItem | null;
  /** The editor shows empty frames as drop targets; renders leave them out. */
  editing: boolean;
}

/** The Studio id on a Fabric object, and the model it was built from (to tell when it needs rebuilding). */
export interface Tagged {
  cfId?: string;
  cfModel?: StudioObject;
}
export type CfObject = FabricObject & Tagged;

// ------------------------------------------------------------------ images

const images = new Map<string, Promise<HTMLImageElement | null>>();
/** Loads an image once (CORS-enabled, so canvases stay exportable). */
export function loadImageEl(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

const tinted = new Map<string, HTMLCanvasElement>();
/** The image filled with one colour where it isn't transparent (a recoloured stamp). */
function tint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const key = `${img.src}|${color}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  tinted.set(key, c);
  return c;
}

/** The URL an object's picture comes from for this item, if any. */
export function objectImageUrl(o: StudioObject, item: MediaItem | null): string | null {
  if (o.kind === 'stamp') {
    const def = getStamp(o.stamp);
    return def ? stampSrc(def) : null;
  }
  const ref = o.kind === 'image' ? o.image : o.kind === 'frame' ? o.image : null;
  const url = item && ref ? resolveImageRef(item, ref) : null;
  return url ? srcOf(url) ?? url : null;
}

// ------------------------------------------------------------------ shapes

/** A Fabric shape of `shape` filling a w×h box (pixels), centred on 0,0 of its parent. */
export function shapeObject(shape: FrameShape, w: number, h: number, radius: number, props: Record<string, unknown> = {}): FabricObject {
  const pts = shapePoints(shape);
  if (pts) return new Polygon(pts.map((p) => ({ x: p.x * w, y: p.y * h })), { ...props });
  if (shape === 'circle') return new Ellipse({ rx: w / 2, ry: h / 2, ...props });
  return new Rect({ width: w, height: h, rx: shape === 'rounded' ? radius : 0, ry: shape === 'rounded' ? radius : 0, ...props });
}

function place(fo: FabricObject, o: StudioObject, U: number) {
  fo.set({ left: o.x * U, top: o.y * U, angle: o.angle, opacity: o.opacity, flipX: !!o.flipX, flipY: !!o.flipY, visible: !o.hidden });
  (fo as CfObject).cfId = o.id;
  (fo as CfObject).cfModel = o;
  return fo as CfObject;
}

// ------------------------------------------------------------------ per kind

async function buildPicture(o: StudioObject & { w: number; h: number }, ctx: BuildCtx, tintColor: string | null): Promise<FabricObject | null> {
  const url = objectImageUrl(o, ctx.item);
  const img = url ? await loadImageEl(url) : null;
  if (!img) return ctx.editing ? missing(o, ctx, o.kind === 'stamp' ? 'Stamp not found' : 'Picture missing') : null;
  const el = tintColor ? tint(img, tintColor) : img;
  const fi = new FabricImage(el);
  fi.set({ scaleX: (o.w * ctx.U) / el.width, scaleY: (o.h * ctx.U) / el.height });
  return fi;
}

/** A grey placeholder where a picture should be (editor only). */
function missing(o: StudioObject, ctx: BuildCtx, label: string) {
  const w = o.w * ctx.U;
  const h = o.h * ctx.U;
  return new Group([
    new Rect({ width: w, height: h, fill: 'rgba(120,130,160,0.25)', stroke: '#8c94b0', strokeWidth: ctx.U * 0.3, strokeDashArray: [ctx.U, ctx.U] }),
    new FabricText(label, { fontSize: Math.min(h * 0.18, ctx.U * 3), fill: '#c6cbe0', fontFamily: 'Rajdhani, sans-serif' }),
  ]);
}

async function buildFrame(o: StudioFrame, ctx: BuildCtx): Promise<FabricObject | null> {
  const { U } = ctx;
  const w = o.w * U;
  const h = o.h * U;
  const url = objectImageUrl(o, ctx.item);
  const img = url ? await loadImageEl(url) : null;
  if (!img) {
    if (!ctx.editing) return o.border ? shapeObject(o.shape, w, h, o.radius * U, { fill: '', stroke: o.border.color, strokeWidth: o.border.width * U }) : null;
    // An empty frame: a drop target with a hint.
    const s = Math.min(w, h);
    return new Group([
      shapeObject(o.shape, w, h, o.radius * U, { fill: 'rgba(70,82,120,0.55)', stroke: '#9aa6d6', strokeWidth: U * 0.35, strokeDashArray: [U * 1.2, U * 0.8] }),
      new FabricText('Drop a picture', { fontSize: Math.max(U * 1.6, Math.min(s * 0.11, U * 4)), fill: '#dfe4f7', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 }),
    ]);
  }
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const c = frameCrop(o, iw, ih);
  const fi = new FabricImage(img, { cropX: c.cropX, cropY: c.cropY, width: c.cropW, height: c.cropH });
  const k = (c.scale * U) as number; // px per picture pixel
  fi.set({ scaleX: k, scaleY: k });
  // A picture that fills the frame exactly is the frame; one fitted inside it (or under a border) sits in a group the
  // frame's size, so the frame keeps its own box.
  const fills = Math.abs(c.cropW * k - w) < 0.5 && Math.abs(c.cropH * k - h) < 0.5;
  if (fills && !o.border) {
    if (o.shape !== 'rect') fi.clipPath = shapeObject(o.shape, c.cropW, c.cropH, (o.radius * U) / k, {});
    return fi;
  }
  const parts: FabricObject[] = [new Rect({ width: w, height: h, fill: 'rgba(0,0,0,0)', strokeWidth: 0 }), fi];
  if (o.border) parts.push(shapeObject(o.shape, w, h, o.radius * U, { fill: '', stroke: o.border.color, strokeWidth: o.border.width * U }));
  const g = new Group(parts);
  if (o.shape !== 'rect') fi.clipPath = shapeObject(o.shape, w / k, h / k, (o.radius * U) / k, { left: 0, top: 0 });
  return g;
}

function buildShape(o: StudioShape, ctx: BuildCtx): FabricObject {
  const { U } = ctx;
  return shapeObject(o.shape, o.w * U, o.h * U, o.radius * U, { fill: o.fill, stroke: o.border?.color, strokeWidth: o.border ? o.border.width * U : 0, strokeUniform: true });
}

export function buildText(o: StudioText, ctx: BuildCtx): Textbox {
  const { U } = ctx;
  const f = STUDIO_FONTS[o.font] ?? STUDIO_FONTS.rajdhani;
  const tb = new Textbox(shownText(o, ctx.item), {
    width: Math.max(U, o.w * U),
    fontSize: o.size * U,
    fontFamily: f.family,
    fontWeight: f.weight,
    fontStyle: f.italic ? 'italic' : 'normal',
    fill: o.color,
    textAlign: o.align,
    lineHeight: o.lineHeight,
    charSpacing: o.spacing,
    stroke: o.outline?.color,
    strokeWidth: o.outline ? o.outline.width * U : 0,
    paintFirst: 'stroke',
    shadow: o.glow ? new Shadow({ color: o.glow, blur: o.size * U * 0.6, offsetX: 0, offsetY: 0 }) : undefined,
    splitByGrapheme: false,
  });
  return tb;
}

/** Builds the Fabric object for a Studio object (null when there's nothing to draw, e.g. an empty frame in a render). */
export async function buildObject(o: StudioObject, ctx: BuildCtx): Promise<CfObject | null> {
  let fo: FabricObject | null = null;
  switch (o.kind) {
    case 'image':
      fo = await buildPicture(o, ctx, null);
      break;
    case 'stamp':
      fo = await buildPicture(o, ctx, o.tint);
      break;
    case 'frame':
      fo = await buildFrame(o, ctx);
      break;
    case 'shape':
      fo = buildShape(o, ctx);
      break;
    case 'text':
      fo = buildText(o, ctx);
      break;
  }
  if (!fo) return null;
  return place(fo, o, ctx.U);
}

/** Where a Fabric object sits now (after the user moved it, maybe inside a multi-selection), in Studio terms. */
export function geometryOf(fo: FabricObject, U: number) {
  const d = util.qrDecompose(fo.calcTransformMatrix());
  return {
    x: d.translateX / U,
    y: d.translateY / U,
    sx: Math.abs(d.scaleX),
    sy: Math.abs(d.scaleY),
    angle: ((d.angle % 360) + 360) % 360,
    w: (fo.width * Math.abs(d.scaleX)) / U,
    h: (fo.height * Math.abs(d.scaleY)) / U,
  };
}

/**
 * The model after a Fabric edit: position, size and rotation read back. Text keeps its scale as a font size (a corner
 * drag makes the letters bigger; a side drag only the box wider); everything else keeps it as width and height.
 */
export function modelFromFabric(fo: CfObject, U: number): StudioObject | null {
  const o = fo.cfModel;
  if (!o) return null;
  const g = geometryOf(fo, U);
  const flips = { flipX: !!fo.flipX, flipY: !!fo.flipY };
  if (o.kind === 'text') {
    const k = Math.abs(g.sy - 1) > 1e-3 ? g.sy : 1;
    return { ...o, ...flips, x: g.x, y: g.y, angle: g.angle, w: g.w, h: g.h, size: o.size * k };
  }
  return { ...o, ...flips, x: g.x, y: g.y, angle: g.angle, w: g.w, h: g.h };
}
