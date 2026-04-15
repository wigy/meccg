/**
 * @module company-actions
 *
 * Pure helper functions that collect and group legal actions from a PlayerView
 * into lookup maps keyed by card instance ID or company ID. These maps are
 * consumed by the company block and view renderers to determine which cards
 * are interactive and what actions are available.
 *
 * All functions are stateless — they take a PlayerView and return a Map.
 */

import type {
  PlayerView,
  CardInstanceId,
  PlayCharacterAction,
  MoveToInfluenceAction,
  TransferItemAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  CorruptionCheckAction,
  SupportCorruptionCheckAction,
  ActivateGrantedAction,
} from '@meccg/shared';
import { viableActions } from '@meccg/shared';

/**
 * Find all viable play-character actions for the selected character instance.
 * Returns a map from site instance ID to the list of actions at that site.
 */
export function getPlayCharacterActions(
  view: PlayerView,
  characterInstanceId: CardInstanceId,
): Map<string, PlayCharacterAction[]> {
  const result = new Map<string, PlayCharacterAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'play-character') continue;
    if (action.characterInstanceId !== characterInstanceId) continue;
    const key = action.atSite as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable move-to-influence actions, keyed by the source character instance ID.
 * Each entry maps to the list of actions available for that character.
 */
export function getMoveToInfluenceActions(view: PlayerView): Map<string, MoveToInfluenceAction[]> {
  const result = new Map<string, MoveToInfluenceAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'move-to-influence') continue;
    const key = action.characterInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable transfer-item actions, keyed by the item instance ID.
 * Each entry maps to the list of transfer actions for that item.
 */
export function getTransferItemActions(view: PlayerView): Map<string, TransferItemAction[]> {
  const result = new Map<string, TransferItemAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'transfer-item') continue;
    const key = action.itemInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable split-company actions, keyed by the character instance ID.
 * Each character can have at most one split action (from one source company).
 */
export function getSplitCompanyActions(view: PlayerView): Map<string, SplitCompanyAction> {
  const result = new Map<string, SplitCompanyAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'split-company') continue;
    result.set(action.characterId as string, action);
  }
  return result;
}

/**
 * Collect all viable move-to-company actions, keyed by the character instance ID.
 */
export function getMoveToCompanyActions(view: PlayerView): Map<string, MoveToCompanyAction[]> {
  const result = new Map<string, MoveToCompanyAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'move-to-company') continue;
    const key = action.characterInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable merge-companies actions, keyed by the source company ID.
 * Each source company can merge into one or more target companies at the same site.
 */
export function getMergeCompaniesActions(view: PlayerView): Map<string, MergeCompaniesAction[]> {
  const result = new Map<string, MergeCompaniesAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'merge-companies') continue;
    const key = action.sourceCompanyId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable sideboard intent actions (start-sideboard-to-deck/discard),
 * keyed by the avatar character instance ID.
 */
export function getSideboardIntentActions(view: PlayerView): Map<string, (StartSideboardToDeckAction | StartSideboardToDiscardAction)[]> {
  const result = new Map<string, (StartSideboardToDeckAction | StartSideboardToDiscardAction)[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'start-sideboard-to-deck' && action.type !== 'start-sideboard-to-discard') continue;
    const key = action.characterInstanceId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable corruption-check actions, keyed by the character instance ID.
 * Each character can have at most one corruption check action.
 */
export function getCorruptionCheckActions(view: PlayerView): Map<string, CorruptionCheckAction> {
  const result = new Map<string, CorruptionCheckAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'corruption-check') continue;
    result.set(action.characterId as string, action);
  }
  return result;
}

/**
 * Collect all viable support-corruption-check actions, keyed by the supporting character instance ID.
 * Each untapped character in the same company as the check target can provide +1 support.
 */
export function getSupportCorruptionCheckActions(view: PlayerView): Map<string, SupportCorruptionCheckAction> {
  const result = new Map<string, SupportCorruptionCheckAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'support-corruption-check') continue;
    result.set(action.supportingCharacterId as string, action);
  }
  return result;
}

/**
 * Collect all viable activate-granted-action actions, keyed by source card instance ID.
 * Used to highlight cards that offer activatable abilities — both hazards (e.g.
 * remove-self-on-roll) and items (e.g. Cram's discard-to-untap).
 * A single card may grant multiple actions (e.g. Cram: untap-bearer + extra-region-movement).
 */
export function getGrantedActions(view: PlayerView): Map<string, ActivateGrantedAction[]> {
  const result = new Map<string, ActivateGrantedAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'activate-granted-action') continue;
    const key = action.sourceCardId as string;
    const existing = result.get(key);
    if (existing) {
      existing.push(action);
    } else {
      result.set(key, [action]);
    }
  }
  return result;
}

/** Collect company IDs that have at least one viable plan-movement action. */
export function getMovableCompanyIds(view: PlayerView): Set<string> {
  const ids = new Set<string>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type === 'plan-movement') ids.add(action.companyId as string);
  }
  return ids;
}
