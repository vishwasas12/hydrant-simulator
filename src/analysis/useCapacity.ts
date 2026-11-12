import { create } from 'zustand';
import type { Network, Project } from '../model/types';
import { networkKey } from '../state/store';
import type { CapacityOptions, CapacityResult } from './capacity';
import type { WorkerMessage, WorkerRequest } from './capacity.worker';

interface CapacityState {
  running: boolean;
  done: number;
  total: number;
  phase: string;
  result: CapacityResult | null;
  error: string | null;
  /** Network the current result was computed from, for staleness checks. */
  resultKey: unknown[] | null;
  run: (project: Project, options: CapacityOptions) => void;
  cancel: () => void;
}

let worker: Worker | null = null;

function stop(): void {
  worker?.terminate();
  worker = null;
}

/** Runs the search off the main thread and keeps its state across tab changes. */
export const useCapacity = create<CapacityState>((set) => ({
  running: false,
  done: 0,
  total: 0,
  phase: '',
  result: null,
  error: null,
  resultKey: null,

  run: (project, options) => {
    stop();
    const key = networkKey(project);
    set({ running: true, done: 0, total: 1, phase: 'Starting', error: null });
    worker = new Worker(new URL('./capacity.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') {
        set({ done: message.done, total: message.total, phase: message.phase });
      } else if (message.type === 'result') {
        set({ running: false, result: message.result, resultKey: key });
        stop();
      } else {
        set({ running: false, error: message.message });
        stop();
      }
    };
    worker.onerror = (event) => {
      set({ running: false, error: event.message || 'The search failed.' });
      stop();
    };
    const network: Network = {
      nodes: project.nodes,
      pipes: project.pipes,
      pumps: project.pumps,
      settings: project.settings,
      tables: project.tables,
    };
    const request: WorkerRequest = { network, options };
    worker.postMessage(request);
  },

  cancel: () => {
    stop();
    set({ running: false, phase: '' });
  },
}));
