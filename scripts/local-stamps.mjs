// Lists the images in public/local-stamps/ in a manifest the Studio reads (public/local-stamps/manifest.json).
// Run with `npm run local-stamps` after adding or removing files. The folder is git-ignored: put logos and labels
// there that you may use but not redistribute (third-party marks, official rating labels). Subfolders become
// categories; a folder can also be a link (a Windows junction or a symlink) to images kept elsewhere.
//
//   npm run local-stamps                  rebuild the manifest
//   npm run local-stamps -- --link zaparoo <path to zaparoo-designer/src/assets>   link a folder in, then rebuild
import { existsSync, mkdirSync, openSync, readSync, closeSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, sep, extname, basename, resolve } from 'node:path';

const ROOT = resolve('public/local-stamps');
const EXT = new Set(['.png', '.svg', '.jpg', '.jpeg', '.webp']);

const args = process.argv.slice(2);
if (args[0] === '--link') {
  const [, name, target] = args;
  if (!name || !target || !existsSync(target)) {
    console.error('Usage: npm run local-stamps -- --link <name> <existing folder>');
    process.exit(1);
  }
  mkdirSync(ROOT, { recursive: true });
  // A junction on Windows needs no admin rights; elsewhere a directory symlink.
  symlinkSync(resolve(target), join(ROOT, name), process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`Linked ${join(ROOT, name)} -> ${resolve(target)}`);
}

/** Reads the first bytes of a file. */
function head(file, n = 65536) {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(n);
  const got = readSync(fd, buf, 0, n, 0);
  closeSync(fd);
  return buf.subarray(0, got);
}

/** Pixel (or SVG user-unit) size of an image, from its header. */
function sizeOf(file) {
  const ext = extname(file).toLowerCase();
  if (ext === '.svg') {
    const s = readFileSync(file, 'utf8').slice(0, 4000);
    const vb = /viewBox="[\s,]*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)"/.exec(s);
    if (vb) return { w: Number(vb[3]), h: Number(vb[4]) };
    const w = /\swidth="([\d.]+)/.exec(s);
    const h = /\sheight="([\d.]+)/.exec(s);
    return w && h ? { w: Number(w[1]), h: Number(h[1]) } : null;
  }
  const b = head(file);
  if (ext === '.png' && b.readUInt32BE(12) === 0x49484452) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (ext === '.jpg' || ext === '.jpeg') {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      i += 2 + len;
    }
    return null;
  }
  if (ext === '.webp' && b.toString('ascii', 12, 16) === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (ext === '.webp' && b.toString('ascii', 12, 16) === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (ext === '.webp' && b.toString('ascii', 12, 16) === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p); // follows links
    if (st.isDirectory()) walk(p, out);
    else if (EXT.has(extname(name).toLowerCase()) && name !== 'manifest.json') out.push(p);
  }
  return out;
}

if (!existsSync(ROOT)) {
  mkdirSync(ROOT, { recursive: true });
  console.log(`Made ${ROOT}: put images in it (subfolders become categories) and run this again.`);
}
const files = walk(ROOT);
const stamps = [];
for (const f of files) {
  const rel = relative(ROOT, f).split(sep).join('/');
  const size = sizeOf(f);
  if (!size || !size.w || !size.h) continue;
  const parts = rel.split('/');
  const stem = basename(rel, extname(rel));
  const category = parts.length > 1 ? parts.slice(0, -1).join(' · ') : 'Local';
  const id = rel.slice(0, -extname(rel).length).toLowerCase().replace(/\s+/g, '-');
  // Rating labels are small; logos and pictures start wider.
  const isRating = /pegi|esrb|usk|rating/i.test(rel);
  stamps.push({ id, name: stem.replace(/[_-]+/g, ' '), category, tags: parts.slice(0, -1).join(' '), file: rel, w: size.w, h: size.h, mm: isRating ? 10 : 30 });
}
stamps.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name, undefined, { numeric: true }));
writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify({ stamps }, null, 0));
const cats = new Map();
for (const s of stamps) cats.set(s.category, (cats.get(s.category) ?? 0) + 1);
console.log(`${stamps.length} local stamps in ${cats.size} categories -> public/local-stamps/manifest.json`);
for (const [c, n] of [...cats].slice(0, 20)) console.log(`  ${c}: ${n}`);
if (cats.size > 20) console.log(`  … and ${cats.size - 20} more`);
