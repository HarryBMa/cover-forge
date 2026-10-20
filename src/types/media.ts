import type { PanelId } from './template';
import type { PanelSettings, SpineSettings } from './editor';
import type { SleeveCopy } from './sleeve';
import type { StudioDoc } from './studio';

export type MediaType = 'game' | 'movie' | 'tv' | 'music' | 'custom';

export interface AssetSlots {
  cover: string | null;
  hero: string | null;
  logo: string | null;
  screenshots: string[];
}

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  subtitle?: string;
  year?: string;
  /** The id at the source (e.g. the Steam app id), usable in QR patterns as {appId}. */
  sourceId?: string;
  assets: AssetSlots;
  /** Item-level overrides; anything unset inherits the global settings. */
  panels?: Partial<Record<PanelId, PanelSettings>>;
  spineOverride?: Partial<SpineSettings>;
  /** The design this item uses on top of the Default one; unset = Default. */
  designId?: string;
  /** The template (case) this item is printed for, a library id such as `game-case-ps4`. Set when it is added. */
  templateId?: string;
  /** The sleeve's words and pictures for the PC GamePak cartridge template; unset fields take defaults (see sleeveOf). */
  sleeve?: Partial<SleeveCopy>;
  /** Free-placed stamps, frames, pictures and text drawn over the cover (the Studio). */
  studio?: StudioDoc;
}
