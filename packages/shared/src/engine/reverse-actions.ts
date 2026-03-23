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
} from '../types/actions.js';

/**
 * Check if a candidate legal action matches any stored reverse action,
 * indicating it would undo previous progress this phase.
 */
export function isRegressive(candidate: GameAction, reverseActions: readonly GameAction[]): boolean {
  return reverseActions.some(r => matchesAction(candidate, r));
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
    case 'merge-companies': {
      const r = b as MergeCompaniesAction;
      return a.sourceCompanyId === r.sourceCompanyId
        && a.targetCompanyId === r.targetCompanyId;
    }
    default:
      return false;
  }
}
