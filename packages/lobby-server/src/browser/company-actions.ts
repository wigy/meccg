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
  CompanyId,
  GameAction,
  PlayCharacterAction,
  MoveToInfluenceAction,
  TransferItemAction,
  StoreItemAction,
  SplitCompanyAction,
  MoveToCompanyAction,
  MergeCompaniesAction,
  StartSideboardToDeckAction,
  StartSideboardToDiscardAction,
  CorruptionCheckAction,
  SupportCorruptionCheckAction,
  ActivateGrantedAction,
  SelectCardBearerAction,
  RevealAgentAction,
  AgentMoveAction,
  CardDefinition,
  GrantActionEffect,
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
 * Collect all viable store-item actions, keyed by the item instance ID.
 * At most one store-item action exists per item (the item belongs to exactly one character).
 */
export function getStoreItemActions(view: PlayerView): Map<string, StoreItemAction> {
  const result = new Map<string, StoreItemAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'store-item') continue;
    result.set(action.itemInstanceId as string, action);
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

/**
 * Collect all viable select-card-bearer actions, keyed by the character instance ID.
 * Each character can have at most one select-card-bearer action (one card needs a bearer at a time).
 */
export function getSelectCardBearerActions(view: PlayerView): Map<string, SelectCardBearerAction> {
  const result = new Map<string, SelectCardBearerAction>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'select-card-bearer') continue;
    result.set(action.characterId as string, action);
  }
  return result;
}

/**
 * Collect all viable reveal-agent actions, keyed by agent company ID.
 * There may be multiple reveal variants for one agent (with/without a home site instance).
 */
export function getRevealAgentActions(view: PlayerView): Map<string, RevealAgentAction[]> {
  const result = new Map<string, RevealAgentAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'reveal-agent') continue;
    const key = action.agentId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable agent-move actions, keyed by agent company ID.
 * One entry per legal destination site.
 */
export function getAgentMoveActions(view: PlayerView): Map<string, AgentMoveAction[]> {
  const result = new Map<string, AgentMoveAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (action.type !== 'agent-move') continue;
    const key = action.agentId as string;
    const existing = result.get(key) ?? [];
    existing.push(action);
    result.set(key, existing);
  }
  return result;
}

/**
 * Collect all viable non-move agent actions (heal/untap/turn-face-down/key-creatures/
 * move-back/return-home), keyed by agent company ID.
 */
export function getAgentOtherActions(view: PlayerView): Map<string, GameAction[]> {
  const AGENT_OTHER_TYPES = new Set([
    'agent-move-back', 'agent-return-home',
    'agent-heal', 'agent-untap',
    'agent-turn-face-down', 'agent-key-creatures',
  ]);
  const result = new Map<string, GameAction[]>();
  for (const action of viableActions(view.legalActions)) {
    if (!AGENT_OTHER_TYPES.has(action.type)) continue;
    const agentId = (action as { agentId: CompanyId }).agentId as string;
    const existing = result.get(agentId) ?? [];
    existing.push(action);
    result.set(agentId, existing);
  }
  return result;
}

/** What clicking an item on a character should do, given its available actions. */
export type ItemClickResolution =
  | { kind: 'none' }
  | { kind: 'menu'; optionCount: number }
  | { kind: 'granted'; action: ActivateGrantedAction }
  | { kind: 'store'; action: StoreItemAction }
  | { kind: 'transfer' };

/**
 * Decide what a click on an item should do, given every kind of action it may
 * simultaneously offer: its own granted actions (e.g. Cram's discard-to-untap
 * or discard-for-extra-movement), storing it at the current site, and
 * transferring it to another character at the same site.
 *
 * An item bearing a granted action is not exclusively a "use it" card — it may
 * also be legally transferable or storable at the same moment (e.g. Cram
 * offering `extra-region-movement` on a character whose company hasn't planned
 * movement yet, while also sitting at a site with another character to receive
 * it). None of these must be hidden behind another: when more than one option
 * is available the caller must present a menu instead of picking one for the
 * player.
 */
export function resolveItemClick(
  grantedActions: readonly ActivateGrantedAction[],
  storeAction: StoreItemAction | undefined,
  transferActions: readonly TransferItemAction[],
): ItemClickResolution {
  const hasStore = storeAction !== undefined;
  const hasTransfer = transferActions.length > 0;
  const optionCount = grantedActions.length + (hasStore ? 1 : 0) + (hasTransfer ? 1 : 0);

  if (optionCount === 0) return { kind: 'none' };
  if (optionCount > 1) return { kind: 'menu', optionCount };
  if (grantedActions.length === 1) return { kind: 'granted', action: grantedActions[0] };
  if (hasStore) return { kind: 'store', action: storeAction };
  return { kind: 'transfer' };
}

/**
 * True when activating `action` pays its cost by discarding its own source
 * card (e.g. Secret Book as-131's untap-site, Bade to Rule le-167's
 * discard-self) — an irreversible loss of the card a misclick can't undo,
 * unlike a tap-only cost that merely taps a character until untap.
 *
 * Looked up from card data rather than the action itself: `ActivateGrantedAction`
 * carries only routing fields (which ability, which card), not its cost.
 */
export function isSelfDiscardGrantedAction(
  action: ActivateGrantedAction,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  const def = cardPool[action.sourceCardDefinitionId as string];
  const effects = def && 'effects' in def ? def.effects ?? [] : [];
  const effect = effects.find(
    (e): e is GrantActionEffect => e.type === 'grant-action' && e.action === action.actionId,
  );
  return effect?.cost.discard === 'self';
}
