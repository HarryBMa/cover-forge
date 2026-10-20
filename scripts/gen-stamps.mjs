// Generates src/studio/stamps.generated.ts: the built-in Studio stamps (stickers) as self-contained SVG.
// Run with `npm run gen:stamps`. Text is converted to outlines with opentype.js, so the SVGs need no fonts (an SVG drawn
// as an image can't use the page's web fonts). Icons are Lucide (ISC); Apple, Linux and Steam glyphs are Simple Icons
// (CC0). Everything else is drawn here. The style follows the PC-GAMEPAK sticker sheets: dark backing, cream lettering,
// six slanted colour bars.
import { readFileSync, writeFileSync } from 'node:fs';
import opentype from 'opentype.js';

const font = (pkg, file) => opentype.parse(readFileSync(`node_modules/@fontsource/${pkg}/files/${file}.woff`).buffer);
const F = {
  logo: font('exo-2', 'exo-2-latin-900-italic'),
  black: font('exo-2', 'exo-2-latin-900-normal'),
  bold: font('exo-2', 'exo-2-latin-800-normal'),
  label: font('rajdhani', 'rajdhani-latin-700-normal'),
};

export const STRIPES = ['#e8323c', '#f7901e', '#fbcd1f', '#21b35b', '#1e88e5', '#8e4bc9'];
const INK = '#f4f1ea'; // cream white lettering
const BACK = '#0d0d12'; // sticker backing
const EDGE = '#e9e6df'; // die-cut edge

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Lays out a string glyph by glyph (advance + kerning + tracking). opentype.js's own getPath() emits NaN coordinates
 * for some strings in these fonts, so the layout is done here and each glyph's outline fetched on its own.
 */
function layout(str, f, size, spacing = 0) {
  const scale = size / f.unitsPerEm;
  const glyphs = f.stringToGlyphs(str);
  const out = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    out.push({ g, x });
    x += g.advanceWidth * scale + spacing * size;
    if (i < glyphs.length - 1) x += f.getKerningValue(g, glyphs[i + 1]) * scale;
  });
  return { glyphs: out, w: x - (glyphs.length ? spacing * size : 0) };
}
const measure = (str, f, size, spacing = 0) => layout(str, f, size, spacing).w;
/** A glyph's outline from its unscaled font-unit commands (Glyph.getPath() can hand back a path cached at another spot). */
function glyphPath(f, g, x, base, size) {
  const k = size / f.unitsPerEm;
  const X = (v) => r2(x + v * k);
  const Y = (v) => r2(base - v * k);
  return g.path.commands
    .map((c) => (c.type === 'M' || c.type === 'L' ? `${c.type}${X(c.x)} ${Y(c.y)}` : c.type === 'Q' ? `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}` : c.type === 'C' ? `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}` : 'Z'))
    .join('');
}
const pathOf = (str, f, size, x0, base, spacing = 0) => layout(str, f, size, spacing).glyphs.map(({ g, x }) => glyphPath(f, g, x0 + x, base, size)).join('');

/** Text as an outline path. `y` is the baseline unless `middle` (then the capitals are centred on `y`). */
function text(str, f, size, x, y, { anchor = 'start', spacing = 0, middle = false, fill = INK } = {}) {
  const w = measure(str, f, size, spacing);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const cap = (f.tables.os2.sCapHeight / f.unitsPerEm) * size;
  const base = middle ? y + cap / 2 : y;
  return { svg: `<path d="${pathOf(str, f, size, x0, base, spacing)}" fill="${fill}"/>`, w, cap };
}
/** A Lucide icon, `size` px square, stroked. */
function icon(name, x, y, size, color = INK, weight = 2.2) {
  const src = readFileSync(`node_modules/lucide-static/icons/${name}.svg`, 'utf8');
  const inner = src.slice(src.indexOf('>', src.indexOf('<svg')) + 1, src.lastIndexOf('</svg>')).replace(/<!--.*?-->/gs, '').trim();
  const s = size / 24;
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(s)})" fill="none" stroke="${color}" stroke-width="${weight}" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
}
/** A Simple Icons glyph (24 px viewBox), filled. */
function brand(slug, x, y, size, color = INK) {
  const src = readFileSync(`node_modules/simple-icons/icons/${slug}.svg`, 'utf8');
  const d = /<path d="([^"]+)"/.exec(src)[1];
  return `<g transform="translate(${r2(x)} ${r2(y)}) scale(${r2(size / 24)})"><path d="${d}" fill="${color}"/></g>`;
}
/** A plain four-pane window mark (generic, not the Microsoft logo). */
function panes(x, y, size, color = INK) {
  const g = size * 0.08;
  const h = (size - g) / 2;
  const sk = size * 0.06;
  return `<g fill="${color}"><path d="M${x} ${y + sk} L${x + h} ${y + sk * 0.4} L${x + h} ${y + h} L${x} ${y + h}Z"/><path d="M${x + h + g} ${y + sk * 0.3} L${x + size} ${y - sk * 0.3} L${x + size} ${y + h} L${x + h + g} ${y + h}Z"/><path d="M${x} ${y + h + g} L${x + h} ${y + h + g} L${x + h} ${y + size - sk * 0.4} L${x} ${y + size - sk}Z"/><path d="M${x + h + g} ${y + h + g} L${x + size} ${y + h + g} L${x + size} ${y + size + sk * 0.3} L${x + h + g} ${y + size - sk * 0.3}Z"/></g>`;
}

/** `n` slanted colour bars `h` tall from (x, y). Returns the svg and its width. */
function bars(x, y, h, { colors = STRIPES, bar = h * 0.19, gap = h * 0.05, slant = h * 0.42 } = {}) {
  let out = '';
  colors.forEach((c, i) => {
    const bx = x + i * (bar + gap);
    out += `<path d="M${r2(bx + slant)} ${r2(y)}H${r2(bx + slant + bar)}L${r2(bx + bar)} ${r2(y + h)}H${r2(bx)}Z" fill="${c}"/>`;
  });
  return { svg: out, w: colors.length * (bar + gap) - gap + slant };
}

/** The planet mark: a ball with a tilted ring that passes behind it and in front of it. Masks cut the gaps. */
let uid = 0;
function planet(cx, cy, r, color = INK, ringColor = color) {
  const id = `p${uid++}`;
  const rx = r * 1.85;
  const ry = r * 0.55;
  const w = r * 0.22; // ring weight
  const gap = r * 0.14;
  const rot = -22;
  const front = `M${r2(cx - rx)} ${r2(cy)} A${r2(rx)} ${r2(ry)} 0 0 0 ${r2(cx + rx)} ${r2(cy)}`;
  return (
    `<defs><mask id="${id}a" maskUnits="userSpaceOnUse"><rect x="${r2(cx - rx * 2)}" y="${r2(cy - rx * 2)}" width="${r2(rx * 4)}" height="${r2(rx * 4)}" fill="#fff"/><circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r + gap)}" fill="#000"/></mask>` +
    `<mask id="${id}b" maskUnits="userSpaceOnUse"><rect x="${r2(cx - rx * 2)}" y="${r2(cy - rx * 2)}" width="${r2(rx * 4)}" height="${r2(rx * 4)}" fill="#fff"/><path d="${front}" transform="rotate(${rot} ${r2(cx)} ${r2(cy)})" fill="none" stroke="#000" stroke-width="${r2(w + gap * 2)}"/></mask></defs>` +
    `<g transform="rotate(${rot} ${r2(cx)} ${r2(cy)})"><ellipse cx="${r2(cx)}" cy="${r2(cy)}" rx="${r2(rx)}" ry="${r2(ry)}" fill="none" stroke="${ringColor}" stroke-width="${r2(w)}" mask="url(#${id}a)"/></g>` +
    `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(r)}" fill="${color}" mask="url(#${id}b)"/>` +
    `<path d="${front}" transform="rotate(${rot} ${r2(cx)} ${r2(cy)})" fill="none" stroke="${ringColor}" stroke-width="${r2(w)}" stroke-linecap="round"/>`
  );
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(w)}" height="${r2(h)}" viewBox="0 0 ${r2(w)} ${r2(h)}">${body}</svg>`;
const backing = (x, y, w, h, r, { fill = BACK, edge = EDGE, ew = 4 } = {}) =>
  `<rect x="${r2(x + ew / 2)}" y="${r2(y + ew / 2)}" width="${r2(w - ew)}" height="${r2(h - ew)}" rx="${r2(r)}" fill="${fill}"${edge ? ` stroke="${edge}" stroke-width="${ew}"` : ''}/>`;

const STAMPS = [];
/** `mm`: the width it is placed at. `tint`: one colour (white) and can be recoloured as a whole. */
const add = (id, name, category, w, h, body, { mm = 30, tint = false, tags = '' } = {}) => STAMPS.push({ id, name, category, tags, mm, tint, svg: svg(w, h, body), w: r2(w), h: r2(h) });

// ---------------------------------------------------------------- PC-GAMEPAK
{
  const word = (x, y, size, fill = INK) => text('PC-GAMEPAK', F.logo, size, x, y, { fill });
  // bars + wordmark
  const b = bars(10, 20, 120);
  const t = word(10 + b.w + 26, 132, 132);
  add('gp-logo', 'PC-GAMEPAK logo', 'PC-GAMEPAK', 10 + b.w + 26 + t.w + 14, 160, b.svg + t.svg, { mm: 60, tags: 'logo wordmark stripes' });
  // on a sticker backing
  {
    const pad = 34;
    const b2 = bars(pad + 10, 36, 110);
    const t2 = text('PC-GAMEPAK', F.logo, 122, pad + 10 + b2.w + 24, 138);
    const W = pad + 10 + b2.w + 24 + t2.w + pad + 10;
    const body = `<path d="M${pad} 12 H${W - 12} L${W - pad} 172 H12 Z" fill="${BACK}" stroke="${EDGE}" stroke-width="5" stroke-linejoin="round"/>` + b2.svg + t2.svg;
    add('gp-logo-sticker', 'PC-GAMEPAK sticker', 'PC-GAMEPAK', W, 184, body, { mm: 60, tags: 'logo sticker' });
  }
  // dark pill, bars on the right
  {
    const t3 = text('PC-GAMEPAK', F.logo, 96, 60, 132);
    const b3 = bars(60 + t3.w + 30, 64, 76);
    const W = 60 + t3.w + 30 + b3.w + 60;
    add('gp-logo-pill', 'PC-GAMEPAK pill', 'PC-GAMEPAK', W, 200, `<rect x="4" y="4" width="${r2(W - 8)}" height="192" rx="96" fill="${BACK}"/>` + t3.svg + b3.svg, { mm: 50, tags: 'logo pill' });
  }
  // plain wordmark
  {
    const t4 = word(6, 110, 130);
    add('gp-wordmark', 'PC-GAMEPAK wordmark', 'PC-GAMEPAK', t4.w + 20, 140, t4.svg, { mm: 50, tint: true, tags: 'logo text' });
  }
  // planet + wordmark pill
  {
    const t5 = text('PC-GAMEPAK', F.logo, 90, 190, 128);
    const W = 190 + t5.w + 56;
    add('gp-logo-planet', 'PC-GAMEPAK with planet', 'PC-GAMEPAK', W, 190, `<rect x="4" y="4" width="${r2(W - 8)}" height="182" rx="34" fill="${BACK}" stroke="${EDGE}" stroke-width="5"/>` + planet(105, 95, 40) + t5.svg, { mm: 50, tags: 'logo planet' });
  }
  // planet marks
  add('gp-planet', 'Planet', 'PC-GAMEPAK', 300, 200, planet(150, 100, 52), { mm: 18, tint: true, tags: 'planet saturn' });
  {
    const t6 = text('PC-GAMEPAK', F.logo, 42, 160, 290, { anchor: 'middle' });
    add('gp-planet-badge', 'Planet badge', 'PC-GAMEPAK', 320, 330, backing(0, 0, 320, 330, 26) + planet(160, 140, 58) + t6.svg, { mm: 22, tags: 'planet badge' });
  }
  [['white', INK, INK], ['rainbow', INK, null], ['red', '#e8323c', '#e8323c'], ['blue', '#1e88e5', '#1e88e5'], ['green', '#21b35b', '#21b35b']].forEach(([n, ring, pc]) => {
    const ringSvg = ring && pc ? `<circle cx="150" cy="150" r="136" fill="${BACK}" stroke="${ring}" stroke-width="12"/>` : `<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">${STRIPES.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/>`).join('')}</linearGradient></defs><circle cx="150" cy="150" r="136" fill="${BACK}" stroke="url(#rg)" stroke-width="12"/>`;
    add(`gp-planet-coin-${n}`, `Planet coin (${n})`, 'PC-GAMEPAK', 300, 300, ringSvg + planet(150, 150, 50, pc ?? INK), { mm: 16, tags: 'planet circle coin' });
  });
  // round seal with text round the edge
  {
    const R = 250;
    const c = 260;
    let ring = `<circle cx="${c}" cy="${c}" r="${R}" fill="${BACK}" stroke="${EDGE}" stroke-width="6"/><circle cx="${c}" cy="${c}" r="${R - 76}" fill="none" stroke="${INK}" stroke-width="5"/>`;
    const word2 = 'PC-GAMEPAK';
    const size = 58;
    const place = (str, startDeg, sweep, flip) => {
      const total = measure(str, F.logo, size, 0.08);
      let acc = 0;
      for (const ch of str) {
        const cw = measure(ch, F.logo, size, 0.08);
        const a = ((startDeg + ((acc + cw / 2) / total) * sweep * (flip ? -1 : 1)) * Math.PI) / 180;
        const rr = flip ? R - 22 : R - 58;
        const x = c + rr * Math.cos(a);
        const y = c + rr * Math.sin(a);
        const rotDeg = (a * 180) / Math.PI + (flip ? -90 : 90);
        const p = pathOf(ch, F.logo, size, -cw / 2, ((F.logo.tables.os2.sCapHeight / F.logo.unitsPerEm) * size) / 2);
        ring += `<path d="${p}" fill="${INK}" transform="translate(${r2(x)} ${r2(y)}) rotate(${r2(rotDeg)})"/>`;
        acc += cw;
      }
    };
    place(word2, -160, 140, false);
    place(word2, 160, 140, true);
    add('gp-seal', 'PC-GAMEPAK seal', 'PC-GAMEPAK', 520, 520, ring + planet(c, c, 66), { mm: 24, tags: 'round seal badge' });
  }
  // info cards
  {
    const W = 760;
    const H = 420;
    let body = backing(0, 0, W, H, 18, { ew: 6 }) + icon('globe', 60, 56, 92, INK, 1.6);
    body += text('PORTABLE', F.label, 58, 190, 96).svg + text('PC GAMES', F.label, 58, 190, 152).svg;
    body += `<rect x="60" y="190" width="${W - 120}" height="5" fill="${INK}"/>`;
    ['RPG / ACTION / ADVENTURE', 'RACING / STRATEGY / SIM', 'INDIE / PUZZLE / MORE'].forEach((l, i) => (body += text(l, F.label, 40, 60, 258 + i * 48).svg));
    STRIPES.forEach((cl, i) => (body += `<rect x="${60 + (i * (W - 120)) / 6}" y="${H - 52}" width="${(W - 120) / 6 + 1}" height="14" fill="${cl}"/>`));
    add('gp-card-portable', 'Portable PC games card', 'PC-GAMEPAK', W, H, body, { mm: 40, tags: 'card genres' });
  }
  {
    const W = 760;
    const H = 460;
    let body = backing(0, 0, W, H, 18, { ew: 6 }) + planet(W / 2, 120, 58);
    body += text('PC-GAMEPAK', F.logo, 104, W / 2, 300, { anchor: 'middle' }).svg;
    const lw = W - 200;
    STRIPES.forEach((cl, i) => (body += `<rect x="${100 + (i * lw) / 6}" y="326" width="${lw / 6 + 1}" height="10" fill="${cl}"/>`));
    body += text('YOUR GAMES. YOUR STORY.', F.label, 36, W / 2, 400, { anchor: 'middle', spacing: 0.12 }).svg;
    add('gp-card-story', 'Your games card', 'PC-GAMEPAK', W, H, body, { mm: 40, tags: 'card tagline' });
  }
  {
    const W = 470;
    const H = 330;
    let body = backing(0, 0, W, H, 18, { ew: 6 });
    ['PLAY', 'COLLECT', 'EXPLORE'].forEach((l, i) => (body += text(l, F.black, 76, 46, 108 + i * 88, { spacing: 0.04 }).svg));
    add('gp-play-collect', 'Play Collect Explore', 'PC-GAMEPAK', W, H, body, { mm: 26, tags: 'tagline' });
  }
  {
    const W = 360;
    const H = 230;
    const body = backing(0, 0, W, H, 18, { ew: 6 }) + text('EST.', F.black, 70, W / 2, 100, { anchor: 'middle' }).svg + text('2026', F.black, 92, W / 2, 196, { anchor: 'middle' }).svg;
    add('gp-est', 'Est. 2026', 'PC-GAMEPAK', W, H, body, { mm: 18, tags: 'year established' });
  }
  // spine strips: planet, vertical wordmark, colour bars
  [
    ['rainbow', STRIPES],
    ['grey', ['#9a9a9a', '#bdbdbd', '#d4d4d4', '#9a9a9a', '#bdbdbd', '#d4d4d4']],
    ['warm', ['#e8323c', '#f7901e', '#fbcd1f', '#e8323c', '#f7901e', '#fbcd1f']],
    ['cool', ['#1e88e5', '#21b35b', '#8e4bc9', '#1e88e5', '#21b35b', '#8e4bc9']],
    ['rgb', ['#e8323c', '#21b35b', '#1e88e5', '#e8323c', '#21b35b', '#1e88e5']],
  ].forEach(([n, cols]) => {
    const W = 190;
    const H = 620;
    const t7 = text('PC-GAMEPAK', F.logo, 66, 0, 0, { anchor: 'middle', middle: true });
    let body = backing(0, 0, W, H, 18, { ew: 6 }) + planet(W / 2, 80, 34);
    body += `<g transform="translate(${W / 2} 310) rotate(90)">${t7.svg}</g>`;
    body += `<g transform="translate(${W / 2 - 64} 520)">${bars(0, 0, 60, { colors: cols, bar: 15, gap: 4, slant: 26 }).svg}</g>`;
    add(`gp-spine-${n}`, `Spine strip (${n})`, 'PC-GAMEPAK', W, H, body, { mm: 10, tags: 'spine vertical' });
  });
  // holographic sticker
  {
    const W = 700;
    const H = 400;
    const stops = ['#c9e7ff', '#f2c9ff', '#fff3c4', '#c4ffe8', '#c9d6ff', '#ffd1e8'];
    let body = `<defs><linearGradient id="h" x1="0" y1="0" x2="1" y2="1">${stops.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/>`).join('')}</linearGradient></defs>`;
    body += `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="40" fill="url(#h)" stroke="#ffffff" stroke-width="6"/>`;
    body += planet(W / 2, 150, 62, '#1a1a22');
    body += text('PC-GAMEPAK', F.logo, 96, W / 2, 330, { anchor: 'middle', fill: '#1a1a22' }).svg;
    add('gp-holo', 'Holographic sticker', 'PC-GAMEPAK', W, H, body, { mm: 30, tags: 'holo shiny' });
  }
  // barcode (a valid EAN-13 shape; the number is a placeholder)
  {
    const digits = '202610100001';
    const sum = [...digits].reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const code = digits + ((10 - (sum % 10)) % 10);
    const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
    const G = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
    const R = L.map((p) => [...p].map((b) => (b === '1' ? '0' : '1')).join(''));
    const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
    const par = PAR[Number(code[0])];
    let bits = '101';
    for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[Number(code[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
    bits += '101';
    const m = 5;
    const W = 95 * m + 120;
    const H = 330;
    let body = `<rect x="3" y="3" width="${W - 6}" height="${H - 6}" rx="16" fill="#f7f5ef" stroke="#c9c6bd" stroke-width="4"/>`;
    body += text('PC-GAMEPAK', F.label, 40, W / 2, 62, { anchor: 'middle', fill: '#111' }).svg;
    [...bits].forEach((b, i) => {
      if (b !== '1') return;
      const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      body += `<rect x="${60 + i * m}" y="84" width="${m}" height="${guard ? 196 : 180}" fill="#111"/>`;
    });
    body += text(code[0], F.label, 40, 34, 300, { fill: '#111' }).svg + text(code.slice(1, 7), F.label, 40, 60 + 3 * m + 21 * m, 300, { anchor: 'middle', fill: '#111', spacing: 0.25 }).svg + text(code.slice(7), F.label, 40, 60 + 50 * m + 21 * m, 300, { anchor: 'middle', fill: '#111', spacing: 0.25 }).svg;
    add('gp-barcode', 'Barcode', 'PC-GAMEPAK', W, H, body, { mm: 30, tags: 'barcode ean' });
  }
}

// ---------------------------------------------------------------- Badges
{
  const pcGame = (id, name, outline) => {
    const W = 300;
    const H = 300;
    let body = outline ? `<rect x="10" y="10" width="280" height="280" rx="22" fill="${BACK}" stroke="${INK}" stroke-width="14"/>` : `<rect x="0" y="0" width="300" height="300" rx="26" fill="${BACK}"/><rect x="22" y="22" width="256" height="256" rx="12" fill="none" stroke="${INK}" stroke-width="8"/>`;
    body += text('PC', F.black, 168, W / 2, 168, { anchor: 'middle' }).svg + text('GAME', F.black, 72, W / 2, 252, { anchor: 'middle', spacing: 0.04 }).svg;
    add(id, name, 'Badges', W, H, body, { mm: 14, tags: 'pc game platform' });
  };
  pcGame('badge-pc-game', 'PC GAME', true);
  pcGame('badge-pc-game-inset', 'PC GAME (inset)', false);
  {
    const W = 300;
    const H = 300;
    const body = `<rect x="0" y="0" width="300" height="300" rx="26" fill="${BACK}"/>` + text('PC', F.black, 170, W / 2, 178, { anchor: 'middle' }).svg + `<rect x="62" y="204" width="176" height="14" fill="${INK}"/>` + text('GAMES', F.black, 56, W / 2, 272, { anchor: 'middle', spacing: 0.06 }).svg;
    add('badge-pc-games', 'PC GAMES', 'Badges', W, H, body, { mm: 14, tags: 'pc games platform' });
  }
  {
    const W = 260;
    const H = 200;
    const body = backing(0, 0, W, H, 16, { ew: 6 }) + text('PC', F.black, 112, W / 2, 128, { anchor: 'middle' }).svg + `<path d="M70 150 H190 M130 150 V172 M96 172 H164" stroke="${INK}" stroke-width="9" stroke-linecap="round" fill="none"/>`;
    add('badge-pc-monitor', 'PC (monitor)', 'Badges', W, H, body, { mm: 12, tags: 'pc computer' });
  }
  const chip = (id, name, label, { w = 260, size = 110, mm = 12 } = {}) => {
    const H = 170;
    const body = `<rect x="7" y="7" width="${w - 14}" height="${H - 14}" rx="16" fill="${BACK}" stroke="${INK}" stroke-width="10"/>` + text(label, F.black, size, w / 2, H / 2, { anchor: 'middle', middle: true }).svg;
    add(id, name, 'Badges', w, H, body, { mm, tags: 'chip label' });
  };
  chip('badge-hd', 'HD', 'HD');
  chip('badge-4k', '4K', '4K');
  chip('badge-16-9', '16:9', '16:9', { w: 300, size: 96 });
  chip('badge-16plus', '16+', '16+', { w: 300 });
  chip('badge-18plus', '18+', '18+', { w: 300 });
  chip('badge-12plus', '12+', '12+', { w: 300 });
  chip('badge-vhs', 'VHS', 'VHS', { w: 320 });
  {
    const W = 330;
    const H = 320;
    let body = backing(0, 0, W, H, 18, { ew: 6 });
    STRIPES.forEach((c, i) => (body += `<rect x="50" y="${44 + i * 22}" width="${W - 100}" height="18" fill="${c}"/>`));
    body += text('RETRO', F.black, 82, W / 2, 268, { anchor: 'middle', spacing: 0.04 }).svg;
    add('badge-retro', 'RETRO', 'Badges', W, H, body, { mm: 16, tags: 'retro stripes' });
  }
  const edition = (id, name, ic, l1, l2) => {
    const W = 330;
    const H = 320;
    let body = backing(0, 0, W, H, 18, { ew: 6 }) + ic;
    body += text(l1, F.label, 56, W / 2, 222, { anchor: 'middle' }).svg + text(l2, F.label, 56, W / 2, 278, { anchor: 'middle' }).svg;
    add(id, name, 'Badges', W, H, body, { mm: 16, tags: 'edition' });
  };
  edition('badge-collectors', "Collector's Edition", icon('star', 125, 44, 80, INK, 2), 'COLLECTORS', 'EDITION');
  edition('badge-special', 'Special Edition', `<g transform="translate(115 44)">${STRIPES.map((c, i) => `<rect x="0" y="${i * 14}" width="100" height="12" fill="${c}"/>`).join('')}</g>`, 'SPECIAL', 'EDITION');
  {
    const W = 420;
    const H = 300;
    let body = backing(0, 0, W, H, 18, { ew: 6 }) + icon('globe', 40, 92, 116, INK, 1.6);
    ['THE', 'NEXT', 'LEVEL'].forEach((l, i) => (body += text(l, F.label, 64, 190, 104 + i * 66).svg));
    add('badge-next-level', 'The Next Level', 'Badges', W, H, body, { mm: 20, tags: 'tagline' });
  }
  const media = (id, name, ic, label) => {
    const W = 520;
    const H = 170;
    const body = backing(0, 0, W, H, 18, { ew: 6 }) + ic + text(label, F.label, label.includes(' ') ? 48 : 58, 168, H / 2, { middle: true }).svg;
    add(id, name, 'Badges', W, H, body, { mm: 26, tags: 'media format' });
  };
  media('badge-physical', 'Physical', icon('disc-3', 44, 37, 96, INK, 1.8), 'PHYSICAL');
  media('badge-digital', 'Digital', icon('download', 44, 37, 96, INK, 2), 'DIGITAL');
  media('badge-nfc', 'NFC', icon('nfc', 44, 37, 96, INK, 2), 'NFC');
  media('badge-limited', 'Limited Edition', icon('star', 44, 37, 96, INK, 2), 'LIMITED EDITION');
}

// ---------------------------------------------------------------- Stripes and shapes
{
  {
    const b = bars(0, 0, 240, { bar: 120, gap: 0, slant: 170 });
    add('stripes-band', 'Slanted band', 'Stripes & shapes', b.w, 240, b.svg, { mm: 50, tags: 'stripes rainbow band' });
  }
  {
    const b = bars(0, 0, 200, { bar: 52, gap: 14, slant: 110 });
    add('stripes-slanted', 'Slanted bars', 'Stripes & shapes', b.w, 200, b.svg, { mm: 24, tags: 'stripes bars' });
  }
  {
    const b = bars(0, 0, 200, { bar: 52, gap: 14, slant: 110, colors: ['#e8323c', '#f7901e', '#fbcd1f', '#21b35b', '#1e88e5'] });
    add('stripes-slanted-5', 'Slanted bars (5)', 'Stripes & shapes', b.w, 200, b.svg, { mm: 22, tags: 'stripes bars' });
  }
  {
    const b = bars(0, 0, 200, { bar: 52, gap: 14, slant: 110, colors: ['#111', '#2a2a2a', '#505050', '#7b7b7b', '#a6a6a6', '#d1d1d1'] });
    add('stripes-grey', 'Slanted bars (grey)', 'Stripes & shapes', b.w, 200, b.svg, { mm: 22, tags: 'stripes mono' });
  }
  add('stripes-flag', 'Stacked stripes', 'Stripes & shapes', 600, 360, STRIPES.map((c, i) => `<rect x="0" y="${i * 60}" width="600" height="61" fill="${c}"/>`).join(''), { mm: 30, tags: 'stripes horizontal flag' });
  add('stripes-vertical', 'Vertical stripes', 'Stripes & shapes', 120, 600, STRIPES.map((c, i) => `<rect x="0" y="${i * 100}" width="120" height="101" fill="${c}"/>`).join(''), { mm: 6, tags: 'stripes vertical spine' });
  add('stripes-thin', 'Thin rainbow rule', 'Stripes & shapes', 1200, 60, STRIPES.map((c, i) => `<rect x="0" y="${i * 10}" width="1200" height="10.5" fill="${c}"/>`).join(''), { mm: 60, tags: 'line rule divider' });
  add('stripes-line', 'Rainbow line', 'Stripes & shapes', 1200, 24, STRIPES.map((c, i) => `<rect x="${i * 200}" y="0" width="201" height="24" fill="${c}"/>`).join(''), { mm: 60, tags: 'line rule divider' });
  {
    let body = '';
    STRIPES.forEach((c, i) => (body += `<path d="M${i * 110 + 60} 0 H${i * 110 + 150} L${i * 110 + 90} 120 H${i * 110} Z" fill="${c}" transform="skewX(0)"/>`));
    add('stripes-pill', 'Rainbow pill', 'Stripes & shapes', 6 * 110 + 60, 120, `<defs><clipPath id="c"><rect x="0" y="0" width="${6 * 110 + 60}" height="120" rx="60"/></clipPath></defs><g clip-path="url(#c)">${body}</g>`, { mm: 24, tags: 'stripes pill' });
  }
  add('dots-rainbow', 'Rainbow dots', 'Stripes & shapes', 6 * 90, 80, STRIPES.map((c, i) => `<circle cx="${i * 90 + 40}" cy="40" r="36" fill="${c}"/>`).join(''), { mm: 24, tags: 'dots circles' });
  STRIPES.forEach((c, i) => {
    const n = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'][i];
    add(`orb-${n}`, `Orb (${n})`, 'Stripes & shapes', 200, 200, `<defs><radialGradient id="g" cx="0.35" cy="0.32" r="0.75"><stop offset="0" stop-color="#ffffff" stop-opacity="0.85"/><stop offset="0.25" stop-color="${c}"/><stop offset="1" stop-color="#000" stop-opacity="0.9"/></radialGradient></defs><circle cx="100" cy="100" r="96" fill="${c}"/><circle cx="100" cy="100" r="96" fill="url(#g)"/>`, { mm: 10, tags: 'planet ball circle' });
  });
  const star4 = (cx, cy, r, k = 0.22) => `M${cx} ${cy - r} Q${cx + r * k} ${cy - r * k} ${cx + r} ${cy} Q${cx + r * k} ${cy + r * k} ${cx} ${cy + r} Q${cx - r * k} ${cy + r * k} ${cx - r} ${cy} Q${cx - r * k} ${cy - r * k} ${cx} ${cy - r}Z`;
  add('sparkle', 'Sparkle', 'Stripes & shapes', 200, 200, `<path d="${star4(100, 100, 96)}" fill="${INK}"/>`, { mm: 8, tint: true, tags: 'star sparkle' });
  add('sparkles', 'Sparkles', 'Stripes & shapes', 300, 300, `<path d="${star4(170, 150, 120)}" fill="${INK}"/><path d="${star4(60, 70, 48)}" fill="${INK}"/><path d="${star4(64, 250, 36)}" fill="${INK}"/>`, { mm: 12, tint: true, tags: 'stars sparkle' });
  {
    let p = '';
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8 - Math.PI / 2;
      const r = i % 2 ? 46 : i % 4 === 0 ? 150 : 96;
      p += `${i ? 'L' : 'M'}${r2(160 + r * Math.cos(a))} ${r2(160 + r * Math.sin(a))}`;
    }
    add('compass-star', 'Compass star', 'Stripes & shapes', 320, 320, `<path d="${p}Z" fill="${INK}"/>`, { mm: 12, tint: true, tags: 'star compass' });
  }
  add('mountains', 'Mountains', 'Stripes & shapes', 360, 260, `<path d="M10 250 L130 40 L190 145 L235 80 L350 250 Z" fill="${INK}"/><path d="M130 40 L95 101 L118 92 L140 112 L162 96Z" fill="${BACK}" opacity="0.35"/>`, { mm: 16, tint: true, tags: 'mountain logo' });
  add('mountains-outline', 'Mountains (outline)', 'Stripes & shapes', 360, 300, `<path d="M20 280 L180 20 L340 280 Z" fill="none" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/><path d="M110 280 L180 165 L250 280" fill="none" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/>`, { mm: 16, tint: true, tags: 'mountain triangle' });
  add('globe', 'Globe', 'Stripes & shapes', 240, 240, icon('globe', 8, 8, 224, INK, 1.4), { mm: 12, tint: true, tags: 'world globe' });
  add('earth', 'Earth', 'Stripes & shapes', 240, 240, icon('earth', 8, 8, 224, INK, 1.4), { mm: 12, tint: true, tags: 'world planet' });
  add('moon', 'Moon', 'Stripes & shapes', 240, 240, `<circle cx="120" cy="120" r="112" fill="${INK}"/><circle cx="84" cy="88" r="22" fill="${BACK}" opacity="0.35"/><circle cx="150" cy="140" r="30" fill="${BACK}" opacity="0.35"/><circle cx="96" cy="166" r="14" fill="${BACK}" opacity="0.35"/><circle cx="160" cy="70" r="12" fill="${BACK}" opacity="0.35"/>`, { mm: 12, tags: 'moon planet' });
}

// ---------------------------------------------------------------- Genres
{
  const GENRES = [
    ['action', 'ACTION', 'crosshair', '#e8323c'],
    ['adventure', 'ADVENTURE', 'mountain', '#f7901e'],
    ['rpg', 'RPG', 'sword', '#fbcd1f'],
    ['strategy', 'STRATEGY', 'castle', '#21b35b'],
    ['simulation', 'SIMULATION', 'car', '#1fb5c9'],
    ['racing', 'RACING', 'flag', '#1e88e5'],
    ['sports', 'SPORTS', 'volleyball', '#1e88e5'],
    ['rhythm', 'RHYTHM', 'music', '#8e4bc9'],
    ['fighting', 'FIGHTING', 'hand-fist', '#e8327c'],
    ['platformer', 'PLATFORMER', 'footprints', '#e8327c'],
    ['puzzle', 'PUZZLE', 'puzzle', '#8e4bc9'],
    ['survival', 'SURVIVAL', 'biohazard', '#9a9a9a'],
    ['horror', 'HORROR', 'skull', '#9a9a9a'],
    ['shooter', 'SHOOTER', 'target', '#e8323c'],
    ['mmo', 'MMO', 'users', '#1fb5c9'],
    ['open-world', 'OPEN WORLD', 'globe', '#21b35b'],
    ['jrpg', 'JRPG', 'sparkle', '#fbcd1f'],
    ['indie', 'INDIE', 'heart', '#e8327c'],
  ];
  for (const [id, label, ic, col] of GENRES) {
    const W = 300;
    const H = 260;
    const size = measure(label, F.label, 50) > 250 ? 42 : 50;
    const body = `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="26" fill="${BACK}" stroke="${col}" stroke-width="14"/>` + icon(ic, W / 2 - 58, 36, 116, col, 2.2) + text(label, F.label, size, W / 2, 222, { anchor: 'middle' }).svg;
    add(`genre-${id}`, label[0] + label.slice(1).toLowerCase(), 'Genres', W, H, body, { mm: 14, tags: `genre ${label.toLowerCase()}` });
  }
}

// ---------------------------------------------------------------- Features
{
  const FEATURES = [
    ['singleplayer', 'SINGLEPLAYER', icon('user', 0, 0, 80)],
    ['multiplayer', 'MULTIPLAYER', icon('users', 0, 0, 80)],
    ['coop', 'CO-OP', icon('users-round', 0, 0, 80)],
    ['local-coop', 'LOCAL CO-OP', icon('monitor', 0, 0, 80)],
    ['online', 'ONLINE', icon('globe', 0, 0, 80)],
    ['steam', 'STEAM', brand('steam', 4, 4, 72)],
    ['cloud-save', 'CLOUD SAVE', icon('cloud', 0, 0, 80)],
    ['controller', 'CONTROLLER SUPPORT', icon('gamepad-2', 0, 0, 80)],
    ['keyboard-mouse', 'KEYBOARD & MOUSE', icon('keyboard', 0, 0, 80)],
    ['vr', 'VR', icon('glasses', 0, 0, 80)],
  ];
  for (const [id, label, ic] of FEATURES) {
    const two = label.includes(' ') && measure(label, F.label, 46) > 330;
    const lines = two ? [label.slice(0, label.lastIndexOf(' ')), label.slice(label.lastIndexOf(' ') + 1)] : [label];
    const W = 520;
    const H = 150;
    let body = `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="18" fill="${BACK}" stroke="#7d7a74" stroke-width="5"/><g transform="translate(40 35)">${ic}</g>`;
    lines.forEach((l, i) => (body += text(l, F.label, 46, 150, lines.length === 1 ? H / 2 : H / 2 - 24 + i * 48, { middle: true }).svg));
    add(`feature-${id}`, label[0] + label.slice(1).toLowerCase(), 'Features', W, H, body, { mm: 24, tags: `feature ${label.toLowerCase()}` });
  }
}

// ---------------------------------------------------------------- Languages
{
  const cross = (bg, fg, inner) => `<rect width="150" height="100" fill="${bg}"/><rect x="45" y="0" width="22" height="100" fill="${fg}"/><rect x="0" y="39" width="150" height="22" fill="${fg}"/>${inner ? `<rect x="51" y="0" width="10" height="100" fill="${inner}"/><rect x="0" y="45" width="150" height="10" fill="${inner}"/>` : ''}`;
  let us = '';
  for (let i = 0; i < 7; i++) us += `<rect y="${i * (100 / 6.5)}" width="150" height="${100 / 13}" fill="#c8102e"/>`;
  us = `<rect width="150" height="100" fill="#fff"/>${us}<rect width="62" height="54" fill="#0a3161"/>`;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) us += `<circle cx="${7 + c * 12}" cy="${7 + r * 13}" r="2.6" fill="#fff"/>`;
  const LANGS = [
    ['english', 'ENGLISH', us],
    ['svenska', 'SVENSKA', cross('#006aa7', '#fecc02')],
    ['dansk', 'DANSK', cross('#c8102e', '#ffffff')],
    ['norsk', 'NORSK', cross('#ba0c2f', '#ffffff', '#00205b')],
    ['suomi', 'SUOMI', cross('#ffffff', '#002f6c')],
    ['languages', 'LANGUAGES', null],
  ];
  for (const [id, label, flag] of LANGS) {
    const W = 470;
    const H = 140;
    let body = `<rect x="4" y="4" width="${W - 8}" height="${H - 8}" rx="18" fill="${BACK}" stroke="#7d7a74" stroke-width="5"/>`;
    body += flag ? `<g transform="translate(34 32) scale(0.62)"><defs><clipPath id="f"><rect width="150" height="100" rx="10"/></clipPath></defs><g clip-path="url(#f)">${flag}</g></g>` : icon('globe', 38, 26, 88, INK, 1.8);
    body += text(label, F.label, 48, 150, H / 2, { middle: true }).svg;
    add(`lang-${id}`, label[0] + label.slice(1).toLowerCase(), 'Languages', W, H, body, { mm: 22, tags: `language flag ${label.toLowerCase()}` });
  }
}

// ---------------------------------------------------------------- Platforms
{
  const P = [
    ['windows', 'Windows (generic panes)', (c) => panes(42, 42, 136, c)],
    ['apple', 'Apple', (c) => brand('apple', 40, 36, 140, c)],
    ['linux', 'Linux', (c) => brand('linux', 40, 40, 140, c)],
    ['steam', 'Steam', (c) => brand('steam', 40, 40, 140, c)],
  ];
  for (const [id, name, draw] of P) {
    add(`platform-${id}`, name, 'Platforms', 220, 220, `<rect x="0" y="0" width="220" height="220" rx="34" fill="${BACK}"/>` + draw(INK), { mm: 10, tags: `platform os ${id}` });
    add(`platform-${id}-plain`, `${name}, plain`, 'Platforms', 220, 220, draw(INK), { mm: 8, tint: true, tags: `platform os ${id}` });
  }
}

// ---------------------------------------------------------------- Icons
{
  const ICONS = [
    ['heart', 'Heart'], ['plus', 'Plus'], ['star', 'Star'], ['settings', 'Settings'], ['search', 'Search'], ['folder', 'Folder'], ['download', 'Download'], ['upload', 'Upload'],
    ['trash-2', 'Trash'], ['power', 'Power'], ['play', 'Play'], ['gamepad-2', 'Gamepad'], ['joystick', 'Joystick'], ['trophy', 'Trophy'], ['rocket', 'Rocket'], ['ghost', 'Ghost'], ['zap', 'Zap'], ['flame', 'Flame'], ['headphones', 'Headphones'], ['wifi', 'Wi-Fi'],
  ].filter(([n]) => { try { readFileSync(`node_modules/lucide-static/icons/${n}.svg`); return true; } catch { return false; } });
  for (const [n, name] of ICONS) {
    add(`icon-${n}`, name, 'Icons', 200, 200, `<rect x="0" y="0" width="200" height="200" rx="34" fill="${BACK}"/>` + icon(n, 44, 44, 112, INK, 2.4), { mm: 8, tags: `icon ${name.toLowerCase()}` });
  }
  const HANDLE = [['triangle-alert', 'Caution'], ['recycle', 'Recycle'], ['arrow-up-from-line', 'This side up'], ['wine', 'Fragile'], ['umbrella', 'Keep dry']];
  for (const [n, name] of HANDLE) {
    add(`handling-${n}`, name, 'Icons', 200, 200, `<rect x="6" y="6" width="188" height="188" rx="16" fill="none" stroke="${INK}" stroke-width="10"/>` + icon(n, 38, 38, 124, INK, 2.2), { mm: 8, tint: true, tags: `packaging handling ${name.toLowerCase()}` });
  }
}

const header = `// GENERATED by scripts/gen-stamps.mjs. Do not edit by hand; run \`npm run gen:stamps\`.
// Lettering converted to outlines from Exo 2 and Rajdhani (SIL OFL 1.1). Icons: Lucide (ISC). Apple, Linux and Steam
// glyphs: Simple Icons (CC0; the marks are trademarks of their owners). Everything else drawn for CoverForge (CC0).
import type { StampDef } from './stamps';

export const BUILTIN_STAMPS: StampDef[] = `;
writeFileSync('src/studio/stamps.generated.ts', header + JSON.stringify(STAMPS, null, 1) + ';\n');
console.log(`${STAMPS.length} stamps, ${(JSON.stringify(STAMPS).length / 1024).toFixed(0)} KB`);
