import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppState, useSelectedItem } from '../../context/AppContext';
import type { StudioObject } from '../../types/studio';
import { STUDIO_FONTS } from '../../types/studio';
import { libraryImages } from '../../engine/imageLibrary';
import { srcOf } from '../../storage/localImages';
import { readImageFile } from '../../api/upload';
import { FRAME_PRESETS, TEXT_PRESETS, layoutsFor, type LayoutDef } from '../../studio/layouts';
import { loadStamps, searchStamps, stampSrc, type StampDef } from '../../studio/stamps';
import { shapePoints } from '../../studio/doc';
import { DRAG_MIME, type DragPayload } from '../../studio/place';

const TABS = ['Layouts', 'Frames', 'Stamps', 'Text', 'Pictures'] as const;
type Tab = (typeof TABS)[number];
/** Local stamp folders can hold thousands of logos: only this many are drawn at once (search narrows them). */
const LOCAL_LIMIT = 120;

/** Props that make an element draggable onto the canvas, and clickable to add it to the selected panel. */
function draggable(p: DragPayload, onAdd: (p: DragPayload) => void) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(p));
      e.dataTransfer.effectAllowed = 'copy';
    },
    onClick: () => onAdd(p),
  };
}

/** The Elements drawer: everything that can be dragged onto the cover. */
export function StudioElements({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  const [tab, setTab] = useState<Tab>('Layouts');
  return (
    <aside className="studio-elements" aria-label="Elements">
      <div className="studio-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="studio-tab-body">
        {tab === 'Layouts' && <Layouts onAdd={onAdd} />}
        {tab === 'Frames' && <Frames onAdd={onAdd} />}
        {tab === 'Stamps' && <Stamps onAdd={onAdd} />}
        {tab === 'Text' && <Texts onAdd={onAdd} />}
        {tab === 'Pictures' && <Pictures onAdd={onAdd} />}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ layouts

/** A thumbnail of a layout: its frames as picture boxes, shapes in their colour, text as lines. */
function LayoutThumb({ l }: { l: LayoutDef }) {
  const { template } = useAppState();
  const item = useSelectedItem();
  const objs = useMemo(() => l.build({ t: template, item }), [l, template, item]);
  // The area shown: the panel it's for, or the whole cover.
  const target = l.target === 'sleeve' ? null : template.panels.find((p) => p.id === (l.target === 'spine' ? 'spine' : l.target));
  const box = target ? { x: target.xMm - 3, y: target.yMm - 3, w: target.widthMm + 6, h: target.heightMm + 6 } : { x: 0, y: 0, w: template.totalWidthMm, h: template.totalHeightMm };
  return (
    <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="layout-thumb" aria-hidden="true">
      {template.panels.map((p) => (
        <rect key={p.id} x={p.xMm} y={p.yMm} width={p.widthMm} height={p.heightMm} fill="#2a2e38" stroke="#555b68" strokeWidth={box.w / 200} />
      ))}
      {objs.map((o) => (
        <ThumbObject key={o.id} o={o} unit={box.w / 120} />
      ))}
    </svg>
  );
}

function ThumbObject({ o, unit }: { o: StudioObject; unit: number }) {
  const tr = `translate(${o.x} ${o.y}) rotate(${o.angle})`;
  const r = { x: -o.w / 2, y: -o.h / 2, width: o.w, height: o.h };
  if (o.kind === 'text') {
    const lines = Math.max(1, Math.min(4, Math.round(o.h / (o.size * 1.2))));
    return (
      <g transform={tr}>
        {Array.from({ length: lines }, (_, i) => (
          <rect key={i} x={-o.w / 2} y={-o.h / 2 + i * o.size * 1.25} width={o.w * (i === lines - 1 && lines > 1 ? 0.6 : 1)} height={o.size * 0.7} fill={o.color} opacity={0.85} rx={unit * 0.4} />
        ))}
      </g>
    );
  }
  const fill = o.kind === 'shape' ? o.fill : o.kind === 'frame' || o.kind === 'image' ? '#6b7a9c' : '#c9cedb';
  const pts = o.kind === 'frame' || o.kind === 'shape' ? shapePoints(o.shape) : null;
  return (
    <g transform={tr} opacity={o.opacity}>
      {pts ? (
        <polygon points={pts.map((p) => `${p.x * o.w},${p.y * o.h}`).join(' ')} fill={fill} />
      ) : (o.kind === 'frame' || o.kind === 'shape') && o.shape === 'circle' ? (
        <ellipse rx={o.w / 2} ry={o.h / 2} fill={fill} />
      ) : (
        <rect {...r} fill={fill} rx={o.kind === 'stamp' ? unit : 0} />
      )}
      {(o.kind === 'frame' || o.kind === 'image') && <path d={`M${-o.w * 0.3} ${o.h * 0.25} L${-o.w * 0.08} ${-o.h * 0.05} L${o.w * 0.05} ${o.h * 0.1} L${o.w * 0.18} ${-o.h * 0.08} L${o.w * 0.3} ${o.h * 0.25}Z`} fill="#93a2c4" />}
    </g>
  );
}

function Layouts({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  const { template } = useAppState();
  const list = layoutsFor(template);
  const groups: [string, LayoutDef[]][] = [
    ['Whole sleeve', list.filter((l) => l.target === 'sleeve')],
    ['Front', list.filter((l) => l.target === 'front')],
    ['Back', list.filter((l) => l.target === 'back')],
    ['Spine', list.filter((l) => l.target === 'spine')],
  ];
  return (
    <>
      <p className="muted small">Click to add a layout to this game, or drag it in. Frames come filled with the game’s pictures; drop another picture on a frame to swap it.</p>
      {groups.map(([g, ls]) =>
        ls.length ? (
          <section key={g}>
            <h3 className="group-label">{g}</h3>
            <div className={`layout-grid ${g === 'Whole sleeve' ? 'wide' : ''}`}>
              {ls.map((l) => (
                <button key={l.id} className="layout-card" title={l.description} {...draggable({ kind: 'layout', id: l.id }, onAdd)}>
                  <LayoutThumb l={l} />
                  <span>{l.name}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null,
      )}
    </>
  );
}

// ------------------------------------------------------------------ frames and shapes

function ShapeIcon({ shape, ratio, filled }: { shape: (typeof FRAME_PRESETS)[number]['shape']; ratio: number; filled?: boolean }) {
  const w = ratio > 1 ? 30 / ratio : 30;
  const h = w * ratio;
  const pts = shapePoints(shape);
  const common = { fill: filled ? '#7c8db5' : '#3a4560', stroke: '#9aa6d6', strokeWidth: 1.2, strokeDasharray: filled ? undefined : '3 2' };
  return (
    <svg viewBox="-20 -20 40 40" aria-hidden="true">
      {pts ? <polygon points={pts.map((p) => `${p.x * w},${p.y * h}`).join(' ')} {...common} /> : shape === 'circle' ? <ellipse rx={w / 2} ry={h / 2} {...common} /> : <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={shape === 'rounded' ? 4 : 0} {...common} />}
    </svg>
  );
}

function Frames({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  return (
    <>
      <p className="muted small">A frame crops whatever picture you drop on it. Double-click a filled frame to move the picture inside it.</p>
      <h3 className="group-label">Frames</h3>
      <div className="element-grid">
        {FRAME_PRESETS.map((f) => (
          <button key={f.name} className="element" title={`${f.name} frame`} {...draggable({ kind: 'frame', shape: f.shape, ratio: f.ratio }, onAdd)}>
            <ShapeIcon shape={f.shape} ratio={f.ratio} />
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      <h3 className="group-label">Shapes</h3>
      <div className="element-grid">
        {(['rect', 'rounded', 'circle', 'hexagon', 'slant', 'diamond', 'star', 'triangle'] as const).map((s) => (
          <button key={s} className="element" title={`${s} shape`} {...draggable({ kind: 'shape', shape: s }, onAdd)}>
            <ShapeIcon shape={s} ratio={s === 'rect' || s === 'rounded' ? 0.4 : 1} filled />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ stamps

function Stamps({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  const [all, setAll] = useState<StampDef[] | null>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void loadStamps().then((s) => live && setAll(s));
    return () => {
      live = false;
    };
  }, []);
  if (!all) return <p className="muted">Loading stamps…</p>;
  const found = searchStamps(all, q);
  const cats = [...new Set(found.map((s) => (s.local ? `Local · ${s.category}` : s.category)))];
  const local = all.some((s) => s.local);
  return (
    <>
      <input type="search" placeholder={local ? 'Search stamps and local logos…' : 'Search stamps…'} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search stamps" />
      {!found.length && <p className="muted">No stamps match “{q}”.</p>}
      {cats.map((c) => {
        const inCat = found.filter((s) => (s.local ? `Local · ${s.category}` : s.category) === c);
        const isLocal = c.startsWith('Local');
        // Local folders start closed (they can be huge); built-in ones open.
        const expanded = open[c] ?? (!isLocal || !!q);
        const shown = isLocal ? inCat.slice(0, LOCAL_LIMIT) : inCat;
        return (
          <section key={c}>
            <button className="group-toggle" aria-expanded={expanded} onClick={() => setOpen({ ...open, [c]: !expanded })}>
              {expanded ? '▾' : '▸'} {c} <span className="muted">{inCat.length}</span>
            </button>
            {expanded && (
              <div className="stamp-grid">
                {shown.map((s) => (
                  <button key={s.id} className="stamp" title={s.name} {...draggable({ kind: 'stamp', id: s.id }, onAdd)}>
                    <img src={stampSrc(s)} alt={s.name} loading="lazy" draggable={false} />
                  </button>
                ))}
                {inCat.length > shown.length && <p className="muted small">{inCat.length - shown.length} more: search to narrow them down.</p>}
              </div>
            )}
          </section>
        );
      })}
      {!local && <p className="muted small">Local stamps (logos and rating labels you keep on this computer) show up here when public/local-stamps has a manifest. See the README.</p>}
    </>
  );
}

// ------------------------------------------------------------------ text

function Texts({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  return (
    <>
      <p className="muted small">Double-click text on the cover to retype it. {'{title}'}, {'{year}'}, {'{headline}'} and {'{blurb}'} fill in from each game.</p>
      <div className="text-presets">
        {TEXT_PRESETS.map((t) => {
          const f = STUDIO_FONTS[t.style.font];
          return (
            <button
              key={t.id}
              className="text-preset"
              {...draggable({ kind: 'text', preset: t.id }, onAdd)}
              style={{ fontFamily: f.family, fontWeight: f.weight, fontStyle: f.italic ? 'italic' : 'normal', fontSize: Math.min(22, 7 + t.style.size * 2.4) }}
            >
              {t.name}
            </button>
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ pictures

function Pictures({ onAdd }: { onAdd: (p: DragPayload) => void }) {
  const item = useSelectedItem();
  const dispatch = useAppDispatch();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  if (!item) return <p className="muted">Add a game first.</p>;
  async function upload(files: FileList | null) {
    if (!files?.length || !item) return;
    setError(null);
    try {
      for (const f of Array.from(files)) dispatch({ type: 'addAsset', id: item.id, url: await readImageFile(f) });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t add that picture');
    }
  }
  return (
    <>
      <p className="muted small">This game’s pictures. Drag one onto a frame to fill it, or onto the cover to place it.</p>
      <div className="picture-grid">
        {libraryImages(item).map((img) => (
          <button key={img.ref} className="picture" title={img.label} {...draggable({ kind: 'image', ref: img.ref }, onAdd)}>
            <img src={srcOf(img.url)} alt={img.label} loading="lazy" crossOrigin="anonymous" draggable={false} />
          </button>
        ))}
        <button className="picture add" onClick={() => input.current?.click()}>
          + Add
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
      {error && <p className="error small">{error}</p>}
    </>
  );
}
