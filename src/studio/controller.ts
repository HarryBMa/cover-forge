import { ActiveSelection, Canvas, FabricImage, FabricObject, Point, Textbox, util, type TPointerEventInfo } from 'fabric';
import type { MediaItem } from '../types/media';
import type { TemplateConfig } from '../types/template';
import type { StudioDoc, StudioFrame, StudioObject, StudioText } from '../types/studio';
import { drawGuides } from '../engine/GuideOverlays';
import { paintRect } from '../templates/geometry';
import { buildObject, loadImageEl, modelFromFabric, objectImageUrl, shapeObject, type BuildCtx, type CfObject } from './fabricObjects';
import { cropFromPlacement, frameCrop } from './doc';
import { loadStudioFonts } from './render';
import { loadStamps } from './stamps';

/**
 * Drives the Fabric canvas of the Studio editor. The Studio document (in app state) is the source of truth: the
 * controller builds Fabric objects from it and reports edits back as new objects; it never keeps its own copy of
 * anything the document says.
 */

export interface StudioCallbacks {
  /** Objects the user changed on the canvas (moved, resized, rotated, retyped, recropped). */
  onChange(objs: StudioObject[], coalesce?: string): void;
  onSelect(ids: string[]): void;
  /** Crop mode started or ended (the toolbar shows a Done button meanwhile). */
  onCropMode?(id: string | null): void;
  /** Zoom changed (in % of fit). */
  onZoom?(percent: number): void;
}

export interface StudioScene {
  template: TemplateConfig;
  item: MediaItem;
  doc: StudioDoc;
  /** The cover underneath (rendered at 300 DPI without the Studio layer). */
  base: HTMLCanvasElement | null;
  guides: boolean;
  selection: string[];
}

const ACCENT = '#3b82f6';
const SNAP_PX = 7;

/** What makes an object need rebuilding other than its own model: the item's pictures and text fields. */
const contentKey = (item: MediaItem) => [item.id, item.assets, item.sleeve, item.title, item.subtitle, item.year] as const;
const sameKey = (a: readonly unknown[] | null, b: readonly unknown[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

interface Crop {
  id: string;
  frame: StudioFrame;
  full: FabricImage;
  inside: FabricImage;
  outline: FabricObject;
  iw: number;
  ih: number;
}

export class StudioController {
  readonly canvas: Canvas;
  private scene: StudioScene | null = null;
  private U = 1;
  private key: readonly unknown[] | null = null;
  private version = 0;
  private suppressSelect = false;
  private fitZoom = 1;
  private snapLines: { x?: number; y?: number }[] = [];
  private pan: { x: number; y: number } | null = null;
  private spaceDown = false;
  private crop: Crop | null = null;
  private rawText = new Map<string, string>();
  private disposed = false;

  constructor(
    el: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly cb: StudioCallbacks,
  ) {
    this.canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selectionColor: 'rgba(59,130,246,0.12)',
      selectionBorderColor: ACCENT,
      selectionLineWidth: 1,
      backgroundColor: '#33363d',
      enableRetinaScaling: true,
      stopContextMenu: true,
      targetFindTolerance: 4,
    });
    this.resize();
    this.wire();
  }

  // ---------------------------------------------------------------- scene

  async setScene(s: StudioScene): Promise<void> {
    const prev = this.scene;
    this.scene = s;
    this.U = s.template.dpiScale;
    if (!prev || prev.template.id !== s.template.id) this.fit();
    if (!prev || prev.base !== s.base) this.setBase(s.base);
    const key = contentKey(s.item);
    const rebuildAll = !sameKey(this.key, key) || prev?.template.id !== s.template.id;
    this.key = key;
    await this.sync(rebuildAll);
    this.applySelection(s.selection);
    this.canvas.requestRenderAll();
  }

  private setBase(base: HTMLCanvasElement | null) {
    const t = this.scene!.template;
    this.canvas.backgroundImage = base ? new FabricImage(base, { left: (t.totalWidthMm * this.U) / 2, top: (t.totalHeightMm * this.U) / 2, objectCaching: false }) : undefined;
  }

  /** Rebuilds the Fabric objects whose model changed, and puts everything in document order. */
  private async sync(all: boolean) {
    const s = this.scene!;
    const v = ++this.version;
    const ctx: BuildCtx = { U: this.U, item: s.item, editing: true };
    const current = new Map<string, CfObject>();
    for (const o of this.canvas.getObjects() as CfObject[]) if (o.cfId) current.set(o.cfId, o);
    await Promise.all([loadStamps(), loadStudioFonts(s.doc.objects)]);
    const built = await Promise.all(
      s.doc.objects.map(async (o) => {
        const ex = current.get(o.id);
        if (ex && !all && ex.cfModel === o) return ex;
        return buildObject(o, ctx);
      }),
    );
    if (v !== this.version || this.disposed) return; // a newer sync started
    const keep = new Set(built.filter(Boolean));
    const active = this.canvas.getActiveObjects() as CfObject[];
    const replacingActive = active.some((a) => !keep.has(a));
    if (replacingActive && !this.isEditingText()) {
      this.suppressSelect = true;
      this.canvas.discardActiveObject();
      this.suppressSelect = false;
    }
    for (const o of this.canvas.getObjects() as CfObject[]) if (o.cfId && !keep.has(o)) this.canvas.remove(o);
    built.forEach((fo, i) => {
      if (!fo) return;
      const model = s.doc.objects[i];
      fo.set({
        selectable: !model.locked,
        evented: !model.locked,
        visible: !model.hidden,
        transparentCorners: false,
        cornerColor: '#ffffff',
        cornerStrokeColor: ACCENT,
        borderColor: ACCENT,
        cornerSize: 10,
        borderScaleFactor: 1.5,
      });
      if (!this.canvas.getObjects().includes(fo)) this.canvas.add(fo);
    });
    // Order: document order, with crop-mode helpers on top.
    let idx = 0;
    for (const fo of built) if (fo) this.canvas.moveObjectTo(fo, idx++);
    this.canvas.requestRenderAll();
  }

  private applySelection(ids: string[]) {
    if (this.crop || this.isEditingText()) return;
    const objs = (this.canvas.getObjects() as CfObject[]).filter((o) => o.cfId && ids.includes(o.cfId) && o.selectable);
    const now = (this.canvas.getActiveObjects() as CfObject[]).map((o) => o.cfId);
    if (now.length === objs.length && objs.every((o) => now.includes(o.cfId))) return;
    this.suppressSelect = true;
    this.canvas.discardActiveObject();
    if (objs.length === 1) this.canvas.setActiveObject(objs[0]);
    else if (objs.length > 1) this.canvas.setActiveObject(new ActiveSelection(objs, { canvas: this.canvas }));
    this.suppressSelect = false;
    this.canvas.requestRenderAll();
  }

  private isEditingText() {
    const a = this.canvas.getActiveObject();
    return a instanceof Textbox && a.isEditing;
  }

  // ---------------------------------------------------------------- view

  resize() {
    const r = this.host.getBoundingClientRect();
    this.canvas.setDimensions({ width: Math.max(50, r.width), height: Math.max(50, r.height) });
    if (this.scene) this.fit();
  }

  /** Zooms to show the whole cover with a margin. */
  fit() {
    if (!this.scene) return;
    const t = this.scene.template;
    const W = t.totalWidthMm * this.U;
    const H = t.totalHeightMm * this.U;
    const cw = this.canvas.getWidth();
    const ch = this.canvas.getHeight();
    const z = Math.min((cw - 60) / W, (ch - 60) / H);
    this.fitZoom = z;
    this.canvas.setViewportTransform([z, 0, 0, z, (cw - W * z) / 2, (ch - H * z) / 2]);
    this.cb.onZoom?.(100);
  }

  zoomBy(f: number, at?: Point) {
    const c = at ?? new Point(this.canvas.getWidth() / 2, this.canvas.getHeight() / 2);
    const z = Math.min(this.fitZoom * 16, Math.max(this.fitZoom * 0.25, this.canvas.getZoom() * f));
    this.canvas.zoomToPoint(c, z);
    this.cb.onZoom?.(Math.round((z / this.fitZoom) * 100));
  }

  /** A page position (e.g. a drop) in canvas millimetres. */
  clientToMm(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.upperCanvasEl.getBoundingClientRect();
    const p = util.transformPoint(new Point(clientX - r.left, clientY - r.top), util.invertTransform(this.canvas.viewportTransform));
    return { x: p.x / this.U, y: p.y / this.U };
  }

  // ---------------------------------------------------------------- events

  private wire() {
    const c = this.canvas;
    const sel = () => {
      if (this.suppressSelect) return;
      if (this.crop && !c.getActiveObjects().includes(this.crop.full)) void this.endCrop(true);
      if (this.crop) return;
      this.cb.onSelect((c.getActiveObjects() as CfObject[]).map((o) => o.cfId).filter((id): id is string => !!id));
    };
    c.on('selection:created', sel);
    c.on('selection:updated', sel);
    c.on('selection:cleared', sel);

    c.on('object:modified', (e) => {
      const t = e.target;
      if (!t || (this.crop && (t === this.crop.full))) return;
      const targets = (t instanceof ActiveSelection ? t.getObjects() : [t]) as CfObject[];
      const out: StudioObject[] = [];
      for (const fo of targets) {
        const before = fo.cfModel;
        const m = modelFromFabric(fo, this.U);
        if (!m || !before) continue;
        // Frames recrop and text resizes its letters on a size change: those are rebuilt; the rest just keep moving.
        const resized = Math.abs(m.w - before.w) > 1e-3 || Math.abs(m.h - before.h) > 1e-3;
        const rebuild = (m.kind === 'frame' && resized) || (m.kind === 'text' && Math.abs((m as StudioText).size - (before as StudioText).size) > 1e-6);
        fo.cfModel = rebuild ? undefined : m;
        out.push(m);
      }
      this.snapLines = [];
      if (out.length) this.cb.onChange(out);
    });

    c.on('object:moving', (e) => this.snap(e.target));
    c.on('mouse:up', () => {
      if (this.snapLines.length) {
        this.snapLines = [];
        c.requestRenderAll();
      }
    });

    c.on('mouse:dblclick', (e) => {
      const t = e.target as CfObject | undefined;
      if (t?.cfModel?.kind === 'frame' && t.cfModel.image) void this.startCrop(t.cfModel.id);
    });

    // Text: edit the raw text (with its {fields}), not what it shows for this item.
    c.on('text:editing:entered', (e) => {
      const t = e.target as CfObject & Textbox;
      const m = t.cfModel;
      if (m?.kind !== 'text') return;
      this.rawText.set(m.id, t.text);
      t.set({ text: m.text });
      t.selectAll();
      c.requestRenderAll();
    });
    c.on('text:editing:exited', (e) => {
      const t = e.target as CfObject & Textbox;
      const m = t.cfModel;
      if (m?.kind !== 'text') return;
      const text = t.text;
      this.rawText.delete(m.id);
      t.cfModel = undefined; // rebuild: the fields fill in again
      this.cb.onChange([{ ...m, text, h: (t.height ?? 0) / this.U }]);
    });

    // Wheel zooms about the cursor; space, Alt or the middle button + drag pans.
    c.on('mouse:wheel', (opt) => {
      const e = opt.e as WheelEvent;
      e.preventDefault();
      e.stopPropagation();
      this.zoomBy(Math.pow(0.999, e.deltaY), new Point(e.offsetX, e.offsetY));
    });
    c.on('mouse:down', (opt: TPointerEventInfo) => {
      const e = opt.e as MouseEvent;
      if (this.spaceDown || e.altKey || e.button === 1) {
        this.pan = { x: e.clientX, y: e.clientY };
        c.selection = false;
        c.setCursor('grabbing');
      }
    });
    c.on('mouse:move', (opt) => {
      if (!this.pan) return;
      const e = opt.e as MouseEvent;
      c.relativePan(new Point(e.clientX - this.pan.x, e.clientY - this.pan.y));
      this.pan = { x: e.clientX, y: e.clientY };
    });
    c.on('mouse:up', () => {
      if (!this.pan) return;
      this.pan = null;
      c.selection = true;
      c.setCursor('default');
    });

    c.on('after:render', ({ ctx }) => this.drawOverlay(ctx));
  }

  setSpace(down: boolean) {
    this.spaceDown = down;
    this.canvas.defaultCursor = down ? 'grab' : 'default';
  }

  /** Dims what's outside the print area, then the cut/fold lines and any snap lines. */
  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const s = this.scene;
    if (!s) return;
    const t = s.template;
    const v = this.canvas.viewportTransform;
    ctx.save();
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5]);
    if (s.guides) drawGuides(ctx, t, this.U);
    ctx.lineWidth = 1 / this.canvas.getZoom();
    ctx.strokeStyle = '#ff2d95';
    for (const l of this.snapLines) {
      ctx.beginPath();
      if (l.x !== undefined) {
        ctx.moveTo(l.x, 0);
        ctx.lineTo(l.x, t.totalHeightMm * this.U);
      } else if (l.y !== undefined) {
        ctx.moveTo(0, l.y);
        ctx.lineTo(t.totalWidthMm * this.U, l.y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Snaps a dragged object's edges and centre to panel edges and centres and to other objects. */
  private snap(target: FabricObject | undefined) {
    const s = this.scene;
    if (!s || !target) return;
    const tol = SNAP_PX / this.canvas.getZoom();
    const xs: number[] = [];
    const ys: number[] = [];
    for (const p of s.template.panels) {
      if (p.follows) continue;
      const a = paintRect(s.template, p);
      for (const r of [p, a]) {
        xs.push(r.xMm * this.U, (r.xMm + r.widthMm / 2) * this.U, (r.xMm + r.widthMm) * this.U);
        ys.push(r.yMm * this.U, (r.yMm + r.heightMm / 2) * this.U, (r.yMm + r.heightMm) * this.U);
      }
    }
    const moving = new Set(target instanceof ActiveSelection ? target.getObjects() : [target]);
    for (const o of this.canvas.getObjects()) {
      if (moving.has(o) || !o.visible || !(o as CfObject).cfId) continue;
      const b = o.getBoundingRect();
      xs.push(b.left, b.left + b.width / 2, b.left + b.width);
      ys.push(b.top, b.top + b.height / 2, b.top + b.height);
    }
    const b = target.getBoundingRect();
    const best = (edges: number[], lines: number[]) => {
      let d = Infinity;
      let line = 0;
      for (const e of edges) for (const l of lines) if (Math.abs(l - e) < Math.abs(d)) [d, line] = [l - e, l];
      return Math.abs(d) <= tol ? { d, line } : null;
    };
    const sx = best([b.left, b.left + b.width / 2, b.left + b.width], xs);
    const sy = best([b.top, b.top + b.height / 2, b.top + b.height], ys);
    this.snapLines = [];
    if (sx) {
      target.set({ left: target.left + sx.d });
      this.snapLines.push({ x: sx.line });
    }
    if (sy) {
      target.set({ top: target.top + sy.d });
      this.snapLines.push({ y: sy.line });
    }
    target.setCoords();
  }

  // ---------------------------------------------------------------- crop mode

  /** Shows a framed picture whole, to drag and scale it inside its frame (double-click a frame, or "Reposition"). */
  async startCrop(id: string) {
    const s = this.scene;
    const f = s?.doc.objects.find((o) => o.id === id);
    if (!s || f?.kind !== 'frame' || !f.image) return;
    if (this.crop) await this.endCrop(true);
    const url = objectImageUrl(f, s.item);
    const img = url ? await loadImageEl(url) : null;
    if (!img) return;
    const U = this.U;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const c = frameCrop(f, iw, ih);
    const k = c.scale * U;
    // The picture's centre, from the frame's centre, turned with the frame.
    const lx = (iw / 2 - (c.cropX + c.cropW / 2)) * k;
    const ly = (ih / 2 - (c.cropY + c.cropH / 2)) * k;
    const a = (f.angle * Math.PI) / 180;
    const cx = f.x * U + lx * Math.cos(a) - ly * Math.sin(a);
    const cy = f.y * U + lx * Math.sin(a) + ly * Math.cos(a);
    const common = { left: cx, top: cy, scaleX: k, scaleY: k, angle: f.angle };
    const full = new FabricImage(img, { ...common, opacity: 0.45, lockRotation: true, lockSkewingX: true, lockSkewingY: true, cornerColor: '#ffffff', cornerStrokeColor: ACCENT, borderColor: ACCENT, transparentCorners: false, cornerSize: 12 });
    full.setControlsVisibility({ mt: false, mb: false, ml: false, mr: false, mtr: false });
    const clip = shapeObject(f.shape, f.w * U, f.h * U, f.radius * U, { left: f.x * U, top: f.y * U, angle: f.angle, absolutePositioned: true });
    const inside = new FabricImage(img, { ...common, selectable: false, evented: false, clipPath: clip });
    const outline = shapeObject(f.shape, f.w * U, f.h * U, f.radius * U, { left: f.x * U, top: f.y * U, angle: f.angle, fill: '', stroke: '#ffffff', strokeWidth: 2 / this.canvas.getZoom(), strokeDashArray: [6 / this.canvas.getZoom(), 4 / this.canvas.getZoom()], selectable: false, evented: false });
    const follow = () => inside.set({ left: full.left, top: full.top, scaleX: full.scaleX, scaleY: full.scaleY });
    full.on('moving', follow);
    full.on('scaling', follow);
    const frameObj = (this.canvas.getObjects() as CfObject[]).find((o) => o.cfId === id);
    frameObj?.set({ visible: false });
    this.crop = { id, frame: f, full, inside, outline, iw, ih };
    this.canvas.add(inside, full, outline);
    this.suppressSelect = true;
    this.canvas.setActiveObject(full);
    this.suppressSelect = false;
    this.cb.onCropMode?.(id);
    this.canvas.requestRenderAll();
  }

  /** Leaves crop mode, keeping the new placement (or not). */
  async endCrop(keep = true) {
    const cr = this.crop;
    if (!cr) return;
    this.crop = null;
    const { full, inside, outline, frame: f } = cr;
    const U = this.U;
    const s = full.scaleX / U; // mm per picture pixel
    const a = (-f.angle * Math.PI) / 180;
    const dxp = full.left - f.x * U;
    const dyp = full.top - f.y * U;
    const dx = (dxp * Math.cos(a) - dyp * Math.sin(a)) / U;
    const dy = (dxp * Math.sin(a) + dyp * Math.cos(a)) / U;
    this.suppressSelect = true;
    this.canvas.discardActiveObject();
    this.canvas.remove(inside, full, outline);
    this.suppressSelect = false;
    const frameObj = (this.canvas.getObjects() as CfObject[]).find((o) => o.cfId === cr.id);
    frameObj?.set({ visible: true });
    this.cb.onCropMode?.(null);
    if (keep) {
      if (frameObj) frameObj.cfModel = undefined;
      this.cb.onChange([{ ...f, ...cropFromPlacement(f, cr.iw, cr.ih, s, dx, dy) }]);
    }
    this.canvas.requestRenderAll();
  }

  get cropping() {
    return this.crop?.id ?? null;
  }

  dispose() {
    this.disposed = true;
    void this.canvas.dispose();
  }
}
