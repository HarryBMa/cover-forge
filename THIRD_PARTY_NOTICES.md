# Third-party notices

## Brand logos (Simple Icons)

The store and console marks offered in the "Brand logo" section are vector paths taken from
[Simple Icons](https://simpleicons.org) (`simple-icons`, released under [CC0 1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md)).
They are regenerated with `npm run gen:brands` into `src/brands/brands.generated.ts`.

**CC0 covers Simple Icons' artwork files only. The brands themselves are trademarks of their respective owners**
(Valve, Epic Games, CD PROJEKT, Sony Interactive Entertainment, and others). CoverForge is not affiliated with or endorsed by any of them,
and the marks are provided so fans can identify the platform or store on personal cover art. You are responsible for using them in line with each
owner's brand guidelines, especially for anything you sell or distribute. Where an owner publishes guidelines, the app links to them.

Simple Icons removes marks at their owners' request, so the Xbox and Nintendo marks are not available from it.

## Additional logos

The SVG files in `src/brands/svg/` (PlayStation, Nintendo Switch, Switch 2, Wii, Wii U, GameCube, the original Xbox, Xbox 360, Xbox One and Xbox Series X, the DVD Video, Blu-ray Disc, VHS, Compact Disc, Compact Cassette and contactless (NFC) symbol and the PC CD-ROM logo, plus the swoosh artwork `xbox360-waves.png`) were source from wiki pages and are
turned into `src/brands/logos.generated.ts` by `npm run gen:brands`. They are used only to draw the "Branded" header and spine of the matching
platform. They are trademarks of their respective owners (Sony Interactive Entertainment, Nintendo); CoverForge is not affiliated with or endorsed by them.

## Fonts

The PC GamePak sleeve is set in [Exo 2](https://fonts.google.com/specimen/Exo+2) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani),
bundled through `@fontsource/exo-2` and `@fontsource/rajdhani` under the [SIL Open Font License 1.1](https://openfontlicense.org).
The PEGI label it draws is the rating system's mark (PEGI S.A.); use it to show a game's real rating.

## Studio

- Icons in the Studio's *Icons* stamps and its toolbar come from [Lucide](https://lucide.dev) (`lucide-static`, [ISC License](https://github.com/lucide-icons/lucide/blob/main/LICENSE)), converted by `npm run gen:stamps`.
- Platform stamps use Simple Icons paths (see above); the same trademark notes apply.
- Studio fonts: [Orbitron](https://fonts.google.com/specimen/Orbitron), [Bebas Neue](https://fonts.google.com/specimen/Bebas+Neue), [Anton](https://fonts.google.com/specimen/Anton) and [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P), bundled through `@fontsource`, all under the SIL Open Font License 1.1.
- The editor uses [Fabric.js](https://fabricjs.com) (MIT) and writes Photoshop files with [ag-psd](https://github.com/Agamnentzar/ag-psd) (MIT).
- The other stamps (PC GamePak marks, badges, stripes, genre and feature labels, flags) are drawn for CoverForge and released with it.
- **Local stamps** (`public/local-stamps/`) are your own files: they are never committed or built into the app. Third-party logo sets and official rating labels you put there stay under their owners' terms.
