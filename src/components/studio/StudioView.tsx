import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAppDispatch, useAppState, useSelectedItem } from '../../context/AppContext';
import type { MediaItem } from '../../types/media';
import type { StudioObject } from '../../types/studio';
import { preloadItem, renderCover } from '../../engine/CanvasRenderer';
import { canvasSizePx } from '../../templates';
import { readImageFile } from '../../api/upload';
import { StudioController } from '../../studio/controller';
import { arrange, duplicateObjects, pasteObjects, removeObjects, replaceObjects, studioOf, updateObject } from '../../studio/doc';
import { DRAG_MIME, placePayload, type DragPayload } from '../../studio/place';
import { onStudio } from '../../studio/bus';
import { StudioElements } from './StudioElements';
import { Icon } from './Icon';

/** Objects copied with Ctrl+C, kept across items so a sticker can be pasted onto another game. */
let clipboard: StudioObject[] = [];

/**
 * The Studio: the cover underneath, and Fabric objects on top to drag, scale, rotate and retype; an Elements drawer on
 * the left (layouts, frames, stamps, text, pictures) to drag from. The right sidebar shows the Inspector.
 */
export function StudioView() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const item = useSelectedItem();
  const { template, shared, designs, banner, showGuides, studioSelection, selectedPanel } = state;
  const host = useRef<HTMLDivElement>(null);
  const canvasEl = useRef<HTMLCanvasElement>(null);
  const ctl = useRef<StudioController | null>(null);
  const latest = useRef<{ item: MediaItem | null }>({ item });
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [zoom, setZoom] = useState(100);
  const [cropping, setCropping] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateSel = useRef(studioSelection);
  // Handlers read the latest item and selection through refs, so they needn't be re-registered on every edit.
  useLayoutEffect(() => {
    latest.current.item = item;
    stateSel.current = studioSelection;
  }, [item, studioSelection]);

  const doc = studioOf(item);

  /** Saves a new document for the selected item (one undo step, or merged into the last with the same key). */
  const commit = useCallback(
    (next: ReturnType<typeof studioOf>, opts: { select?: string[]; coalesce?: string } = {}) => {
      const it = latest.current.item;
      if (it) dispatch({ type: 'studioSet', id: it.id, doc: next, ...opts });
    },
    [dispatch],
  );

  // The Fabric controller lives as long as the view.
  useEffect(() => {
    if (!canvasEl.current || !host.current) return;
    const c = new StudioController(canvasEl.current, host.current, {
      onChange: (objs) => commit(replaceObjects(studioOf(latest.current.item), objs)),
      onSelect: (ids) => dispatch({ type: 'studioSelect', ids }),
      onCropMode: setCropping,
      onZoom: setZoom,
    });
    ctl.current = c;
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(host.current);
    const off = onStudio((cmd) => {
      if (cmd.type === 'crop') void c.startCrop(cmd.id);
      else if (cmd.type === 'endCrop') void c.endCrop(true);
      else c.fit();
    });
    return () => {
      off();
      ro.disconnect();
      c.dispose();
      ctl.current = null;
    };
  }, [commit, dispatch]);

  // The cover underneath, rendered without the Studio layer. Studio edits don't change it, so it's keyed on the rest.
  const itemKey = useMemo(() => (item ? JSON.stringify({ ...item, studio: undefined, hide: item.studio?.hideBranded }) : ''), [item]);
  useEffect(() => {
    if (!item) return;
    let live = true;
    const draw = () => {
      const { width, height } = canvasSizePx(template);
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      renderCover(c.getContext('2d')!, { template, item, shared, designs, banner, showGuides: false, skipStudio: true }, template.dpiScale);
      if (live) setBase(c);
    };
    void preloadItem({ item, shared, designs }).then(draw);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on itemKey: Studio-only changes don't redraw the cover
  }, [itemKey, template, shared, designs, banner]);

  useEffect(() => {
    if (!item || !ctl.current) return;
    void ctl.current.setScene({ template, item, doc, base, guides: true, selection: studioSelection });
  }, [item, doc, base, template, studioSelection, showGuides]);

  /** Adds something from the drawer (or a drop) and selects it. */
  const place = useCallback(
    async (p: DragPayload, at: { x: number; y: number } | null, forItem?: MediaItem) => {
      const it = forItem ?? latest.current.item;
      if (!it) return;
      const r = await placePayload(p, at, { doc: studioOf(it), item: it, template, panel: selectedPanel });
      if (r) commit(r.doc, { select: r.select });
    },
    [commit, template, selectedPanel],
  );

  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDropHint(false);
    const c = ctl.current;
    const it = latest.current.item;
    if (!c || !it) return;
    const at = c.clientToMm(e.clientX, e.clientY);
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (raw) {
      await place(JSON.parse(raw) as DragPayload, at);
      return;
    }
    // Pictures dragged in from the desktop: added to the game's pictures, then placed (or put in the frame below).
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    setError(null);
    try {
      let current = it;
      for (const [i, f] of files.entries()) {
        const url = await readImageFile(f);
        dispatch({ type: 'addAsset', id: it.id, url });
        current = { ...current, assets: { ...current.assets, screenshots: [...current.assets.screenshots, url] } };
        await place({ kind: 'image', ref: `screenshot:${current.assets.screenshots.length - 1}` }, { x: at.x + i * 4, y: at.y + i * 4 }, current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t add that picture');
    }
  }

  // Keyboard: delete, duplicate, copy/paste, undo/redo, nudge, arrange, select all.
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
    const down = (e: KeyboardEvent) => {
      const c = ctl.current;
      const it = latest.current.item;
      if (e.code === 'Space' && !typing(e.target)) c?.setSpace(true);
      if (!c || !it || typing(e.target)) return;
      const active = c.canvas.getActiveObject() as { isEditing?: boolean } | undefined;
      if (active?.isEditing) return;
      const d = studioOf(it);
      const sel = stateSel.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'studioRedo' : 'studioUndo', id: it.id });
      } else if (mod && key === 'y') {
        e.preventDefault();
        dispatch({ type: 'studioRedo', id: it.id });
      } else if (e.key === 'Escape') {
        if (c.cropping) void c.endCrop(true);
        else dispatch({ type: 'studioSelect', ids: [] });
      } else if (e.key === 'Enter' && c.cropping) {
        void c.endCrop(true);
      } else if (!sel.length) {
        if (mod && key === 'a') {
          e.preventDefault();
          dispatch({ type: 'studioSelect', ids: d.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id) });
        } else if (mod && key === 'v' && clipboard.length) {
          e.preventDefault();
          const r = pasteObjects(d, clipboard);
          commit(r.doc, { select: r.ids });
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        commit(removeObjects(d, sel), { select: [] });
      } else if (mod && key === 'd') {
        e.preventDefault();
        const r = duplicateObjects(d, sel);
        commit(r.doc, { select: r.ids });
      } else if (mod && key === 'c') {
        clipboard = d.objects.filter((o) => sel.includes(o.id)).map((o) => structuredClone(o));
      } else if (mod && key === 'v' && clipboard.length) {
        e.preventDefault();
        const r = pasteObjects(d, clipboard);
        commit(r.doc, { select: r.ids });
      } else if (mod && key === 'a') {
        e.preventDefault();
        dispatch({ type: 'studioSelect', ids: d.objects.filter((o) => !o.locked && !o.hidden).map((o) => o.id) });
      } else if (e.key === ']' || e.key === '[') {
        e.preventDefault();
        commit(arrange(d, sel, e.key === ']' ? (mod ? 'front' : 'forward') : mod ? 'back' : 'backward'));
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 0.5;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        let next = d;
        for (const o of d.objects) if (sel.includes(o.id)) next = updateObject(next, o.id, { x: o.x + dx, y: o.y + dy });
        commit(next, { coalesce: `nudge:${sel.join(',')}` });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') ctl.current?.setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [commit, dispatch]);
  const history = item ? state.studioHistory[item.id] : undefined;

  return (
    <div className="studio">
      <StudioElements onAdd={(p) => void place(p, null)} />
      <div
        className={`studio-stage ${dropHint ? 'drop' : ''}`}
        ref={host}
        onDragOver={(e) => {
          if ([...e.dataTransfer.types].some((t) => t === DRAG_MIME || t === 'Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDropHint(true);
          }
        }}
        onDragLeave={() => setDropHint(false)}
        onDrop={(e) => void onDrop(e)}
      >
        <canvas ref={canvasEl} />
        {!item && <p className="empty-hint">Add a game to start designing.</p>}
        <div className="studio-toolbar" onPointerDown={(e) => e.stopPropagation()}>
          <button title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!history?.past.length} onClick={() => item && dispatch({ type: 'studioUndo', id: item.id })}>
            <Icon name="undo" />
          </button>
          <button title="Redo (Ctrl+Y)" aria-label="Redo" disabled={!history?.future.length} onClick={() => item && dispatch({ type: 'studioRedo', id: item.id })}>
            <Icon name="redo" />
          </button>
          <span className="sep" />
          <button aria-label="Zoom out" onClick={() => ctl.current?.zoomBy(1 / 1.25)}>
            −
          </button>
          <button className="zoom" title="Fit to view" onClick={() => ctl.current?.fit()}>
            {zoom}%
          </button>
          <button aria-label="Zoom in" onClick={() => ctl.current?.zoomBy(1.25)}>
            +
          </button>
        </div>
        {cropping && (
          <div className="studio-crop-bar" onPointerDown={(e) => e.stopPropagation()}>
            <span>Drag or scale the picture inside its frame</span>
            <button className="primary" onClick={() => void ctl.current?.endCrop(true)}>
              Done
            </button>
          </div>
        )}
        <p className="studio-help muted">Drag from the left onto the cover · drop pictures from your computer · double-click a frame to reposition its picture · Space + drag to pan</p>
        {error && <p className="error studio-error">{error}</p>}
      </div>
    </div>
  );
}
