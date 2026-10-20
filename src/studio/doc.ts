import type { MediaItem } from '../types/media';
import type { ImageRef } from '../types/editor';
import type { TemplateConfig } from '../types/template';
import type { FrameShape, StudioDoc, StudioFrame, StudioImage, StudioObject, StudioShape, StudioStamp, StudioText } from '../types/studio';
import { EMPTY_STUDIO } from '../types/studio';
import { sleeveOf } from '../engine/gamepak';

/** Pure operations on a Studio document. Every one returns a new document and leaves the old one as it was. */

let counter = 0;
export const newId = () => `o${Date.now().toString(36)}${(counter++).toString(36)}`;

export const studioOf = (item: MediaItem | null | undefined): StudioDoc => item?.studio ?? EMPTY_STUDIO;

export const findObject = (doc: StudioDoc, id: string) => doc.objects.find((o) => o.id === id);

export function addObjects(doc: StudioDoc, objs: StudioObject[]): StudioDoc {
  return { ...doc, objects: [...doc.objects, ...objs] };
}

export function updateObject(doc: StudioDoc, id: string, patch: Partial<StudioObject>): StudioDoc {
  return { ...doc, objects: doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as StudioObject) : o)) };
}

/** Replaces several objects at once (after a drag that moved a whole selection). */
export function replaceObjects(doc: StudioDoc, next: StudioObject[]): StudioDoc {
  const byId = new Map(next.map((o) => [o.id, o]));
  return { ...doc, objects: doc.objects.map((o) => byId.get(o.id) ?? o) };
}

export function removeObjects(doc: StudioDoc, ids: string[]): StudioDoc {
  const gone = new Set(ids);
  return { ...doc, objects: doc.objects.filter((o) => !gone.has(o.id)) };
}

/** Copies the objects a little down and to the right, each just above its original. Returns the doc and the new ids. */
export function duplicateObjects(doc: StudioDoc, ids: string[], offsetMm = 3): { doc: StudioDoc; ids: string[] } {
  const want = new Set(ids);
  const made: string[] = [];
  const objects: StudioObject[] = [];
  for (const o of doc.objects) {
    objects.push(o);
    if (!want.has(o.id)) continue;
    const copy = { ...o, id: newId(), x: o.x + offsetMm, y: o.y + offsetMm, locked: false };
    made.push(copy.id);
    objects.push(copy);
  }
  return { doc: { ...doc, objects }, ids: made };
}

/** Pastes objects (from the clipboard) as new ones, offset so they don't sit exactly on their source. */
export function pasteObjects(doc: StudioDoc, objs: StudioObject[], offsetMm = 3): { doc: StudioDoc; ids: string[] } {
  const copies = objs.map((o) => ({ ...o, id: newId(), x: o.x + offsetMm, y: o.y + offsetMm }));
  return { doc: addObjects(doc, copies), ids: copies.map((o) => o.id) };
}

export type Arrange = 'forward' | 'backward' | 'front' | 'back';

/** Moves objects up or down the stack, keeping their order among themselves. */
export function arrange(doc: StudioDoc, ids: string[], how: Arrange): StudioDoc {
  const pick = new Set(ids);
  const list = [...doc.objects];
  if (how === 'front' || how === 'back') {
    const moved = list.filter((o) => pick.has(o.id));
    const rest = list.filter((o) => !pick.has(o.id));
    return { ...doc, objects: how === 'front' ? [...rest, ...moved] : [...moved, ...rest] };
  }
  if (how === 'forward') {
    for (let i = list.length - 2; i >= 0; i--) if (pick.has(list[i].id) && !pick.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
  } else {
    for (let i = 1; i < list.length; i++) if (pick.has(list[i].id) && !pick.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
  }
  return { ...doc, objects: list };
}

/** Moves one object to a new position in the stack (layers list drag). */
export function moveToIndex(doc: StudioDoc, id: string, index: number): StudioDoc {
  const from = doc.objects.findIndex((o) => o.id === id);
  if (from < 0) return doc;
  const list = [...doc.objects];
  const [o] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, index)), 0, o);
  return { ...doc, objects: list };
}

// ------------------------------------------------------------------ makers

type Box = { x: number; y: number; w: number; h: number };
const base = (b: Box, name?: string) => ({ id: newId(), x: b.x, y: b.y, w: b.w, h: b.h, angle: 0, opacity: 1, ...(name && { name }) });

export const makeImage = (image: ImageRef, b: Box, name?: string): StudioImage => ({ ...base(b, name), kind: 'image', image });

/** Stamps that start out as holo foil (the holographic sticker). */
const HOLO_STAMPS = new Set(['gp-holo']);

export const makeStamp = (stamp: string, b: Box, name?: string): StudioStamp => ({ ...base(b, name), kind: 'stamp', stamp, tint: null, ...(HOLO_STAMPS.has(stamp) && { holo: 'light' as const }) });

export const makeFrame = (shape: FrameShape, b: Box, image: ImageRef | null = null, name?: string): StudioFrame => ({
  ...base(b, name),
  kind: 'frame',
  shape,
  radius: shape === 'rounded' ? Math.min(b.w, b.h) * 0.08 : 0,
  image,
  zoom: 1,
  cx: 0.5,
  cy: 0.5,
  border: null,
});

export const makeShape = (shape: FrameShape, b: Box, fill: string, name?: string): StudioShape => ({
  ...base(b, name),
  kind: 'shape',
  shape,
  radius: shape === 'rounded' ? Math.min(b.w, b.h) * 0.08 : 0,
  fill,
  border: null,
});

export const makeText = (text: string, b: Box, style: Partial<StudioText> = {}, name?: string): StudioText => ({
  ...base(b, name),
  kind: 'text',
  text,
  font: 'rajdhani',
  size: 4,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.1,
  spacing: 0,
  uppercase: false,
  outline: null,
  glow: null,
  ...style,
});

// ------------------------------------------------------------------ frames

export interface FrameCrop {
  /** The part of the picture shown, in its own pixels. */
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  /** Millimetres per picture pixel. */
  scale: number;
}

/** The picture's size in the frame before zooming: covering it, or (`contain`) fitting inside it. */
const baseScale = (f: Pick<StudioFrame, 'w' | 'h' | 'fit'>, iw: number, ih: number) => (f.fit === 'contain' ? Math.min(f.w / iw, f.h / ih) : Math.max(f.w / iw, f.h / ih));

/**
 * Which part of an `iw`×`ih` picture a frame shows: covered (or fitted), then zoomed, centred on (cx, cy) and kept
 * inside the picture. A fitted picture can be smaller than the frame: then all of it shows.
 */
export function frameCrop(f: Pick<StudioFrame, 'w' | 'h' | 'zoom' | 'cx' | 'cy' | 'fit'>, iw: number, ih: number): FrameCrop {
  const scale = baseScale(f, iw, ih) * Math.max(1, f.zoom);
  const cropW = Math.min(iw, f.w / scale);
  const cropH = Math.min(ih, f.h / scale);
  const cropX = clamp(f.cx * iw - cropW / 2, 0, iw - cropW);
  const cropY = clamp(f.cy * ih - cropH / 2, 0, ih - cropH);
  return { cropX, cropY, cropW, cropH, scale };
}

/**
 * The reverse, for repositioning a picture inside its frame: the picture shown at `scale` mm per pixel with its centre
 * `dx`, `dy` mm from the frame's centre (in the frame's own axes). Returns the zoom and focus that reproduce it, kept
 * so the picture still covers the frame.
 */
export function cropFromPlacement(f: Pick<StudioFrame, 'w' | 'h' | 'fit'>, iw: number, ih: number, scale: number, dx: number, dy: number): Pick<StudioFrame, 'zoom' | 'cx' | 'cy'> {
  const cover = baseScale(f, iw, ih);
  const zoom = Math.max(1, scale / cover);
  const s = cover * zoom;
  const halfW = Math.min(0.5, f.w / s / iw / 2);
  const halfH = Math.min(0.5, f.h / s / ih / 2);
  return {
    zoom,
    cx: clamp(0.5 - dx / s / iw, halfW, 1 - halfW),
    cy: clamp(0.5 - dy / s / ih, halfH, 1 - halfH),
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Outline of a shape in a unit box (−0.5…0.5), as polygon points; null for the ones drawn as rect/ellipse. */
export function shapePoints(shape: FrameShape): { x: number; y: number }[] | null {
  switch (shape) {
    case 'hexagon':
      return [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0.5 * Math.cos((Math.PI / 3) * i), y: 0.5 * Math.sin((Math.PI / 3) * i) }));
    case 'slant':
      return [{ x: -0.3, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.3, y: 0.5 }, { x: -0.5, y: 0.5 }];
    case 'diamond':
      return [{ x: 0, y: -0.5 }, { x: 0.5, y: 0 }, { x: 0, y: 0.5 }, { x: -0.5, y: 0 }];
    case 'triangle':
      return [{ x: 0, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
    case 'star':
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.2 : 0.5;
        return { x: r * Math.cos(a), y: r * Math.sin(a) + 0.04 };
      });
    default:
      return null;
  }
}

// ------------------------------------------------------------------ text and hit testing

/** Fills `{title}` and friends from the item. Unknown names are left as they are. */
export function fillTokens(text: string, item: MediaItem | null | undefined): string {
  if (!item) return text;
  const s = sleeveOf(item);
  const values: Record<string, string> = {
    title: item.title,
    subtitle: item.subtitle ?? '',
    year: item.year ?? '',
    headline: s.headline,
    blurb: s.blurb,
    tagline: s.tagline,
    features: s.features,
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? values[k] : m));
}

/** What a text object actually shows for an item. */
export const shownText = (o: StudioText, item: MediaItem | null | undefined) => {
  const t = fillTokens(o.text, item);
  return o.uppercase ? t.toUpperCase() : t;
};

/** Whether a canvas-mm point falls inside an object's (rotated) box. */
export function containsPoint(o: StudioObject, x: number, y: number): boolean {
  const a = (-o.angle * Math.PI) / 180;
  const dx = x - o.x;
  const dy = y - o.y;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2;
}

/** The topmost visible frame under a point (where a dropped picture goes). */
export function frameAt(doc: StudioDoc, x: number, y: number): StudioFrame | undefined {
  for (let i = doc.objects.length - 1; i >= 0; i--) {
    const o = doc.objects[i];
    if (o.kind === 'frame' && !o.hidden && containsPoint(o, x, y)) return o;
  }
  return undefined;
}

/** A panel's trim box as a Studio box (centre + size). */
export function panelBox(t: TemplateConfig, panelId: string): Box | null {
  const p = t.panels.find((q) => q.id === panelId);
  return p ? { x: p.xMm + p.widthMm / 2, y: p.yMm + p.heightMm / 2, w: p.widthMm, h: p.heightMm } : null;
}

/** Image refs a document draws, so they can be loaded first. */
export function studioImageRefs(doc: StudioDoc): ImageRef[] {
  return doc.objects.flatMap((o) => (o.kind === 'image' ? [o.image] : o.kind === 'frame' && o.image ? [o.image] : []));
}

/** A readable name for the layers list and PSD layers. */
export function objectLabel(o: StudioObject, item?: MediaItem | null, stampName?: (id: string) => string | undefined): string {
  if (o.name) return o.name;
  switch (o.kind) {
    case 'text':
      return shownText(o, item).split('\n')[0].slice(0, 32) || 'Text';
    case 'stamp':
      return stampName?.(o.stamp) ?? 'Stamp';
    case 'frame':
      return `Frame (${o.shape})`;
    case 'shape':
      return `Shape (${o.shape})`;
    case 'image':
      return `Picture (${o.image})`;
  }
}
