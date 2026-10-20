/** A stamp (sticker) that can be dropped onto a cover: a self-contained SVG, or an image file shipped locally. */
export interface StampDef {
  id: string;
  name: string;
  category: string;
  /** Extra words the search matches. */
  tags: string;
  /** Width it is placed at, in mm. */
  mm: number;
  /** One colour: recolouring tints the whole stamp. */
  tint: boolean;
  /** Inline SVG (built-in stamps). */
  svg?: string;
  /** Image URL (local stamps). */
  url?: string;
  /** Natural size, for the aspect ratio. */
  w: number;
  h: number;
  /** Local stamps aren't part of the repository: they're files the user keeps in public/local-stamps. */
  local?: boolean;
}

/**
 * Where local stamps live: a folder next to the app (`public/local-stamps/` in development), listed by a manifest that
 * `npm run local-stamps` writes. It is git-ignored: its files (third-party logos, official rating labels) stay on the
 * machine they were put on. Without it the library simply has no local section.
 */
export const LOCAL_STAMPS_DIR = 'local-stamps/';

const registry = new Map<string, StampDef>();
let loading: Promise<StampDef[]> | null = null;

/** Every stamp: the built-in ones (loaded on demand: they're a few hundred KB of outlines) and any local ones. */
export function loadStamps(): Promise<StampDef[]> {
  if (!loading) {
    loading = Promise.all([import('./stamps.generated').then((m) => m.BUILTIN_STAMPS), loadLocalStamps()]).then(([builtin, local]) => {
      const all = [...builtin, ...local];
      for (const s of all) registry.set(s.id, s);
      return all;
    });
  }
  return loading;
}

interface LocalManifest {
  stamps: { id: string; name: string; category: string; tags?: string; file: string; w: number; h: number; mm?: number; tint?: boolean }[];
}

async function loadLocalStamps(): Promise<StampDef[]> {
  if (typeof fetch === 'undefined') return [];
  try {
    const res = await fetch(`${LOCAL_STAMPS_DIR}manifest.json`, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
    const m = (await res.json()) as LocalManifest;
    return (m.stamps ?? []).map((s) => ({
      id: `local:${s.id}`,
      name: s.name,
      category: s.category,
      tags: s.tags ?? '',
      mm: s.mm ?? 20,
      tint: !!s.tint,
      url: LOCAL_STAMPS_DIR + s.file.split('/').map(encodeURIComponent).join('/'),
      w: s.w,
      h: s.h,
      local: true,
    }));
  } catch {
    return [];
  }
}

/** A stamp by id, once loadStamps() has run. */
export const getStamp = (id: string) => registry.get(id);

/** For tests and previews that build stamps themselves. */
export function registerStamps(defs: StampDef[]) {
  for (const s of defs) registry.set(s.id, s);
}

/** Built-in SVGs are drawn at this multiple of their own size, so recolouring (done on pixels) stays sharp. */
const SVG_SCALE = 4;
const svgUrls = new Map<string, string>();

/** The image URL a stamp is drawn from. */
export function stampSrc(def: StampDef): string {
  if (def.url) return def.url;
  let u = svgUrls.get(def.id);
  if (!u) {
    const svg = (def.svg ?? '').replace(/^<svg([^>]*?) width="[\d.]+" height="[\d.]+"/, `<svg$1 width="${def.w * SVG_SCALE}" height="${def.h * SVG_SCALE}"`);
    u = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    svgUrls.set(def.id, u);
  }
  return u;
}

/** Stamps whose name, category or tags contain every word of the query. */
export function searchStamps(all: StampDef[], query: string): StampDef[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  return all.filter((s) => {
    const hay = `${s.name} ${s.category} ${s.tags}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
