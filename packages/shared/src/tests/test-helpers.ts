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
} from '../index.js';
import type { PlayerId, GameState, CardDefinitionId, CardInstanceId, GameAction } from '../index.js';
import {
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GLORFINDEL_II,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
} from '../index.js';

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
  // Non-unique long events: up to 3 copies each
  const longEvents = [SUN, SUN];
  // Non-unique hazard creatures: 3 copies each
  const hazards = [
    CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
    ORC_PATROL, ORC_PATROL, ORC_PATROL,
    BARROW_WIGHT,
    EYE_OF_SAURON, EYE_OF_SAURON,
  ];
  return [...uniqueResources, ...nonUniqueResources, ...longEvents, ...hazards];
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
        draftPool: [ARAGORN, BILBO, FRODO, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [MORIA, MINAS_TIRITH, MOUNT_DOOM],
        startingHavens: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
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
  actions: readonly GameAction[],
): GameState {
  for (const action of actions) {
    const result = reduce(state, action);
    if (result.error) throw new Error(`Action ${action.type} failed: ${result.error}`);
    state = result.state;
  }
  return state;
}

/**
 * Find the draft pool instance ID for a given character definition.
 * Looks up the pool in the current draft state for the given player.
 */
export function draftInstId(state: GameState, playerIndex: number, defId: CardDefinitionId): CardInstanceId {
  if (state.phaseState.phase !== 'setup' || state.phaseState.setupStep.step !== 'character-draft') {
    throw new Error('Not in character draft phase');
  }
  const draftPool = state.phaseState.setupStep.draftState[playerIndex].pool;
  for (const instId of draftPool) {
    if (state.instanceMap[instId as string]?.definitionId === defId) return instId;
  }
  throw new Error(`Definition ${defId} not found in player ${playerIndex}'s draft pool`);
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
    { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, ARAGORN) },
    { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, LEGOLAS) },
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

// ─── Shared state builder ────────────────────────────────────────────────────

import type {
  CompanyId, CardInPlay, CharacterInPlay, Company,
  PlayerState, EffectiveStats,
} from '../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS } from '../index.js';

let nextInstanceCounter = 1;

/** Mint a fresh CardInstanceId. Call {@link resetMint} between tests. */
export function mint(): CardInstanceId {
  return `inst-${nextInstanceCounter++}` as CardInstanceId;
}

/** Reset the instance counter so tests get deterministic IDs. */
export function resetMint(): void {
  nextInstanceCounter = 1;
}

/** Setup for a single character in a company. */
export interface CharacterSetup {
  defId: CardDefinitionId;
  items?: CardDefinitionId[];
  status?: CardStatus;
  /** Index into the same company's characters array for the character this one follows. */
  followerOf?: number;
}

/** Setup for a company at a site with characters. */
export interface CompanySetup {
  site: CardDefinitionId;
  characters: CharacterSetup[];
}

/** Setup for one player's starting state. */
export interface PlayerSetup {
  id: PlayerId;
  companies: CompanySetup[];
  hand: CardDefinitionId[];
  siteDeck: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  cardsInPlay?: CardInPlay[];
}

/** Options for {@link buildTestState}. */
export interface BuildTestStateOpts {
  activePlayer: PlayerId;
  players: [PlayerSetup, PlayerSetup];
  /** Which phase the state starts in. Defaults to Organization. */
  phase?: Phase;
  /** RNG seed for deterministic dice rolls. Defaults to 42. */
  seed?: number;
  /**
   * If true, manually compute generalInfluenceUsed and effectiveStats from
   * card definitions before returning. Useful when tests assert on these
   * values before dispatching any action (the reducer recomputes on every
   * action, but tests that inspect the initial state need correct values).
   */
  recompute?: boolean;
}

/**
 * Build a minimal valid GameState for testing. Supports all common features:
 * characters with items, followers, cardsInPlay, configurable phase, and
 * optional pre-computation of derived values.
 */
export function buildTestState(opts: BuildTestStateOpts): GameState {
  resetMint();

  const instanceMap: Record<string, { instanceId: CardInstanceId; definitionId: CardDefinitionId }> = {};

  function mintFor(defId: CardDefinitionId): CardInstanceId {
    const id = mint();
    instanceMap[id as string] = { instanceId: id, definitionId: defId };
    return id;
  }

  const playerStates = opts.players.map((setup) => {
    const hand = setup.hand.map(defId => mintFor(defId));
    const siteDeck = setup.siteDeck.map(defId => mintFor(defId));

    // Register pre-built cardsInPlay instances
    if (setup.cardsInPlay) {
      for (const card of setup.cardsInPlay) {
        instanceMap[card.instanceId as string] = { instanceId: card.instanceId, definitionId: card.definitionId };
      }
    }

    const characters: Record<string, CharacterInPlay> = {};
    const companies: Company[] = [];

    for (const companySetup of setup.companies) {
      const siteInstId = mintFor(companySetup.site);
      const charInstIds: CardInstanceId[] = [];

      for (const charSetup of companySetup.characters) {
        const charInstId = mintFor(charSetup.defId);
        charInstIds.push(charInstId);

        const items = (charSetup.items ?? []).map(itemDefId => {
          const itemInstId = mintFor(itemDefId);
          return { instanceId: itemInstId, definitionId: itemDefId, status: CardStatus.Untapped };
        });

        characters[charInstId as string] = {
          instanceId: charInstId,
          definitionId: charSetup.defId,
          status: charSetup.status ?? CardStatus.Untapped,
          items,
          allies: [],
          corruptionCards: [],
          followers: [],
          controlledBy: 'general' as const,
          effectiveStats: ZERO_EFFECTIVE_STATS,
        };
      }

      // Wire up followers after all characters in company are created
      for (let i = 0; i < companySetup.characters.length; i++) {
        const charSetup = companySetup.characters[i];
        if (charSetup.followerOf !== undefined) {
          const followerInstId = charInstIds[i];
          const controllerInstId = charInstIds[charSetup.followerOf];
          characters[followerInstId as string] = {
            ...characters[followerInstId as string],
            controlledBy: controllerInstId,
          };
          const ctrl = characters[controllerInstId as string];
          characters[controllerInstId as string] = {
            ...ctrl,
            followers: [...ctrl.followers, followerInstId],
          };
        }
      }

      companies.push({
        id: `company-${setup.id as string}-${companies.length}` as CompanyId,
        characters: charInstIds,
        currentSite: { instanceId: siteInstId, definitionId: companySetup.site, status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
      });
    }

    const playDeck = (setup.playDeck ?? []).map(defId => mintFor(defId));
    const discardPile = (setup.discardPile ?? []).map(defId => mintFor(defId));

    return {
      id: setup.id,
      name: setup.id === PLAYER_1 ? 'Alice' : 'Bob',
      alignment: Alignment.Wizard,
      wizard: null,
      hand,
      playDeck,
      discardPile,
      siteDeck,
      siteDiscardPile: [] as CardInstanceId[],
      sideboard: [] as CardInstanceId[],
      killPile: [] as CardInstanceId[],
      eliminatedPile: [] as CardInstanceId[],
      companies,
      characters,
      cardsInPlay: setup.cardsInPlay ?? ([] as CardInPlay[]),
      marshallingPoints: ZERO_MARSHALLING_POINTS,
      generalInfluenceUsed: 0,
      deckExhaustionCount: 0,
      freeCouncilCalled: false,
      lastDiceRoll: null,
      sideboardAccessedDuringUntap: false,
    };
  });

  const phase = opts.phase ?? Phase.Organization;
  let phaseState: GameState['phaseState'];
  if (phase === Phase.Organization) {
    phaseState = { phase: Phase.Organization, characterPlayedThisTurn: false, pendingCorruptionCheck: null } as GameState['phaseState'];
  } else if (phase === Phase.EndOfTurn) {
    phaseState = { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false] } as GameState['phaseState'];
  } else {
    phaseState = { phase } as GameState['phaseState'];
  }

  // Optionally recompute GI and effective stats from card definitions
  if (opts.recompute) {
    for (const ps of playerStates) {
      let giUsed = 0;
      for (const [, char] of Object.entries(ps.characters)) {
        if (char.controlledBy === 'general') {
          const def = pool[char.definitionId as string];
          if (def && 'mind' in def && (def as { mind: number | null }).mind !== null) {
            giUsed += (def as { mind: number }).mind;
          }
        }
      }
      (ps as { generalInfluenceUsed: number }).generalInfluenceUsed = giUsed;

      for (const [key, char] of Object.entries(ps.characters)) {
        const def = pool[char.definitionId as string];
        if (def && 'prowess' in def) {
          const cd = def as { prowess: number; body: number; directInfluence: number };
          (ps.characters[key] as { effectiveStats: EffectiveStats }).effectiveStats = {
            prowess: cd.prowess,
            body: cd.body,
            directInfluence: cd.directInfluence,
            corruptionPoints: 0,
          };
        }
      }
    }
  }

  return {
    gameId: 'test-game',
    players: playerStates as unknown as readonly [PlayerState, PlayerState],
    activePlayer: opts.activePlayer,
    phaseState,
    combat: null,
    chain: null,
    eventsInPlay: [],
    cardPool: pool,
    instanceMap,
    turnNumber: 1,
    pendingEffects: [],
    rng: { seed: opts.seed ?? 42, counter: 0 },
    stateSeq: 0,
    reverseActions: [],
    cheatRollTotal: null,
  } as unknown as GameState;
}

// Re-export commonly used things
export {
  createGame, reduce,
  Phase, Alignment,
  ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GLORFINDEL_II,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR,
  CAVE_DRAKE, ORC_PATROL, BARROW_WIGHT,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS,
};
export type { GameConfig, QuickStartGameConfig, ReducerResult, CardInPlay, CardInstanceId, CardDefinitionId, CompanyId };
