/**
 * @module test-helpers
 *
 * Shared test utilities for creating game configs and running through
 * setup steps. Reduces boilerplate across test files.
 */

import { expect } from 'vitest';
import { createGame } from '../engine/init.js';
import type { GameConfig, QuickStartGameConfig } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import type { ReducerResult } from '../engine/reducer.js';
import {
  loadCardPool,
  Phase,
  Alignment,
  computeLegalActions,
} from '../index.js';
import type { PlayerId, GameState, CardDefinitionId, CardInstanceId, CardInstance, GameAction, PlayCharacterAction, SitePhaseState, MovementHazardPhaseState, OpponentInfluenceAttemptAction, LongEventPhaseState, CreatureKeyingMatch } from '../index.js';
import {
  ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING,
  CRAM,
  GWAIHIR,
  CAVE_DRAKE, ORC_LIEUTENANT, ORC_PATROL, BARROW_WIGHT, FOOLISH_WORDS,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RIDERS_OF_ROHAN,
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
    ORC_LIEUTENANT, ORC_LIEUTENANT, ORC_LIEUTENANT,
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
  PlayerState, EffectiveStats, OnGuardCard,
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
      alignment: Alignment.Wizard,
      wizard: null,
      hand,
      playDeck,
      discardPile,
      siteDeck,
      siteDiscardPile: [] as CardInstance[],
      sideboard,
      killPile: [] as CardInstance[],
      eliminatedPile: [] as CardInstance[],
      companies,
      characters,
      cardsInPlay: setup.cardsInPlay ?? ([] as CardInPlay[]),
      marshallingPoints: ZERO_MARSHALLING_POINTS,
      generalInfluenceUsed: 0,
      deckExhaustionCount: 0,
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
    phaseState = { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null, pendingCorruptionCheck: null } as GameState['phaseState'];
  } else if (phase === Phase.Untap) {
    phaseState = { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false } as GameState['phaseState'];
  } else if (phase === Phase.LongEvent) {
    phaseState = { phase: Phase.LongEvent } as GameState['phaseState'];
  } else if (phase === Phase.EndOfTurn) {
    phaseState = { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] } as GameState['phaseState'];
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
    cardPool: pool,
    turnNumber: 1,
    startingPlayer: null,
    pendingEffects: [],
    rng: { seed: opts.seed ?? 42, counter: 0 },
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
  } as unknown as GameState;
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

/** Get all viable play-character actions for a player. */
export function viablePlayCharacterActions(state: GameState, playerId: PlayerId) {
  return computeLegalActions(state, playerId)
    .filter(ea => ea.viable && ea.action.type === 'play-character')
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
    pendingWoundCorruptionChecks: [],
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
    pendingEffectsToOrder: [],
    hazardsPlayedThisCompany: 0,
    hazardLimit: 4,
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
    pendingWoundCorruptionChecks: [],
    ...overrides,
  };
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
    pendingWoundCorruptionChecks: [],
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

/** Place an on-guard card on a player's company and return the updated GameState + card. */
export function placeOnGuard(
  state: GameState,
  playerIdx: number,
  companyIdx: number,
  hazardDefId: CardDefinitionId,
): { state: GameState; ogCard: OnGuardCard } {
  const ogCard: OnGuardCard = { instanceId: mint(), definitionId: hazardDefId, revealed: false };
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

/** Execute the defender's roll. */
export function defendInfluence(state: GameState) {
  const result = reduce(state, { type: 'opponent-influence-defend', player: PLAYER_2 });
  expect(result.error).toBeUndefined();
  return result;
}

// ─── Play-and-resolve helpers ────────────────────────────────────────────────

/** Play a hazard card and resolve the chain (both players pass). */
export function playHazardAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
  targetCompanyId: CompanyId,
): GameState {
  let result = reduce(state, { type: 'play-hazard', player, cardInstanceId, targetCompanyId });
  expect(result.error).toBeUndefined();
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
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
  let result = reduce(state, { type: 'play-short-event', player, cardInstanceId, targetInstanceId });
  expect(result.error).toBeUndefined();
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
}

/** Play a permanent event and resolve the chain (both players pass). */
export function playPermanentEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
): GameState {
  let result = reduce(state, { type: 'play-permanent-event', player, cardInstanceId });
  expect(result.error).toBeUndefined();
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
}

/** Play a long event and resolve the chain (both players pass). */
export function playLongEventAndResolve(
  state: GameState,
  player: PlayerId,
  cardInstanceId: CardInstanceId,
): GameState {
  let result = reduce(state, { type: 'play-long-event', player, cardInstanceId });
  expect(result.error).toBeUndefined();
  const opponent = player === PLAYER_1 ? PLAYER_2 : PLAYER_1;
  result = reduce(result.state, { type: 'pass-chain-priority', player: opponent });
  expect(result.error).toBeUndefined();
  result = reduce(result.state, { type: 'pass-chain-priority', player });
  expect(result.error).toBeUndefined();
  return result.state;
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
    pendingWoundCorruptionChecks: [],
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

// Re-export commonly used things
export {
  createGame, reduce,
  Phase, Alignment,
  ADRAZAR, ARAGORN, BILBO, FRODO, LEGOLAS, GIMLI, FARAMIR,
  EOWYN, BEREGOND, BERGIL, BARD_BOWMAN, ANBORN, SAM_GAMGEE,
  THEODEN, ELROND, CELEBORN, GALADRIEL, GLORFINDEL_II, HALDIR, GANDALF, BALIN, KILI,
  GLAMDRING, STING, THE_MITHRIL_COAT, THE_ONE_RING, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, PRECIOUS_GOLD_RING,
  CRAM,
  GWAIHIR,
  CAVE_DRAKE, ORC_LIEUTENANT, ORC_PATROL, BARROW_WIGHT, FOOLISH_WORDS,
  SUN, EYE_OF_SAURON, GATES_OF_MORNING, TWILIGHT, DOORS_OF_NIGHT, SMOKE_RINGS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, THRANDUILS_HALLS, BLUE_MOUNTAIN_DWARF_HOLD, DOL_AMROTH, BREE, PELARGIR, EDORAS, EAGLES_EYRIE, BANDIT_LAIR,
  WOOD_ELVES, BLUE_MOUNTAIN_DWARVES, KNIGHTS_OF_DOL_AMROTH, MEN_OF_LEBENNIN, RANGERS_OF_THE_NORTH, RIDERS_OF_ROHAN,
  CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS,
};
export type { GameConfig, QuickStartGameConfig, ReducerResult, CardInPlay, CardInstance, CardInstanceId, CardDefinitionId, CompanyId, OpponentInfluenceAttemptAction, SitePhaseState, LongEventPhaseState, CreatureKeyingMatch };

