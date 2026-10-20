import type { ImageRef } from './editor';

/**
 * The Studio: free layout on top of a cover, Canva style. Objects are placed in canvas millimetres (the template's
 * whole canvas, bleed margin included) by their centre, so rotation and flipping happen about the middle.
 */

/** Outlines a frame or a plain shape can take. */
export const FRAME_SHAPES = ['rect', 'rounded', 'circle', 'hexagon', 'slant', 'diamond', 'star', 'triangle'] as const;
export type FrameShape = (typeof FRAME_SHAPES)[number];

/** Typefaces text objects can use (all bundled, so canvases and exports render them the same). */
export const STUDIO_FONTS = {
  'exo-black': { label: 'Exo 2 Black Italic', family: '"Exo 2"', weight: 900, italic: true, ps: 'Exo2-BlackItalic' },
  'exo-bold': { label: 'Exo 2 Bold', family: '"Exo 2"', weight: 700, italic: false, ps: 'Exo2-Bold' },
  rajdhani: { label: 'Rajdhani', family: 'Rajdhani', weight: 600, italic: false, ps: 'Rajdhani-SemiBold' },
  'rajdhani-bold': { label: 'Rajdhani Bold', family: 'Rajdhani', weight: 700, italic: false, ps: 'Rajdhani-Bold' },
  orbitron: { label: 'Orbitron', family: 'Orbitron', weight: 800, italic: false, ps: 'Orbitron-ExtraBold' },
  bebas: { label: 'Bebas Neue', family: '"Bebas Neue"', weight: 400, italic: false, ps: 'BebasNeue-Regular' },
  anton: { label: 'Anton', family: 'Anton', weight: 400, italic: false, ps: 'Anton-Regular' },
  pixel: { label: 'Press Start 2P', family: '"Press Start 2P"', weight: 400, italic: false, ps: 'PressStart2P-Regular' },
} as const;
export type StudioFont = keyof typeof STUDIO_FONTS;

interface StudioBase {
  id: string;
  /** Centre, canvas mm. */
  x: number;
  y: number;
  /** Size, mm (for text: the box width; its height follows the lines). */
  w: number;
  h: number;
  /** Degrees, clockwise. */
  angle: number;
  /** 0–1. */
  opacity: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Can't be selected on the canvas (pick it in the layers list instead). */
  locked?: boolean;
  hidden?: boolean;
  /** Shown in the layers list and as the PSD layer name. */
  name?: string;
}

/** A picture from the item's library (its cover, a screenshot, an upload…). */
export interface StudioImage extends StudioBase {
  kind: 'image';
  image: ImageRef;
}

/** A sticker from the stamp library (built in, or one of the local ones). */
export interface StudioStamp extends StudioBase {
  kind: 'stamp';
  stamp: string;
  /** Recolours the whole stamp; null = its own colours. */
  tint: string | null;
}

/**
 * A frame: an outline that crops whatever picture is dropped into it, the way Canva's frames do. The picture covers
 * the frame; `zoom` (≥ 1) enlarges it further and `cx`/`cy` say which point of the picture (0–1) sits in the middle.
 */
export interface StudioFrame extends StudioBase {
  kind: 'frame';
  shape: FrameShape;
  /** Corner radius for `rounded`, mm. */
  radius: number;
  image: ImageRef | null;
  zoom: number;
  cx: number;
  cy: number;
  /** `cover` (default) fills the frame and crops the overflow; `contain` fits the whole picture inside (for logos). */
  fit?: 'cover' | 'contain';
  /** A thin outline round the frame; null = none. */
  border: { color: string; width: number } | null;
}

/** A filled shape (a band, a panel behind text…). */
export interface StudioShape extends StudioBase {
  kind: 'shape';
  shape: FrameShape;
  radius: number;
  fill: string;
  border: { color: string; width: number } | null;
}

/**
 * Text. `{title}`, `{subtitle}`, `{year}`, `{headline}`, `{blurb}` and `{tagline}` are filled in from the item, so a
 * design can be copied to other games and still name each one.
 */
export interface StudioText extends StudioBase {
  kind: 'text';
  text: string;
  font: StudioFont;
  /** Font size, mm. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** Letter spacing, thousandths of an em. */
  spacing: number;
  uppercase: boolean;
  outline: { color: string; width: number } | null;
  /** A soft glow of this colour behind the letters; null = none. */
  glow: string | null;
}

export type StudioObject = StudioImage | StudioStamp | StudioFrame | StudioShape | StudioText;
export type StudioKind = StudioObject['kind'];

export interface StudioDoc {
  /** Back to front. */
  objects: StudioObject[];
  /** Leave out the template's built-in Branded layout under the Studio objects (a full Studio design replaces it). */
  hideBranded?: boolean;
}

export const EMPTY_STUDIO: StudioDoc = { objects: [] };
