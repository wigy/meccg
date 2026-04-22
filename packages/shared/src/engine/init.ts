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
 * in the game receives a globally unique {@link CardInstanceId}. Each player
 * has their own minter whose prefix is the player's {@link PlayerId}, so the
 * owning player can always be derived from an instance ID via
 * {@link ownerOf} — see `state.ts`.
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
} from '../index.js';
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
  isItemCard,
  isSiteCard,
} from '../index.js';
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
  readonly draftPool: readonly CardDefinitionId[];           // characters + starting minor items for the draft
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly sideboard: readonly CardDefinitionId[];
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
 * Mutable helper that stamps out unique {@link CardInstance}s.
 * Passed through initialisation functions so that every card in the game
 * — across both players — gets a distinct ID.
 */
interface InstanceMinter {
  counter: number;
  prefix: string;
}

/**
 * Creates a fresh minter whose prefix is a player's {@link PlayerId}.
 * Instance IDs minted by this minter are owned by that player for the
 * lifetime of the game (deck-ownership never transfers in MECCG, even
 * for hazards that physically reside in the opponent's zones).
 */
function createMinter(prefix: PlayerId): InstanceMinter {
  return { counter: 0, prefix: prefix as string };
}

/**
 * Mints a new {@link CardInstance} for a given definition and increments the counter.
 * The resulting `instanceId` is `<playerId>-<counter>` (e.g. "p1-0", "p2-3"),
 * so the owning player is derivable from the ID without any state lookup.
 */
function mint(minter: InstanceMinter, definitionId: CardDefinitionId): CardInstance {
  const instanceId = `${minter.prefix}-${minter.counter}` as CardInstanceId;
  minter.counter++;
  return { instanceId, definitionId };
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
  const minter0 = createMinter(config.players[0].id);
  const minter1 = createMinter(config.players[1].id);
  let rng: RngState = createRng(config.seed);

  const [p0, rng0] = initPlayerPreDraft(config.players[0], cardPool, minter0, rng);
  const [p1, rng1] = initPlayerPreDraft(config.players[1], cardPool, minter1, rng0);
  rng = rng1;
  const players: readonly [PlayerState, PlayerState] = [p0, p1];

  const draftState: [DraftPlayerState, DraftPlayerState] = [
    { pool: config.players[0].draftPool.map(defId => mint(minter0, defId)), drafted: [], currentPick: null, stopped: false },
    { pool: config.players[1].draftPool.map(defId => mint(minter1, defId)), drafted: [], currentPick: null, stopped: false },
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
        setAside: [[], []],
      },
    },
    combat: null,
    chain: null,
    cardPool,
    turnNumber: 0,
    startingPlayer: null,
    pendingEffects: [],
    pendingResolutions: [],
    activeConstraints: [],
    rng,
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    revealedInstances: {},
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
 * @param minter - This player's instance minter (prefix = player's PlayerId).
 * @param rng - Current RNG state (threaded for determinism).
 * @returns A tuple of `[playerState, nextRng]`.
 */
function initPlayerPreDraft(
  config: PlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  // Mint and shuffle play deck (no hand dealt yet — that happens after draft)
  const playDeckMinted = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstance[];
  [shuffledDeck, rng] = shuffle(playDeckMinted, rng);

  // Mint site deck
  const siteDeckCards = config.siteDeck.map(defId => mint(minter, defId));

  // Mint sideboard
  const sideboardCards = config.sideboard.map(defId => mint(minter, defId));

  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    wizard: null,
    hand: [],
    playDeck: shuffledDeck,
    discardPile: [],
    siteDeck: siteDeckCards,
    siteDiscardPile: [],
    sideboard: sideboardCards,
    killPile: [],
    outOfPlayPile: [],
    companies: [],
    characters: {},
    cardsInPlay: [],
    marshallingPoints: ZERO_MARSHALLING_POINTS,
    generalInfluenceUsed: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
    lastDiceRoll: null,
    sideboardAccessedDuringUntap: false,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
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
  setAside: readonly [readonly CardInstance[], readonly CardInstance[]] = [[], []],
): GameState {
  const results = state.players.map((player, index) => {
    const drafted = draftState[index].drafted;
    const pool = draftState[index].pool;

    // Extract items from the pool (items are not drafted during character draft).
    // Keep the original instance IDs — every card minted into the game must keep
    // its instance ID for the lifetime of the game.
    const minorItems: CardInstance[] = [];
    for (const card of pool) {
      if (isItemCard(state.cardPool[card.definitionId as string])) {
        minorItems.push(card);
      }
    }

    // Promote drafted cards to characters-in-play using their existing instance IDs.
    const characters: Record<string, CharacterInPlay> = {};
    const characterInstanceIds: CardInstanceId[] = [];

    for (const card of drafted) {
      const def = state.cardPool[card.definitionId as string];
      if (!isCharacterCard(def)) continue;
      characterInstanceIds.push(card.instanceId);
      characters[card.instanceId as string] = {
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        status: CardStatus.Untapped,
        items: [],
        allies: [],
        hazards: [],
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
      siteCardOwned: true,
      destinationSite: null,
      movementPath: [],
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
      hazards: [],
    };

    // GI and MP are left at zero — recomputeDerived() runs after the reducer
    return {
      player: {
        ...player,
        companies: [company],
        characters,
      } satisfies PlayerState,
      unassignedItems: minorItems,
    };
  });

  const newPlayers: readonly [PlayerState, PlayerState] = [results[0].player, results[1].player];
  // Remaining pool for character deck draft: undrafted characters + this player's set-aside characters
  // (items are excluded — already extracted above). Each player keeps the collided instances that
  // originated from their own pick, so every instance remains in exactly one location.
  const remainingPool: readonly [readonly CardInstance[], readonly CardInstance[]] = [
    [...draftState[0].pool.filter(card => !isItemCard(state.cardPool[card.definitionId as string])), ...setAside[0]],
    [...draftState[1].pool.filter(card => !isItemCard(state.cardPool[card.definitionId as string])), ...setAside[1]],
  ];
  const itemDraftState: readonly [ItemDraftPlayerState, ItemDraftPlayerState] = [
    { unassignedItems: results[0].unassignedItems, done: results[0].unassignedItems.length === 0 },
    { unassignedItems: results[1].unassignedItems, done: results[1].unassignedItems.length === 0 },
  ];

  // If neither player has items to assign, skip to character deck draft (or Untap)
  if (itemDraftState[0].done && itemDraftState[1].done) {
    return transitionAfterItemDraft({ ...state, players: newPlayers }, remainingPool);
  }

  return {
    ...state,
    players: newPlayers,
    activePlayer: null,
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
  remainingPool: readonly [readonly CardInstance[], readonly CardInstance[]],
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
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false },
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
  readonly sideboard: readonly CardDefinitionId[];
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
  const minter0 = createMinter(config.players[0].id);
  const minter1 = createMinter(config.players[1].id);
  let rng: RngState = createRng(config.seed);

  const [qp0, qrng0] = initPlayerWithCharacters(config.players[0], cardPool, minter0, rng);
  const [qp1, qrng1] = initPlayerWithCharacters(config.players[1], cardPool, minter1, qrng0);
  rng = qrng1;
  const players: readonly [PlayerState, PlayerState] = [qp0, qp1];

  const gameId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  return recomputeDerived({
    gameId,
    players,
    activePlayer: config.players[0].id,
    phaseState: { phase: Phase.Untap, untapped: false, hazardSideboardDestination: null, hazardSideboardFetched: 0, hazardSideboardAccessed: false, resourcePlayerPassed: false, hazardPlayerPassed: false },
    combat: null,
    chain: null,
    cardPool,
    turnNumber: 1,
    startingPlayer: config.players[0].id,
    pendingEffects: [],
    pendingResolutions: [],
    activeConstraints: [],
    rng,
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    revealedInstances: {},
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
  const firstHaven = config.siteDeck.find(defId => {
    const def = cardPool[defId as string];
    return isSiteCard(def) && def.siteType === 'haven';
  });
  if (!firstHaven) {
    throw new Error('No haven found in site deck');
  }
  const havenCard = mint(minter, firstHaven);

  const characters: Record<string, CharacterInPlay> = {};
  const characterInstanceIds: CardInstanceId[] = [];

  for (const charDefId of config.startingCharacters) {
    const charDef = cardPool[charDefId as string];
    if (!isCharacterCard(charDef)) {
      throw new Error(`Starting character '${charDefId}' not found or not a character`);
    }
    const card = mint(minter, charDefId);
    characterInstanceIds.push(card.instanceId);
    characters[card.instanceId as string] = {
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      status: CardStatus.Untapped,
      items: [],
      allies: [],
      hazards: [],
      followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
  }

  const company: Company = {
    id: `company-${config.id}-0` as CompanyId,
    characters: characterInstanceIds,
    currentSite: { instanceId: havenCard.instanceId, definitionId: havenCard.definitionId, status: CardStatus.Untapped },
    siteCardOwned: true,
    destinationSite: null,
    movementPath: [],
    moved: false,
    siteOfOrigin: null,
    onGuardCards: [],
    hazards: [],
  };

  const playDeckMinted = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstance[];
  [shuffledDeck, rng] = shuffle(playDeckMinted, rng);

  const hand = shuffledDeck.slice(0, HAND_SIZE);
  const remainingDeck = shuffledDeck.slice(HAND_SIZE);
  const siteDeckCards = config.siteDeck.map(defId => mint(minter, defId));
  const sideboardCards = config.sideboard.map(defId => mint(minter, defId));

  // GI and MP are left at zero — recomputeDerived() is called on the final state
  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    wizard: null,
    hand,
    playDeck: remainingDeck,
    discardPile: [],
    siteDeck: siteDeckCards,
    siteDiscardPile: [],
    sideboard: sideboardCards,
    killPile: [],
    outOfPlayPile: [],
    companies: [company],
    characters,
    cardsInPlay: [],
    marshallingPoints: ZERO_MARSHALLING_POINTS,
    generalInfluenceUsed: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
    lastDiceRoll: null,
    sideboardAccessedDuringUntap: false,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
  };

  return [playerState, rng];
}
