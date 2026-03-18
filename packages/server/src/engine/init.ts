import type {
  GameState,
  PlayerState,
  Company,
  CharacterInPlay,
  CardInstance,
  RngState,
  CardDefinition,
  PlayerId,
  CardInstanceId,
  CompanyId,
  CardDefinitionId,
  WizardName,
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
  readonly wizard: WizardName;
  readonly startingCharacters: readonly CardDefinitionId[];
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

// ---- Initialization ----

export function createGame(
  config: GameConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
): GameState {
  const minter = createMinter('i');
  let rng: RngState = createRng(config.seed);

  const players = config.players.map((pc, index) => {
    let playerState: PlayerState;
    [playerState, rng] = initPlayer(pc, index, cardPool, minter, rng);
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

function initPlayer(
  config: PlayerConfig,
  _index: number,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
): [PlayerState, RngState] {
  // Mint haven instance
  const havenDef = cardPool[config.startingHaven as string];
  if (!havenDef || havenDef.cardType !== 'hero-site') {
    throw new Error(`Starting haven '${config.startingHaven}' not found or not a hero-site`);
  }
  const havenInstanceId = mint(minter, config.startingHaven);

  // Mint starting characters and create CharacterInPlay entries
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
    // Wizards have null mind, don't cost general influence
    if (charDef.mind !== null) {
      generalInfluenceUsed += charDef.mind;
    }
  }

  // Create starting company at haven
  const company: Company = {
    id: `company-${config.id}-0` as CompanyId,
    characters: characterInstanceIds,
    currentSite: havenInstanceId,
    destinationSite: null,
    movementPath: [],
    moved: false,
  };

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
    wizard: config.wizard,
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
