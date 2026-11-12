import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { seedProject } from '../model/seed';
import { parseProject } from '../model/schema';
import type { Id, Project, Scenario } from '../model/types';
import { solve, type SolveResults } from '../solver';

export type Tool =
  | 'select'
  | 'junction'
  | 'pipe'
  | 'valve'
  | 'hydrant'
  | 'hoseReel'
  | 'pump'
  | 'toggle'
  | 'calibrate';
export type ColorBy = 'diameter' | 'pressure' | 'velocity';
export type Selection = { type: 'node' | 'pipe' | 'pump' | 'valve'; id: Id } | null;

export type BottomTab =
  | 'manual'
  | 'nodes'
  | 'pipes'
  | 'hydrants'
  | 'path'
  | 'charts'
  | 'requirement'
  | 'capacity'
  | 'scenarios'
  | 'assumptions';

export interface Camera {
  tx: number;
  ty: number;
  k: number;
}

export interface ViewOptions {
  colorBy: ColorBy;
  showGrid: boolean;
  showLabels: boolean;
  showFittings: boolean;
  showFlow: boolean;
  showDelta: boolean;
  showCriticalPath: boolean;
  ortho: boolean;
  snap: boolean;
  gridSize: number;
}

const HISTORY_LIMIT = 200;
/** Edits with the same key inside this window collapse into one undo step. */
const COALESCE_MS = 800;
const AUTOSAVE_KEY = 'hydrant-sim.project.v1';

interface State {
  project: Project;
  past: Project[];
  future: Project[];
  lastEditKey: string | null;
  lastEditTime: number;
  tool: Tool;
  selection: Selection;
  pipeStart: Id | null;
  newPipeSize: number;
  view: ViewOptions;
  camera: Camera;
  fitRequest: number;
  bottomTab: BottomTab;
  bottomOpen: boolean;
  toast: string | null;
  autosaveNote: string | null;

  update: (recipe: (draft: Draft<Project>) => void, key?: string) => void;
  undo: () => void;
  redo: () => void;
  setTool: (tool: Tool) => void;
  select: (selection: Selection) => void;
  setPipeStart: (id: Id | null) => void;
  setNewPipeSize: (size: number) => void;
  setView: (patch: Partial<ViewOptions>) => void;
  setCamera: (camera: Camera) => void;
  requestFit: () => void;
  setBottomTab: (tab: BottomTab) => void;
  setBottomOpen: (open: boolean) => void;
  showToast: (message: string | null) => void;
  loadProject: (project: Project) => void;
}

function initialProject(): Project {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const parsed = parseProject(JSON.parse(raw));
      if (parsed.ok) return parsed.project;
    }
  } catch {
    // Storage blocked or data corrupt: fall through to the seed project.
  }
  return seedProject();
}

export const useStore = create<State>((set, get) => ({
  project: initialProject(),
  past: [],
  future: [],
  lastEditKey: null,
  lastEditTime: 0,
  tool: 'select',
  selection: null,
  pipeStart: null,
  newPipeSize: 150,
  view: {
    colorBy: 'diameter',
    showGrid: true,
    showLabels: true,
    showFittings: true,
    showFlow: true,
    showDelta: false,
    showCriticalPath: false,
    ortho: false,
    snap: false,
    gridSize: 10,
  },
  camera: { tx: 0, ty: 0, k: 1 },
  fitRequest: 0,
  bottomTab: 'manual',
  bottomOpen: true,
  toast: null,
  autosaveNote: null,

  update: (recipe, key) => {
    const { project, past, lastEditKey, lastEditTime } = get();
    const next = produce(project, recipe);
    if (next === project) return;
    const now = Date.now();
    const coalesce = key !== undefined && key === lastEditKey && now - lastEditTime < COALESCE_MS;
    set({
      project: next,
      past: coalesce ? past : [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      lastEditKey: key ?? null,
      lastEditTime: now,
    });
  },

  undo: () => {
    const { past, project, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    set({
      project: previous,
      past: past.slice(0, -1),
      future: [project, ...future],
      lastEditKey: null,
      selection: null,
      pipeStart: null,
    });
  },

  redo: () => {
    const { past, project, future } = get();
    if (future.length === 0) return;
    set({
      project: future[0],
      future: future.slice(1),
      past: [...past, project],
      lastEditKey: null,
      selection: null,
      pipeStart: null,
    });
  },

  setTool: (tool) => set({ tool, pipeStart: null }),
  select: (selection) => set({ selection }),
  setPipeStart: (pipeStart) => set({ pipeStart }),
  setNewPipeSize: (newPipeSize) => set({ newPipeSize }),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  setCamera: (camera) => set({ camera }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setBottomTab: (bottomTab) => set({ bottomTab, bottomOpen: true }),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
  showToast: (toast) => set({ toast }),
  loadProject: (project) =>
    set((s) => ({
      project,
      past: [],
      future: [],
      selection: null,
      pipeStart: null,
      lastEditKey: null,
      fitRequest: s.fitRequest + 1,
    })),
}));

/* Solve caching. Results depend only on the network, so unrelated edits are free. */

let solvedFor: unknown[] = [];
let solvedResults: SolveResults | null = null;
let solvedMs = 0;

export function networkKey(p: Project): unknown[] {
  return [p.nodes, p.pipes, p.pumps, p.settings, p.tables];
}

function sameKey(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function resultsFor(project: Project): { results: SolveResults; ms: number } {
  const key = networkKey(project);
  if (!solvedResults || !sameKey(key, solvedFor)) {
    const t0 = performance.now();
    solvedResults = solve(project);
    solvedMs = performance.now() - t0;
    solvedFor = key;
  }
  return { results: solvedResults, ms: solvedMs };
}

export function useResults(): SolveResults {
  return resultsFor(useStore((s) => s.project)).results;
}

let baselineFor: unknown[] = [];
let baselineResults: SolveResults | null = null;

export function baselineResultsFor(project: Project): SolveResults | null {
  const baseline: Scenario | null = project.baseline;
  if (!baseline) return null;
  const key = [...networkKey(project), baseline];
  if (!baselineResults || !sameKey(key, baselineFor)) {
    baselineResults = solve(project, baseline);
    baselineFor = key;
  }
  return baselineResults;
}

/* Autosave, debounced. A large background image can exceed the storage quota. */

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist(project: Project): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(project));
    useStore.setState({ autosaveNote: null });
  } catch {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ ...project, background: null }));
      useStore.setState({
        autosaveNote: 'Autosaved without the background image, which is too large for browser storage. Save a project file to keep it.',
      });
    } catch {
      useStore.setState({ autosaveNote: 'Autosave is unavailable in this browser.' });
    }
  }
}

useStore.subscribe((state, previous) => {
  if (state.project === previous.project) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persist(state.project), 400);
});
