/**
 * @module test-helpers
 *
 * Shared test utilities for creating game configs and running through
 * setup steps. Reduces boilerplate across test files.
 */

import { createGame } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import {
  loadCardPool,
  Phase,
  Alignment,
} from '@meccg/shared';
import type { PlayerId, GameState, CardDefinitionId } from '@meccg/shared';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GLORFINDEL_II,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '@meccg/shared';

export const PLAYER_1 = 'p1' as PlayerId;
export const PLAYER_2 = 'p2' as PlayerId;

export const pool = loadCardPool();

export function makePlayDeck(): CardDefinitionId[] {
  // Unique items: 1 copy each
  const uniqueResources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING];
  // Non-unique items: up to 3 copies each
  const nonUniqueResources = [
    DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE,
  ];
  // Non-unique hazard creatures: 3 copies each
  const hazards = [
    CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
    ORC_PATROL, ORC_PATROL, ORC_PATROL,
    BARROW_WIGHT,
  ];
  return [...uniqueResources, ...nonUniqueResources, ...hazards];
}

export function makeQuickStartConfig(seed = 42): QuickStartGameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        startingCharacters: [ARAGORN, BILBO],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        startingCharacters: [LEGOLAS, GIMLI],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH],
        startingHavens: [LORIEN],
      },
    ],
    seed,
  };
}

export function makeDraftConfig(seed = 42): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.Wizard,
        draftPool: [ARAGORN, BILBO, FRODO],
        startingMinorItems: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LEGOLAS, GIMLI, FARAMIR],
        startingMinorItems: [DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH],
        startingHavens: [LORIEN],
      },
    ],
    seed,
  };
}

/**
 * Run a sequence of actions, asserting no errors.
 * Returns the final state.
 */
export function runActions(
  state: GameState,
  actions: Array<{ type: string; player: PlayerId; [key: string]: unknown }>,
): GameState {
  for (const action of actions) {
    const result = reduce(state, action as never);
    if (result.error) throw new Error(`Action ${action.type} failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

/**
 * Run through the character draft: both players pick one character each,
 * then both stop. Returns the state after draft completion (in item-draft or later).
 */
export function runSimpleDraft(config?: GameConfig): GameState {
  const gameConfig = config ?? makeDraftConfig();
  let state = createGame(gameConfig, pool);

  // Both pick one character
  state = runActions(state, [
    { type: 'draft-pick', player: PLAYER_1, characterDefId: ARAGORN },
    { type: 'draft-pick', player: PLAYER_2, characterDefId: LEGOLAS },
    { type: 'draft-stop', player: PLAYER_1 },
    { type: 'draft-stop', player: PLAYER_2 },
  ]);

  return state;
}

/**
 * Run through the entire setup from draft to Untap, including item assignment,
 * deck draft, site selection, placement, shuffle, draw, and initiative roll.
 * Returns the state at the start of turn 1 (Untap phase).
 */
export function runFullSetup(config?: GameConfig): GameState {
  let state = runSimpleDraft(config);

  // Item draft: assign all items to first character
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'item-draft') {
    const p1Char = state.players[0].companies[0].characters[0];
    const p2Char = state.players[1].companies[0].characters[0];
    const p1Items = state.phaseState.setupStep.itemDraftState[0].unassignedItems;
    const p2Items = state.phaseState.setupStep.itemDraftState[1].unassignedItems;

    for (const _item of p1Items) {
      const result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
    for (const _item of p2Items) {
      const result = reduce(state, { type: 'assign-starting-item', player: PLAYER_2, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p2Char });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
  }

  // Deck draft: pass
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-deck-draft') {
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
  }

  // Site selection: pick first available site
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'starting-site-selection') {
    const p1Site = state.players[0].siteDeck[0];
    const p2Site = state.players[1].siteDeck[0];
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: p1Site },
      { type: 'pass', player: PLAYER_1 },
      { type: 'select-starting-site', player: PLAYER_2, siteInstanceId: p2Site },
      { type: 'pass', player: PLAYER_2 },
    ]);
  }

  // Character placement: pass (if needed)
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'character-placement') {
    const step = state.phaseState.setupStep;
    if (!step.placementDone[0]) {
      const result = reduce(state, { type: 'pass', player: PLAYER_1 });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
    if (!step.placementDone[1]) {
      const result = reduce(state, { type: 'pass', player: PLAYER_2 });
      if (result.error) throw new Error(result.error);
      state = result.state;
    }
  }

  // Deck shuffle
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'deck-shuffle') {
    state = runActions(state, [
      { type: 'shuffle-play-deck', player: PLAYER_1 },
      { type: 'shuffle-play-deck', player: PLAYER_2 },
    ]);
  }

  // Initial draw
  if (state.phaseState.phase === Phase.Setup && state.phaseState.setupStep.step === 'initial-draw') {
    state = runActions(state, [
      { type: 'draw-cards', player: PLAYER_1, count: 8 },
      { type: 'draw-cards', player: PLAYER_2, count: 8 },
    ]);
  }

  // Initiative roll (may need rerolls on ties)
  while (state.phaseState.phase === Phase.Setup) {
    state = runActions(state, [
      { type: 'roll-initiative', player: PLAYER_1 },
      { type: 'roll-initiative', player: PLAYER_2 },
    ]);
  }

  return state;
}

// Re-export commonly used things
export {
  createGame, reduce,
  Phase, Alignment,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GLORFINDEL_II,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
};
export type { GameConfig, QuickStartGameConfig, ReducerResult };
