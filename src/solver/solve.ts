import type { Network, ScenarioOverrides } from '../model/types';
import { compile } from './compile';
import { iterate } from './gga';
import { buildResults, failedResults } from './results';
import type { SolveResults } from './types';

/**
 * Steady-state hydraulic solve. A pure function of its inputs: it reads the
 * network and optional scenario overrides and returns a results object.
 */
export function solve(network: Network, scenario?: ScenarioOverrides): SolveResults {
  const compiled = compile(network, scenario);
  if (compiled.fatal || !compiled.ldl) {
    return failedResults(network, compiled.issues);
  }
  const state = iterate(compiled, compiled.initialOn);
  return buildResults(compiled, compiled.initialOn, state);
}
