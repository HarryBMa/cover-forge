import type { MediaItem } from '../types/media';
import type { TemplateConfig } from '../types/template';

/**
 * Rendered Studio layers, by item (items are replaced, never changed in place, so a changed item is a new key) and
 * template. Kept apart from the Fabric renderer so the cover renderer, and its tests, never load Fabric.
 */
const cache = new WeakMap<MediaItem, Map<string, HTMLCanvasElement | null>>();

export function setStudioOverlay(item: MediaItem, template: TemplateConfig, canvas: HTMLCanvasElement | null): void {
  const m = cache.get(item) ?? new Map();
  m.set(template.id, canvas);
  cache.set(item, m);
}

/** The item's rendered Studio layer for a template: a canvas, null (nothing to draw), or undefined (not rendered yet). */
export function getStudioOverlay(item: MediaItem, template: TemplateConfig): HTMLCanvasElement | null | undefined {
  return cache.get(item)?.get(template.id);
}

/** Whether the item has a Studio design to draw. */
export const hasStudio = (item: MediaItem | null | undefined) => !!item?.studio?.objects.length;
