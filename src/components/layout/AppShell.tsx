import { lazy, Suspense, useState } from 'react';
import { useAppState } from '../../context/AppContext';
import { SearchPanel } from '../search/SearchPanel';
import { CanvasEditor } from '../editor/CanvasEditor';
import { PanelControls } from '../editor/PanelControls';
import { ExportModal } from '../export/ExportModal';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { ViewerControls } from './ViewerControls';
import { StatusBar } from './StatusBar';

// three.js is heavy; only load it when the 3D view is first opened.
const ThreeDPreview = lazy(() => import('../preview/ThreeDPreview').then((m) => ({ default: m.ThreeDPreview })));
// The Studio brings Fabric.js; only load it when the Studio is opened.
const StudioView = lazy(() => import('../studio/StudioView').then((m) => ({ default: m.StudioView })));
const StudioInspector = lazy(() => import('../studio/StudioInspector').then((m) => ({ default: m.StudioInspector })));

export function AppShell() {
  const { view } = useAppState();
  const [exporting, setExporting] = useState(false);

  return (
    <div className="shell">
      <Toolbar onExport={() => setExporting(true)} />
      <Sidebar side="left" label="the media panel">
        <SearchPanel />
      </Sidebar>
      <main className="main">
        {view === '2d' ? (
          <CanvasEditor />
        ) : view === 'studio' ? (
          <Suspense fallback={<p className="empty-hint">Loading the Studio…</p>}>
            <StudioView />
          </Suspense>
        ) : (
          <Suspense fallback={<p className="empty-hint">Loading 3D viewer…</p>}>
            <ThreeDPreview />
          </Suspense>
        )}
        <ViewerControls />
      </main>
      <Sidebar side="right" label="the design panel">
        {view === 'studio' ? (
          <Suspense fallback={null}>
            <StudioInspector />
          </Suspense>
        ) : (
          <PanelControls />
        )}
      </Sidebar>
      <StatusBar />
      {exporting && <ExportModal onClose={() => setExporting(false)} />}
    </div>
  );
}
