/**
 * @module reverse-actions
 *
 * Computes and matches reverse actions for the organization phase.
 *
 * When a player takes an action during organization, the engine computes
 * the action(s) that would undo it — the "reverse actions." These are stored
 * in `GameState.reverseActions` and cleared at every phase transition.
 *
 * When computing legal actions, each candidate is checked against the stored
 * reverses. If it matches, the action is marked `regress: true`, signalling
 * to the AI that it undoes previous progress, and to the UI that it should
 * be rendered with a lighter/dimmer style.
 *
 * This replaces the old "touched cards" heuristic with precise action-level
 * tracking, giving the AI a reliable signal for which actions move the game
 * forward versus backward.
 */

import type {
  GameAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  SplitCompanyAction,
  PlanMovementAction,
  CancelMovementAction,
  MoveToInfluenceAction,
  TransferItemAction,
  UseItemAction,
} from '../types/actions.js';
import type { EvaluatedAction } from '../index.js';

/**
 * Check if a candidate legal action matches any stored reverse action,
 * indicating it would undo previous progress this phase.
 */
export function isRegressive(candidate: GameAction, reverseActions: readonly GameAction[]): boolean {
  return reverseActions.some(r => matchesAction(candidate, r));
}

/**
 * Wrap a candidate action as a viable {@link EvaluatedAction}, stamping the
 * `regress` flag when the action would undo this phase's progress (per
 * {@link isRegressive} against `state.reverseActions`). Folds the identical
 * build-candidate → check-regress → push boilerplate repeated across the
 * organization-phase emitters.
 */
export function regressable(state: { readonly reverseActions: readonly GameAction[] }, candidate: GameAction): EvaluatedAction {
  const regress = isRegressive(candidate, state.reverseActions);
  return { action: { ...candidate, ...(regress ? { regress: true } : {}) }, viable: true };
}

/**
 * Compare two actions by their type-specific identifying fields.
 * The `regress` field is intentionally ignored — only structural
 * fields (company IDs, character IDs, etc.) are compared.
 */
function matchesAction(a: GameAction, b: GameAction): boolean {
  if (a.type !== b.type || a.player !== b.player) return false;

  switch (a.type) {
    case 'plan-movement': {
      const r = b as PlanMovementAction;
      return a.companyId === r.companyId
        && a.destinationSite === r.destinationSite;
    }
    case 'cancel-movement': {
      const r = b as CancelMovementAction;
      return a.companyId === r.companyId;
    }
    case 'move-to-influence': {
      const r = b as MoveToInfluenceAction;
      return a.characterInstanceId === r.characterInstanceId
        && a.controlledBy === r.controlledBy;
    }
    case 'transfer-item': {
      const r = b as TransferItemAction;
      return a.itemInstanceId === r.itemInstanceId
        && a.fromCharacterId === r.fromCharacterId
        && a.toCharacterId === r.toCharacterId;
    }
    case 'split-company': {
      const r = b as SplitCompanyAction;
      return a.sourceCompanyId === r.sourceCompanyId
        && a.characterId === r.characterId;
    }
    case 'move-to-company': {
      const r = b as MoveToCompanyAction;
      return a.characterInstanceId === r.characterInstanceId
        && a.sourceCompanyId === r.sourceCompanyId
        && a.targetCompanyId === r.targetCompanyId;
    }
    case 'use-item': {
      // A character bearing two items of one slot can only ever have one of
      // them in use, so declaring either always leaves the other declarable —
      // the pair is switchable back and forth forever. `handleUseItem` stores
      // the displaced item as the reverse; without this case it matched
      // nothing, no candidate was ever stamped `regress`, and a self-play game
      // spent its last 23000 decisions handing the armor slot back and forth
      // between two copies of Hauberk of Bright Mail borne by one character.
      const r = b as UseItemAction;
      return a.characterInstanceId === r.characterInstanceId
        && a.itemInstanceId === r.itemInstanceId;
    }
    case 'merge-companies': {
      // Unordered: a stored reverse only ever exists because a split created
      // these two company IDs from one, and reuniting them undoes that split
      // regardless of which side is nominally "source" vs "target" — the
      // legal-action computer offers both directions for any pair of
      // companies at the same site (`organization-companies.ts`), and only
      // matching the exact stored direction let the AI take the mirrored
      // merge as if it were fresh progress, split again, and repeat forever.
      const r = b as MergeCompaniesAction;
      return (a.sourceCompanyId === r.sourceCompanyId && a.targetCompanyId === r.targetCompanyId)
        || (a.sourceCompanyId === r.targetCompanyId && a.targetCompanyId === r.sourceCompanyId);
    }
    default:
      return false;
  }
}
