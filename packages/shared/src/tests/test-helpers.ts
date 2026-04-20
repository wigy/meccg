/**
 * @module test-helpers
 *
 * Shared test utilities for creating game configs and running through
 * setup steps. Reduces boilerplate across test files.
 */

import { expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createGame } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import { autoMergeNonHavenCompanies as _autoMergeNonHavenCompanies } from '../engine/reducer-utils.js';
import {
  loadCardPool,
  Phase,
  Alignment,
  RegionType,
  SiteType,
  computeLegalActions,
} from '../index.js';
import type { PlayerId, GameState, CardDefinitionId, CardInstanceId, CardInstance, GameAction, PlayCharacterAction, SitePhaseState, MovementHazardPhaseState, InfluenceAttemptAction, OpponentInfluenceAttemptAction, LongEventPhaseState, CreatureKeyingMatch, CombatState, CharacterCard, ActivateGrantedAction, ActiveConstraint, CheckKind } from '../index.js';
import type { EvaluatedAction } from '../rules/types.js';
import type { DeckList } from '../types/cards.js';
import { enqueueResolution, addConstraint } from '../engine/pending.js';
import type { CollectedEffect } from '../engine/effects/index.js';
import {
  ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BARD_BOWMAN, ANBORN, SAM_GAMGEE, FATTY_BOLGER, PEATH,
  THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI,
  SARUMAN, IORETH,
  GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING, HAUBERK_OF_BRIGHT_MAIL,
  CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, SAPLING_OF_THE_WHITE_TREE,
  GWAIHIR, TREEBEARD,
  ASSASSIN, CAVE_DRAKE, ORC_GUARD, ORC_WARBAND, ORC_LIEUTENANT, ORC_PATROL, ORC_WATCH, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, HOBGOBLINS, FOOLISH_WORDS, LURE_OF_THE_SENSES, ALONE_AND_UNADVISED, LOST_IN_FREE_DOMAINS, STEALTH, RIVER,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS, CONCEALMENT, DODGE, DARK_QUARRELS, HALFLING_STRENGTH, MARVELS_TOLD, LITTLE_SNUFFLER, AND_FORTH_HE_HASTENED, WIZARDS_LAUGHTER, VANISHMENT,
  AN_UNEXPECTED_OUTPOST, TWO_OR_THREE_TRIBES_PRESENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR, DUNNISH_CLAN_HOLD, HENNETH_ANNUN, LOND_GALEN, TOLFALAS, EDHELLOND, WELLINGHALL,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN, MEN_OF_ANFALAS, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RANGERS_OF_ITHILIEN, RIDERS_OF_ROHAN, DUNLENDINGS,
} from '../index.js';

export const PLAYER_1 = 'p1' as PlayerId;
export const PLAYER_2 = 'p2' as PlayerId;

/**
 * Player index convention for tests: unless a test deliberately flips
 * roles, player 0 is the resource (active) player and player 1 is the
 * hazard (opponent) player. Prefer these constants over bare `0` / `1`
 * when calling helpers like `charIdAt`, `getCharacter`, `handCardId`,
 * `attachHazardToChar`, etc., so test intent reads at the call site.
 *
 * For tests whose `activePlayer` is `PLAYER_2`, the convention does not
 * apply — use bare indices (with a short comment) or add a local
 * `const HERO_IDX = 1;` to clarify.
 */
export const RESOURCE_PLAYER = 0;
export const HAZARD_PLAYER = 1;

export const pool = loadCardPool();

const THE_ONE_RING = 'tw-347' as CardDefinitionId;

export function makePlayDeck(): CardDefinitionId[] {
  // Unique items: 1 copy each
  const uniqueResources = [GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, HAUBERK_OF_BRIGHT_MAIL];
  // Non-unique items: up to 3 copies each
  const nonUniqueResources = [
    DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE,
  ];
  // Non-unique long events: up to 3 copies each
  const longEvents = [SUN, SUN];
  // Non-unique hazard creatures: 3 copies each
  const hazards = [
    CAVE_DRAKE, CAVE_DRAKE, CAVE_DRAKE,
    ORC_LIEUTENANT, ORC_LIEUTENANT, ORC_LIEUTENANT,
    ORC_PATROL, ORC_PATROL, ORC_PATROL,
    ORC_WARBAND, ORC_WARBAND, ORC_WARBAND,
    BARROW_WIGHT,
    BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG,
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
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        startingCharacters: [LEGOLAS, GIMLI],
        playDeck: makePlayDeck(),
        siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
        sideboard: [],
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
        siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
        sideboard: [],
      },
      {
        id: PLAYER_2,
        name: 'Bob',
        alignment: Alignment.Wizard,
        draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
        playDeck: makePlayDeck(),
        siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
        sideboard: [],
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
  for (const inst of draftPool) {
    if (inst.definitionId === defId) return inst.instanceId;
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
    const p1Site = state.players[0].siteDeck[0].instanceId;
    const p2Site = state.players[1].siteDeck[0].instanceId;
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
  PlayerState, OnGuardCard, MarshallingPointTotals,
} from '../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS } from '../index.js';
import { recomputeDerived } from '../engine/recompute-derived.js';

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

/** A character entry can be a full setup object or just a definition ID. */
export type CharacterEntry = CharacterSetup | CardDefinitionId;

/** Setup for a company at a site with characters. */
export interface CompanySetup {
  site: CardDefinitionId;
  characters: CharacterEntry[];
}

/** Setup for one player's starting state. */
export interface PlayerSetup {
  id: PlayerId;
  companies: CompanySetup[];
  hand: CardDefinitionId[];
  siteDeck: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  sideboard?: CardDefinitionId[];
  cardsInPlay?: CardInPlay[];
  /** Player alignment. Defaults to {@link Alignment.Wizard} (hero). */
  alignment?: Alignment;
  /** Override raw marshalling-point totals (defaults to all zero). */
  marshallingPoints?: Partial<MarshallingPointTotals>;
  /** Override how many times the play deck has been exhausted (defaults to 0). */
  deckExhaustionCount?: number;
}

/** Options for {@link buildTestState}. */
export interface BuildTestStateOpts {
  activePlayer: PlayerId;
  players: [PlayerSetup, PlayerSetup];
  /** Which phase the state starts in. */
  phase: Phase;
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

  function mintFor(defId: CardDefinitionId): CardInstance {
    const id = mint();
    return { instanceId: id, definitionId: defId };
  }

  const playerStates = opts.players.map((setup) => {
    const hand = setup.hand.map(defId => mintFor(defId));
    const siteDeck = setup.siteDeck.map(defId => mintFor(defId));

    const characters: Record<string, CharacterInPlay> = {};
    const companies: Company[] = [];

    for (const companySetup of setup.companies) {
      const siteInst = mintFor(companySetup.site);
      const charInstIds: CardInstanceId[] = [];

      const normalizedChars = companySetup.characters.map(
        c => typeof c === 'string' ? { defId: c } : c,
      );

      for (const charSetup of normalizedChars) {
        const charInst = mintFor(charSetup.defId);
        charInstIds.push(charInst.instanceId);

        const items = (charSetup.items ?? []).map(itemDefId => {
          const itemInst = mintFor(itemDefId);
          return { instanceId: itemInst.instanceId, definitionId: itemDefId, status: CardStatus.Untapped };
        });

        characters[charInst.instanceId as string] = {
          instanceId: charInst.instanceId,
          definitionId: charSetup.defId,
          status: charSetup.status ?? CardStatus.Untapped,
          items,
          allies: [],
          hazards: [],
          followers: [],
          controlledBy: 'general' as const,
          effectiveStats: ZERO_EFFECTIVE_STATS,
        };
      }

      // Wire up followers after all characters in company are created
      for (let i = 0; i < normalizedChars.length; i++) {
        const charSetup = normalizedChars[i];
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
        currentSite: { instanceId: siteInst.instanceId, definitionId: companySetup.site, status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
        hazards: [],
      });
    }

    const playDeck = (setup.playDeck ?? []).map(defId => mintFor(defId));
    const discardPile = (setup.discardPile ?? []).map(defId => mintFor(defId));
    const sideboard = (setup.sideboard ?? []).map(defId => mintFor(defId));

    return {
      id: setup.id,
      name: setup.id === PLAYER_1 ? 'Alice' : 'Bob',
      alignment: setup.alignment ?? Alignment.Wizard,
      wizard: null,
      hand,
      playDeck,
      discardPile,
      siteDeck,
      siteDiscardPile: [] as CardInstance[],
      sideboard,
      killPile: [] as CardInstance[],
      outOfPlayPile: [] as CardInstance[],
      companies,
      characters,
      cardsInPlay: setup.cardsInPlay ?? ([] as CardInPlay[]),
      marshallingPoints: { ...ZERO_MARSHALLING_POINTS, ...(setup.marshallingPoints ?? {}) },
      generalInfluenceUsed: 0,
      deckExhaustionCount: setup.deckExhaustionCount ?? 0,
      freeCouncilCalled: false,
      lastDiceRoll: null,
      sideboardAccessedDuringUntap: false,
      deckExhaustPending: false,
      deckExhaustExchangeCount: 0,
    };
  });

  const phase = opts.phase;
  let phaseState: GameState['phaseState'];
  if (phase === Phase.Organization) {
    phaseState = { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null } as GameState['phaseState'];
  } else if (phase === Phase.Untap) {
    phaseState = { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false } as GameState['phaseState'];
  } else if (phase === Phase.LongEvent) {
    phaseState = { phase: Phase.LongEvent } as GameState['phaseState'];
  } else if (phase === Phase.EndOfTurn) {
    phaseState = { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] } as GameState['phaseState'];
  } else {
    phaseState = { phase } as GameState['phaseState'];
  }

  // Optionally recompute GI and effective stats from card definitions.
  // Uses the production `recomputeDerived` so item corruption points,
  // DSL stat modifiers, and global effects all flow through exactly the
  // same code the real reducer runs — avoids drift between tests and
  // production.
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
    }
  }

  const baseState = {
    gameId: 'test-game',
    players: playerStates as unknown as readonly [PlayerState, PlayerState],
    activePlayer: opts.activePlayer,
    phaseState,
    combat: null,
    chain: null,
    cardPool: pool,
    turnNumber: 1,
    startingPlayer: null,
    pendingEffects: [],
    pendingResolutions: [],
    activeConstraints: [],
    rng: { seed: opts.seed ?? 42, counter: 0 },
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
  } as unknown as GameState;

  if (opts.recompute) {
    return recomputeDerived(baseState);
  }
  return baseState;
}

// ─── End-of-turn phase setup ───────────────────────────────────────────────

/**
 * Build a minimal End-of-Turn phase state with P1 active, Aragorn+Bilbo at
 * Rivendell, and Legolas at Lorien. Hands and decks are configurable.
 */
export function eotState(opts?: {
  p1Hand?: CardDefinitionId[];
  p2Hand?: CardDefinitionId[];
  p1Deck?: CardDefinitionId[];
  p2Deck?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.EndOfTurn,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MORIA],
        playDeck: opts?.p1Deck ?? [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts?.p2Hand ?? [],
        siteDeck: [MINAS_TIRITH],
        playDeck: opts?.p2Deck ?? [],
      },
    ],
  });
}

// ─── Shared test helpers ─────────────────────────────────────────────────────

/** Find the instance ID of a character in play by definition ID. */
export function findCharInstanceId(state: GameState, playerIdx: number, defId: CardDefinitionId): CardInstanceId {
  for (const [key, char] of Object.entries(state.players[playerIdx].characters)) {
    if (char.definitionId === defId) return key as CardInstanceId;
  }
  throw new Error(`Character ${defId} not found for player ${playerIdx}`);
}

/** Get all viable actions of a specific type for a player. */
export function viableActions(state: GameState, playerId: PlayerId, actionType: string) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === actionType);
}

/**
 * Return the first viable `influence-attempt` action that targets the given
 * faction instance from the player's hand (first-play influence, not
 * re-influence). Useful in faction-card tests that assert on the computed
 * `need` value for a specific character/faction pairing.
 */
export function firstFactionInfluenceAttempt(
  state: GameState,
  factionInstanceId: CardInstanceId,
  playerId: PlayerId = PLAYER_1,
): InfluenceAttemptAction | undefined {
  return viableActions(state, playerId, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionInstanceId);
}

/**
 * Return the first viable `opponent-influence-attempt` action that targets
 * the given opponent-controlled instance (character, ally, or faction). The
 * `revealOnly` option filters to the reveal-identical variant.
 */
export function firstOpponentInfluenceAttempt(
  state: GameState,
  targetInstanceId: CardInstanceId,
  playerId: PlayerId = PLAYER_1,
  opts?: { revealOnly?: boolean },
): OpponentInfluenceAttemptAction | undefined {
  return viableActions(state, playerId, 'opponent-influence-attempt')
    .map(a => a.action as OpponentInfluenceAttemptAction)
    .find(a => a.targetInstanceId === targetInstanceId && (opts?.revealOnly ? !!a.revealedCardInstanceId : !a.revealedCardInstanceId));
}

/** All viable actions (of any type) for a player. */
export function viableFor(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId).filter(ea => ea.viable);
}

/**
 * Filter a pre-computed `EvaluatedAction[]` array to viable entries of
 * the given action type. Use when a test inspects both viable and
 * non-viable entries from the same `computeLegalActions` call.
 */
export function viableOfType(
  actions: readonly EvaluatedAction[],
  actionType: string,
): EvaluatedAction[] {
  return actions.filter(ea => ea.viable && ea.action.type === actionType);
}

/**
 * Filter a pre-computed `EvaluatedAction[]` array to non-viable entries
 * of the given action type.
 */
export function nonViableOfType(
  actions: readonly EvaluatedAction[],
  actionType: string,
): EvaluatedAction[] {
  return actions.filter(ea => !ea.viable && ea.action.type === actionType);
}

/** The action-type names of every viable action for a player. */
export function viableActionTypes(state: GameState, playerId: PlayerId): string[] {
  return viableFor(state, playerId).map(ea => ea.action.type);
}

/**
 * Narrow `state.phaseState` to a specific phase-state shape without the
 * noisy inline cast. Callers pick the right type via the generic argument.
 */
export function phaseStateAs<T extends GameState['phaseState']>(state: GameState): T {
  return state.phaseState as T;
}

/**
 * Narrow an {@link GameAction} to a specific shape. Used to reach into
 * payload-specific fields (e.g. `cardInstanceId`) without repeating the
 * cast at every call site.
 */
export function actionAs<T extends GameAction>(action: GameAction): T {
  return action as T;
}

/** Get all viable play-character actions for a player. */
export function viablePlayCharacterActions(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'play-character')
    .map(ea => ea.action as PlayCharacterAction);
}

/** Get all non-viable play-character actions for a player. */
export function nonViablePlayCharacterActions(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId)
    .filter(ea => !ea.viable && ea.action.type === 'play-character')
    .map(ea => ea.action as PlayCharacterAction);
}

/** Build a state in site phase at play-resources step with a company at a site. */
export function buildSitePhaseState(opts: {
  characters?: CharacterEntry[];
  site: CardDefinitionId;
  hand?: CardDefinitionId[];
  siteStatus?: CardStatus;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.site, characters: opts.characters ?? [ARAGORN] }], hand: opts.hand ?? [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
    phase: Phase.Site,
  });

  const company = state.players[0].companies[0];
  if (opts.siteStatus) {
    (company.currentSite as { status: CardStatus }).status = opts.siteStatus;
  }

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...state, phaseState: sitePhaseState };
}

/** The company ID for PLAYER_1's first company (target of hazards). */
export const P1_COMPANY = `company-${PLAYER_1 as string}-0` as CompanyId;

/** Build a MovementHazardPhaseState in the play-hazards step. */
export function makeMHState(overrides?: Partial<MovementHazardPhaseState>): MovementHazardPhaseState {
  return {
    phase: Phase.MovementHazard,
    step: 'play-hazards',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    movementType: null,
    declaredRegionPath: [],
    maxRegionDistance: 4,
    hazardsPlayedThisCompany: 0,
    hazardLimitAtReveal: 4,
    preRevealHazardLimitConstraintIds: [],
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: null,
    destinationSiteName: null,
    resourceDrawMax: 0,
    hazardDrawMax: 0,
    resourceDrawCount: 0,
    hazardDrawCount: 0,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
    onGuardPlacedThisCompany: false,
    siteRevealed: false,
    returnedToOrigin: false,
    hazardsEncountered: [],
    ahuntAttacksResolved: 0,
    ...overrides,
  };
}

/**
 * Build a {@link CombatState} in the body-check phase for a single
 * wounded character, set up against a generic automatic-attack source.
 *
 * Defaults: strikesTotal 1, strikeProwess 10, creatureRace 'orc',
 * detainment false, bodyCheckTarget 'character', attackingPlayerId
 * PLAYER_2, defendingPlayerId PLAYER_1. Override as needed.
 */
export function makeBodyCheckCombat(opts: {
  companyId: CompanyId;
  characterId: CardInstanceId;
  wasAlreadyWounded?: boolean;
  attackingPlayerId?: PlayerId;
  defendingPlayerId?: PlayerId;
  strikesTotal?: number;
  strikeProwess?: number;
  creatureBody?: number | null;
  creatureRace?: CombatState['creatureRace'];
  bodyCheckTarget?: CombatState['bodyCheckTarget'];
  detainment?: boolean;
  attackSource?: CombatState['attackSource'];
}): CombatState {
  return {
    attackSource: opts.attackSource ?? {
      type: 'automatic-attack',
      siteInstanceId: 'fake-site' as CardInstanceId,
      attackIndex: 0,
    },
    companyId: opts.companyId,
    defendingPlayerId: opts.defendingPlayerId ?? PLAYER_1,
    attackingPlayerId: opts.attackingPlayerId ?? PLAYER_2,
    strikesTotal: opts.strikesTotal ?? 1,
    strikeProwess: opts.strikeProwess ?? 10,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: opts.creatureRace ?? 'orc',
    strikeAssignments: [
      {
        characterId: opts.characterId,
        excessStrikes: 0,
        resolved: true,
        result: 'wounded',
        wasAlreadyWounded: opts.wasAlreadyWounded ?? false,
      },
    ],
    currentStrikeIndex: 0,
    phase: 'body-check',
    assignmentPhase: 'done',
    bodyCheckTarget: opts.bodyCheckTarget ?? 'character',
    detainment: opts.detainment ?? false,
  };
}

/**
 * MH state describing arrival at a Shadow-Hold "Moria" via an Imlad Morgul
 * shadow region. Mirrors the setup used by many combat rule tests.
 */
export function makeShadowMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Imlad Morgul'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/**
 * MH state describing arrival at Ruins-and-Lairs "Moria" via a Rhudaur
 * wilderness region.
 */
export function makeWildernessMHState(
  overrides?: Partial<MovementHazardPhaseState>,
): MovementHazardPhaseState {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Rhudaur'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
    ...overrides,
  });
}

/** Build a SitePhaseState at the play-resources step. */
export function makeSitePhase(overrides?: Partial<SitePhaseState>): SitePhaseState {
  return {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
    ...overrides,
  };
}

/** Attach a hazard card to a character and return the updated GameState. */
export function attachHazardToChar(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  hazardDefId: CardDefinitionId,
): GameState {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  const hazardCard: CardInstance = { instanceId: mint(), definitionId: hazardDefId };
  const char = state.players[playerIdx].characters[charId as string];
  const updatedChar = { ...char, hazards: [...char.hazards, hazardCard] };
  const updatedCharacters = { ...state.players[playerIdx].characters, [charId as string]: updatedChar };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedCharacters };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/** Attach an ally card to a character and return the updated GameState. */
export function attachAllyToChar(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  allyDefId: CardDefinitionId,
): GameState {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  const allyInPlay = { instanceId: mint(), definitionId: allyDefId, status: CardStatus.Untapped };
  const char = state.players[playerIdx].characters[charId as string];
  const updatedChar = { ...char, allies: [...char.allies, allyInPlay] };
  const updatedCharacters = { ...state.players[playerIdx].characters, [charId as string]: updatedChar };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedCharacters };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Build a minimal two-player Organization-phase state with stock
 * companies — Aragorn+Bilbo at Rivendell vs Legolas at Lorien — and
 * empty hands/decks. Tests that don't care about the company shape but
 * need *some* valid state to layer assertions on top of should use this.
 */
export function buildSimpleTwoPlayerState(activePlayer: PlayerId = PLAYER_1): GameState {
  return buildTestState({
    activePlayer,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** Push a card instance onto a player's killPile. */
export function addToKillPile(state: GameState, playerIdx: 0 | 1, card: CardInstance): GameState {
  const updated = { ...state.players[playerIdx], killPile: [...state.players[playerIdx].killPile, card] };
  const players = playerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

/** Push a card instance onto a player's outOfPlayPile (the eliminated pile). */
export function addToOutOfPlayPile(state: GameState, playerIdx: 0 | 1, card: CardInstance): GameState {
  const updated = { ...state.players[playerIdx], outOfPlayPile: [...state.players[playerIdx].outOfPlayPile, card] };
  const players = playerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

/**
 * Append a CardInPlay entry to a player's `cardsInPlay` (e.g. a
 * permanent event). Mints a fresh `<playerId>-<n>` instance ID so
 * {@link ownerOf} resolves to the owning player. The counter starts
 * high (1000) to avoid colliding with IDs produced during initial state
 * setup.
 */
export function addCardInPlay(state: GameState, ownerIdx: 0 | 1, defId: CardDefinitionId): GameState {
  const ownerId = state.players[ownerIdx].id;
  const counter = 1000 + state.players[ownerIdx].cardsInPlay.length;
  const card: CardInPlay = {
    instanceId: `${ownerId as string}-${counter}` as CardInstanceId,
    definitionId: defId,
    status: CardStatus.Untapped,
  };
  const updated = { ...state.players[ownerIdx], cardsInPlay: [...state.players[ownerIdx].cardsInPlay, card] };
  const players = ownerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

/** Attach an item (or permanent resource event) to a character and return the updated GameState. */
export function attachItemToChar(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  itemDefId: CardDefinitionId,
): GameState {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  const itemInPlay = { instanceId: mint(), definitionId: itemDefId, status: CardStatus.Untapped };
  const char = state.players[playerIdx].characters[charId as string];
  const updatedChar = { ...char, items: [...char.items, itemInPlay] };
  const updatedCharacters = { ...state.players[playerIdx].characters, [charId as string]: updatedChar };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedCharacters };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Enqueue a transfer-style corruption-check pending resolution onto the
 * given state. Used by tests that simulate a just-completed item transfer
 * without going through the full transfer reducer flow.
 *
 * Replaces the legacy pattern of poking
 * `OrganizationPhaseState.pendingCorruptionCheck` directly.
 */
export function enqueueTransferCorruptionCheck(
  state: GameState,
  playerId: PlayerId,
  characterId: CardInstanceId,
  transferredItemId: CardInstanceId,
): GameState {
  return enqueueResolution(state, {
    source: transferredItemId,
    actor: playerId,
    scope: { kind: 'phase', phase: Phase.Organization },
    kind: {
      type: 'corruption-check',
      characterId,
      modifier: 0,
      reason: 'Transfer',
      possessions: [],
      transferredItemId,
    },
  });
}

/**
 * Place an on-guard card on a player's company and return the updated
 * GameState + card. Cards are placed face-down by default; pass
 * `revealed: true` to place a pre-revealed card (e.g. for testing the
 * post-reveal chain in rule 6.16).
 */
export function placeOnGuard(
  state: GameState,
  playerIdx: number,
  companyIdx: number,
  hazardDefId: CardDefinitionId,
  opts?: { revealed?: boolean },
): { state: GameState; ogCard: OnGuardCard } {
  const ogCard: OnGuardCard = {
    instanceId: mint(),
    definitionId: hazardDefId,
    revealed: opts?.revealed ?? false,
  };
  const company = state.players[playerIdx].companies[companyIdx];
  const updatedCompany = { ...company, onGuardCards: [...company.onGuardCards, ogCard] };
  const updatedCompanies = [...state.players[playerIdx].companies];
  updatedCompanies[companyIdx] = updatedCompany;
  const updatedPlayer = { ...state.players[playerIdx], companies: updatedCompanies };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { state: { ...state, players: [p0, p1] as unknown as typeof state.players }, ogCard };
}

/**
 * Resolve an active chain by having both players pass priority until
 * the chain is cleared. Returns the resulting state.
 */
export function resolveChain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 20 && current.chain !== null; i++) {
    const priorityPlayer = current.chain.priority;
    const actions = computeLegalActions(current, priorityPlayer);
    const pass = actions.find(ea => ea.viable && ea.action.type === 'pass-chain-priority');
    if (!pass) break;
    const result = reduce(current, pass.action);
    if (result.error) break;
    current = result.state;
  }
  return current;
}

// ─── Opponent influence helpers ─────────────────────────────────────────────

/**
 * Build a state where both players have companies at the same site (Moria)
 * in the play-resources step, with siteEntered = true.
 * P1 is active (resource player), P2 is the hazard player.
 */
export function buildOpponentInfluenceState(opts?: {
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  turnNumber?: number;
  sitePhaseOverrides?: Partial<SitePhaseState>;
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: opts?.p1Chars ?? [ARAGORN] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MORIA, characters: opts?.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: opts?.turnNumber ?? 3,
    phaseState: makeSitePhase(opts?.sitePhaseOverrides),
  };
}

/** Build a state with both players' companies and configurable sites. */
export function buildTargetState(opts: {
  p1Site: CardDefinitionId;
  p2Site: CardDefinitionId;
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.p1Site, characters: opts.p1Chars ?? [ARAGORN] }],
        hand: opts.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: opts.p2Site, characters: opts.p2Chars ?? [LEGOLAS] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: 3,
    phaseState: makeSitePhase(),
  };
}

/**
 * Build a state at play-resources with both players at Moria.
 * P2 has many characters so their unused GI is low (easier to influence).
 */
export function buildResolutionState(opts?: {
  p1Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p2Chars?: Parameters<typeof buildTestState>[0]['players'][0]['companies'][0]['characters'];
  p1Hand?: Parameters<typeof buildTestState>[0]['players'][0]['hand'];
  attackerCheatRoll?: number;
}) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: opts?.p1Chars ?? [ARAGORN] }],
        hand: opts?.p1Hand ?? [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        // Give P2 many characters to use up GI (20 - sum(minds) = low unused GI)
        // Legolas(6) + Gimli(6) + Bilbo(5) = 17 mind, unused GI = 3
        companies: [{ site: MORIA, characters: opts?.p2Chars ?? [LEGOLAS, GIMLI, BILBO] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
    phase: Phase.Site,
    recompute: true,
  });

  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: opts?.attackerCheatRoll ?? null,
    phaseState: makeSitePhase(),
  };
}

/** Execute the attacker's influence attempt against a specific target. */
export function attemptInfluence(state: GameState, targetDefId?: string) {
  const actions = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
  expect(actions.length).toBeGreaterThan(0);
  const attempt = targetDefId
    ? actions.find(a => {
      const tChar = state.players[1].characters[a.action.targetInstanceId as string];
      return tChar && tChar.definitionId === targetDefId && !a.action.revealedCardInstanceId;
    })
    : actions.find(a => !a.action.revealedCardInstanceId);
  expect(attempt).toBeDefined();
  const result = reduce(state, attempt!.action);
  expect(result.error).toBeUndefined();
  return { state: result.state, action: attempt!.action, effects: result.effects };
}

/** Execute the defender's roll using the legal action (which includes the explanation). */
export function defendInfluence(state: GameState) {
  const actions = viableActions(state, PLAYER_2, 'opponent-influence-defend');
  expect(actions.length).toBe(1);
  const result = reduce(state, actions[0].action);
  expect(result.error).toBeUndefined();
  return result;
}

// ─── Play-and-resolve helpers ────────────────────────────────────────────────

/**
 * Dispatch an action that opens a chain, then drive both players'
 * pass-chain-priority calls via {@link resolveChain} until the chain
 * clears. Shared by the typed `play*AndResolve` helpers below.
 */
function playAndResolve(state: GameState, action: GameAction): GameState {
  return resolveChain(dispatch(state, action));
}

/** Play a hazard card and resolve the chain (both players pass). */
export function playHazardAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
): GameState {
  return playAndResolve(state, { type: 'play-hazard', player, cardInstanceId, targetCompanyId });
}

/**
 * Play a creature hazard with keying info and resolve the chain.
 * Returns the state after chain resolution (combat should be active).
 */
export function playCreatureHazardAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
  keyedBy: CreatureKeyingMatch,
): GameState {
  const result = reduce(state, {
    type: 'play-hazard',
    player,
    cardInstanceId,
    targetCompanyId,
    keyedBy,
  });
  expect(result.error).toBeUndefined();
  return resolveChain(result.state);
}

/**
 * Execute the first viable action of the given type for a player.
 * Optionally sets a cheat dice roll. For `resolve-strike`, picks the
 * tap or no-tap variant based on the `tapToFight` parameter (default false).
 */
export function executeAction(
  state: GameState,
  player: PlayerId,
  actionType: string,
  roll?: number,
  tapToFight = false,
): GameState {
  const s = roll !== undefined ? { ...state, cheatRollTotal: roll } : state;
  const actions = viableActions(s, player, actionType);
  expect(actions.length).toBeGreaterThan(0);
  let action = actions[0].action;
  if (actionType === 'resolve-strike') {
    const preferred = actions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight === tapToFight);
    if (preferred) action = preferred.action;
  }
  const result = reduce(s, action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Run through creature combat: assign a single strike to the specified
 * character, resolve it with the given dice roll, and optionally handle
 * the body check. Returns the state after combat finalizes.
 *
 * @param state - State with active combat (after playing a creature hazard)
 * @param characterDefId - Definition ID of the character to assign the strike to
 * @param strikeRoll - Cheat roll total for strike resolution
 * @param bodyRoll - Cheat roll total for the body check (null to skip)
 * @param tapToFight - Whether to pick the tap-to-fight variant (default false)
 * @param attacker - Player whose character is being struck (default PLAYER_1)
 * @param defender - Opponent player for body checks (default PLAYER_2)
 */
export function runCreatureCombat(
  state: GameState,
  characterDefId: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
  tapToFight = false,
  attacker: PlayerId = PLAYER_1,
  defender: PlayerId = PLAYER_2,
): GameState {
  const charId = findCharInstanceId(state, attacker === PLAYER_1 ? 0 : 1, characterDefId);

  // Assign strike
  const result = reduce(state, { type: 'assign-strike', player: attacker, characterId: charId });
  expect(result.error).toBeUndefined();

  // Resolve strike
  const afterStrike = executeAction(result.state, attacker, 'resolve-strike', strikeRoll, tapToFight);

  // Body check if needed
  if (afterStrike.combat?.phase === 'body-check' && bodyRoll !== null) {
    return executeAction(afterStrike, defender, 'body-check-roll', bodyRoll);
  }

  return afterStrike;
}

/** Play a short event and resolve the chain (both players pass). */
export function playShortEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetInstanceId: CardInstanceId,
): GameState {
  return playAndResolve(state, { type: 'play-short-event', player, cardInstanceId, targetInstanceId });
}

/** Play a permanent event and resolve the chain (both players pass). */
export function playPermanentEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCharacterId?: CardInstanceId,
  opts?: {
    targetSiteDefinitionId?: CardDefinitionId;
    discardCardInstanceId?: CardInstanceId;
  },
): GameState {
  return playAndResolve(state, {
    type: 'play-permanent-event', player, cardInstanceId, targetCharacterId,
    ...opts,
  });
}

/** Play a long event and resolve the chain (both players pass). */
export function playLongEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
): GameState {
  return playAndResolve(state, { type: 'play-long-event', player, cardInstanceId });
}

// ─── Auto-attack state builders ──────────────────────────────────────────────

/**
 * Adds cards to the hazard player's (P2) cardsInPlay.
 *
 * @param state - A state built by `buildSitePhaseState` or similar.
 * @param cards - Card instances to add to P2's cardsInPlay.
 */
export function addP2CardsInPlay<T extends GameState>(
  state: T,
  cards: CardInPlay[],
): T {
  const players = state.players.map((p, i) =>
    i === 1 ? { ...p, cardsInPlay: [...p.cardsInPlay, ...cards] } : p,
  ) as unknown as typeof state.players;
  return { ...state, players };
}

/**
 * Transitions a site phase state to the automatic-attacks step.
 *
 * @param state - A state with a SitePhaseState (e.g. from `buildSitePhaseState`).
 */
export function setupAutoAttackStep<T extends GameState>(state: T): T {
  const base = state.phaseState as SitePhaseState;
  const autoAttackState: SitePhaseState = {
    phase: base.phase,
    step: 'automatic-attacks',
    activeCompanyIndex: base.activeCompanyIndex,
    handledCompanyIds: base.handledCompanyIds,
    siteEntered: false,
    resourcePlayed: base.resourcePlayed,
    minorItemAvailable: base.minorItemAvailable,
    declaredAgentAttack: base.declaredAgentAttack,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: base.awaitingOnGuardReveal,
    pendingResourceAction: base.pendingResourceAction,
    opponentInteractionThisTurn: base.opponentInteractionThisTurn,
    pendingOpponentInfluence: base.pendingOpponentInfluence,
  };
  return { ...state, phaseState: autoAttackState };
}

/**
 * Run through auto-attack combat at a site. Triggers the attack via a pass
 * action, assigns a single strike to the specified character, resolves it
 * with the given dice roll, and optionally handles the body check.
 *
 * @param baseState - State at the automatic-attacks step (use setupAutoAttackStep)
 * @param characterDefId - Definition ID of the character to assign the strike to
 * @param strikeRoll - Cheat roll total for strike resolution
 * @param bodyRoll - Cheat roll total for the body check (null to skip)
 * @param tapToFight - Whether to pick the tap-to-fight variant (default true)
 * @param attacker - Player triggering the attack (default PLAYER_1)
 * @param defender - Opponent player for body checks (default PLAYER_2)
 */
export function runAutoAttackCombat(
  baseState: GameState,
  characterDefId: CardDefinitionId,
  strikeRoll: number,
  bodyRoll: number | null,
  tapToFight = true,
  attacker: PlayerId = PLAYER_1,
  defender: PlayerId = PLAYER_2,
): ReducerResult {
  // Trigger auto-attack
  let result = reduce(baseState, { type: 'pass', player: attacker });
  expect(result.error).toBeUndefined();
  expect(result.state.combat).toBeDefined();

  const charId = findCharInstanceId(result.state, attacker === PLAYER_1 ? 0 : 1, characterDefId);

  // Assign strike
  result = reduce(result.state, { type: 'assign-strike', player: attacker, characterId: charId });
  expect(result.error).toBeUndefined();

  // Get resolve-strike action from legal actions
  const resolveActions = viableActions({ ...result.state, cheatRollTotal: strikeRoll }, attacker, 'resolve-strike');
  expect(resolveActions.length).toBeGreaterThan(0);
  const selectedAction = tapToFight
    ? (resolveActions.find(a => 'tapToFight' in a.action && a.action.tapToFight)?.action ?? resolveActions[0].action)
    : (resolveActions.find(a => 'tapToFight' in a.action && !a.action.tapToFight)?.action ?? resolveActions[0].action);

  result = reduce({ ...result.state, cheatRollTotal: strikeRoll }, selectedAction);
  expect(result.error).toBeUndefined();

  // If body check is needed
  if (result.state.combat?.phase === 'body-check' && bodyRoll !== null) {
    const bodyActions = viableActions(result.state, defender, 'body-check-roll');
    expect(bodyActions.length).toBeGreaterThan(0);
    result = reduce({ ...result.state, cheatRollTotal: bodyRoll }, bodyActions[0].action);
    expect(result.error).toBeUndefined();
  }

  return result;
}

/**
 * Rule 2.IV.6 primitive: auto-join companies at the same non-haven site
 * at the end of all movement/hazard phases. Re-exported here so rules
 * tests for that transition can invoke it without reaching into
 * internal engine modules.
 */
export const autoMergeNonHavenCompanies = _autoMergeNonHavenCompanies;

// ─── Convenience lookups ────────────────────────────────────────────────────

/** Which PlayerState pile to search in {@link findInPile}. */
export type PileKey =
  | 'hand'
  | 'playDeck'
  | 'discardPile'
  | 'siteDeck'
  | 'siteDiscardPile'
  | 'sideboard'
  | 'killPile'
  | 'outOfPlayPile';

/** Get the instance ID of a card in a player's hand by position (default: first card). */
export function handCardId(
  state: GameState,
  playerIdx: number,
  index = 0,
): CardInstanceId {
  const card = state.players[playerIdx].hand[index];
  if (!card) throw new Error(`No card at hand[${index}] for player ${playerIdx}`);
  return card.instanceId;
}

/** Get the ID of a player's company (default: first company). */
export function companyIdAt(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
): CompanyId {
  const company = state.players[playerIdx].companies[companyIdx];
  if (!company) throw new Error(`No company at companies[${companyIdx}] for player ${playerIdx}`);
  return company.id;
}

/** Get the instance ID of a character by its position in a company. */
export function charIdAt(
  state: GameState,
  playerIdx: number,
  companyIdx = 0,
  charIdx = 0,
): CardInstanceId {
  const company = state.players[playerIdx].companies[companyIdx];
  if (!company) throw new Error(`No company at companies[${companyIdx}] for player ${playerIdx}`);
  const id = company.characters[charIdx];
  if (!id) throw new Error(`No character at companies[${companyIdx}].characters[${charIdx}] for player ${playerIdx}`);
  return id;
}

/** Get the {@link CharacterInPlay} object for a character by definition ID. */
export function getCharacter(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): CharacterInPlay {
  const id = findCharInstanceId(state, playerIdx, defId);
  return state.players[playerIdx].characters[id as string];
}

/**
 * Find the first card instance in a player's pile matching the given
 * definition or instance ID. Returns undefined if not found.
 */
export function findInPile(
  state: GameState,
  playerIdx: number,
  pile: PileKey,
  idOrDefId: CardDefinitionId | CardInstanceId,
): CardInstance | undefined {
  const list = state.players[playerIdx][pile];
  return list.find(c => c.definitionId === idOrDefId || c.instanceId === idOrDefId);
}

// ─── Convenience action helpers ─────────────────────────────────────────────

/**
 * Apply an action and assert it produced no error. Returns the new state.
 *
 * Replaces the common two-line pattern:
 * ```
 * const result = reduce(state, action);
 * expect(result.error).toBeUndefined();
 * state = result.state;
 * ```
 */
export function dispatch(state: GameState, action: GameAction): GameState {
  const result = reduce(state, action);
  expect(result.error).toBeUndefined();
  return result.state;
}

/**
 * Apply an action and assert it produced no error. Returns the full
 * {@link ReducerResult} so tests can inspect emitted effects. Use
 * {@link dispatch} when only the next state is needed.
 */
export function dispatchResult(state: GameState, action: GameAction): ReducerResult {
  const result = reduce(state, action);
  expect(result.error).toBeUndefined();
  return result;
}

/**
 * Find the first viable action of a given type, optionally narrowed by a
 * predicate. Returns undefined if no match is found.
 */
export function findAction<T extends GameAction = GameAction>(
  state: GameState,
  playerId: PlayerId,
  actionType: string,
  predicate?: (action: T) => boolean,
): T | undefined {
  const actions = viableActions(state, playerId, actionType);
  const match = predicate
    ? actions.find(ea => predicate(ea.action as T))
    : actions[0];
  return match ? (match.action as T) : undefined;
}

/**
 * Get the first viable action of a given type, optionally narrowed by a
 * predicate. Asserts that a match exists and returns the typed action.
 */
export function firstAction<T extends GameAction = GameAction>(
  state: GameState,
  playerId: PlayerId,
  actionType: string,
  predicate?: (action: T) => boolean,
): T {
  const match = findAction<T>(state, playerId, actionType, predicate);
  expect(match).toBeDefined();
  return match!;
}

// ─── Convenience assertions ────────────────────────────────────────────────

/** Assert a character (located by definition ID) currently has the expected status. */
export function expectCharStatus(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
  expected: CardStatus,
): void {
  expect(getCharacter(state, playerIdx, defId).status).toBe(expected);
}

/** Assert a character (located by definition ID) has the expected number of items. */
export function expectCharItemCount(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
  expected: number,
): void {
  expect(getCharacter(state, playerIdx, defId).items).toHaveLength(expected);
}

/**
 * Assert a card is in the given pile for the player, matched by either
 * definition or instance ID.
 */
export function expectInPile(
  state: GameState,
  playerIdx: number,
  pile: PileKey,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  const found = findInPile(state, playerIdx, pile, idOrDefId);
  expect(found).toBeDefined();
}

/**
 * Assert a card is in the player's discard pile, matched by either
 * definition or instance ID. Short-hand for the most common
 * {@link expectInPile} call.
 */
export function expectInDiscardPile(
  state: GameState,
  playerIdx: number,
  idOrDefId: CardDefinitionId | CardInstanceId,
): void {
  expectInPile(state, playerIdx, 'discardPile', idOrDefId);
}

// ─── Convenience state mutations ───────────────────────────────────────────

/**
 * Return a new state with a character's status updated. Replaces the
 * multi-line spread boilerplate required to update a deeply nested field.
 */
export function setCharStatus(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
  status: CardStatus,
): GameState {
  const charId = findCharInstanceId(state, playerIdx, defId);
  const char = state.players[playerIdx].characters[charId as string];
  const updatedChars = {
    ...state.players[playerIdx].characters,
    [charId as string]: { ...char, status },
  };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedChars };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

// ─── Convenience accessors ─────────────────────────────────────────────────

/** Base prowess of a character card definition (before any effects/items). */
export function baseProwess(defId: CardDefinitionId): number {
  return (pool[defId as string] as CharacterCard).prowess;
}

/**
 * Viable `activate-granted-action` actions emitted for the given character
 * and action ID. Used to check which granted-action variants (e.g. the
 * standard tap and no-tap variants of `remove-self-on-roll`) are currently
 * on offer.
 */
export function grantedActionsFor(
  state: GameState,
  characterId: CardInstanceId,
  actionId: string,
  playerId: PlayerId,
): ActivateGrantedAction[] {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable)
    .map(ea => ea.action)
    .filter((a): a is ActivateGrantedAction =>
      a.type === 'activate-granted-action'
      && a.characterId === characterId
      && a.actionId === actionId);
}

/** Definition IDs of all permanent-type cards in play for a player. */
export function definitionIdsInPlay(state: GameState, playerIdx: number): string[] {
  return state.players[playerIdx].cardsInPlay.map(c => c.definitionId as string);
}

/** Instance IDs of all permanent-type cards in play for a player. */
export function instanceIdsInPlay(state: GameState, playerIdx: number): CardInstanceId[] {
  return state.players[playerIdx].cardsInPlay.map(c => c.instanceId);
}

/** Hazards attached to a character (located by definition ID). */
export function getHazardsOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).hazards;
}

/** Items attached to a character (located by definition ID). */
export function getItemsOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).items;
}

/** Allies attached to a character (located by definition ID). */
export function getAlliesOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInPlay[] {
  return getCharacter(state, playerIdx, charDefId).allies;
}

/** Follower instance IDs attached to a character (located by definition ID). */
export function getFollowersOn(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
): readonly CardInstanceId[] {
  return getCharacter(state, playerIdx, charDefId).followers;
}

/** Assert a character (by instance ID) is present in the player's characters map. */
export function expectCharInPlay(
  state: GameState,
  playerIdx: number,
  charId: CardInstanceId,
): void {
  expect(state.players[playerIdx].characters[charId as string]).toBeDefined();
}

/** Assert a character (by instance ID) has been removed from the player's characters map. */
export function expectCharNotInPlay(
  state: GameState,
  playerIdx: number,
  charId: CardInstanceId,
): void {
  expect(state.players[playerIdx].characters[charId as string]).toBeUndefined();
}

/** Append a pre-built CardInPlay to a player's cardsInPlay (e.g. a fixture permanent). */
export function pushCardInPlay(
  state: GameState,
  playerIdx: 0 | 1,
  card: CardInPlay,
): GameState {
  const updated = { ...state.players[playerIdx], cardsInPlay: [...state.players[playerIdx].cardsInPlay, card] };
  const players = playerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

// ─── Deck fixture loaders ───────────────────────────────────────────────────

const DECKS_DIR = join(__dirname, '../../../../data/decks');

/** Load every JSON deck under `data/decks`. Used by deck-construction rule tests. */
export function loadAllDecks(): DeckList[] {
  const files = readdirSync(DECKS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(readFileSync(join(DECKS_DIR, f), 'utf-8')) as DeckList);
}

// ─── Effect / constraint fixture builders ───────────────────────────────────

/**
 * Build a single {@link CollectedEffect} wrapping a check-modifier. Used by
 * effect-resolver tests to assemble inputs without leaking resolver internals.
 */
export function makeCheckModifierEffect(
  check: CheckKind | readonly CheckKind[],
  value: number,
): CollectedEffect {
  return {
    effect: { type: 'check-modifier', check, value },
    sourceDef: undefined as never,
    sourceInstance: 'src-1' as never,
  };
}

/** Predicate that matches an `activate-granted-action` with the given actionId. */
export function isGrantedAction(actionId: string) {
  return (action: { type: string; actionId?: string }): boolean =>
    action.type === 'activate-granted-action' && action.actionId === actionId;
}

/**
 * Build the pair of constraints River (tw-84) adds when it resolves: a
 * `site-phase-do-nothing` restriction plus a parallel `granted-action`
 * that lets an untapped ranger tap to cancel. Both share the same source
 * so `remove-constraint` sweeps them together.
 */
export function makeRiverConstraints(
  source: CardInstanceId,
  companyId: CompanyId,
  riverDefId: CardDefinitionId,
): readonly [Omit<ActiveConstraint, 'id'>, Omit<ActiveConstraint, 'id'>] {
  const restriction: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: riverDefId,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: { type: 'site-phase-do-nothing' },
  };
  const grant: Omit<ActiveConstraint, 'id'> = {
    source,
    sourceDefinitionId: riverDefId,
    scope: { kind: 'company-site-phase', companyId },
    target: { kind: 'company', companyId },
    kind: {
      type: 'granted-action',
      action: 'cancel-river',
      cost: { tap: 'character' },
      when: {
        $and: [
          { 'actor.skills': { $includes: 'ranger' } },
          { 'actor.status': 'untapped' },
        ],
      },
      apply: { type: 'remove-constraint', select: 'constraint-source' },
    },
  };
  return [restriction, grant];
}

/** Apply both River constraints to the state via {@link addConstraint}. */
export function addRiverConstraints(
  state: GameState,
  source: CardInstanceId,
  companyId: CompanyId,
  riverDefId: CardDefinitionId,
): GameState {
  const [restriction, grant] = makeRiverConstraints(source, companyId, riverDefId);
  return addConstraint(addConstraint(state, restriction), grant);
}

/**
 * Mint a River card, register both of its constraints on the active
 * company, and stash the card record somewhere `resolveInstanceId` can
 * find it so the constraint filter can read its `actor.skills`. Wraps
 * the three-step setup (mint + addConstraint×2 + pushCardInPlay) used
 * across every River test. Defaults to pushing the River into the
 * resource player's cardsInPlay because the River tests patch it there
 * as an artificial lookup target, not because the card is truly in that
 * player's ownership.
 */
export function installRiverOnActiveCompany(
  state: GameState,
  riverDefId: CardDefinitionId,
  lookupPlayerIdx: 0 | 1 = 0,
): { state: GameState; riverInstance: CardInstanceId } {
  const riverInstance = mint();
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const constrained = addRiverConstraints(state, riverInstance, companyId, riverDefId);
  const card: CardInPlay = {
    instanceId: riverInstance,
    definitionId: riverDefId,
    status: CardStatus.Untapped,
  };
  return { state: pushCardInPlay(constrained, lookupPlayerIdx, card), riverInstance };
}

/**
 * Build a Great Ship (tw-248) granted-action constraint payload. Mirrors
 * what the card's `self-enters-play` apply produces: a turn-scoped
 * `granted-action` that offers `cancel-chain-entry` to any untapped
 * character in the target company when the site path is coastal.
 */
export function makeGreatShipConstraint(
  sourceId: CardInstanceId,
  companyId: CompanyId,
  greatShipDefId: CardDefinitionId,
): Omit<ActiveConstraint, 'id'> {
  return {
    source: sourceId,
    sourceDefinitionId: greatShipDefId,
    scope: { kind: 'turn' },
    target: { kind: 'company', companyId },
    kind: {
      type: 'granted-action',
      action: 'cancel-chain-entry',
      phase: Phase.MovementHazard,
      cost: { tap: 'character' },
      when: {
        $and: [
          { 'chain.hazardCount': { $gt: 0 } },
          { path: { $includes: 'coastal' } },
          { path: { $noConsecutiveOtherThan: 'coastal' } },
        ],
      },
      apply: { type: 'cancel-chain-entry', select: 'most-recent-unresolved-hazard' },
    },
  };
}

/**
 * Return the first (and usually only) constraint on the active company.
 * Spells out a common assertion chain so call sites stay short.
 */
export function singleActiveConstraint(state: GameState): ActiveConstraint {
  expect(state.activeConstraints).toHaveLength(1);
  return state.activeConstraints[0];
}

/** Return every active constraint sourced from the given card instance. */
export function constraintsFromSource(
  state: GameState,
  source: CardInstanceId,
): readonly ActiveConstraint[] {
  return state.activeConstraints.filter(c => c.source === source);
}

// ─── Single-character combat scaffolding ────────────────────────────────────

/**
 * Options for {@link makeSingleCharCombatState}. Describes a combat where a
 * lone hero character (player 0, company 0, character 0) faces a synthetic
 * creature attack with the given prowess/body/race — used by card tests
 * that exercise modifiers keyed to a specific enemy race.
 */
export interface SingleCharCombatOpts {
  heroDefId: CardDefinitionId;
  creatureRace: string;
  creatureProwess: number;
  creatureBody: number | null;
  /** If true, the test skips strike assignment (phase starts at `resolve-strike`). */
  preAssigned?: boolean;
}

/**
 * Build a state with a single hero character in combat against a fabricated
 * creature with the given race/prowess/body. Phase is M/H in Shadow; when
 * `preAssigned` is true the state is ready to resolve a strike, otherwise it
 * awaits assignment. Used by e.g. Éowyn's anti-nazgûl tests.
 */
export function makeSingleCharCombatState(opts: SingleCharCombatOpts): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [opts.heroDefId] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });

  const heroId = findCharInstanceId(state, RESOURCE_PLAYER, opts.heroDefId);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: `fake-${opts.creatureRace}` as never },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.creatureProwess,
    creatureBody: opts.creatureBody,
    creatureRace: opts.creatureRace,
    strikeAssignments: opts.preAssigned
      ? [{ characterId: heroId, excessStrikes: 0, resolved: false }]
      : [],
    currentStrikeIndex: 0,
    phase: opts.preAssigned ? 'resolve-strike' : 'assign-strikes',
    assignmentPhase: opts.preAssigned ? 'done' : 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { ...state, phaseState: makeShadowMHState(), combat };
}

// ─── Detainment-strike scaffolding ──────────────────────────────────────────

/**
 * Options for {@link makeDetainmentStrikeState}.
 */
export interface DetainmentStrikeOpts {
  /** Whether the attack is detainment. */
  detainment: boolean;
  /** Creature's strike prowess. */
  strikeProwess: number;
  /** Creature body — null disables creature body check. */
  creatureBody?: number | null;
  /** Pre-strike status of the defending character (default Untapped). */
  charStatus?: CardStatus;
  /**
   * If set, a Barrow-wight creature card is minted into the hazard
   * player's cardsInPlay and used as the `attackSource`. Needed for
   * rule-8.34 MP/discard routing tests, which assert where the creature
   * card lands after `finalizeCombat`.
   */
  creatureInPlay?: CardDefinitionId;
}

/**
 * Build a single-character M/H-phase state poised to resolve one strike
 * against Aragorn from a fabricated creature. Parameterised by the
 * detainment flag and creature stats so the rule-8.32 suite can exercise
 * every branch of the wound / body-check / tap path.
 *
 * Returns the state plus Aragorn's instance id for direct status
 * assertions after the strike resolves.
 */
export function makeDetainmentStrikeState(opts: DetainmentStrikeOpts): {
  state: GameState;
  characterId: CardInstanceId;
  creatureInstanceId: CardInstanceId;
} {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  const characterId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
  const companyId = companyIdAt(base, RESOURCE_PLAYER);
  const withStatus = opts.charStatus ? setCharStatus(base, RESOURCE_PLAYER, ARAGORN, opts.charStatus) : base;

  let creatureInstanceId: CardInstanceId = 'fake-creature' as CardInstanceId;
  let stateWithCreature: GameState = withStatus;
  if (opts.creatureInPlay) {
    creatureInstanceId = mint();
    const hazardIdx = stateWithCreature.players.findIndex(p => p.id === PLAYER_2);
    const players: [PlayerState, PlayerState] = [
      stateWithCreature.players[0],
      stateWithCreature.players[1],
    ];
    players[hazardIdx] = {
      ...players[hazardIdx],
      cardsInPlay: [
        ...players[hazardIdx].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: opts.creatureInPlay, status: CardStatus.Untapped },
      ],
    };
    stateWithCreature = { ...stateWithCreature, players };
  }

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: 'orc',
    strikeAssignments: [{ characterId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: opts.detainment,
  };

  return {
    state: { ...stateWithCreature, phaseState: makeShadowMHState(), combat },
    characterId,
    creatureInstanceId,
  };
}

// ─── Opponent-influence scaffolding ─────────────────────────────────────────

/**
 * Build a site-phase state where PLAYER_1 is attempting opponent influence
 * against PLAYER_2's characters. PLAYER_2 has a wizard (Gandalf) and one
 * card in hand, ready to be used as a cancel-influence response. Used by
 * Wizard's Laughter (tw-362) and other spell-cancel tests.
 */
export function buildWizardCancelInfluenceState(handCard: CardDefinitionId): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: MORIA, characters: [GANDALF, LEGOLAS] }], hand: [handCard], siteDeck: [LORIEN] },
    ],
    phase: Phase.Site,
    recompute: true,
  });
  return {
    ...state,
    turnNumber: 3,
    cheatRollTotal: 12,
    phaseState: makeSitePhase(),
  };
}

// ─── Long-event / ahunt scaffolding ─────────────────────────────────────────

/**
 * Build an order-effects M/H state for a company moving through the given
 * region path, with an ahunt long-event card (plus any extras) in the
 * hazard player's cardsInPlay. Used by ahunt card tests to drive the
 * order-effects trigger without running through movement manually.
 */
export function buildAhuntOrderEffectsState(opts: {
  ahuntDefId: CardDefinitionId;
  pathNames: readonly string[];
  pathTypes: readonly RegionType[];
  extraCardsInPlay?: readonly CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: EDHELLOND, characters: [ARAGORN, GANDALF] }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

  const newCards: CardInPlay[] = [
    { instanceId: mint(), definitionId: opts.ahuntDefId, status: CardStatus.Untapped },
    ...(opts.extraCardsInPlay ?? []).map(defId => ({
      instanceId: mint(),
      definitionId: defId,
      status: CardStatus.Untapped,
    })),
  ];

  const withCards = addP2CardsInPlay(base, newCards);

  return {
    ...withCards,
    phaseState: makeMHState({
      step: 'order-effects' as const,
      resolvedSitePathNames: opts.pathNames as string[],
      resolvedSitePath: opts.pathTypes as RegionType[],
    }),
  };
}

// ─── On-guard scaffolding ───────────────────────────────────────────────────

/**
 * Build a site-phase state with PLAYER_1 at the given site and PLAYER_2 at
 * Lorien. Shared scaffolding for rule 6.02 (reveal-on-guard-attacks) and
 * similar on-guard tests where only the site and characters vary.
 */
export function buildSitePhaseTwoPlayer(opts: {
  site: CardDefinitionId;
  heroChars?: readonly CardDefinitionId[];
  heroHand?: readonly CardDefinitionId[];
  heroSiteDeck?: readonly CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site, characters: [...(opts.heroChars ?? [ARAGORN])] }],
        hand: [...(opts.heroHand ?? [])],
        siteDeck: [...(opts.heroSiteDeck ?? [])],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/**
 * Build a site-phase scenario where PLAYER_1's company has an on-guard
 * card attached. Returns the pre-configured state at the `play-resources`
 * step plus the OG card record so tests can target it by instance ID.
 */
export function buildOnGuardSiteScenario(opts: {
  site: CardDefinitionId;
  heroChars?: readonly CardDefinitionId[];
  heroHand?: readonly CardDefinitionId[];
  onGuard: CardDefinitionId;
}): { testState: GameState; ogCard: OnGuardCard } {
  const base = buildSitePhaseTwoPlayer({
    site: opts.site,
    heroChars: opts.heroChars,
    heroHand: opts.heroHand,
  });
  const { state, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, opts.onGuard);
  return { testState: { ...state, phaseState: makeSitePhase() }, ogCard };
}

// ─── Card-specific scenario builders ────────────────────────────────────────

/**
 * Build a play-hazards M/H state for An Unexpected Outpost (dm-45): the
 * hazard player's hand always contains AN_UNEXPECTED_OUTPOST, with optional
 * sideboard, discard, extra in-play cards, and additional hand cards.
 * PLAYER_1's company sits at Rivendell heading to Moria.
 */
export function buildAnUnexpectedOutpostMH(opts?: {
  sideboard?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  p2CardsInPlay?: CardInPlay[];
  hand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [AN_UNEXPECTED_OUTPOST, ...(opts?.hand ?? [])],
        siteDeck: [MINAS_TIRITH],
        sideboard: opts?.sideboard ?? [],
        discardPile: opts?.discardPile ?? [],
        cardsInPlay: opts?.p2CardsInPlay ?? [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/**
 * Set up an M/H combat vs. Cave-drake at Moria via wilderness. PLAYER_1 has
 * the given pair of heroes in their company and can hold an optional hand.
 * Returns the state immediately after the creature is revealed on the chain,
 * ready for strike assignment. Used by tw-209 (Dodge) etc.
 */
export function setupCombatWithCaveDrake(opts: {
  heroChars: readonly CardDefinitionId[];
  heroHand?: readonly CardDefinitionId[];
  creatureDefId: CardDefinitionId;
  hazardCharacter?: CardDefinitionId;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [...opts.heroChars] }],
        hand: [...(opts.heroHand ?? [])],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [opts.hazardCharacter ?? GIMLI] }],
        hand: [opts.creatureDefId],
        siteDeck: [RIVENDELL],
      },
    ],
  });

  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Wilderness],
    resolvedSitePathNames: ['Hollin'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...state, phaseState: mhState };

  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const wildernessKeying = { method: 'region-type' as const, value: 'wilderness' };
  const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, wildernessKeying);
  expect(s0.combat).not.toBeNull();
  return s0;
}

/**
 * Resolve a Cave-drake's two strikes against the named defender: the
 * defender passes the cancel window, then the attacker assigns both
 * strikes. Returns the state ready for strike resolution.
 */
export function assignBothStrikesTo(
  state: GameState,
  targetDefId: CardDefinitionId,
): GameState {
  const targetId = findCharInstanceId(state, RESOURCE_PLAYER, targetDefId);
  let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId, excess: true });
  expect(s.combat!.phase).toBe('resolve-strike');
  return s;
}

/**
 * Build an M/H order-effects state where PLAYER_1's company (with the given
 * hero characters) is moving from Rivendell to a fresh copy of the given
 * destination site. Dispatching `pass` triggers the transition into
 * draw-cards, surfacing draw-count modifiers. Used by wizard draw-modifier
 * tests (Alatar, etc.).
 */
export function buildMHOrderEffectsDrawState(opts: {
  heroChars: readonly CardDefinitionId[];
  destinationSite: CardDefinitionId;
  heroSiteDeck?: readonly CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [...opts.heroChars] }],
        hand: [],
        siteDeck: [...(opts.heroSiteDeck ?? [MORIA])],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
        playDeck: makePlayDeck(),
      },
    ],
  });

  const destInstId = mint();
  const company = {
    ...state.players[0].companies[0],
    destinationSite: { instanceId: destInstId, definitionId: opts.destinationSite, status: CardStatus.Untapped },
  };
  const players: readonly [PlayerState, PlayerState] = [
    { ...state.players[0], companies: [company] },
    state.players[1],
  ];

  const mhState = makeMHState({ step: 'order-effects' as MovementHazardPhaseState['step'] });
  return { ...state, players, phaseState: mhState } as GameState;
}

// Re-export commonly used things
export {
  createGame, reduce,
  Phase, Alignment,
  ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BARD_BOWMAN, ANBORN, SAM_GAMGEE, FATTY_BOLGER, PEATH,
  THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI,
  SARUMAN, IORETH,
  GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING, HAUBERK_OF_BRIGHT_MAIL,
  CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, SAPLING_OF_THE_WHITE_TREE,
  GWAIHIR, TREEBEARD,
  ASSASSIN, CAVE_DRAKE, ORC_GUARD, ORC_WARBAND, ORC_LIEUTENANT, ORC_PATROL, ORC_WATCH, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, HOBGOBLINS, FOOLISH_WORDS, LURE_OF_THE_SENSES, ALONE_AND_UNADVISED, LOST_IN_FREE_DOMAINS, STEALTH, RIVER,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS, CONCEALMENT, DODGE, DARK_QUARRELS, HALFLING_STRENGTH, MARVELS_TOLD, LITTLE_SNUFFLER, AND_FORTH_HE_HASTENED, WIZARDS_LAUGHTER, VANISHMENT,
  AN_UNEXPECTED_OUTPOST, TWO_OR_THREE_TRIBES_PRESENT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR, DUNNISH_CLAN_HOLD, HENNETH_ANNUN, LOND_GALEN, TOLFALAS, EDHELLOND, WELLINGHALL,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_ANORIEN, MEN_OF_ANFALAS, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RANGERS_OF_ITHILIEN, RIDERS_OF_ROHAN, DUNLENDINGS,
  CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS,
};
export type { GameConfig, QuickStartGameConfig, ReducerResult, CardInPlay, CardInstance, CardInstanceId, CardDefinitionId, CompanyId, OpponentInfluenceAttemptAction, SitePhaseState, LongEventPhaseState, CreatureKeyingMatch, EvaluatedAction };

