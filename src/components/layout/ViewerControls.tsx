import { useAppDispatch, useAppState, useSelectedItem } from '../../context/AppContext';
import { requestSnapshot } from '../../three/snapshot';

/** Saves what the 3D view shows as a PNG with a transparent background (for launchers, store pages…). */
async function save3dImage(title: string): Promise<void> {
  const url = await requestSnapshot(3);
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[\\/:*?"<>|]+/g, '').trim() || 'cover'} 3D.png`;
  a.click();
}

/** 2D / 3D switch, the guide lines toggle, and (in 3D) an auto-rotate demo spin. They only change the viewer, so they sit inside it. */
export function ViewerControls() {
  const { showGuides, showMeasurements, view, autoRotate } = useAppState();
  const dispatch = useAppDispatch();
  const item = useSelectedItem();
  return (
    <div className="viewer-controls" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div className="seg" role="group" aria-label="View">
        <button className={view === '2d' ? 'active' : ''} onClick={() => dispatch({ type: 'setView', view: '2d' })}>
          2D
        </button>
        <button className={view === '3d' ? 'active' : ''} onClick={() => dispatch({ type: 'setView', view: '3d' })}>
          3D
        </button>
        <button className={view === 'studio' ? 'active' : ''} title="Drag-and-drop stamps, frames and text onto the cover" onClick={() => dispatch({ type: 'setView', view: 'studio' })}>
          Studio
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={showGuides} onChange={(e) => dispatch({ type: 'setShowGuides', show: e.target.checked })} />
        Guides
      </label>
      <label className="check">
        <input type="checkbox" checked={showMeasurements} onChange={(e) => dispatch({ type: 'setShowMeasurements', show: e.target.checked })} />
        Measurements
      </label>
      {view === '3d' && (
        <label className="check">
          <input type="checkbox" checked={autoRotate} onChange={(e) => dispatch({ type: 'setAutoRotate', autoRotate: e.target.checked })} />
          Auto-rotate
        </label>
      )}
      {view === '3d' && item && (
        <button title="Save this view as a PNG with a transparent background" onClick={() => void save3dImage(item.title)}>
          Save image
        </button>
      )}
    </div>
  );
}
