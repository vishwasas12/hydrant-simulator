import type { Id, Network } from '../model/types';
import { checkOutlet, compile, iterate, m3sToLpm, pumpHead, type HydraulicState } from '../solver';
import { requirementCheck } from './requirement';

export interface CapacityOptions {
  /** The k used for the worst-case and k-farthest reports. */
  chosenK: number;
  /** Fail any combination that pushes the pump past its last curve point. */
  respectPumpLimit: boolean;
  /** Largest hydrant count searched exhaustively. */
  exhaustiveLimit?: number;
  /** Largest C(n, k) enumerated exactly on bigger networks. */
  exactKLimit?: number;
}

export interface Combo {
  /** Indices into CapacityResult.hydrants. */
  members: number[];
  count: number;
  margin: number;
  pass: boolean;
  /** Member with the smallest margin. */
  critical: number;
  pumpFlowLpm: number;
  pumpHeadM: number;
  reason: string;
}

export interface HydrantRef {
  id: Id;
  label: string;
  /** Pump head needed for this hydrant alone. Higher is more remote. */
  pumpHeadNeededM: number;
}

export interface CapacityResult {
  method: 'exhaustive' | 'greedy';
  hydrants: HydrantRef[];
  /** Hydrants left out because they have no path to the pump. */
  excluded: string[];
  evaluated: number;
  /** Largest k with at least one passing combination. */
  maxSimultaneous: number;
  maxExact: boolean;
  bestCombo: Combo | null;
  /** Largest k such that every combination of that size passes. */
  guaranteedK: number;
  guaranteedExact: boolean;
  chosenK: number;
  worstForK: Combo | null;
  worstForKExact: boolean;
  kFarthest: Combo | null;
  /** Hydrant indices from most to least remote. */
  remoteness: number[];
  /** Sorted from worst margin to best. */
  combos: Combo[];
}

export type ProgressFn = (done: number, total: number, phase: string) => void;

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= Math.min(k, n - k); i++) {
    result = (result * (n - i + 1)) / i;
  }
  return Math.round(result);
}

/** Calls `visit` with every k-subset of 0..n-1, in lexicographic order. */
function forEachSubset(n: number, k: number, visit: (subset: number[]) => void): void {
  const idx = Array.from({ length: k }, (_, i) => i);
  for (;;) {
    visit(idx.slice());
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/**
 * Finds how many hydrants can run together. Up to the exhaustive limit every
 * combination is solved. Beyond it, greedy searches run, and combination sizes
 * small enough to enumerate are still solved exactly.
 */
export function runCapacity(
  network: Network,
  options: CapacityOptions,
  onProgress: ProgressFn = () => undefined,
): CapacityResult {
  const compiled = compile(network);
  if (compiled.fatal || !compiled.ldl) {
    const first = compiled.issues.find((i) => i.severity === 'error');
    throw new Error(first ? first.message : 'The network cannot be solved.');
  }

  const exhaustiveLimit = options.exhaustiveLimit ?? 15;
  const exactKLimit = options.exactKLimit ?? 100000;
  const hydrantOutlets = compiled.outlets
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => o.isHydrant);
  const n = hydrantOutlets.length;
  const reachable = new Set(hydrantOutlets.map(({ o }) => o.nodeId));
  const excluded = network.nodes
    .filter((x) => x.kind === 'hydrant' && !reachable.has(x.id))
    .map((x) => x.label);

  const requirement = new Map(requirementCheck(network).map((r) => [r.id, r]));
  const hydrants: HydrantRef[] = hydrantOutlets.map(({ o }) => ({
    id: o.nodeId,
    label: o.label,
    pumpHeadNeededM: requirement.get(o.nodeId)?.pumpHeadNeededM ?? 0,
  }));
  const remoteness = hydrants
    .map((_, i) => i)
    .sort((a, b) => hydrants[b].pumpHeadNeededM - hydrants[a].pumpHeadNeededM);
  const chosenK = Math.min(Math.max(Math.round(options.chosenK), 1), Math.max(n, 1));

  // Hose reels stay in their current state. Hydrants are set per combination.
  const on = compiled.initialOn.slice();
  for (const { i } of hydrantOutlets) on[i] = false;

  const pumpLink = compiled.pumpLinks[0];
  const curve = compiled.pumpCurves[pumpLink];
  let warm: HydraulicState | undefined;
  let evaluated = 0;
  const seen = new Map<string, Combo>();

  const solveMembers = (members: number[]): HydraulicState => {
    for (const { i } of hydrantOutlets) on[i] = false;
    for (const m of members) on[hydrantOutlets[m].i] = true;
    let state = iterate(compiled, on, warm);
    if (!state.converged) state = iterate(compiled, on);
    return state;
  };

  const evaluate = (members: number[]): Combo => {
    const key = members.join(',');
    const known = seen.get(key);
    if (known) return known;
    const state = solveMembers(members);
    evaluated++;
    warm = state.converged ? state : undefined;
    let margin = Infinity;
    let critical = members[0];
    let pass = state.converged;
    let reason = state.converged ? '' : 'Did not converge';
    for (const m of members) {
      const check = checkOutlet(compiled, hydrantOutlets[m].o, state);
      if (check.margin < margin) {
        margin = check.margin;
        critical = m;
      }
      if (!check.pressureOk || !check.flowOk) {
        pass = false;
        if (!reason) {
          reason = `${hydrants[m].label}: ${!check.pressureOk ? 'pressure' : 'flow'} below minimum`;
        }
      }
    }
    const pumpFlowLpm = m3sToLpm(Math.max(state.flows[pumpLink], 0));
    if (options.respectPumpLimit && curve && pumpFlowLpm > curve.maxFlowLpm + 1e-6) {
      pass = false;
      margin = Math.min(margin, (curve.maxFlowLpm - pumpFlowLpm) / curve.maxFlowLpm);
      reason = reason || 'Pump beyond last curve point';
    }
    const combo: Combo = {
      members,
      count: members.length,
      margin,
      pass,
      critical,
      pumpFlowLpm,
      pumpHeadM: curve ? pumpHead(curve, pumpFlowLpm) : 0,
      reason,
    };
    seen.set(key, combo);
    return combo;
  };

  const finish = (partial: Omit<CapacityResult, 'hydrants' | 'excluded' | 'evaluated' | 'chosenK' | 'remoteness' | 'combos' | 'kFarthest'>): CapacityResult => {
    const kFarthest = n > 0 ? evaluate(remoteness.slice(0, chosenK).sort((a, b) => a - b)) : null;
    const combos = [...seen.values()].sort((a, b) => a.margin - b.margin);
    return { ...partial, hydrants, excluded, evaluated, chosenK, remoteness, combos, kFarthest };
  };

  if (n === 0) {
    return finish({
      method: 'exhaustive',
      maxSimultaneous: 0,
      maxExact: true,
      bestCombo: null,
      guaranteedK: 0,
      guaranteedExact: true,
      worstForK: null,
      worstForKExact: true,
    });
  }

  const summarise = (k: number): { any: boolean; all: boolean; best: Combo | null; worst: Combo | null } => {
    let any = false;
    let all = true;
    let best: Combo | null = null;
    let worst: Combo | null = null;
    for (const c of seen.values()) {
      if (c.count !== k) continue;
      any = any || c.pass;
      all = all && c.pass;
      if (!best || c.margin > best.margin) best = c;
      if (!worst || c.margin < worst.margin) worst = c;
    }
    return { any, all, best, worst };
  };

  if (n <= exhaustiveLimit) {
    const total = (1 << n) - 1;
    let previous = 0;
    for (let g = 1; g <= total; g++) {
      // Gray code: one hydrant changes per step, so each solve warm-starts well.
      const gray = g ^ (g >> 1);
      previous = gray;
      const members: number[] = [];
      for (let b = 0; b < n; b++) if (previous & (1 << b)) members.push(b);
      evaluate(members);
      if ((g & 255) === 0 || g === total) onProgress(g, total, 'Solving every combination');
    }
    let maxSimultaneous = 0;
    let bestCombo: Combo | null = null;
    let guaranteedK = 0;
    let stillGuaranteed = true;
    for (let k = 1; k <= n; k++) {
      const s = summarise(k);
      if (s.any) {
        maxSimultaneous = k;
        bestCombo = s.best;
      }
      if (stillGuaranteed && s.all) guaranteedK = k;
      else stillGuaranteed = false;
    }
    return finish({
      method: 'exhaustive',
      maxSimultaneous,
      maxExact: true,
      bestCombo,
      guaranteedK,
      guaranteedExact: true,
      worstForK: summarise(chosenK).worst,
      worstForKExact: true,
    });
  }

  // Greedy searches for networks too large to enumerate completely.
  const greedy = (mode: 'best' | 'worst'): Combo[] => {
    const chosen: number[] = [];
    const remaining = new Set(hydrants.map((_, i) => i));
    const path: Combo[] = [];
    while (remaining.size > 0) {
      let pick = -1;
      let pickCombo: Combo | null = null;
      for (const h of remaining) {
        const combo = evaluate([...chosen, h].sort((a, b) => a - b));
        const better =
          !pickCombo || (mode === 'best' ? combo.margin > pickCombo.margin : combo.margin < pickCombo.margin);
        if (better) {
          pick = h;
          pickCombo = combo;
        }
      }
      if (!pickCombo) break;
      path.push(pickCombo);
      if (mode === 'best' && !pickCombo.pass) break;
      chosen.push(pick);
      remaining.delete(pick);
      if (mode === 'worst' && !pickCombo.pass && chosen.length >= chosenK) break;
    }
    return path;
  };

  onProgress(0, 1, 'Greedy search');
  const bestPath = greedy('best');
  const worstPath = greedy('worst');

  // Enumerate each combination size that fits the budget, smallest first.
  let total = 0;
  for (let k = 1; k <= n && binomial(n, k) <= exactKLimit; k++) total += binomial(n, k);
  let done = 0;
  let guaranteedK = 0;
  let guaranteedExact = false;
  let maxEnumerated = 0;
  let bestEnumerated: Combo | null = null;
  let maxExact = false;
  let lastEnumeratedK = 0;

  for (let k = 1; k <= n && binomial(n, k) <= exactKLimit; k++) {
    forEachSubset(n, k, (subset) => {
      evaluate(subset);
      done++;
      if ((done & 255) === 0) onProgress(done, total, `Solving combinations of ${k}`);
    });
    lastEnumeratedK = k;
    const s = summarise(k);
    if (!guaranteedExact) {
      if (s.all) guaranteedK = k;
      else guaranteedExact = true;
    }
    if (s.any) {
      maxEnumerated = k;
      bestEnumerated = s.best;
    } else {
      maxExact = true;
      break;
    }
  }

  const greedyPasses = bestPath.filter((c) => c.pass);
  const greedyMax = greedyPasses.length > 0 ? greedyPasses[greedyPasses.length - 1] : null;
  const useGreedy = !maxExact && !!greedyMax && greedyMax.count > maxEnumerated;
  const maxSimultaneous = useGreedy && greedyMax ? greedyMax.count : maxEnumerated;
  const bestCombo = useGreedy ? greedyMax : bestEnumerated;

  // A greedy worst-case failure caps the guarantee even when it is not exact.
  if (!guaranteedExact) {
    const firstFail = worstPath.find((c) => !c.pass);
    guaranteedK = firstFail ? firstFail.count - 1 : Math.max(guaranteedK, worstPath.length);
  }

  let worstForK: Combo | null;
  let worstForKExact: boolean;
  if (binomial(n, chosenK) <= exactKLimit) {
    if (chosenK > lastEnumeratedK) forEachSubset(n, chosenK, (subset) => void evaluate(subset));
    worstForK = summarise(chosenK).worst;
    worstForKExact = true;
  } else {
    const candidates = [
      worstPath.find((c) => c.count === chosenK),
      evaluate(remoteness.slice(0, chosenK).sort((a, b) => a - b)),
    ].filter((c): c is Combo => !!c);
    worstForK = candidates.reduce<Combo | null>((w, c) => (!w || c.margin < w.margin ? c : w), null);
    worstForKExact = false;
  }

  onProgress(1, 1, 'Done');
  return finish({
    method: 'greedy',
    maxSimultaneous,
    maxExact,
    bestCombo,
    guaranteedK,
    guaranteedExact,
    worstForK,
    worstForKExact,
  });
}
