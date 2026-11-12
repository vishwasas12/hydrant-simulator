import type { Network } from '../model/types';
import { runCapacity, type CapacityOptions, type CapacityResult } from './capacity';

export interface WorkerRequest {
  network: Network;
  options: CapacityOptions;
}

export type WorkerMessage =
  | { type: 'progress'; done: number; total: number; phase: string }
  | { type: 'result'; result: CapacityResult }
  | { type: 'error'; message: string };

const post = (message: WorkerMessage): void => {
  (self as unknown as { postMessage: (m: WorkerMessage) => void }).postMessage(message);
};

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const result = runCapacity(event.data.network, event.data.options, (done, total, phase) => {
      post({ type: 'progress', done, total, phase });
    });
    post({ type: 'result', result });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : 'The search failed.' });
  }
};
