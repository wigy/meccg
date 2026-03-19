import type {
  GameState,
  PlayerState,
  Company,
  CharacterInPlay,
  CardInstance,
  DraftPlayerState,
  RngState,
  CardDefinition,
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
} from '@meccg/shared';
import {
  Phase,
  CharacterStatus,
  HAND_SIZE,
  createRng,
  shuffle,
} from '@meccg/shared';

// ---- Config types ----

export interface PlayerConfig {
  readonly id: PlayerId;
  readonly name: string;
  readonly draftPool: readonly CardDefinitionId[];           // up to 10 characters for the draft
  readonly startingMinorItems: readonly CardDefinitionId[];  // up to 2 non-unique minor items
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly startingHaven: CardDefinitionId;
}

export interface GameConfig {
  readonly players: readonly [PlayerConfig, PlayerConfig];
  readonly seed: number;
}

// ---- Instance minting ----

interface InstanceMinter {
  instanceMap: Record<string, CardInstance>;
  counter: number;
  prefix: string;
}

function createMinter(prefix: string): InstanceMinter {
  return { instanceMap: {}, counter: 0, prefix };
}

function mint(minter: InstanceMinter, definitionId: CardDefinitionId): CardInstanceId {
  const instanceId = `${minter.prefix}-${minter.counter}` as CardInstanceId;
  minter.instanceMap[instanceId as string] = { instanceId, definitionId };
  minter.counter++;
  return instanceId;
}

// ---- Game creation: starts in character draft phase ----

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

  return {
    players,
    activePlayer: config.players[0].id,
    phaseState: {
      phase: Phase.CharacterDraft,
      round: 1,
      draftState,
      setAside: [],
    },
    eventsInPlay: [],
    cardPool,
    instanceMap: minter.instanceMap,
    turnNumber: 0,
    pendingEffects: [],
    rng,
  };
}

/**
 * Initialize player state before the draft — decks are set up,
 * but no characters are in play yet.
 */
function initPlayerPreDraft(
  config: PlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  // Validate haven
  const havenDef = cardPool[config.startingHaven as string];
  if (!havenDef || havenDef.cardType !== 'hero-site') {
    throw new Error(`Starting haven '${config.startingHaven}' not found or not a hero-site`);
  }

  // Mint and shuffle play deck
  const playDeckDefIds = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstanceId[];
  [shuffledDeck, rng] = shuffle(playDeckDefIds, rng);

  // Deal hand
  const hand = shuffledDeck.slice(0, HAND_SIZE);
  const remainingDeck = shuffledDeck.slice(HAND_SIZE);

  // Mint site deck
  const siteDeckIds = config.siteDeck.map(defId => mint(minter, defId));

  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    wizard: null,
    hand,
    playDeck: remainingDeck,
    discardPile: [],
    siteDeck: siteDeckIds,
    siteDiscardPile: [],
    sideboard: [],
    companies: [],
    characters: {},
    generalInfluenceUsed: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
  };

  return [playerState, rng];
}

/**
 * Called by the reducer when the draft is complete.
 * Places drafted characters at their starting havens and transitions to Untap.
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

  const newPlayers = state.players.map((player, index) => {
    const drafted = draftState[index].drafted;
    const startingMinorItems = draftState[index].startingMinorItems;
    const config = { id: player.id, startingHaven: findPlayerHaven(state, player) };

    // Mint haven instance
    const havenInstanceId = mint(minter, config.startingHaven);

    // Mint starting minor items
    const minorItemInstanceIds: CardInstanceId[] = [];
    for (const itemDefId of startingMinorItems) {
      minorItemInstanceIds.push(mint(minter, itemDefId));
    }

    // Mint characters and create CharacterInPlay entries
    const characters: Record<string, CharacterInPlay> = {};
    const characterInstanceIds: CardInstanceId[] = [];
    let generalInfluenceUsed = 0;
    let firstCharInstanceId: string | null = null;

    for (const charDefId of drafted) {
      const charDef = state.cardPool[charDefId as string];
      if (!charDef || charDef.cardType !== 'hero-character') continue;
      const instanceId = mint(minter, charDefId);
      characterInstanceIds.push(instanceId);
      if (firstCharInstanceId === null) {
        firstCharInstanceId = instanceId as string;
      }
      characters[instanceId as string] = {
        instanceId,
        definitionId: charDefId,
        status: CharacterStatus.Untapped,
        items: [],
        allies: [],
        corruptionCards: [],
        followers: [],
        controlledBy: 'general',
      };
      if (charDef.mind !== null) {
        generalInfluenceUsed += charDef.mind;
      }
    }

    // Assign starting minor items to first character
    if (firstCharInstanceId !== null && minorItemInstanceIds.length > 0) {
      characters[firstCharInstanceId] = {
        ...characters[firstCharInstanceId],
        items: minorItemInstanceIds,
      };
    }

    const company: Company = {
      id: `company-${player.id}-0` as CompanyId,
      characters: characterInstanceIds,
      currentSite: havenInstanceId,
      destinationSite: null,
      movementPath: [],
      moved: false,
    };

    return {
      ...player,
      companies: [company],
      characters,
      generalInfluenceUsed,
    } satisfies PlayerState;
  }) as unknown as readonly [PlayerState, PlayerState];

  return {
    ...state,
    players: newPlayers,
    instanceMap: minter.instanceMap,
    phaseState: { phase: Phase.Untap },
    turnNumber: 1,
  };
}

function findPlayerHaven(state: GameState, player: PlayerState): CardDefinitionId {
  // Find the haven from the player's site deck — first haven-type site
  for (const siteInstId of player.siteDeck) {
    const inst = state.instanceMap[siteInstId as string];
    if (inst) {
      const def = state.cardPool[inst.definitionId as string];
      if (def && def.cardType === 'hero-site' && def.siteType === 'haven') {
        return inst.definitionId;
      }
    }
  }
  // Fallback: use Rivendell if available
  for (const [id, def] of Object.entries(state.cardPool)) {
    if (def.cardType === 'hero-site' && def.siteType === 'haven') {
      return id as CardDefinitionId;
    }
  }
  throw new Error('No haven found for player');
}

// ---- Convenience: skip draft and start with specific characters ----

export interface QuickStartPlayerConfig {
  readonly id: PlayerId;
  readonly name: string;
  readonly startingCharacters: readonly CardDefinitionId[];
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly startingHaven: CardDefinitionId;
}

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

  return {
    players,
    activePlayer: config.players[0].id,
    phaseState: { phase: Phase.Untap },
    eventsInPlay: [],
    cardPool,
    instanceMap: minter.instanceMap,
    turnNumber: 1,
    pendingEffects: [],
    rng,
  };
}

function initPlayerWithCharacters(
  config: QuickStartPlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  const havenDef = cardPool[config.startingHaven as string];
  if (!havenDef || havenDef.cardType !== 'hero-site') {
    throw new Error(`Starting haven '${config.startingHaven}' not found or not a hero-site`);
  }
  const havenInstanceId = mint(minter, config.startingHaven);

  const characters: Record<string, CharacterInPlay> = {};
  const characterInstanceIds: CardInstanceId[] = [];
  let generalInfluenceUsed = 0;

  for (const charDefId of config.startingCharacters) {
    const charDef = cardPool[charDefId as string];
    if (!charDef || charDef.cardType !== 'hero-character') {
      throw new Error(`Starting character '${charDefId}' not found or not a hero-character`);
    }
    const instanceId = mint(minter, charDefId);
    characterInstanceIds.push(instanceId);
    characters[instanceId as string] = {
      instanceId,
      definitionId: charDefId,
      status: CharacterStatus.Untapped,
      items: [],
      allies: [],
      corruptionCards: [],
      followers: [],
      controlledBy: 'general',
    };
    if (charDef.mind !== null) {
      generalInfluenceUsed += charDef.mind;
    }
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

  const playerState: PlayerState = {
    id: config.id,
    name: config.name,
    wizard: null,
    hand,
    playDeck: remainingDeck,
    discardPile: [],
    siteDeck: siteDeckIds,
    siteDiscardPile: [],
    sideboard: [],
    companies: [company],
    characters,
    generalInfluenceUsed,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
  };

  return [playerState, rng];
}
