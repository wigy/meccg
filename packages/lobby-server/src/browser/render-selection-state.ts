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
