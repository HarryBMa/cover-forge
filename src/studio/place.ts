import type { MediaItem } from '../types/media';
import type { ImageRef } from '../types/editor';
import type { PanelId, PanelRect, TemplateConfig } from '../types/template';
import type { FrameShape, StudioDoc } from '../types/studio';
import { resolveImageRef } from '../engine/imageLibrary';
import { srcOf } from '../storage/localImages';
import { addObjects, frameAt, makeFrame, makeImage, makeShape, makeStamp, makeText, updateObject } from './doc';
import { LAYOUTS, TEXT_PRESETS } from './layouts';
import { getStamp } from './stamps';

/** What can be dragged from the Elements drawer (or clicked to add). */
export type DragPayload =
  | { kind: 'stamp'; id: string }
  | { kind: 'image'; ref: ImageRef }
  | { kind: 'frame'; shape: FrameShape; ratio: number }
  | { kind: 'shape'; shape: FrameShape }
  | { kind: 'text'; preset: string }
  | { kind: 'layout'; id: string };

export const DRAG_MIME = 'application/x-coverforge-studio';

export interface PlaceCtx {
  doc: StudioDoc;
  item: MediaItem;
  template: TemplateConfig;
  /** The panel to add to when there's no drop point (the selected panel tab). */
  panel: PanelId;
}

/** The panel under a point (its trim box), else the given one, else the first. */
function panelAt(t: TemplateConfig, at: { x: number; y: number } | null, fallback: PanelId): PanelRect {
  const hit = at && t.panels.find((p) => !p.follows && at.x >= p.xMm && at.x <= p.xMm + p.widthMm && at.y >= p.yMm && at.y <= p.yMm + p.heightMm);
  return hit || t.panels.find((p) => p.id === fallback) || t.panels.find((p) => p.id === 'front') || t.panels[0];
}

const naturalSize = (url: string): Promise<{ w: number; h: number } | null> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });

/**
 * Adds what was dropped or clicked: at the drop point, or centred on the panel. A picture dropped on a frame goes into
 * the frame instead. Returns the new document and what to select.
 */
export async function placePayload(p: DragPayload, at: { x: number; y: number } | null, ctx: PlaceCtx): Promise<{ doc: StudioDoc; select: string[] } | null> {
  const { doc, item, template: t } = ctx;
  const panel = panelAt(t, at, ctx.panel);
  const c = at ?? { x: panel.xMm + panel.widthMm / 2, y: panel.yMm + panel.heightMm / 2 };
  const maxW = panel.widthMm * 0.8;

  switch (p.kind) {
    case 'stamp': {
      const def = getStamp(p.id);
      if (!def) return null;
      const w = Math.min(def.mm, maxW);
      const o = makeStamp(def.id, { ...c, w, h: (w * def.h) / def.w }, def.name);
      return { doc: addObjects(doc, [o]), select: [o.id] };
    }
    case 'image': {
      const frame = at && frameAt(doc, at.x, at.y);
      if (frame) return { doc: updateObject(doc, frame.id, { image: p.ref, zoom: 1, cx: 0.5, cy: 0.5 }), select: [frame.id] };
      const url = resolveImageRef(item, p.ref);
      const size = url ? await naturalSize(srcOf(url) ?? url) : null;
      const ratio = size ? size.h / size.w : 0.75;
      let w = panel.widthMm * 0.6;
      if (w * ratio > panel.heightMm * 0.8) w = (panel.heightMm * 0.8) / ratio;
      const o = makeImage(p.ref, { ...c, w, h: w * ratio });
      return { doc: addObjects(doc, [o]), select: [o.id] };
    }
    case 'frame': {
      let w = Math.min(36, panel.widthMm * 0.6);
      if (w * p.ratio > panel.heightMm * 0.8) w = (panel.heightMm * 0.8) / p.ratio;
      const o = makeFrame(p.shape, { ...c, w, h: w * p.ratio });
      return { doc: addObjects(doc, [o]), select: [o.id] };
    }
    case 'shape': {
      const w = Math.min(30, maxW);
      const o = makeShape(p.shape, { ...c, w, h: p.shape === 'rect' || p.shape === 'rounded' ? w * 0.4 : w }, '#0b0f26');
      return { doc: addObjects(doc, [o]), select: [o.id] };
    }
    case 'text': {
      const preset = TEXT_PRESETS.find((x) => x.id === p.preset) ?? TEXT_PRESETS[0];
      const w = Math.min(preset.w, panel.widthMm * 0.9);
      const o = makeText(preset.text, { ...c, w, h: preset.style.size * 1.3 }, preset.style);
      return { doc: addObjects(doc, [o]), select: [o.id] };
    }
    case 'layout': {
      const l = LAYOUTS.find((x) => x.id === p.id);
      if (!l) return null;
      // A layout is a starting point: it goes under what's already there, so stickers placed earlier stay on top.
      const objs = l.build({ t, item });
      const next = { ...doc, objects: [...objs, ...doc.objects] };
      return { doc: l.target === 'sleeve' ? { ...next, hideBranded: true } : next, select: [] };
    }
  }
}
