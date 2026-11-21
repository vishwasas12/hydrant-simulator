import type { ReactNode } from 'react';
import { useStore, type BottomTab } from '../state/store';
import { AssumptionsTab } from './AssumptionsTab';
import { CapacityTab } from './CapacityTab';
import { ChartsTab } from './charts';
import { RequirementTab } from './RequirementTab';
import { CriticalPathTab } from './CriticalPathTab';
import { ManualTab } from './ManualTab';
import { HydrantsTab, NodesTab, PipesTab } from './ResultsTables';
import { ScenariosTab } from './ScenariosTab';

const TABS: { id: BottomTab; label: string; view: () => ReactNode }[] = [
  { id: 'manual', label: 'Operation', view: () => <ManualTab /> },
  { id: 'nodes', label: 'Nodes', view: () => <NodesTab /> },
  { id: 'pipes', label: 'Pipes', view: () => <PipesTab /> },
  { id: 'hydrants', label: 'Hydrants', view: () => <HydrantsTab /> },
  { id: 'path', label: 'Critical path', view: () => <CriticalPathTab /> },
  { id: 'charts', label: 'Charts', view: () => <ChartsTab /> },
  { id: 'requirement', label: 'Individual check', view: () => <RequirementTab /> },
  { id: 'capacity', label: 'Capacity', view: () => <CapacityTab /> },
  { id: 'scenarios', label: 'Scenarios', view: () => <ScenariosTab /> },
  { id: 'assumptions', label: 'Assumptions', view: () => <AssumptionsTab /> },
];

export function BottomPanel() {
  const bottomOpen = useStore((s) => s.bottomOpen);
  const bottomTab = useStore((s) => s.bottomTab);
  const setBottomTab = useStore((s) => s.setBottomTab);
  const setBottomOpen = useStore((s) => s.setBottomOpen);
  const active = TABS.find((t) => t.id === bottomTab) ?? TABS[0];

  return (
    <section className={`bottom${bottomOpen ? '' : ' collapsed'}`} data-testid="bottom-panel">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={bottomOpen && active.id === t.id}
            className={bottomOpen && active.id === t.id ? 'active' : ''}
            data-testid={`tab-${t.id}`}
            onClick={() => setBottomTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="viewbar-fill" />
        <button
          type="button"
          className="tabs-collapse"
          aria-label={bottomOpen ? 'Collapse results panel' : 'Expand results panel'}
          onClick={() => setBottomOpen(!bottomOpen)}
        >
          {bottomOpen ? '▾' : '▴'}
        </button>
      </div>
      {bottomOpen && <div className="tab-body">{active.view()}</div>}
    </section>
  );
}
