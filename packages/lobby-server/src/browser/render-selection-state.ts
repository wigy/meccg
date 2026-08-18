/**
 * @module render-selection-state
 *
 * Shared mutable state for two-step selection flows in the visual UI.
 * Several hand-card interactions require the player to first click a card
 * (selecting it) and then click a target (character, company, or site).
 * This module holds the selected-card state for each flow and provides
 * getters/setters so both the hand renderer and the company view can
 * coordinate without circular imports.
 */

import type { CardDefinitionId, CardDefinition, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';

/**
 * Targeting instruction text displayed when the player is in a two-step
 * selection flow (item draft, play-character, move-to-influence).
 * Takes priority over phase-based instructions when set.
 */
let targetingInstruction: string | null = null;

/**
 * Set or clear the targeting instruction shown in the phase meter breadcrumb
 * (#phase-target-hint). Called from within render modules and by external
 * modules (e.g. company-view) when entering/exiting two-step selection flows.
 */
export function setTargetingInstruction(text: string | null): void {
  targetingInstruction = text;
  const el = document.getElementById('phase-target-hint');
  if (!el) return;
  el.textContent = text ? ` — ${text}` : '';
}

/** Get the current targeting instruction (re-applied by renderPhaseMeter). */
export function getTargetingInstruction(): string | null {
  return targetingInstruction;
}

/** Arguments a two-step selection flow needs to re-render the board later. */
export interface SelectionRenderCache {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
}

/** One independent render-cache slot; `set(null)` clears it. */
export interface RenderCacheSlot {
  get(): SelectionRenderCache | null;
  set(cache: SelectionRenderCache | null): void;
}

/**
 * Create a render-cache slot for one two-step selection flow. Each flow keeps
 * its own slot so clearing one (its selection ended) never disturbs another.
 */
function renderCacheSlot(): RenderCacheSlot {
  let cache: SelectionRenderCache | null = null;
  return {
    get: () => cache,
    set: (next) => { cache = next; },
  };
}

// ---- Item draft selection ----

/**
 * Module-level state for the item draft two-step selection flow.
 * When a player clicks an item in the hand arc, it becomes "selected" and
 * valid target characters are highlighted on the table. Clicking a target
 * character sends the assign-starting-item action.
 */
let selectedItemDefId: CardDefinitionId | null = null;

/** Get the currently selected item definition ID for item draft. */
export function getSelectedItemDefId(): CardDefinitionId | null {
  return selectedItemDefId;
}

/** Set the selected item definition ID for item draft. */
export function setSelectedItemDefId(id: CardDefinitionId | null): void {
  selectedItemDefId = id;
}

/** Cached arguments for re-rendering during item draft target selection. */
export const itemDraftRenderCache = renderCacheSlot();

// ---- Play-character selection ----

/**
 * Module-level state for the play-character two-step selection flow.
 * When a player clicks a playable character in the hand arc, the character
 * instance ID is stored here and the company view highlights valid targets.
 */
let selectedCharacterInstanceId: CardInstanceId | null = null;

/** Returns the currently selected character instance ID for the play-character flow. */
export function getSelectedCharacterForPlay(): CardInstanceId | null {
  return selectedCharacterInstanceId;
}

/** Set the selected character instance ID for the play-character flow. */
export function setSelectedCharacterForPlay(id: CardInstanceId | null): void {
  selectedCharacterInstanceId = id;
}

/** Clear the play-character selection (called by company-view after action is sent). */
export function clearCharacterPlaySelection(): void {
  selectedCharacterInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during character play target selection. */
export const playCharacterRenderCache = renderCacheSlot();

// ---- Faction influence selection ----

/**
 * Selected faction instance ID for the two-step influence attempt flow.
 * When a player clicks a playable faction in the hand arc, the faction
 * instance ID is stored here and the company view highlights untapped characters.
 */
let selectedFactionInstanceId: CardInstanceId | null = null;

/** Returns the currently selected faction instance ID for the influence-attempt flow. */
export function getSelectedFactionForInfluence(): CardInstanceId | null {
  return selectedFactionInstanceId;
}

/** Set the selected faction instance ID for the influence-attempt flow. */
export function setSelectedFactionForInfluence(id: CardInstanceId | null): void {
  selectedFactionInstanceId = id;
}

/** Clear the faction influence selection (called by company-view after action is sent). */
export function clearFactionInfluenceSelection(): void {
  selectedFactionInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during faction influence target selection. */
export const factionInfluenceRenderCache = renderCacheSlot();

// ---- Resource/item play selection ----

/**
 * Selected resource/item instance ID for the two-step play-resource flow.
 * When a player clicks a playable resource or item in the hand arc, the
 * instance ID is stored here and the company view highlights untapped characters.
 */
let selectedResourceInstanceId: CardInstanceId | null = null;

/** Returns the currently selected resource instance ID for the play-resource flow. */
export function getSelectedResourceForPlay(): CardInstanceId | null {
  return selectedResourceInstanceId;
}

/** Set the selected resource instance ID for the play-resource flow. */
export function setSelectedResourceForPlay(id: CardInstanceId | null): void {
  selectedResourceInstanceId = id;
}

/** Clear the resource play selection (called by company-block after action is sent). */
export function clearResourcePlaySelection(): void {
  selectedResourceInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during resource play target selection. */
export const resourcePlayRenderCache = renderCacheSlot();

// ---- Ally play selection ----

/**
 * Selected ally instance ID for the two-step play-ally flow.
 * When a player clicks a playable ally in the hand arc, the ally
 * instance ID is stored here and the company view highlights untapped characters.
 */
let selectedAllyInstanceId: CardInstanceId | null = null;

/** Returns the currently selected ally instance ID for the play-ally flow. */
export function getSelectedAllyForPlay(): CardInstanceId | null {
  return selectedAllyInstanceId;
}

/** Set the selected ally instance ID for the play-ally flow. */
export function setSelectedAllyForPlay(id: CardInstanceId | null): void {
  selectedAllyInstanceId = id;
}

/** Clear the ally play selection (called by company-block after action is sent). */
export function clearAllyPlaySelection(): void {
  selectedAllyInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during ally play target selection. */
export const allyPlayRenderCache = renderCacheSlot();

// ---- Hazard character-targeting selection ----

/**
 * Selected hazard instance ID for the two-step hazard targeting flow.
 * When a player clicks a hazard that can target characters AND be placed
 * on-guard, the hazard instance ID is stored here. Clicking an opponent
 * character plays the hazard on that character; clicking the site places on-guard.
 */
let selectedHazardInstanceId: CardInstanceId | null = null;

/** The on-guard action associated with the currently selected hazard. */
let selectedHazardOnGuardAction: GameAction | null = null;

/** Returns the currently selected hazard instance ID for the targeting flow. */
export function getSelectedHazardForPlay(): CardInstanceId | null {
  return selectedHazardInstanceId;
}

/** Returns the on-guard action for the currently selected hazard. */
export function getSelectedHazardOnGuardAction(): GameAction | null {
  return selectedHazardOnGuardAction;
}

/** Set the selected hazard and its on-guard action for the targeting flow. */
export function setSelectedHazardForPlay(id: CardInstanceId | null, onGuardAction?: GameAction | null): void {
  selectedHazardInstanceId = id;
  selectedHazardOnGuardAction = onGuardAction ?? null;
}

/** Clear the hazard targeting selection. */
export function clearHazardPlaySelection(): void {
  selectedHazardInstanceId = null;
  selectedHazardOnGuardAction = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during hazard targeting selection. */
export const hazardPlayRenderCache = renderCacheSlot();

// ---- Opponent influence selection ----

/**
 * Selected character instance ID for the opponent influence two-step flow.
 * When a player clicks an untapped character that has opponent-influence-attempt
 * actions, the character is stored here and opponent cards are highlighted.
 */
let selectedInfluencerForOpponent: CardInstanceId | null = null;

/** Returns the currently selected influencer for the opponent influence flow. */
export function getSelectedInfluencerForOpponent(): CardInstanceId | null {
  return selectedInfluencerForOpponent;
}

/** Set the selected influencer for opponent influence targeting. */
export function setSelectedInfluencerForOpponent(id: CardInstanceId | null): void {
  selectedInfluencerForOpponent = id;
}

/** Clear the opponent influence selection (called by company-view after action is sent). */
export function clearOpponentInfluenceSelection(): void {
  selectedInfluencerForOpponent = null;
  setTargetingInstruction(null);
}

// ---- Short-event character targeting ----

/**
 * Selected short-event instance ID for the two-step character targeting flow.
 * When a player clicks a short-event with multiple eligible character targets
 * (e.g. Stealth choosing a scout), the card instance ID is stored here and
 * the company view highlights valid target characters.
 */
let selectedShortEventInstanceId: CardInstanceId | null = null;

/** Returns the currently selected short-event instance ID for character targeting. */
export function getSelectedShortEvent(): CardInstanceId | null {
  return selectedShortEventInstanceId;
}

/** Set the selected short-event instance ID for character targeting. */
export function setSelectedShortEvent(id: CardInstanceId | null): void {
  selectedShortEventInstanceId = id;
}

/** Clear the short-event character targeting selection. */
export function clearShortEventSelection(): void {
  selectedShortEventInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during short-event target selection. */
export const shortEventRenderCache = renderCacheSlot();

// ---- Cancel-attack scout targeting ----

/**
 * Selected cancel-attack card instance ID for the two-step scout targeting flow.
 * When a player clicks a cancel-attack card (e.g. Concealment) with multiple
 * eligible scouts, the card instance ID is stored here and the combat view
 * highlights valid scout characters for point-and-click selection.
 */
let selectedCancelAttackInstanceId: CardInstanceId | null = null;

/** Returns the currently selected cancel-attack card instance ID for scout targeting. */
export function getSelectedCancelAttack(): CardInstanceId | null {
  return selectedCancelAttackInstanceId;
}

/** Set the selected cancel-attack card instance ID for scout targeting. */
export function setSelectedCancelAttack(id: CardInstanceId | null): void {
  selectedCancelAttackInstanceId = id;
}

/** Clear the cancel-attack scout targeting selection. */
export function clearCancelAttackSelection(): void {
  selectedCancelAttackInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during cancel-attack scout selection. */
export const cancelAttackRenderCache = renderCacheSlot();

// ---- Permanent-event character targeting selection ----

/**
 * Selected permanent-event instance ID for the two-step character targeting flow.
 * When a player clicks a character-targeting permanent event with multiple
 * eligible characters, the card instance ID is stored here and the company
 * view highlights valid target characters.
 */
let selectedPermanentEventInstanceId: CardInstanceId | null = null;

/** Returns the currently selected permanent-event instance ID for character targeting. */
export function getSelectedPermanentEventForPlay(): CardInstanceId | null {
  return selectedPermanentEventInstanceId;
}

/** Set the selected permanent-event instance ID for character targeting. */
export function setSelectedPermanentEventForPlay(id: CardInstanceId | null): void {
  selectedPermanentEventInstanceId = id;
}

/** Clear the permanent-event character targeting selection. */
export function clearPermanentEventPlaySelection(): void {
  selectedPermanentEventInstanceId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during permanent-event character targeting. */
export const permanentEventPlayRenderCache = renderCacheSlot();

// ---- Tap-alt-permanent-event character targeting selection ----

/**
 * Selected in-play creature-permanent-event instance ID for the two-step
 * `tap-alt-permanent-event` character-targeting flow (e.g. Adûnaphel tw-2,
 * which when tapped taps any one character). When the player clicks the
 * in-play permanent-event, its instance ID is stored here and the company view
 * highlights the eligible target characters (of either player). Distinct from
 * {@link selectedPermanentEventInstanceId}, which targets a character while
 * *playing* a permanent-event from hand.
 */
let selectedTapAltPermanentEventInstanceId: CardInstanceId | null = null;

/** Returns the in-play permanent-event instance ID selected for tap-targeting. */
export function getSelectedTapAltPermanentEvent(): CardInstanceId | null {
  return selectedTapAltPermanentEventInstanceId;
}

/** Set the in-play permanent-event instance ID selected for tap-targeting. */
export function setSelectedTapAltPermanentEvent(id: CardInstanceId | null): void {
  selectedTapAltPermanentEventInstanceId = id;
}

/** Clear the tap-alt-permanent-event character-targeting selection. */
export function clearTapAltPermanentEventSelection(): void {
  selectedTapAltPermanentEventInstanceId = null;
  setTargetingInstruction(null);
}

// ---- Permanent-event long-event targeting selection ----

/**
 * Selected permanent-event instance ID for the two-step long-event targeting
 * flow (Echo of All Joy td-110): when a player clicks a long-event-targeting
 * permanent event with multiple eligible own in-play resource long-events,
 * the card instance ID is stored here and the board highlights valid target
 * long-events for a second click. Distinct from
 * {@link selectedPermanentEventInstanceId}, which targets a character.
 */
let selectedPermanentEventForLongEventTargetId: CardInstanceId | null = null;

/** Returns the currently selected permanent-event instance ID for long-event targeting. */
export function getSelectedPermanentEventForLongEventTarget(): CardInstanceId | null {
  return selectedPermanentEventForLongEventTargetId;
}

/** Set the selected permanent-event instance ID for long-event targeting. */
export function setSelectedPermanentEventForLongEventTarget(id: CardInstanceId | null): void {
  selectedPermanentEventForLongEventTargetId = id;
}

/** Clear the permanent-event long-event targeting selection. */
export function clearPermanentEventLongEventTargetSelection(): void {
  selectedPermanentEventForLongEventTargetId = null;
  setTargetingInstruction(null);
}

/** Cached arguments for re-rendering during permanent-event long-event targeting. */
export const permanentEventLongEventTargetRenderCache = renderCacheSlot();

// ---- CvCC attacker selection ----

/** The attacking character the player has first-clicked during CvCC attacker assignment. */
let selectedCvCCAttackerId: CardInstanceId | null = null;

/** Get the selected CvCC attacker instance ID. */
export function getSelectedCvCCAttacker(): CardInstanceId | null {
  return selectedCvCCAttackerId;
}

/** Set the selected CvCC attacker instance ID. */
export function setSelectedCvCCAttacker(id: CardInstanceId): void {
  selectedCvCCAttackerId = id;
}

/** Clear the CvCC attacker selection. */
export function clearSelectedCvCCAttacker(): void {
  selectedCvCCAttackerId = null;
}

// ---- CvCC defender selection ----

/**
 * The defending character the player has first-clicked during CvCC defender phase
 * assignment. After selecting a defender (golden → green), the player clicks an
 * attacker (blue) to create the full pair.
 */
let selectedCvCCDefenderId: CardInstanceId | null = null;

/** Get the selected CvCC defender instance ID. */
export function getSelectedCvCCDefender(): CardInstanceId | null {
  return selectedCvCCDefenderId;
}

/** Set the selected CvCC defender instance ID. */
export function setSelectedCvCCDefender(id: CardInstanceId): void {
  selectedCvCCDefenderId = id;
}

/** Clear the CvCC defender selection. */
export function clearSelectedCvCCDefender(): void {
  selectedCvCCDefenderId = null;
}
