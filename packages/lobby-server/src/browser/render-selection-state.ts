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
 * Set or clear the targeting instruction displayed in the center of the board.
 * Called from within render modules and by external modules (e.g. company-view)
 * when entering/exiting two-step selection flows.
 */
export function setTargetingInstruction(text: string | null): void {
  targetingInstruction = text;
  const el = document.getElementById('instruction-text');
  if (!el) return;
  el.textContent = text ?? '';
}

/** Get the current targeting instruction (for renderInstructions to check priority). */
export function getTargetingInstruction(): string | null {
  return targetingInstruction;
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
let itemDraftRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached item draft render arguments. */
export function getItemDraftRenderCache(): typeof itemDraftRenderCache {
  return itemDraftRenderCache;
}

/** Set the cached item draft render arguments. */
export function setItemDraftRenderCache(cache: typeof itemDraftRenderCache): void {
  itemDraftRenderCache = cache;
}

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
let playCharacterRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached play-character render arguments. */
export function getPlayCharacterRenderCache(): typeof playCharacterRenderCache {
  return playCharacterRenderCache;
}

/** Set the cached play-character render arguments. */
export function setPlayCharacterRenderCache(cache: typeof playCharacterRenderCache): void {
  playCharacterRenderCache = cache;
}

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
let factionInfluenceRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached faction influence render arguments. */
export function getFactionInfluenceRenderCache(): typeof factionInfluenceRenderCache {
  return factionInfluenceRenderCache;
}

/** Set the cached faction influence render arguments. */
export function setFactionInfluenceRenderCache(cache: typeof factionInfluenceRenderCache): void {
  factionInfluenceRenderCache = cache;
}

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
let resourcePlayRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached resource play render arguments. */
export function getResourcePlayRenderCache(): typeof resourcePlayRenderCache {
  return resourcePlayRenderCache;
}

/** Set the cached resource play render arguments. */
export function setResourcePlayRenderCache(cache: typeof resourcePlayRenderCache): void {
  resourcePlayRenderCache = cache;
}

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
let allyPlayRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached ally play render arguments. */
export function getAllyPlayRenderCache(): typeof allyPlayRenderCache {
  return allyPlayRenderCache;
}

/** Set the cached ally play render arguments. */
export function setAllyPlayRenderCache(cache: typeof allyPlayRenderCache): void {
  allyPlayRenderCache = cache;
}

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
let hazardPlayRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached hazard play render arguments. */
export function getHazardPlayRenderCache(): typeof hazardPlayRenderCache {
  return hazardPlayRenderCache;
}

/** Set the cached hazard play render arguments. */
export function setHazardPlayRenderCache(cache: typeof hazardPlayRenderCache): void {
  hazardPlayRenderCache = cache;
}

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
let shortEventRenderCache: {
  view: PlayerView;
  cardPool: Readonly<Record<string, CardDefinition>>;
  onAction: (action: GameAction) => void;
} | null = null;

/** Get the cached short-event render arguments. */
export function getShortEventRenderCache(): typeof shortEventRenderCache {
  return shortEventRenderCache;
}

/** Set the cached short-event render arguments. */
export function setShortEventRenderCache(cache: typeof shortEventRenderCache): void {
  shortEventRenderCache = cache;
}
