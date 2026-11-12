import { findValve } from '../model/edit';
import { useStore } from '../state/store';
import { ValvePanel } from './ValvePanel';
import { NodePanel } from './NodePanel';
import { PipePanel } from './PipePanel';
import { ProjectPanel } from './ProjectPanel';
import { PumpPanel } from './PumpPanel';

export function Properties() {
  const selection = useStore((s) => s.selection);
  const project = useStore((s) => s.project);

  let content = <ProjectPanel />;
  if (selection?.type === 'node') {
    const node = project.nodes.find((n) => n.id === selection.id);
    if (node) content = <NodePanel key={node.id} node={node} />;
  } else if (selection?.type === 'pipe') {
    const pipe = project.pipes.find((p) => p.id === selection.id);
    if (pipe) content = <PipePanel key={pipe.id} pipe={pipe} />;
  } else if (selection?.type === 'valve') {
    const found = findValve(project, selection.id);
    if (found) content = <ValvePanel key={found.valve.id} pipe={found.pipe} valve={found.valve} />;
  } else if (selection?.type === 'pump') {
    const pump = project.pumps.find((p) => p.id === selection.id);
    if (pump) content = <PumpPanel key={pump.id} pump={pump} />;
  }
  return (
    <aside className="properties" data-testid="properties">
      {content}
    </aside>
  );
}
