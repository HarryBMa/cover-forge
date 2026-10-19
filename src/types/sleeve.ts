import type { ImageRef } from './editor';

/** PEGI age ratings (the European label printed on PC boxes). */
export const PEGI_RATINGS = ['3', '7', '12', '16', '18'] as const;
export type PegiRating = (typeof PEGI_RATINGS)[number];

/** One feature row on the back: a screenshot, a logo (or a title) and a line of text. */
export interface SleeveRow {
  /** Screenshot from the item's library; `null` = none. */
  image: ImageRef | null;
  /** A logo from the library, drawn instead of `title`; `null` = use the title. */
  logo: ImageRef | null;
  title: string;
  text: string;
}

/**
 * The words and pictures of a PC GamePak sleeve (the cartridge template's Branded layout), per item. Everything is
 * optional on the item: anything unset takes its default (see sleeveOf), so a new game already reads like a box.
 */
export interface SleeveCopy {
  /** Logo drawn at the top of the front, over the cover art; `null` = none (the cover art has its own title). */
  titleLogo: ImageRef | null;
  /** A line under the title logo, e.g. the games in a collection. */
  tagline: string;
  /** The back's headline. A line break (or wrapping) splits it; the last line is drawn in the accent colour. */
  headline: string;
  blurb: string;
  /** Up to three. Rows with no logo, title or text are shown as a strip of screenshots. */
  rows: SleeveRow[];
  /** The line of features under the rows, e.g. "1 PLAYER · TURN-BASED STRATEGY · WINDOWS 10 / 11". */
  features: string;
  rating: PegiRating | null;
  /** Shown beside the rating on the back, e.g. "Violence". */
  descriptor: string;
  /** Publisher and developer logos for the back's footer, from the library. */
  footerLogos: ImageRef[];
  /** Small print at the bottom of the back. */
  legal: string;
  /** Headline, frames and rules. */
  accent: string;
}

export const MAX_SLEEVE_ROWS = 3;
