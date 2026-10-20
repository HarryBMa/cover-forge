import type { MediaItem } from '../types/media';
import type { TemplateConfig } from '../types/template';
import type { Design, SharedSettings } from '../types/editor';
import { canvasSizePx } from '../templates';
import { drawGuides } from './GuideOverlays';
import { drawSpineText, spineText } from './SpineTypography';
import { getCachedImage, loadImages } from './imageCache';
import { BASE_BACKGROUND, PANEL_IDS, resolvePanel, resolveSpine } from './resolve';
import { computePlacement, paintRect } from './placement';
import { designOf, layeredShared } from './designs';
import { drawLogo } from './logo';
import { drawCode, sleeveCodeSlot } from './code';
import { drawBorder } from './border';
import { getBrand } from '../brands';
import { drawOfficial, spineTitleCase, spineTitleColor, spineTitleScale, spineTitleStartMm } from './official';
import { drawGamePak, loadGamePakFonts, sleeveImageUrls } from './gamepak';
import { getStudioOverlay, hasStudio } from './studioCache';
import { paintRect as panelPaintRect } from '../templates/geometry';

export interface Scene {
  template: TemplateConfig;
  item: MediaItem | null;
  shared: SharedSettings;
  /** The designs items can use; an item's design sits between `shared` (Default) and its own overrides. */
  designs?: Design[];
  /** Draw the template's official banner (platform or format header) and spine cap. */
  banner: boolean;
  showGuides: boolean;
  /** Clear everything outside the cut lines (bleed, and any gaps between panels), so the canvas looks like the cut-out piece (the 2D view). */
  hideOutsideCut?: boolean;
  /** Leave the item's Studio objects out (the Studio editor draws them itself, on top). */
  skipStudio?: boolean;
}

export type ImageLookup = (url: string | null | undefined) => HTMLImageElement | null;

/**
 * Renders the full flat cover. Pure and synchronous: used by the editor, the 3D texture and export.
 * `px` is pixels per mm, so the same code serves screen previews and 300 DPI output.
 */
export function renderCover(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  px: number,
  getImage: ImageLookup = getCachedImage,
): void {
  const { template: t, item } = scene;
  const shared = layeredShared(scene.shared, designOf(scene.designs, item));
  ctx.save();
  ctx.clearRect(0, 0, t.totalWidthMm * px, t.totalHeightMm * px);
  ctx.fillStyle = BASE_BACKGROUND;
  ctx.fillRect(0, 0, t.totalWidthMm * px, t.totalHeightMm * px);

  for (const panel of t.panels) {
    const area = paintRect(t, panel);
    const r = resolvePanel(shared, item, panel.follows ?? panel.id, t.kind);
    if (r.backgroundColor) {
      ctx.fillStyle = r.backgroundColor;
      // Snapped outwards to whole pixels so neighbouring panels leave no hairline of the base colour between them.
      const [x0, y0] = [Math.floor(area.xMm * px), Math.floor(area.yMm * px)];
      ctx.fillRect(x0, y0, Math.ceil((area.xMm + area.widthMm) * px) - x0, Math.ceil((area.yMm + area.heightMm) * px) - y0);
    }
    if (panel.follows) continue; // a dust flap is plain: no image, border, logo or code

    const img = getImage(r.imageUrl);
    if (img) {
      const tr = r.transform;
      // Sized to its box (filling or fitting it) and clipped to it when filling; rotation is about the image centre.
      const pl = computePlacement(t, panel, img.naturalWidth, img.naturalHeight, tr);
      ctx.save();
      ctx.beginPath();
      ctx.rect(pl.clip.xMm * px, pl.clip.yMm * px, pl.clip.widthMm * px, pl.clip.heightMm * px);
      ctx.clip();
      ctx.globalAlpha = tr.opacity ?? 1;

      ctx.translate((pl.area.xMm + pl.xMm + pl.widthMm / 2) * px, (pl.area.yMm + pl.yMm + pl.heightMm / 2) * px);
      ctx.rotate((tr.rotationDeg * Math.PI) / 180);
      ctx.scale(pl.fit * px, pl.fit * px);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      ctx.restore();
    }
    drawBorder(ctx, panel, r.border, px);
  }

  // A Studio design can stand in for the built-in Branded layout.
  const digital = scene.banner && !item?.studio?.hideBranded;
  if (digital) drawOfficial(ctx, t, px);
  // The cartridge's Branded layout is the PC GamePak sleeve, filled in from the item's own words and pictures.
  if (digital && item && t.kind === 'cartridge') {
    // An automatic code on the back sits in the sleeve's footer, which makes room for it.
    const back = t.panels.find((p) => p.id === 'back');
    const code = back ? resolvePanel(shared, item, 'back', t.kind).code : null;
    drawGamePak(ctx, t, item, px, getImage, back && code && code.kind !== 'none' && code.box === null ? sleeveCodeSlot(back, code.kind) : null);
  }

  if (item) {
    const chosen = resolveSpine(shared, item);
    const settings = { ...chosen, color: spineTitleColor(t.kind, t.variantId, digital, chosen.color) };
    for (const p of t.panels) {
      // Branded spines have a cap and marks at their start; keep the title clear of them.
      if (p.text) drawSpineText(ctx, p, spineTitleCase(t.kind, t.variantId, digital, spineText(item, settings)), settings, px, p.text, { start: spineTitleStartMm(t.kind, t.variantId, digital, p.text === 'vertical' ? p.heightMm : p.widthMm), end: 0 }, spineTitleScale(t.kind, t.variantId, digital));
    }
  }

  // Brand logos sit above every image and the spine text.
  for (const panel of t.panels.filter((q) => !q.follows)) {
    const { logo } = resolvePanel(shared, item, panel.id, t.kind);
    const brand = getBrand(logo.brand);
    if (brand && item) drawLogo(ctx, t, panel, brand, logo, px);
  }

  // QR codes and barcodes go on top of logos.
  for (const panel of t.panels.filter((q) => !q.follows)) {
    const { code } = resolvePanel(shared, item, panel.id, t.kind);
    if (item && code.kind !== 'none') drawCode(ctx, t, panel, code, item, px);
  }

  // The Studio layer (free-placed stamps, frames, text), clipped to the print area: the panels and their bleed.
  const overlay = item && !scene.skipStudio && hasStudio(item) ? getStudioOverlay(item, t) : null;
  if (overlay) {
    ctx.save();
    ctx.beginPath();
    for (const p of t.panels) {
      const a = panelPaintRect(t, p);
      ctx.rect(a.xMm * px, a.yMm * px, a.widthMm * px, a.heightMm * px);
    }
    ctx.clip();
    ctx.drawImage(overlay, 0, 0, t.totalWidthMm * px, t.totalHeightMm * px);
    ctx.restore();
  }

  if (scene.hideOutsideCut) {
    // Keep only what's inside the panels' trim rects. Snapped outwards to whole pixels, so touching panels leave no seam.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    ctx.beginPath(); // one path, so the panels' union is kept (not just the last one)
    for (const p of t.panels) {
      const [x0, y0] = [Math.floor(p.xMm * px), Math.floor(p.yMm * px)];
      ctx.rect(x0, y0, Math.ceil((p.xMm + p.widthMm) * px) - x0, Math.ceil((p.yMm + p.heightMm) * px) - y0);
    }
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  if (scene.showGuides) drawGuides(ctx, t, px);
  ctx.restore();
}

/**
 * Preloads every image the item uses so a subsequent synchronous render is complete, and (given its template) renders
 * its Studio layer. Fabric is only loaded for items that have a Studio design.
 */
export function preloadItem({ item, shared, designs, template }: Pick<Scene, 'item' | 'shared' | 'designs'> & { template?: TemplateConfig }): Promise<unknown> {
  if (!item) return Promise.resolve();
  const layered = layeredShared(shared, designOf(designs, item));
  const studio = template && hasStudio(item) && getStudioOverlay(item, template) === undefined ? import('../studio/render').then((m) => m.prepareStudioOverlay(item, template)) : null;
  return Promise.all([loadImages([...PANEL_IDS.map((id) => resolvePanel(layered, item, id, null).imageUrl), ...sleeveImageUrls(item)]), loadGamePakFonts(), studio]);
}

/**
 * Owns the on-screen canvas: sizes it to full 300 DPI resolution and repaints on the next animation
 * frame only when marked dirty.
 */
export class CanvasRenderer {
  private scene: Scene | null = null;
  private dirty = false;
  private raf = 0;
  private disposed = false;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly paintListeners = new Set<() => void>();

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported');
    this.ctx = ctx;
  }

  setScene(scene: Scene): void {
    const prev = this.scene;
    this.scene = scene;
    if (!prev || prev.template.id !== scene.template.id) {
      const { width, height } = canvasSizePx(scene.template);
      this.canvas.width = width;
      this.canvas.height = height;
    }
    void preloadItem(scene).then(() => this.invalidate());
    this.invalidate();
  }

  /** Calls `fn` after every repaint, so a view that shows a reduced copy can refresh it. Returns the unsubscribe. */
  onPaint(fn: () => void): () => void {
    this.paintListeners.add(fn);
    return () => this.paintListeners.delete(fn);
  }

  getScene(): Scene | null {
    return this.scene;
  }

  invalidate(): void {
    if (this.dirty || this.disposed) return;
    this.dirty = true;
    this.raf = requestAnimationFrame(() => this.paint());
  }

  private paint(): void {
    this.dirty = false;
    if (!this.scene || this.disposed) return;
    renderCover(this.ctx, this.scene, this.scene.template.dpiScale);
    for (const fn of this.paintListeners) fn();
  }

  dispose(): void {
    this.disposed = true;
    this.paintListeners.clear();
    cancelAnimationFrame(this.raf);
  }
}
