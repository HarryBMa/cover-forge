import { useEffect, useState } from 'react';
import { templateOf, useAppDispatch, useAppState, useSelectedItem } from '../../context/AppContext';
import type { ImageRef } from '../../types/editor';
import type { FrameShape, StudioDoc, StudioFrame, StudioObject, StudioShape, StudioStamp, StudioText } from '../../types/studio';
import { FOIL_STYLES, FRAME_SHAPES, STUDIO_FONTS, type FoilStyle, type HoloMode, type StudioFont } from '../../types/studio';
import { libraryImages } from '../../engine/imageLibrary';
import { srcOf } from '../../storage/localImages';
import { arrange, duplicateObjects, moveToIndex, objectLabel, removeObjects, studioOf, updateObject, type Arrange } from '../../studio/doc';
import { getStamp, loadStamps } from '../../studio/stamps';
import { sendStudio } from '../../studio/bus';
import { NumberSlider } from '../editor/NumberSlider';
import { CaseBar } from '../templates/CaseBar';
import { BrandedToggle } from '../editor/BrandedToggle';
import { Icon } from './Icon';

/** Rounds for display in mm fields. */
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The Studio's right panel: the selected object's settings, the design's options, and the layers. */
export function StudioInspector() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const item = useSelectedItem();
  const [, setStampsReady] = useState(false);
  useEffect(() => void loadStamps().then(() => setStampsReady(true)), []);
  if (!item) {
    return (
      <section className="controls">
        <div className="controls-head">
          <CaseBar />
        </div>
        <p className="muted">Add a game to design its cover.</p>
      </section>
    );
  }
  const doc = studioOf(item);
  const sel = doc.objects.filter((o) => state.studioSelection.includes(o.id));
  const commit = (next: StudioDoc, opts: { select?: string[]; coalesce?: string } = {}) => dispatch({ type: 'studioSet', id: item.id, doc: next, ...opts });
  const sameTemplate = state.items.filter((i) => i.id !== item.id && templateOf(state, i).id === state.template.id);

  return (
    <section className="controls studio-inspector">
      <div className="controls-head">
        <CaseBar />
        <BrandedToggle />
      </div>
      <div className="controls-body">
        {sel.length === 1 ? (
          <ObjectPanel key={sel[0].id} o={sel[0]} doc={doc} commit={commit} />
        ) : sel.length > 1 ? (
          <MultiPanel sel={sel} doc={doc} commit={commit} />
        ) : (
          <>
            <h2>Design</h2>
            <p className="muted">Pick something on the cover to change it, or drag stamps, frames and text in from the left.</p>
            <label className="check">
              <input type="checkbox" checked={!doc.hideBranded} onChange={(e) => commit({ ...doc, hideBranded: !e.target.checked })} />
              Show the built-in layout underneath
            </label>
            {doc.objects.some((x) => x.holo) && <FoilStylePick doc={doc} commit={commit} />}
            <div className="button-row">
              {sameTemplate.length > 0 && (
                <button disabled={!doc.objects.length} title="Copies this design to them; each game fills the frames and {fields} with its own pictures and text" onClick={() => dispatch({ type: 'studioCopyTo', from: item.id, to: sameTemplate.map((i) => i.id) })}>
                  Use on the other {sameTemplate.length} {state.template.name} {sameTemplate.length === 1 ? 'game' : 'games'}
                </button>
              )}
              <button disabled={!doc.objects.length} onClick={() => commit({ ...doc, objects: [] }, { select: [] })}>
                Clear design
              </button>
            </div>
          </>
        )}
        <Layers doc={doc} commit={commit} />
      </div>
    </section>
  );
}

type Commit = (next: StudioDoc, opts?: { select?: string[]; coalesce?: string }) => void;

function Arrange({ ids, doc, commit }: { ids: string[]; doc: StudioDoc; commit: Commit }) {
  const go = (how: Arrange) => commit(arrange(doc, ids, how));
  return (
    <div className="button-row">
      <button onClick={() => go('front')} title="Bring to front (Ctrl+])">To front</button>
      <button onClick={() => go('forward')} title="Forward (])">Forward</button>
      <button onClick={() => go('backward')} title="Backward ([)">Backward</button>
      <button onClick={() => go('back')} title="Send to back (Ctrl+[)">To back</button>
    </div>
  );
}

function MultiPanel({ sel, doc, commit }: { sel: StudioObject[]; doc: StudioDoc; commit: Commit }) {
  const ids = sel.map((o) => o.id);
  // Align the selection's boxes (unrotated extents) to the selection's own edges and centre.
  const align = (how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') => {
    const L = Math.min(...sel.map((o) => o.x - o.w / 2));
    const R = Math.max(...sel.map((o) => o.x + o.w / 2));
    const T = Math.min(...sel.map((o) => o.y - o.h / 2));
    const B = Math.max(...sel.map((o) => o.y + o.h / 2));
    let next = doc;
    for (const o of sel) {
      const x = how === 'left' ? L + o.w / 2 : how === 'right' ? R - o.w / 2 : how === 'hcenter' ? (L + R) / 2 : o.x;
      const y = how === 'top' ? T + o.h / 2 : how === 'bottom' ? B - o.h / 2 : how === 'vcenter' ? (T + B) / 2 : o.y;
      next = updateObject(next, o.id, { x, y });
    }
    commit(next);
  };
  return (
    <>
      <h2>{sel.length} selected</h2>
      <div className="button-row">
        <button onClick={() => align('left')}>Left</button>
        <button onClick={() => align('hcenter')}>Centre</button>
        <button onClick={() => align('right')}>Right</button>
        <button onClick={() => align('top')}>Top</button>
        <button onClick={() => align('vcenter')}>Middle</button>
        <button onClick={() => align('bottom')}>Bottom</button>
      </div>
      <Arrange ids={ids} doc={doc} commit={commit} />
      <div className="button-row">
        <button onClick={() => { const r = duplicateObjects(doc, ids); commit(r.doc, { select: r.ids }); }}>Duplicate</button>
        <button onClick={() => commit(removeObjects(doc, ids), { select: [] })}>Delete</button>
      </div>
    </>
  );
}

function ObjectPanel({ o, doc, commit }: { o: StudioObject; doc: StudioDoc; commit: Commit }) {
  const item = useSelectedItem()!;
  const set = (patch: Partial<StudioObject>, coalesce?: string) => commit(updateObject(doc, o.id, patch), coalesce ? { coalesce: `${o.id}:${coalesce}` } : {});
  const title = { text: 'Text', stamp: getStamp((o as StudioStamp).stamp)?.name ?? 'Stamp', frame: 'Frame', shape: 'Shape', image: 'Picture' }[o.kind];
  return (
    <>
      <h2>{title}</h2>
      {o.kind === 'text' && <TextFields o={o} set={set} />}
      {o.kind === 'stamp' && <StampFields o={o} set={set} />}
      {o.kind === 'frame' && <FrameFields o={o} set={set} />}
      {o.kind === 'shape' && <ShapeFields o={o} set={set} />}
      {o.kind === 'image' && <PicturePick label="Picture" value={o.image} onPick={(image) => image && set({ image })} allowNone={false} />}

      <h2>Position</h2>
      <div className="xy-grid">
        <label>X<input type="number" step={0.5} value={r1(o.x)} onChange={(e) => set({ x: Number(e.target.value) }, 'x')} /></label>
        <label>Y<input type="number" step={0.5} value={r1(o.y)} onChange={(e) => set({ y: Number(e.target.value) }, 'y')} /></label>
        <label>W<input type="number" step={0.5} min={1} value={r1(o.w)} onChange={(e) => set({ w: Math.max(1, Number(e.target.value)) }, 'w')} /></label>
        {o.kind !== 'text' && <label>H<input type="number" step={0.5} min={1} value={r1(o.h)} onChange={(e) => set({ h: Math.max(1, Number(e.target.value)) }, 'h')} /></label>}
      </div>
      <NumberSlider label="Rotation" unit="°" min={-180} max={180} step={1} decimals={0} value={o.angle > 180 ? o.angle - 360 : o.angle} onChange={(angle) => set({ angle: (angle + 360) % 360 }, 'angle')} />
      <NumberSlider label="Opacity" unit="%" min={0} max={100} step={1} decimals={0} value={Math.round(o.opacity * 100)} onChange={(v) => set({ opacity: v / 100 }, 'opacity')} />
      <HoloFields o={o} doc={doc} set={set} commit={commit} />
      <div className="button-row">
        <button aria-pressed={!!o.flipX} onClick={() => set({ flipX: !o.flipX })}>Flip ↔</button>
        <button aria-pressed={!!o.flipY} onClick={() => set({ flipY: !o.flipY })}>Flip ↕</button>
        <button aria-pressed={!!o.locked} onClick={() => commit(updateObject(doc, o.id, { locked: !o.locked }), { select: o.locked ? [o.id] : [] })}>{o.locked ? 'Unlock' : 'Lock'}</button>
      </div>
      <Arrange ids={[o.id]} doc={doc} commit={commit} />
      <div className="button-row">
        <button onClick={() => { const r = duplicateObjects(doc, [o.id]); commit(r.doc, { select: r.ids }); }}>Duplicate</button>
        <button onClick={() => commit(removeObjects(doc, [o.id]), { select: [] })}>Delete</button>
      </div>
      <label className="field">
        <span>Layer name</span>
        <input type="text" value={o.name ?? ''} placeholder={objectLabel({ ...o, name: undefined }, item, (id) => getStamp(id)?.name)} onChange={(e) => set({ name: e.target.value || undefined }, 'name')} />
      </label>
    </>
  );
}

const HOLO_LABELS: Record<'off' | HoloMode, string> = { off: 'Off', light: 'Light parts', full: 'Whole' };

/** Holo foil on the object: on screen in 3D only (print exports draw it as usual). */
function HoloFields({ o, doc, set, commit }: { o: StudioObject; doc: StudioDoc; set: Set; commit: Commit }) {
  const mode = o.holo ?? 'off';
  return (
    <>
      <div className="field">
        <span>Holo foil (3D view only)</span>
        <div className="seg" role="group" aria-label="Holo foil">
          {(['off', 'light', 'full'] as const).map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              className={mode === m ? 'active' : ''}
              title={m === 'light' ? 'Light parts shine as foil, dark parts stay ink (like printing on holo vinyl)' : m === 'full' ? 'The whole shape is foil' : undefined}
              onClick={() => set({ holo: m === 'off' ? undefined : m })}
            >
              {HOLO_LABELS[m]}
            </button>
          ))}
        </div>
      </div>
      {o.holo && <FoilStylePick doc={doc} commit={commit} />}
    </>
  );
}

/** One foil look per design. */
function FoilStylePick({ doc, commit }: { doc: StudioDoc; commit: Commit }) {
  return (
    <label className="field">
      <span>Foil style (all holo objects)</span>
      <select value={doc.foil ?? 'pastel'} onChange={(e) => commit({ ...doc, foil: e.target.value as FoilStyle })}>
        {Object.entries(FOIL_STYLES).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ColorField({ label, value, onChange, onClear }: { label: string; value: string | null; onChange: (c: string) => void; onClear?: () => void }) {
  return (
    <div className="field row">
      <input type="color" aria-label={label} value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      <span className="muted">{label}{value ? `: ${value}` : ': none'}</span>
      {onClear && value && (
        <button className="link" onClick={onClear}>
          Remove
        </button>
      )}
    </div>
  );
}

type Set = (patch: Partial<StudioObject>, coalesce?: string) => void;

function TextFields({ o, set }: { o: StudioText; set: Set }) {
  return (
    <>
      <label className="field">
        <span>Text ({'{title}'}, {'{year}'}, {'{headline}'}, {'{blurb}'} fill in per game)</span>
        <textarea rows={3} value={o.text} onChange={(e) => set({ text: e.target.value }, 'text')} />
      </label>
      <label className="field">
        <span>Font</span>
        <select value={o.font} onChange={(e) => set({ font: e.target.value as StudioFont })}>
          {Object.entries(STUDIO_FONTS).map(([k, f]) => (
            <option key={k} value={k}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <NumberSlider label="Size" unit="mm" min={1} max={30} step={0.1} decimals={1} value={o.size} onChange={(size) => set({ size }, 'size')} />
      <ColorField label="Colour" value={o.color} onChange={(color) => set({ color }, 'color')} />
      <div className="button-row">
        {(['left', 'center', 'right'] as const).map((a) => (
          <button key={a} aria-pressed={o.align === a} className={o.align === a ? 'active' : ''} onClick={() => set({ align: a })}>
            {a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)}
          </button>
        ))}
        <button aria-pressed={o.uppercase} className={o.uppercase ? 'active' : ''} onClick={() => set({ uppercase: !o.uppercase })}>
          AA
        </button>
      </div>
      <NumberSlider label="Line height" unit="×" min={0.7} max={2} step={0.05} decimals={2} value={o.lineHeight} onChange={(lineHeight) => set({ lineHeight }, 'lh')} />
      <NumberSlider label="Letter spacing" unit="" min={-100} max={600} step={10} decimals={0} value={o.spacing} onChange={(spacing) => set({ spacing }, 'sp')} />
      <ColorField label="Outline" value={o.outline?.color ?? null} onChange={(color) => set({ outline: { color, width: o.outline?.width ?? 0.3 } }, 'oc')} onClear={() => set({ outline: null })} />
      {o.outline && <NumberSlider label="Outline width" unit="mm" min={0.05} max={2} step={0.05} decimals={2} value={o.outline.width} onChange={(width) => set({ outline: { ...o.outline!, width } }, 'ow')} />}
      <ColorField label="Glow" value={o.glow} onChange={(glow) => set({ glow }, 'glow')} onClear={() => set({ glow: null })} />
    </>
  );
}

function StampFields({ o, set }: { o: StudioStamp; set: Set }) {
  const def = getStamp(o.stamp);
  return (
    <>
      {def?.local && <p className="muted small">A local stamp: it stays on this computer and isn't shared with the code.</p>}
      <ColorField label={def?.tint ? 'Colour' : 'Recolour (as a silhouette)'} value={o.tint} onChange={(tint) => set({ tint }, 'tint')} onClear={() => set({ tint: null })} />
      {def && (
        <button onClick={() => set({ h: (o.w * def.h) / def.w })} title="Undo any stretching">
          Original proportions
        </button>
      )}
    </>
  );
}

function ShapePick({ value, onPick }: { value: FrameShape; onPick: (s: FrameShape) => void }) {
  return (
    <label className="field">
      <span>Shape</span>
      <select value={value} onChange={(e) => onPick(e.target.value as FrameShape)}>
        {FRAME_SHAPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

function FrameFields({ o, set }: { o: StudioFrame; set: Set }) {
  return (
    <>
      <PicturePick label="Picture in the frame" value={o.image} onPick={(image) => set({ image, zoom: 1, cx: 0.5, cy: 0.5 })} allowNone />
      {o.image && (
        <>
          <div className="button-row">
            <button aria-pressed={o.fit !== 'contain'} onClick={() => set({ fit: 'cover', zoom: 1, cx: 0.5, cy: 0.5 })}>Fill the frame</button>
            <button aria-pressed={o.fit === 'contain'} onClick={() => set({ fit: 'contain', zoom: 1, cx: 0.5, cy: 0.5 })}>Fit inside</button>
          </div>
          <NumberSlider label="Zoom" unit="×" min={1} max={5} step={0.05} decimals={2} value={o.zoom} onChange={(zoom) => set({ zoom }, 'zoom')} />
          <button onClick={() => sendStudio({ type: 'crop', id: o.id })}>Reposition picture…</button>
        </>
      )}
      <ShapePick value={o.shape} onPick={(shape) => set({ shape, radius: shape === 'rounded' && !o.radius ? Math.min(o.w, o.h) * 0.08 : o.radius })} />
      {o.shape === 'rounded' && <NumberSlider label="Corner radius" unit="mm" min={0} max={Math.min(o.w, o.h) / 2} step={0.1} decimals={1} value={o.radius} onChange={(radius) => set({ radius }, 'radius')} />}
      <ColorField label="Border" value={o.border?.color ?? null} onChange={(color) => set({ border: { color, width: o.border?.width ?? 0.4 } }, 'bc')} onClear={() => set({ border: null })} />
      {o.border && <NumberSlider label="Border width" unit="mm" min={0.1} max={3} step={0.05} decimals={2} value={o.border.width} onChange={(width) => set({ border: { ...o.border!, width } }, 'bw')} />}
    </>
  );
}

function ShapeFields({ o, set }: { o: StudioShape; set: Set }) {
  return (
    <>
      <ShapePick value={o.shape} onPick={(shape) => set({ shape })} />
      <ColorField label="Fill" value={o.fill} onChange={(fill) => set({ fill }, 'fill')} />
      {o.shape === 'rounded' && <NumberSlider label="Corner radius" unit="mm" min={0} max={Math.min(o.w, o.h) / 2} step={0.1} decimals={1} value={o.radius} onChange={(radius) => set({ radius }, 'radius')} />}
      <ColorField label="Border" value={o.border?.color ?? null} onChange={(color) => set({ border: { color, width: o.border?.width ?? 0.4 } }, 'bc')} onClear={() => set({ border: null })} />
      {o.border && <NumberSlider label="Border width" unit="mm" min={0.1} max={3} step={0.05} decimals={2} value={o.border.width} onChange={(width) => set({ border: { ...o.border!, width } }, 'bw')} />}
    </>
  );
}

function PicturePick({ label, value, onPick, allowNone }: { label: string; value: ImageRef | null; onPick: (r: ImageRef | null) => void; allowNone: boolean }) {
  const item = useSelectedItem()!;
  return (
    <div className="field">
      <span>{label}</span>
      <div className="thumbs sleeve-thumbs">
        {allowNone && (
          <button className={`thumb none ${value === null ? 'selected' : ''}`} aria-pressed={value === null} onClick={() => onPick(null)}>
            Empty
          </button>
        )}
        {libraryImages(item).map((img) => (
          <button key={img.ref} className={`thumb ${img.ref === value ? 'selected' : ''}`} title={img.label} aria-label={`${label}: ${img.label}`} aria-pressed={img.ref === value} onClick={() => onPick(img.ref)}>
            <img src={srcOf(img.url)} alt="" loading="lazy" crossOrigin="anonymous" />
          </button>
        ))}
      </div>
    </div>
  );
}

/** The layers, top first: select, show/hide, lock, and drag to restack. */
function Layers({ doc, commit }: { doc: StudioDoc; commit: Commit }) {
  const { studioSelection } = useAppState();
  const dispatch = useAppDispatch();
  const item = useSelectedItem();
  const [drag, setDrag] = useState<string | null>(null);
  const list = [...doc.objects].reverse();
  if (!doc.objects.length) return null;
  const icon = { text: 'type', stamp: 'sticker', frame: 'frame', shape: 'square', image: 'image' } as const;
  return (
    <>
      <h2>Layers</h2>
      <ul className="layers" aria-label="Layers">
        {list.map((o, i) => (
          <li
            key={o.id}
            className={`${studioSelection.includes(o.id) ? 'selected' : ''} ${o.hidden ? 'hidden-layer' : ''}`}
            draggable
            onDragStart={() => setDrag(o.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (drag && drag !== o.id) commit(moveToIndex(doc, drag, doc.objects.length - 1 - i));
              setDrag(null);
            }}
          >
            <button className="layer-name" onClick={(e) => dispatch({ type: 'studioSelect', ids: e.shiftKey ? [...new Set([...studioSelection, o.id])] : [o.id] })}>
              <Icon name={icon[o.kind]} />
              {objectLabel(o, item, (id) => getStamp(id)?.name)}
            </button>
            <button className="layer-toggle" title={o.hidden ? 'Show' : 'Hide'} aria-label={o.hidden ? 'Show' : 'Hide'} aria-pressed={!!o.hidden} onClick={() => commit(updateObject(doc, o.id, { hidden: !o.hidden }))}>
              <Icon name={o.hidden ? 'eyeOff' : 'eye'} />
            </button>
            <button className="layer-toggle" title={o.locked ? 'Unlock' : 'Lock'} aria-label={o.locked ? 'Unlock' : 'Lock'} aria-pressed={!!o.locked} onClick={() => commit(updateObject(doc, o.id, { locked: !o.locked }))}>
              <Icon name={o.locked ? 'lock' : 'lockOpen'} />
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
