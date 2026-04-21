/**
 * @module render-hand
 *
 * Renders the player's hand and opponent's hand as card arcs in the visual view.
 * Handles all card-click interactions: direct plays, two-step selection flows
 * (item draft, play-character, faction influence, ally play), disambiguation
 * tooltips for short-events and hazard keying, and resource/item target menus.
 */

import type { PlayerView, CardDefinition, CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { cardImageProxyPath, viableActions, Phase } from '@meccg/shared';
import { getCachedInstanceLookup, findNonViableReason } from './render-text-format.js';
import {
  setTargetingInstruction,
  getSelectedItemDefId, setSelectedItemDefId,
  getItemDraftRenderCache, setItemDraftRenderCache,
  getSelectedCharacterForPlay, setSelectedCharacterForPlay,
  getPlayCharacterRenderCache, setPlayCharacterRenderCache,
  getSelectedFactionForInfluence, setSelectedFactionForInfluence,
  getFactionInfluenceRenderCache, setFactionInfluenceRenderCache,
  getSelectedResourceForPlay, setSelectedResourceForPlay,
  getResourcePlayRenderCache, setResourcePlayRenderCache,
  getSelectedAllyForPlay, setSelectedAllyForPlay,
  getAllyPlayRenderCache, setAllyPlayRenderCache,
  getSelectedHazardForPlay, setSelectedHazardForPlay,
  getHazardPlayRenderCache, setHazardPlayRenderCache,
  getSelectedInfluencerForOpponent, setSelectedInfluencerForOpponent,
  getSelectedShortEvent, setSelectedShortEvent,
  getShortEventRenderCache, setShortEventRenderCache,
  getSelectedCancelAttack, setSelectedCancelAttack,
  getCancelAttackRenderCache, setCancelAttackRenderCache,
} from './render-selection-state.js';
import { findSelfIndex } from './render-debug-panels.js';

// ---- Card action finders ----

/**
 * Find the legal action associated with a card in the hand arc, if any.
 * Actions that need no extra parameters beyond identifying the card are
 * returned directly -- clicking the card sends them immediately.
 */
function findCardAction(
  defId: CardDefinitionId,
  legalActions: readonly GameAction[],
  instanceLookup?: (id: CardInstanceId) => CardDefinitionId | undefined,
): GameAction | null {
  for (const action of legalActions) {
    if (action.type === 'draft-pick' && instanceLookup
      && instanceLookup(action.characterInstanceId) === defId) return action;
    if (action.type === 'add-character-to-deck' && instanceLookup
      && instanceLookup(action.characterInstanceId) === defId) return action;
    if (action.type === 'select-starting-site' && instanceLookup
      && instanceLookup(action.siteInstanceId) === defId) return action;
    if (action.type === 'play-permanent-event' && instanceLookup
      && instanceLookup(action.cardInstanceId) === defId) return action;
    if (action.type === 'play-long-event' && instanceLookup
      && instanceLookup(action.cardInstanceId) === defId) return action;
  }
  return null;
}

/**
 * Find all play-short-event actions for a given card instance.
 * Returns the list of matching actions (may have multiple targets).
 */
function findShortEventActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-short-event' && a.cardInstanceId === instanceId,
  );
}

/** Card types that represent allies. */
const ALLY_CARD_TYPES: ReadonlySet<string> = new Set(['hero-resource-ally', 'minion-resource-ally']);

/** Check whether a play-hero-resource action targets an ally card. */
function isAllyAction(
  action: GameAction,
  cardPool: Readonly<Record<string, CardDefinition>>,
): boolean {
  if (action.type !== 'play-hero-resource') return false;
  const instLookup = getCachedInstanceLookup();
  const defId = instLookup(action.cardInstanceId);
  if (!defId) return false;
  const def = cardPool[defId as string];
  return def !== undefined && ALLY_CARD_TYPES.has(def.cardType);
}

/**
 * Find all play-hero-resource ally actions for a given card instance.
 * One action per eligible untapped character target.
 */
function findAllyPlayActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-hero-resource'
      && a.cardInstanceId === instanceId
      && isAllyAction(a, cardPool),
  );
}

/**
 * Find all non-ally play-hero-resource or play-minor-item actions for a given card instance.
 * Items have one action per eligible character target.
 */
function findResourcePlayActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
  cardPool: Readonly<Record<string, CardDefinition>>,
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => (a.type === 'play-hero-resource' || a.type === 'play-minor-item')
      && a.cardInstanceId === instanceId
      && !isAllyAction(a, cardPool),
  );
}

/**
 * Find all influence-attempt actions for a given faction card instance.
 * One action per eligible untapped character.
 */
function findInfluenceActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'influence-attempt' && a.factionInstanceId === instanceId,
  );
}

/**
 * Find all play-hazard actions for a given card instance.
 * Creatures may have multiple entries with different keying methods.
 */
function findHazardActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-hazard' && a.cardInstanceId === instanceId,
  );
}

/**
 * Check whether a card in the hand arc has assign-starting-item actions
 * (needs the two-step target selection flow).
 */
function isItemDraftCard(defId: CardDefinitionId, legalActions: readonly GameAction[]): boolean {
  return legalActions.some(a => a.type === 'assign-starting-item' && a.itemDefId === defId);
}

/**
 * Check whether a card in the hand arc has viable play-character actions
 * (needs the two-step company target selection flow).
 */
function isPlayCharacterCard(
  defId: CardDefinitionId,
  legalActions: readonly GameAction[],
  instanceLookup?: (id: CardInstanceId) => CardDefinitionId | undefined,
): boolean {
  return instanceLookup !== undefined && legalActions.some(
    a => a.type === 'play-character' && instanceLookup(a.characterInstanceId) === defId,
  );
}

/**
 * Find all cancel-attack actions for a given card instance.
 * Each action names a different scout character that can tap to pay the cost.
 */
function findCancelAttackActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'cancel-attack' && a.cardInstanceId === instanceId,
  );
}

/**
 * Find all play-dodge actions for a given card instance.
 */
function findDodgeActions(
  instanceId: CardInstanceId | null,
  legalActions: readonly GameAction[],
): GameAction[] {
  if (!instanceId) return [];
  return legalActions.filter(
    a => a.type === 'play-dodge' && a.cardInstanceId === instanceId,
  );
}

/**
 * When a `discard-in-play` target is a hazard attached to a character
 * (stored in `character.hazards`), return the bearer character's display
 * name. Used to disambiguate action labels when two identical-named
 * hazards are attached to different characters — without the bearer name,
 * both buttons render with the same text ("Tap Sage, discard Foolish Words").
 * Returns null when the target is a non-attached in-play card (e.g. Eye of
 * Sauron in `cardsInPlay`), in which case no bearer disambiguation is needed.
 */
function findHazardBearerName(
  hazardInstanceId: CardInstanceId,
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
): string | null {
  for (const chars of [view.self.characters, view.opponent.characters]) {
    for (const char of Object.values(chars)) {
      if (char.hazards.some(h => h.instanceId === hazardInstanceId)) {
        const charDef = cardPool[char.definitionId as string];
        return charDef ? charDef.name : null;
      }
    }
  }
  return null;
}

// ---- Disambiguation tooltips ----

/**
 * Show a disambiguation tooltip near the clicked short-event card
 * when there are multiple valid targets. Each button names a target
 * environment; clicking it sends the corresponding action.
 */
function showShortEventTargetMenu(
  event: MouseEvent,
  actions: readonly GameAction[],
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  // Remove any existing tooltip
  document.querySelector('.chain-target-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const action of actions) {
    if (action.type !== 'play-short-event') continue;

    let label: string;
    if (action.targetInstanceId) {
      // Canceling an environment
      const targetDefId = cachedInstanceLookup(action.targetInstanceId);
      const targetDef = targetDefId ? cardPool[targetDefId as string] : undefined;
      const targetName = targetDef ? targetDef.name : '?';
      const chainEntry = view.chain?.entries.find(e => e.card?.instanceId === action.targetInstanceId);
      const ownerName = chainEntry
        ? (chainEntry.declaredBy === view.self.id ? 'You' : view.opponent.name)
        : null;
      label = ownerName ? `Cancel ${targetName} (${ownerName})` : `Cancel ${targetName}`;
    } else if (action.discardTargetInstanceId) {
      // Cards like Marvels Told: may tap a character AND force the discard
      // of an in-play card. The player must see and pick the discard target
      // rather than having the UI silently commit to the first match.
      const discardDefId = cachedInstanceLookup(action.discardTargetInstanceId);
      const discardDef = discardDefId ? cardPool[discardDefId as string] : undefined;
      const discardName = discardDef ? discardDef.name : '?';
      // Two identical-named hazards (e.g. Foolish Words) can both be legal
      // discard targets when attached to different characters. Append the
      // bearer character's name so the two actions don't render as duplicates.
      const bearerName = findHazardBearerName(action.discardTargetInstanceId, view, cardPool);
      const discardLabel = bearerName ? `${discardName} (on ${bearerName})` : discardName;
      if (action.targetScoutInstanceId) {
        const scoutDefId = cachedInstanceLookup(action.targetScoutInstanceId);
        const scoutDef = scoutDefId ? cardPool[scoutDefId as string] : undefined;
        const scoutName = scoutDef ? scoutDef.name : '?';
        label = `Tap ${scoutName}, discard ${discardLabel}`;
      } else {
        label = `Discard ${discardLabel}`;
      }
    } else if (action.targetScoutInstanceId) {
      // Targeting a scout (e.g. Stealth)
      const scoutDefId = cachedInstanceLookup(action.targetScoutInstanceId);
      const scoutDef = scoutDefId ? cardPool[scoutDefId as string] : undefined;
      label = scoutDef ? scoutDef.name : '?';
    } else {
      continue;
    }

    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}

/**
 * Show a disambiguation tooltip for creature hazards with multiple keying
 * methods. Each button describes a keying match; clicking it sends the action.
 */
function showHazardKeyingMenu(
  event: MouseEvent,
  actions: readonly GameAction[],
  onAction: (action: GameAction) => void,
  onGuardAction?: GameAction,
  cardPool?: Readonly<Record<string, CardDefinition>>,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  document.querySelector('.chain-target-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'chain-target-backdrop';
  backdrop.addEventListener('click', () => backdrop.remove());

  const tooltip = document.createElement('div');
  tooltip.className = 'chain-target-tooltip';
  tooltip.style.left = `${event.clientX}px`;
  tooltip.style.top = `${event.clientY}px`;

  for (const action of actions) {
    if (action.type !== 'play-hazard' || !action.keyedBy) continue;
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = `Keyed by ${action.keyedBy.method}: ${action.keyedBy.value}`;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  // Non-keyed hazard events (single play action without keying)
  for (const action of actions) {
    if (action.type !== 'play-hazard' || action.keyedBy) continue;
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    let label = 'Play hazard';
    if (action.targetCharacterId && cardPool) {
      const charDefId = cachedInstanceLookup(action.targetCharacterId);
      const charDef = charDefId ? cardPool[charDefId as string] : undefined;
      label = charDef ? `Play on ${charDef.name}` : `Play on ${action.targetCharacterId as string}`;
    }
    btn.textContent = label;
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(action);
    });
    tooltip.appendChild(btn);
  }

  if (onGuardAction) {
    const btn = document.createElement('button');
    btn.className = 'char-action-tooltip__btn';
    btn.textContent = 'Place on-guard';
    btn.addEventListener('click', () => {
      backdrop.remove();
      onAction(onGuardAction);
    });
    tooltip.appendChild(btn);
  }

  backdrop.appendChild(tooltip);
  document.body.appendChild(backdrop);
}

// ---- Hand card helpers ----

/** A card in the hand arc with definition and optional instance ID. */
interface HandCard {
  defId: CardDefinitionId;
  instanceId: CardInstanceId | null;
}

/** Get the list of card definition IDs to display in the hand arc. */
function getHandCards(view: PlayerView): HandCard[] {
  // During character draft, show the player's draft pool instead of hand
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const selfIdx = findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    return draft.draftState[selfIdx].pool.map(card => {
      return { defId: card.definitionId, instanceId: card.instanceId };
    });
  }
  // During character deck draft, show remaining pool characters
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-deck-draft') {
    const deckDraft = view.phaseState.setupStep.deckDraftState;
    const selfIdx = findSelfIndex(deckDraft[0].remainingPool, deckDraft[1].remainingPool);
    return deckDraft[selfIdx].remainingPool.map(card => {
      return { defId: card.definitionId, instanceId: card.instanceId };
    });
  }
  // During item draft, show remaining pool (undrafted characters) + unassigned items
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'item-draft') {
    const cards: HandCard[] = [];

    const step = view.phaseState.setupStep;
    // Remaining pool: undrafted characters (shown dimmed as non-items)
    const selfPoolIdx = findSelfIndex(step.remainingPool[0], step.remainingPool[1]);
    for (const card of step.remainingPool[selfPoolIdx]) {
      cards.push({ defId: card.definitionId, instanceId: card.instanceId });
    }

    // Unassigned items (assigned items are removed from pool)
    const selfItemIdx = step.itemDraftState[0].unassignedItems.length > 0
      ? 0 : 1;
    for (const card of step.itemDraftState[selfItemIdx].unassignedItems) {
      cards.push({ defId: card.definitionId, instanceId: card.instanceId });
    }

    return cards;
  }
  // During site selection, hand arc is empty — sites are shown in the site deck viewer
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'starting-site-selection') {
    return [];
  }
  // During character placement and deck shuffle, no hand cards
  if (view.phaseState.phase === 'setup'
    && (view.phaseState.setupStep.step === 'character-placement'
      || view.phaseState.setupStep.step === 'deck-shuffle')) {
    return [];
  }
  return view.self.hand.map(c => ({ defId: c.definitionId, instanceId: c.instanceId }));
}

// ---- Re-render helpers for two-step selection flows ----

/** Re-render hand and drafted areas using cached state (for item draft selection flow). */
function reRenderItemDraft(): void {
  const cache = getItemDraftRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  // Import renderDrafted dynamically to avoid circular dependency
  void import('./render-board.js').then(m => m.renderDrafted(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for character play selection flow). */
function reRenderCharacterPlay(): void {
  const cache = getPlayCharacterRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  // Import is circular-safe since renderCompanyViews is called as a function reference
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for faction influence selection flow). */
function reRenderFactionInfluence(): void {
  const cache = getFactionInfluenceRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for hazard targeting selection flow). */
function reRenderHazardTarget(): void {
  const cache = getHazardPlayRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for ally play selection flow). */
function reRenderAllyPlay(): void {
  const cache = getAllyPlayRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for resource/item play selection flow). */
function reRenderResourcePlay(): void {
  const cache = getResourcePlayRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and company views using cached state (for short-event character targeting flow). */
function reRenderShortEventTarget(): void {
  const cache = getShortEventRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

/** Re-render hand and combat views using cached state (for cancel-attack scout targeting flow). */
function reRenderCancelAttackTarget(): void {
  const cache = getCancelAttackRenderCache();
  if (!cache) return;
  const { view, cardPool, onAction } = cache;
  renderHand(view, cardPool, onAction);
  void import('./company-view.js').then(m => m.renderCompanyViews(view, cardPool, onAction));
}

// ---- Main hand rendering ----

/** Render the player's hand (or draft pool) as an arc of card images in the visual view. */
export function renderHand(
  view: PlayerView,
  cardPool: Readonly<Record<string, CardDefinition>>,
  onAction?: (action: GameAction) => void,
): void {
  const cachedInstanceLookup = getCachedInstanceLookup();
  const el = document.getElementById('hand-arc');
  if (!el) return;
  el.innerHTML = '';
  if (view.phaseState.phase === Phase.GameOver) return;

  const cards = getHandCards(view);
  const total = cards.length;
  el.style.setProperty('--total', String(total));
  // Overlap cards more when there are many
  const margin = total > 7 ? -4 : -2.5;
  el.style.setProperty('--card-margin', `${margin}vh`);

  // Cache render state for item draft re-rendering
  const viable = viableActions(view.legalActions);
  if (onAction && view.phaseState.phase === 'setup'
    && 'setupStep' in view.phaseState && view.phaseState.setupStep.step === 'item-draft') {
    setItemDraftRenderCache({ view, cardPool, onAction });
    // Auto-clear selection if the selected item is no longer in legal actions
    const selectedItemDefId = getSelectedItemDefId();
    if (selectedItemDefId && !isItemDraftCard(selectedItemDefId, viable)) {
      setSelectedItemDefId(null);
      setTargetingInstruction(null);
    }
  } else {
    // Not in item draft — clear any stale selection
    if (getSelectedItemDefId()) setTargetingInstruction(null);
    setSelectedItemDefId(null);
    setItemDraftRenderCache(null);
  }

  // Cache render state for play-character re-rendering
  const hasPlayCharacters = viable.some(a => a.type === 'play-character');
  if (onAction && hasPlayCharacters) {
    setPlayCharacterRenderCache({ view, cardPool, onAction });
    // Auto-clear selection if the selected character is no longer viable
    const selectedCharacterInstanceId = getSelectedCharacterForPlay();
    if (selectedCharacterInstanceId) {
      const stillViable = viable.some(
        a => a.type === 'play-character' && a.characterInstanceId === selectedCharacterInstanceId,
      );
      if (!stillViable) {
        setSelectedCharacterForPlay(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasPlayCharacters) {
    if (getSelectedCharacterForPlay()) setTargetingInstruction(null);
    setSelectedCharacterForPlay(null);
    setPlayCharacterRenderCache(null);
  }

  // Cache render state for faction influence re-rendering
  const hasInfluenceActions = viable.some(a => a.type === 'influence-attempt');
  if (onAction && hasInfluenceActions) {
    setFactionInfluenceRenderCache({ view, cardPool, onAction });
    const selectedFactionInstanceId = getSelectedFactionForInfluence();
    if (selectedFactionInstanceId) {
      const stillViable = viable.some(
        a => a.type === 'influence-attempt' && a.factionInstanceId === selectedFactionInstanceId,
      );
      if (!stillViable) {
        setSelectedFactionForInfluence(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasInfluenceActions) {
    if (getSelectedFactionForInfluence()) setTargetingInstruction(null);
    setSelectedFactionForInfluence(null);
    setFactionInfluenceRenderCache(null);
  }

  // Cache render state for ally play re-rendering
  const hasAllyPlayActions = viable.some(
    a => a.type === 'play-hero-resource' && isAllyAction(a, cardPool),
  );
  if (onAction && hasAllyPlayActions) {
    setAllyPlayRenderCache({ view, cardPool, onAction });
    const selectedAllyInstanceId = getSelectedAllyForPlay();
    if (selectedAllyInstanceId) {
      const stillViable = viable.some(
        a => a.type === 'play-hero-resource'
          && a.cardInstanceId === selectedAllyInstanceId
          && isAllyAction(a, cardPool),
      );
      if (!stillViable) {
        setSelectedAllyForPlay(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasAllyPlayActions) {
    if (getSelectedAllyForPlay()) setTargetingInstruction(null);
    setSelectedAllyForPlay(null);
    setAllyPlayRenderCache(null);
  }

  // Cache render state for resource/item play re-rendering
  const hasResourcePlayActions = viable.some(
    a => (a.type === 'play-hero-resource' || a.type === 'play-minor-item') && !isAllyAction(a, cardPool),
  );
  if (onAction && hasResourcePlayActions) {
    setResourcePlayRenderCache({ view, cardPool, onAction });
    const selectedResourceInstanceId = getSelectedResourceForPlay();
    if (selectedResourceInstanceId) {
      const stillViable = viable.some(
        a => (a.type === 'play-hero-resource' || a.type === 'play-minor-item')
          && a.cardInstanceId === selectedResourceInstanceId
          && !isAllyAction(a, cardPool),
      );
      if (!stillViable) {
        setSelectedResourceForPlay(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasResourcePlayActions) {
    if (getSelectedResourceForPlay()) setTargetingInstruction(null);
    setSelectedResourceForPlay(null);
    setResourcePlayRenderCache(null);
  }

  // Cache render state for hazard character-targeting re-rendering
  const hasCharTargetHazardActions = viable.some(
    a => a.type === 'play-hazard' && 'targetCharacterId' in a && a.targetCharacterId,
  );
  if (onAction && hasCharTargetHazardActions) {
    setHazardPlayRenderCache({ view, cardPool, onAction });
    const selectedHazardInstanceId = getSelectedHazardForPlay();
    if (selectedHazardInstanceId) {
      const stillViable = viable.some(
        a => a.type === 'play-hazard'
          && a.cardInstanceId === selectedHazardInstanceId
          && 'targetCharacterId' in a && a.targetCharacterId,
      );
      if (!stillViable) {
        setSelectedHazardForPlay(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasCharTargetHazardActions) {
    if (getSelectedHazardForPlay()) setTargetingInstruction(null);
    setSelectedHazardForPlay(null);
    setHazardPlayRenderCache(null);
  }

  // Cache render state for opponent influence re-rendering
  const hasOppInfluenceActions = viable.some(a => a.type === 'opponent-influence-attempt');
  if (onAction && hasOppInfluenceActions) {
    const selectedInfluencerForOpponent = getSelectedInfluencerForOpponent();
    if (selectedInfluencerForOpponent) {
      const stillViable = viable.some(
        a => a.type === 'opponent-influence-attempt' && a.influencingCharacterId === selectedInfluencerForOpponent,
      );
      if (!stillViable) {
        setSelectedInfluencerForOpponent(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasOppInfluenceActions) {
    if (getSelectedInfluencerForOpponent()) setTargetingInstruction(null);
    setSelectedInfluencerForOpponent(null);
  }

  // Cache render state for short-event character targeting (e.g. Stealth → scout)
  const hasScoutShortEvents = viable.some(
    a => a.type === 'play-short-event' && a.targetScoutInstanceId,
  );
  if (onAction && hasScoutShortEvents) {
    setShortEventRenderCache({ view, cardPool, onAction });
    const selectedSE = getSelectedShortEvent();
    if (selectedSE) {
      const stillViable = viable.some(
        a => a.type === 'play-short-event' && a.cardInstanceId === selectedSE,
      );
      if (!stillViable) {
        setSelectedShortEvent(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasScoutShortEvents) {
    if (getSelectedShortEvent()) setTargetingInstruction(null);
    setSelectedShortEvent(null);
    setShortEventRenderCache(null);
  }

  // Cache render state for cancel-attack scout targeting (e.g. Concealment → scout)
  const hasMultiScoutCancelAttacks = viable.some(
    a => a.type === 'cancel-attack' && a.scoutInstanceId,
  ) && viable.filter(a => a.type === 'cancel-attack').length > 1;
  if (onAction && hasMultiScoutCancelAttacks) {
    setCancelAttackRenderCache({ view, cardPool, onAction });
    const selectedCA = getSelectedCancelAttack();
    if (selectedCA) {
      const stillViable = viable.some(
        a => a.type === 'cancel-attack' && a.cardInstanceId === selectedCA,
      );
      if (!stillViable) {
        setSelectedCancelAttack(null);
        setTargetingInstruction(null);
      }
    }
  } else if (!hasMultiScoutCancelAttacks) {
    if (getSelectedCancelAttack()) setTargetingInstruction(null);
    setSelectedCancelAttack(null);
    setCancelAttackRenderCache(null);
  }

  for (let i = 0; i < total; i++) {
    const { defId: cardDefId, instanceId: cardInstanceId } = cards[i];
    const def = cardPool[cardDefId as string];
    if (!def) continue;
    const imgPath = cardImageProxyPath(def);
    if (!imgPath) continue;

    const action = findCardAction(cardDefId, viable, cachedInstanceLookup);
    const isItemDraft = isItemDraftCard(cardDefId, viable);
    const isPlayChar = isPlayCharacterCard(cardDefId, viable, cachedInstanceLookup);
    const shortEventActions = findShortEventActions(cardInstanceId, viable);
    const isShortEvent = shortEventActions.length > 0;
    const hazardActions = findHazardActions(cardInstanceId, viable);
    const onGuardAction = cardInstanceId
      ? viable.find(a => a.type === 'place-on-guard' && a.cardInstanceId === cardInstanceId)
      : undefined;
    const isHazard = hazardActions.length > 0;
    const allyActions = findAllyPlayActions(cardInstanceId, viable, cardPool);
    const isAlly = allyActions.length > 0;
    const resourceActions = findResourcePlayActions(cardInstanceId, viable, cardPool);
    const isResource = resourceActions.length > 0;
    const influenceActions = findInfluenceActions(cardInstanceId, viable);
    const isInfluence = influenceActions.length > 0;
    const cancelAttackActions = findCancelAttackActions(cardInstanceId, viable);
    const isCancelAttack = cancelAttackActions.length > 0;
    const dodgeActions = findDodgeActions(cardInstanceId, viable);
    const isDodge = dodgeActions.length > 0;
    const discardAction = cardInstanceId
      ? viable.find(a => a.type === 'discard-card' && a.cardInstanceId === cardInstanceId)
      : undefined;
    const nonViableReason = !action && !isItemDraft && !isPlayChar && !isShortEvent && !isHazard && !isAlly && !isResource && !isInfluence && !isCancelAttack && !isDodge && !discardAction && !onGuardAction
      ? findNonViableReason(cardDefId, view.legalActions, cachedInstanceLookup)
      : undefined;
    const selectedItemDefId = getSelectedItemDefId();
    const isSelected = selectedItemDefId === cardDefId;

    const selectedCharacterInstanceId = getSelectedCharacterForPlay();
    const isCharSelected = selectedCharacterInstanceId !== null
      && cardInstanceId !== null
      && selectedCharacterInstanceId === cardInstanceId;

    const selectedFactionInstanceId = getSelectedFactionForInfluence();
    const isFactionSelected = selectedFactionInstanceId !== null
      && cardInstanceId !== null
      && selectedFactionInstanceId === cardInstanceId;

    const selectedAllyInstanceId = getSelectedAllyForPlay();
    const isAllySelected = selectedAllyInstanceId !== null
      && cardInstanceId !== null
      && selectedAllyInstanceId === cardInstanceId;

    const selectedResourceInstanceId = getSelectedResourceForPlay();
    const isResourceSelected = selectedResourceInstanceId !== null
      && cardInstanceId !== null
      && selectedResourceInstanceId === cardInstanceId;

    const selectedHazardInstanceId = getSelectedHazardForPlay();
    const isHazardSelected = selectedHazardInstanceId !== null
      && cardInstanceId !== null
      && selectedHazardInstanceId === cardInstanceId;

    const img = document.createElement('img');
    img.src = imgPath;
    img.alt = def.name;
    img.dataset.cardId = cardDefId as string;
    if (cardInstanceId) img.dataset.instanceId = cardInstanceId as string;
    img.style.setProperty('--i', String(i));

    if (isItemDraft) {
      // Item draft two-step flow: click to select, then click a target character
      img.className = isSelected
        ? 'hand-card hand-card-selected'
        : 'hand-card hand-card-playable';
      img.dataset.defId = cardDefId as string;
      if (onAction) {
        img.addEventListener('click', () => {
          setSelectedItemDefId(isSelected ? null : cardDefId);
          setTargetingInstruction(
            getSelectedItemDefId() ? `Click a highlighted character to assign ${def.name}` : null,
          );
          reRenderItemDraft();
        });
      }
    } else if (isPlayChar) {
      // Play-character two-step flow: click to select, then click a target company
      img.className = isCharSelected
        ? 'hand-card hand-card-selected'
        : 'hand-card hand-card-playable';
      if (onAction && cardInstanceId) {
        const instId = cardInstanceId;
        img.addEventListener('click', () => {
          setSelectedCharacterForPlay(isCharSelected ? null : instId);
          setTargetingInstruction(
            getSelectedCharacterForPlay() ? `Click a highlighted company to play ${def.name}` : null,
          );
          if (getSelectedCharacterForPlay()) {
            void import('./company-view.js').then(m => m.switchToAllCompanies());
          }
          reRenderCharacterPlay();
        });
      }
    } else if (isShortEvent) {
      // Check if this short-event targets characters (e.g. Stealth → scout)
      const hasScoutTargets = shortEventActions.some(
        a => a.type === 'play-short-event' && a.targetScoutInstanceId,
      );
      // Cards with a `discard-in-play` effect (e.g. Marvels Told) always go
      // through the disambiguation menu so the player explicitly sees and
      // chooses which in-play card will be discarded — never silently picked.
      const hasDiscardTargets = shortEventActions.some(
        a => a.type === 'play-short-event' && a.discardTargetInstanceId,
      );
      if (hasDiscardTargets) {
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          img.addEventListener('click', (e) => {
            showShortEventTargetMenu(e, shortEventActions, view, cardPool, onAction);
          });
        }
      } else if (hasScoutTargets && shortEventActions.length > 1) {
        // Two-step character targeting flow
        const selectedSE = getSelectedShortEvent();
        const isSESelected = selectedSE === cardInstanceId;
        img.className = isSESelected ? 'hand-card hand-card-selected' : 'hand-card hand-card-playable';
        if (onAction && cardInstanceId) {
          const instId = cardInstanceId;
          img.addEventListener('click', () => {
            setSelectedShortEvent(isSESelected ? null : instId);
            setTargetingInstruction(
              getSelectedShortEvent() ? `Click a highlighted character to play ${def.name}` : null,
            );
            reRenderShortEventTarget();
          });
        }
      } else {
        // Single target plays directly, multiple environment targets show tooltip
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          if (shortEventActions.length === 1) {
            img.addEventListener('click', () => onAction(shortEventActions[0]));
          } else {
            img.addEventListener('click', (e) => {
              showShortEventTargetMenu(e, shortEventActions, view, cardPool, onAction);
            });
          }
        }
      }
    } else if (isHazard) {
      // Check if this hazard has character-targeting actions (e.g. corruption hazards)
      const charTargetActions = hazardActions.filter(
        a => a.type === 'play-hazard' && 'targetCharacterId' in a && a.targetCharacterId,
      );
      const hasCharTargets = charTargetActions.length > 0;
      // Two-step targeting: hazard targets characters AND can be placed on-guard
      if (hasCharTargets && onGuardAction) {
        img.className = isHazardSelected
          ? 'hand-card hand-card-selected'
          : 'hand-card hand-card-playable';
        if (onAction && cardInstanceId) {
          const instId = cardInstanceId;
          img.addEventListener('click', () => {
            setSelectedHazardForPlay(isHazardSelected ? null : instId, onGuardAction);
            setTargetingInstruction(
              getSelectedHazardForPlay() ? `Click a character or site to play ${def.name}` : null,
            );
            reRenderHazardTarget();
          });
        }
      } else {
        // No character targets, or no on-guard: use original menu/direct play
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          if (hazardActions.length === 1 && !onGuardAction) {
            img.addEventListener('click', () => onAction(hazardActions[0]));
          } else {
            img.addEventListener('click', (e) => {
              showHazardKeyingMenu(e, hazardActions, onAction, onGuardAction, cardPool);
            });
          }
        }
      }
    } else if (isAlly) {
      // Ally play: single target plays directly, multiple targets use two-step character targeting
      if (allyActions.length === 1) {
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          img.addEventListener('click', () => onAction(allyActions[0]));
        }
      } else {
        img.className = isAllySelected
          ? 'hand-card hand-card-selected'
          : 'hand-card hand-card-playable';
        if (onAction && cardInstanceId) {
          const instId = cardInstanceId;
          img.addEventListener('click', () => {
            setSelectedAllyForPlay(isAllySelected ? null : instId);
            setTargetingInstruction(
              getSelectedAllyForPlay() ? `Click an untapped character to control ${def.name}` : null,
            );
            reRenderAllyPlay();
          });
        }
      }
    } else if (isResource) {
      // Resource/item play: single target plays directly, multiple targets use two-step character targeting
      if (resourceActions.length === 1) {
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          img.addEventListener('click', () => onAction(resourceActions[0]));
        }
      } else {
        img.className = isResourceSelected
          ? 'hand-card hand-card-selected'
          : 'hand-card hand-card-playable';
        if (onAction && cardInstanceId) {
          const instId = cardInstanceId;
          img.addEventListener('click', () => {
            setSelectedResourceForPlay(isResourceSelected ? null : instId);
            setTargetingInstruction(
              getSelectedResourceForPlay() ? `Click an untapped character to bear ${def.name}` : null,
            );
            reRenderResourcePlay();
          });
        }
      }
    } else if (isInfluence) {
      // Faction influence two-step flow: click to select, then click a character in company
      img.className = isFactionSelected
        ? 'hand-card hand-card-selected'
        : 'hand-card hand-card-playable';
      if (onAction && cardInstanceId) {
        const instId = cardInstanceId;
        img.addEventListener('click', () => {
          setSelectedFactionForInfluence(isFactionSelected ? null : instId);
          setTargetingInstruction(
            getSelectedFactionForInfluence() ? `Click an untapped character to influence ${def.name}` : null,
          );
          reRenderFactionInfluence();
        });
      }
    } else if (isCancelAttack) {
      if (cancelAttackActions.length === 1) {
        img.className = 'hand-card hand-card-playable';
        if (onAction) {
          img.addEventListener('click', () => onAction(cancelAttackActions[0]));
        }
      } else {
        // Two-step scout targeting flow: click to select, then click a scout in combat view
        const selectedCA = getSelectedCancelAttack();
        const isCASelected = selectedCA === cardInstanceId;
        img.className = isCASelected ? 'hand-card hand-card-selected' : 'hand-card hand-card-playable';
        if (onAction && cardInstanceId) {
          const instId = cardInstanceId;
          img.addEventListener('click', () => {
            setSelectedCancelAttack(isCASelected ? null : instId);
            setTargetingInstruction(
              getSelectedCancelAttack() ? `Click a highlighted scout to play ${def.name}` : null,
            );
            reRenderCancelAttackTarget();
          });
        }
      }
    } else if (isDodge) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => onAction(dodgeActions[0]));
      }
    } else if (action) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => onAction(action));
      }
    } else if (discardAction) {
      img.className = 'hand-card hand-card-playable';
      if (onAction) {
        img.addEventListener('click', () => onAction(discardAction));
      }
    } else if (onGuardAction) {
      // Non-playable card but can be placed on-guard — stays dimmed, click shows menu
      img.className = 'hand-card hand-card-dimmed';
      if (onAction) {
        img.style.cursor = 'pointer';
        img.addEventListener('click', (e) => {
          showHazardKeyingMenu(e, [], onAction, onGuardAction, cardPool);
        });
      }
    } else {
      img.className = 'hand-card hand-card-dimmed';
      if (nonViableReason) {
        img.title = nonViableReason;
      }
    }
    el.appendChild(img);
  }
}

// ---- Opponent hand ----

/** Get the opponent's cards to display: draft pool during draft, card backs otherwise. */
function getOpponentCards(view: PlayerView): { cards: CardDefinitionId[]; hidden: boolean } {
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-draft') {
    const draft = view.phaseState.setupStep;
    const oppIdx = 1 - findSelfIndex(draft.draftState[0].pool, draft.draftState[1].pool);
    // Opponent pool is redacted — create placeholder array of the right length for card backs
    return { cards: Array.from({ length: draft.draftState[oppIdx].pool.length }, () => 'unknown-card' as CardDefinitionId), hidden: true };
  }
  // During character deck draft, show opponent's remaining pool as card backs
  if (view.phaseState.phase === 'setup' && view.phaseState.setupStep.step === 'character-deck-draft') {
    const deckDraft = view.phaseState.setupStep.deckDraftState;
    const oppIdx = 1 - findSelfIndex(deckDraft[0].remainingPool, deckDraft[1].remainingPool);
    return { cards: Array.from({ length: deckDraft[oppIdx].remainingPool.length }, () => 'unknown-card' as CardDefinitionId), hidden: true };
  }
  // During character placement and deck shuffle, no hand cards for either player
  if (view.phaseState.phase === 'setup'
    && (view.phaseState.setupStep.step === 'character-placement'
      || view.phaseState.setupStep.step === 'deck-shuffle')) {
    return { cards: [], hidden: true };
  }
  // Outside draft, show card backs for each card in opponent's hand
  const count = view.opponent.hand.length;
  return { cards: new Array<CardDefinitionId>(count).fill('unknown-card' as CardDefinitionId), hidden: true };
}

/** Render the opponent's hand (or draft pool) as an arc at the top of the visual view. */
export function renderOpponentHand(view: PlayerView, cardPool: Readonly<Record<string, CardDefinition>>): void {
  const el = document.getElementById('opponent-arc');
  if (!el) return;
  el.innerHTML = '';
  if (view.phaseState.phase === Phase.GameOver) return;

  const { cards, hidden } = getOpponentCards(view);
  const total = cards.length;
  el.style.setProperty('--total', String(total));
  const margin = total > 7 ? -4 : -2.5;
  el.style.setProperty('--card-margin', `${margin}vh`);

  for (let i = 0; i < total; i++) {
    const img = document.createElement('img');
    if (hidden || (cards[i] as string) === 'unknown-card') {
      img.src = '/images/card-back.jpg';
      img.alt = 'Hidden card';
    } else {
      const def = cardPool[cards[i] as string];
      if (!def) continue;
      const imgPath = cardImageProxyPath(def);
      if (!imgPath) continue;
      img.src = imgPath;
      img.alt = def.name;
      img.dataset.cardId = cards[i] as string;
    }
    img.className = 'opponent-card';
    img.style.setProperty('--i', String(i));
    el.appendChild(img);
  }
}
