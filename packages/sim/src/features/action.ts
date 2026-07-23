/**
 * @module features/action
 *
 * Action featurizer + masker: encodes each {@link EvaluatedAction} candidate
 * from `computeLegalActions` as a fixed-width vector, with `viable` as the
 * legality mask. This is the fix for the ~160-type, variable-branching
 * action space: the policy scores each candidate vector against the state
 * encoding rather than picking from a fixed-width head.
 *
 * A candidate vector carries the action-type embedding index, the viable
 * flag, and a generic encoding of the action's parameters: card-instance
 * references are resolved to card-vocabulary indices through the view's
 * instance lookup (so the net sees *which cards* an action touches), and
 * the first numeric parameters are passed through as scalars. Parameter
 * extraction walks the action object with sorted keys, so identical actions
 * always encode identically regardless of construction order.
 */

import { buildInstanceLookup } from '@meccg/shared';
import type { CardDefinition, CardInstanceId, EvaluatedAction, PlayerView } from '@meccg/shared';

/** The instance→definition resolver returned by {@link buildInstanceLookup}. */
type InstanceLookup = ReturnType<typeof buildInstanceLookup>;
import { actionTypeIndex } from './action-types.js';
import type { CardVocab } from './vocab.js';

/** How many card references a candidate vector carries. */
const MAX_REFS = 4;
/** How many numeric parameters a candidate vector carries. */
const MAX_NUMS = 2;
/** Recursion depth limit of the parameter walk. */
const MAX_DEPTH = 4;

/** Names of each candidate vector's columns, in order. */
export const ACTION_FEATURE_NAMES: readonly string[] = [
  'action-type', // ACTION_TYPES index (integer, 0 = unknown)
  'viable',      // legality mask
  'ref-count',   // referenced card instances found (scaled /5)
  ...Array.from({ length: MAX_REFS }, (_, i) => `ref-card-${i + 1}`), // vocab indices
  ...Array.from({ length: MAX_NUMS }, (_, i) => `num-${i + 1}`),      // scalar params /10
];

/** Width of one candidate vector. */
export const ACTION_FEATURE_WIDTH = ACTION_FEATURE_NAMES.length;

/** Featurized candidate set for one decision. */
export interface ActionFeatures {
  /** One fixed-width vector per candidate, in `view.legalActions` order. */
  readonly candidates: readonly (readonly number[])[];
  /** 1 where the candidate is viable (may be chosen), 0 otherwise. */
  readonly mask: readonly number[];
}

/** Collects instance references and numeric scalars from an action object. */
function walkParams(
  value: unknown,
  depth: number,
  instanceLookup: InstanceLookup,
  refs: string[],
  nums: number[],
): void {
  if (depth > MAX_DEPTH || value === null || value === undefined) return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) nums.push(value);
    return;
  }
  if (typeof value === 'string') {
    const definitionId = instanceLookup(value as CardInstanceId);
    if (definitionId !== undefined) refs.push(definitionId);
    return;
  }
  if (Array.isArray(value)) {
    for (const element of value) walkParams(element, depth + 1, instanceLookup, refs, nums);
    return;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record).sort()) {
      if (key === 'type') continue;
      walkParams(record[key], depth + 1, instanceLookup, refs, nums);
    }
  }
}

/** Featurizes one candidate action against the view's instance lookup. */
function featurizeCandidate(
  evaluated: EvaluatedAction,
  instanceLookup: InstanceLookup,
  vocab: CardVocab,
): number[] {
  const refs: string[] = [];
  const nums: number[] = [];
  walkParams(evaluated.action as unknown as Record<string, unknown>, 0, instanceLookup, refs, nums);
  return [
    actionTypeIndex(evaluated.action.type),
    evaluated.viable ? 1 : 0,
    refs.length / 5,
    ...Array.from({ length: MAX_REFS }, (_, i) => vocab.indexOf(refs[i])),
    ...Array.from({ length: MAX_NUMS }, (_, i) => (nums[i] ?? 0) / 10),
  ];
}

/**
 * Featurizes the full candidate set of a view: one vector per entry of
 * `view.legalActions` (viable and non-viable alike, so indices line up
 * with the engine's candidate list) plus the viability mask.
 */
export function featurizeActions(
  view: PlayerView,
  _cardPool: Readonly<Record<string, CardDefinition>>,
  vocab: CardVocab,
): ActionFeatures {
  const instanceLookup = buildInstanceLookup(view);
  return {
    candidates: view.legalActions.map(evaluated => featurizeCandidate(evaluated, instanceLookup, vocab)),
    mask: view.legalActions.map(evaluated => (evaluated.viable ? 1 : 0)),
  };
}
