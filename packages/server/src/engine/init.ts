/**
 * @module init
 *
 * Game initialisation and character draft setup. This module is responsible
 * for turning player configurations into a fully-formed {@link GameState}
 * ready for play.
 *
 * Two creation paths are provided:
 *
 * 1. **{@link createGame}** — the standard flow. Players start in the
 *    {@link Phase.CharacterDraft} phase where they simultaneously pick
 *    starting characters from their draft pools before play begins.
 *
 * 2. **{@link createGameQuickStart}** — a shortcut that places characters
 *    directly and skips the draft. Primarily used in tests and scripted
 *    scenarios.
 *
 * Both paths share the same instance-minting system to ensure every card
 * in the game receives a globally unique {@link CardInstanceId}.
 */

import type {
  GameState,
  PlayerState,
  Company,
  CharacterInPlay,
  CardInstance,
  DraftPlayerState,
  ItemDraftPlayerState,
  RngState,
  CardDefinition,
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
} from '@meccg/shared';
import {
  Phase,
  SetupStep,
  CardStatus,
  Alignment,
  HAND_SIZE,
  ZERO_MARSHALLING_POINTS,
  ZERO_EFFECTIVE_STATS,
  createRng,
  shuffle,
  isCharacterCard,
  isSiteCard,
} from '@meccg/shared';
import { recomputeDerived } from './recompute-derived.js';

// ---- Config types ----

/**
 * Per-player configuration for a standard game with character draft.
 * Supplied by the client at join time.
 */
export interface PlayerConfig {
  readonly id: PlayerId;
  readonly name: string;
  readonly alignment: Alignment;
  readonly draftPool: readonly CardDefinitionId[];           // up to 10 characters for the draft
  readonly startingMinorItems: readonly CardDefinitionId[];  // up to 2 non-unique minor items
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly startingHavens: readonly CardDefinitionId[];
}

/**
 * Top-level game configuration. Requires exactly two player configs and a
 * seed for the deterministic RNG.
 */
export interface GameConfig {
  readonly players: readonly [PlayerConfig, PlayerConfig];
  /** Seed for the pseudo-random number generator (e.g. `Date.now()`). */
  readonly seed: number;
}

// ---- Instance minting ----

/**
 * Mutable helper that stamps out unique {@link CardInstanceId}s and records
 * the definition→instance mapping. Passed through initialisation functions
 * so that every card in the game — across both players — gets a distinct ID.
 */
interface InstanceMinter {
  instanceMap: Record<string, CardInstance>;
  counter: number;
  prefix: string;
}

/** Creates a fresh minter with the given ID prefix (typically "i"). */
function createMinter(prefix: string): InstanceMinter {
  return { instanceMap: {}, counter: 0, prefix };
}

/**
 * Mints a new {@link CardInstanceId} for a given definition, records the
 * mapping in the minter's instance map, and increments the counter.
 *
 * @returns The newly created instance ID (e.g. "i-0", "i-1", ...).
 */
function mint(minter: InstanceMinter, definitionId: CardDefinitionId): CardInstanceId {
  const instanceId = `${minter.prefix}-${minter.counter}` as CardInstanceId;
  minter.instanceMap[instanceId as string] = { instanceId, definitionId };
  minter.counter++;
  return instanceId;
}

// ---- Game creation: starts in character draft phase ----

/**
 * Creates a new game that begins in the {@link Phase.CharacterDraft} phase.
 *
 * Each player's play deck is minted, shuffled, and stored, but no hand is
 * dealt and no characters are placed yet — those happen when the draft
 * completes via {@link applyDraftResults}. The draft state is initialised
 * from each player's `draftPool` (up to 10 character definition IDs).
 *
 * @param config - Two-player game configuration including RNG seed.
 * @param cardPool - The full card definition dictionary.
 * @returns A brand-new {@link GameState} in the CharacterDraft phase.
 */
export function createGame(
  config: GameConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
): GameState {
  const minter = createMinter('i');
  let rng: RngState = createRng(config.seed);

  const players = config.players.map((pc) => {
    let playerState: PlayerState;
    [playerState, rng] = initPlayerPreDraft(pc, cardPool, minter, rng);
    return playerState;
  }) as unknown as readonly [PlayerState, PlayerState];

  const draftState: [DraftPlayerState, DraftPlayerState] = [
    { pool: [...config.players[0].draftPool], drafted: [], startingMinorItems: [...config.players[0].startingMinorItems], currentPick: null, stopped: false },
    { pool: [...config.players[1].draftPool], drafted: [], startingMinorItems: [...config.players[1].startingMinorItems], currentPick: null, stopped: false },
  ];

  const gameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return {
    gameId,
    players,
    activePlayer: null,
    phaseState: {
      phase: Phase.Setup,
      setupStep: {
        step: SetupStep.CharacterDraft,
        round: 1,
        draftState,
        setAside: [],
      },
    },
    eventsInPlay: [],
    cardPool,
    instanceMap: minter.instanceMap,
    turnNumber: 0,
    pendingEffects: [],
    rng,
    stateSeq: 0,
  };
}

/**
 * Initialises a single player's state before the character draft.
 *
 * The play deck is minted and shuffled but the hand is empty — cards are
 * dealt only after draft completion. The site deck is minted but not
 * shuffled (site order is player-controlled). No companies or characters
 * exist yet.
 *
 * @param config - This player's configuration.
 * @param cardPool - The full card definition dictionary (for validation).
 * @param minter - Shared instance minter across both players.
 * @param rng - Current RNG state (threaded for determinism).
 * @returns A tuple of `[playerState, nextRng]`.
 */
function initPlayerPreDraft(
  config: PlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  // Validate havens
  for (const havenId of config.startingHavens) {
    const havenDef = cardPool[havenId as string];
    if (!isSiteCard(havenDef)) {
      throw new Error(`Starting haven '${havenId}' not found or not a site`);
    }
  }

  // Mint and shuffle play deck (no hand dealt yet — that happens after draft)
  const playDeckDefIds = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstanceId[];
  [shuffledDeck, rng] = shuffle(playDeckDefIds, rng);

  // Mint site deck
  const siteDeckIds = config.siteDeck.map(defId => mint(minter, defId));

  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    wizard: null,
    hand: [],
    playDeck: shuffledDeck,
    discardPile: [],
    siteDeck: siteDeckIds,
    siteDiscardPile: [],
    sideboard: [],
    companies: [],
    characters: {},
    marshallingPoints: ZERO_MARSHALLING_POINTS,
    generalInfluenceUsed: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
  };

  return [playerState, rng];
}

/**
 * Finalises the character draft by placing each player's drafted characters
 * into a single starting company at their haven, equipping starting minor
 * items on the first character, dealing initial hands from the play deck,
 * and advancing the game to {@link Phase.Untap} (turn 1).
 *
 * Called by the reducer once both players have finished drafting.
 *
 * @param state - The game state at the end of the draft phase.
 * @param draftState - The final draft results for both players.
 * @returns A new {@link GameState} ready for the first real turn.
 */
export function applyDraftResults(
  state: GameState,
  draftState: readonly [DraftPlayerState, DraftPlayerState],
): GameState {
  const minter: InstanceMinter = {
    instanceMap: { ...state.instanceMap } as Record<string, CardInstance>,
    counter: Object.keys(state.instanceMap).length,
    prefix: 'i',
  };

  const results = state.players.map((player, index) => {
    const drafted = draftState[index].drafted;
    const startingMinorItems = draftState[index].startingMinorItems;
    // Mint starting minor items
    const minorItemInstanceIds: CardInstanceId[] = [];
    for (const itemDefId of startingMinorItems) {
      minorItemInstanceIds.push(mint(minter, itemDefId));
    }

    // Mint characters and create CharacterInPlay entries
    const characters: Record<string, CharacterInPlay> = {};
    const characterInstanceIds: CardInstanceId[] = [];

    for (const charDefId of drafted) {
      const charDef = state.cardPool[charDefId as string];
      if (!isCharacterCard(charDef)) continue;
      const instanceId = mint(minter, charDefId);
      characterInstanceIds.push(instanceId);
      characters[instanceId as string] = {
        instanceId,
        definitionId: charDefId,
        status: CardStatus.Untapped,
        items: [],
        allies: [],
        corruptionCards: [],
        followers: [],
        controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      };
    }

    // Company created with null site — site is assigned during starting site selection
    const company: Company = {
      id: `company-${player.id}-0` as CompanyId,
      characters: characterInstanceIds,
      currentSite: null,
      destinationSite: null,
      movementPath: [],
      moved: false,
    };

    // GI and MP are left at zero — recomputeDerived() runs after the reducer
    return {
      player: {
        ...player,
        companies: [company],
        characters,
      } satisfies PlayerState,
      unassignedItems: minorItemInstanceIds,
    };
  });

  const newPlayers = [results[0].player, results[1].player] as unknown as readonly [PlayerState, PlayerState];
  const remainingPool: readonly [readonly CardDefinitionId[], readonly CardDefinitionId[]] = [
    draftState[0].pool,
    draftState[1].pool,
  ];
  const itemDraftState: readonly [ItemDraftPlayerState, ItemDraftPlayerState] = [
    { unassignedItems: results[0].unassignedItems, done: results[0].unassignedItems.length === 0 },
    { unassignedItems: results[1].unassignedItems, done: results[1].unassignedItems.length === 0 },
  ];

  // If neither player has items to assign, skip to character deck draft (or Untap)
  if (itemDraftState[0].done && itemDraftState[1].done) {
    return transitionAfterItemDraft({ ...state, players: newPlayers, instanceMap: minter.instanceMap }, remainingPool);
  }

  return {
    ...state,
    players: newPlayers,
    activePlayer: null,
    instanceMap: minter.instanceMap,
    phaseState: { phase: Phase.Setup, setupStep: { step: SetupStep.ItemDraft, itemDraftState, remainingPool } },
    turnNumber: 0,
  };
}

/**
 * Transitions the game after item draft completes. If either player has
 * remaining pool characters, enters the character deck draft phase.
 * Otherwise skips directly to Untap (turn 1).
 */
export function transitionAfterItemDraft(
  state: GameState,
  remainingPool: readonly [readonly CardDefinitionId[], readonly CardDefinitionId[]],
): GameState {
  if (remainingPool[0].length > 0 || remainingPool[1].length > 0) {
    return {
      ...state,
      activePlayer: null,
      phaseState: {
        phase: Phase.Setup,
        setupStep: {
          step: SetupStep.CharacterDeckDraft,
          deckDraftState: [
            { remainingPool: remainingPool[0], done: remainingPool[0].length === 0 },
            { remainingPool: remainingPool[1], done: remainingPool[1].length === 0 },
          ],
        },
      },
      turnNumber: 0,
    };
  }
  return enterSiteSelection(state);
}

/**
 * Enters the starting site selection step.
 * Called after deck shuffling is complete.
 */
export function enterSiteSelection(state: GameState): GameState {
  return {
    ...state,
    activePlayer: null,
    phaseState: {
      phase: Phase.Setup,
      setupStep: {
        step: SetupStep.StartingSiteSelection,
        siteSelectionState: [
          { selectedSites: [], done: false },
          { selectedSites: [], done: false },
        ],
      },
    },
    turnNumber: 0,
  };
}

/**
 * Transitions to the first Untap phase (turn 1).
 * Called once all setup steps are complete.
 */
export function startFirstTurn(state: GameState): GameState {
  return {
    ...state,
    // activePlayer should already be set by initiative roll
    activePlayer: state.activePlayer ?? state.players[0].id,
    phaseState: { phase: Phase.Untap, passed: [] },
    turnNumber: 1,
  };
}

// ---- Convenience: skip draft and start with specific characters ----

/**
 * Simplified player configuration that skips the draft — characters are
 * specified directly rather than chosen from a pool.
 */
export interface QuickStartPlayerConfig {
  readonly id: PlayerId;
  readonly name: string;
  readonly alignment: Alignment;
  readonly startingCharacters: readonly CardDefinitionId[];
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly startingHavens: readonly CardDefinitionId[];
}

/** Game configuration for the quick-start (draft-free) path. */
export interface QuickStartGameConfig {
  readonly players: readonly [QuickStartPlayerConfig, QuickStartPlayerConfig];
  readonly seed: number;
}

/**
 * Creates a game that skips the draft phase — characters are placed directly.
 * Useful for testing and scenarios.
 */
export function createGameQuickStart(
  config: QuickStartGameConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
): GameState {
  const minter = createMinter('i');
  let rng: RngState = createRng(config.seed);

  const players = config.players.map((pc) => {
    let playerState: PlayerState;
    [playerState, rng] = initPlayerWithCharacters(pc, cardPool, minter, rng);
    return playerState;
  }) as unknown as readonly [PlayerState, PlayerState];

  const gameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return recomputeDerived({
    gameId,
    players,
    activePlayer: config.players[0].id,
    phaseState: { phase: Phase.Untap, passed: [] },
    eventsInPlay: [],
    cardPool,
    instanceMap: minter.instanceMap,
    turnNumber: 1,
    pendingEffects: [],
    rng,
    stateSeq: 0,
  });
}

/**
 * Initialises a player with characters already in play (quick-start path).
 * Creates a single company at the starting haven, mints all characters and
 * their instances, and shuffles and deals the play deck. Derived values
 * (GI usage, MPs) are left at zero and recomputed by {@link recomputeDerived}.
 */
function initPlayerWithCharacters(
  config: QuickStartPlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  const firstHaven = config.startingHavens[0];
  if (!firstHaven) {
    throw new Error('No starting havens specified');
  }
  const havenDef = cardPool[firstHaven as string];
  if (!isSiteCard(havenDef)) {
    throw new Error(`Starting haven '${firstHaven}' not found or not a site`);
  }
  const havenInstanceId = mint(minter, firstHaven);

  const characters: Record<string, CharacterInPlay> = {};
  const characterInstanceIds: CardInstanceId[] = [];

  for (const charDefId of config.startingCharacters) {
    const charDef = cardPool[charDefId as string];
    if (!isCharacterCard(charDef)) {
      throw new Error(`Starting character '${charDefId}' not found or not a character`);
    }
    const instanceId = mint(minter, charDefId);
    characterInstanceIds.push(instanceId);
    characters[instanceId as string] = {
      instanceId,
      definitionId: charDefId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      corruptionCards: [],
      followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
  }

  const company: Company = {
    id: `company-${config.id}-0` as CompanyId,
    characters: characterInstanceIds,
    currentSite: havenInstanceId,
    destinationSite: null,
    movementPath: [],
    moved: false,
  };

  const playDeckDefIds = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstanceId[];
  [shuffledDeck, rng] = shuffle(playDeckDefIds, rng);

  const hand = shuffledDeck.slice(0, HAND_SIZE);
  const remainingDeck = shuffledDeck.slice(HAND_SIZE);
  const siteDeckIds = config.siteDeck.map(defId => mint(minter, defId));

  // GI and MP are left at zero — recomputeDerived() is called on the final state
  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    wizard: null,
    hand,
    playDeck: remainingDeck,
    discardPile: [],
    siteDeck: siteDeckIds,
    siteDiscardPile: [],
    sideboard: [],
    companies: [company],
    characters,
    marshallingPoints: ZERO_MARSHALLING_POINTS,
    generalInfluenceUsed: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
  };

  return [playerState, rng];
}
