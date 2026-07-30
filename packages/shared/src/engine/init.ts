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
  CardInPlay,
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
import { HAND_SIZE } from '../constants.js';
import { createRng, shuffle } from '../rng.js';
import { resolveThrallCharacterPairings } from '../stage-resource-characters.js';
import { isCharacterCard, isItemCard, isSiteCard } from '../types/cards.js';
import { CardStatus, Alignment } from '../types/common.js';
import { ZERO_MARSHALLING_POINTS, ZERO_EFFECTIVE_STATS } from '../types/state-cards.js';
import { Phase, SetupStep } from '../types/state-phases.js';
import { recomputeDerived } from './recompute-derived.js';
import { logDetail } from './legal-actions/log.js';
import { defById, findById, isStageResourceCard, hasRecruitmentVehicleEffect, hasStartingCompanyPlacementInDeck, hasStartingCompanyPlacementEffect } from './reducer-utils.js';
import { stageResourceNeedsSite } from './stage-resource-sites.js';
import { applyStageResourceSiteConstraints } from './chain-reducer.js';

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
  /**
   * Anti-Fallen-wizard sideboard (MEWH): up to 10 cards preselected for facing a
   * Fallen-wizard opponent. When this player's *opponent* is a Fallen-wizard,
   * these cards are added to {@link sideboard} at game start ("Your opponent may
   * also add 10 cards to his sideboard"). Ignored against non-Fallen-wizards.
   */
  readonly antiFwSideboard?: readonly CardDefinitionId[];
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

  // Each player's anti-Fallen-wizard sideboard is folded into their main
  // sideboard only when their *opponent* is a Fallen-wizard (MEWH).
  const [p0, rng0] = initPlayerPreDraft(config.players[0], cardPool, minter0, rng, config.players[1].alignment);
  const [p1, rng1] = initPlayerPreDraft(config.players[1], cardPool, minter1, rng0, config.players[0].alignment);
  rng = rng1;
  const players: readonly [PlayerState, PlayerState] = [p0, p1];

  const draftState: [DraftPlayerState, DraftPlayerState] = [
    { pool: config.players[0].draftPool.map(defId => mint(minter0, defId)), drafted: [], draftedStageResources: [], currentPick: null, stopped: false },
    { pool: config.players[1].draftPool.map(defId => mint(minter1, defId)), drafted: [], draftedStageResources: [], currentPick: null, stopped: false },
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
    hazardHosts: [],
    rng,
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    cheated: false,
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
/**
 * Build a fresh {@link PlayerState} with every pile and counter at its
 * game-start default. The four fields that differ between the two init paths —
 * `hand`, `playDeck`, `companies`, `characters` — are supplied by the caller
 * (the latter three default to empty); everything else (empty piles, zeroed
 * MP/GI, cleared flags) is filled here. Centralizing the starting shape means a
 * newly-added PlayerState field is set in one place instead of being silently
 * missed by one of the two callers.
 */
function makeInitialPlayerState(opts: {
  readonly id: PlayerState['id'];
  readonly name: PlayerState['name'];
  readonly alignment: PlayerState['alignment'];
  readonly playDeck: PlayerState['playDeck'];
  readonly siteDeck: PlayerState['siteDeck'];
  readonly sideboard: PlayerState['sideboard'];
  readonly hand?: PlayerState['hand'];
  readonly companies?: PlayerState['companies'];
  readonly characters?: PlayerState['characters'];
}): PlayerState {
  return {
    id: opts.id,
    name: opts.name,
    alignment: opts.alignment,
    wizard: null,
    hand: opts.hand ?? [],
    playDeck: opts.playDeck,
    discardPile: [],
    siteDeck: opts.siteDeck,
    siteDiscardPile: [],
    sideboard: opts.sideboard,
    killPile: [],
    outOfPlayPile: [],
    companies: opts.companies ?? [],
    agents: [],
    characters: opts.characters ?? {},
    cardsInPlay: [],
    marshallingPoints: ZERO_MARSHALLING_POINTS,
    callableMarshallingPoints: ZERO_MARSHALLING_POINTS,
    stagePoints: 0,
    generalInfluenceUsed: 0,
    generalInfluenceBonus: 0,
    generalInfluenceControlPenalty: 0,
    deckExhaustionCount: 0,
    freeCouncilCalled: false,
    lastDiceRoll: null,
    sideboardAccessedDuringUntap: false,
    deckExhaustPending: false,
    deckExhaustExchangeCount: 0,
    reservedCreatures: [],
  };
}

function initPlayerPreDraft(
  config: PlayerConfig,
  cardPool: Readonly<Record<string, CardDefinition>>,
  minter: InstanceMinter,
  rng: RngState,
  opponentAlignment?: Alignment,
): [PlayerState, RngState] {
  // Mint and shuffle play deck (no hand dealt yet — that happens after draft)
  const playDeckMinted = config.playDeck.map(defId => mint(minter, defId));
  let shuffledDeck: CardInstance[];
  [shuffledDeck, rng] = shuffle(playDeckMinted, rng);

  // Mint site deck
  const siteDeckCards = config.siteDeck.map(defId => mint(minter, defId));

  // Mint sideboard. MEWH: when the opponent is a Fallen-wizard, fold in this
  // player's preselected anti-Fallen-wizard sideboard (up to 10 cards).
  const sideboardCards = config.sideboard.map(defId => mint(minter, defId));
  if (opponentAlignment === Alignment.FallenWizard && config.antiFwSideboard) {
    for (const defId of config.antiFwSideboard) {
      sideboardCards.push(mint(minter, defId));
    }
  }

  const playerState = makeInitialPlayerState({
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    playDeck: shuffledDeck,
    siteDeck: siteDeckCards,
    sideboard: sideboardCards,
  });

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
  // Resolve each player's site-targeting Stage-resource pairings (Hidden Haven,
  // wh-75) to the chosen site's definition id, so we can detect cross-player
  // collisions (both players paired the *same site definition*). CRF 22: a
  // colliding Hidden Haven is set aside (to hand) rather than converting.
  const pairingsByPlayer: { stageResourceInstanceId: CardInstanceId; siteInstanceId: CardInstanceId; siteDefId: CardDefinitionId }[][] = [[], []];
  for (let i = 0; i < 2; i++) {
    for (const pairing of draftState[i].stageResourceSites ?? []) {
      const siteCard = findById(state.players[i].siteDeck, pairing.siteInstanceId);
      if (!siteCard) continue;
      pairingsByPlayer[i].push({
        stageResourceInstanceId: pairing.stageResourceInstanceId,
        siteInstanceId: pairing.siteInstanceId,
        siteDefId: siteCard.definitionId,
      });
    }
  }
  const sitesChosenBy = (i: number): Set<string> => new Set(pairingsByPlayer[i].map(p => p.siteDefId as string));
  const sites0 = sitesChosenBy(0);
  const sites1 = sitesChosenBy(1);
  const collisionSiteDefIds = new Set<string>([...sites0].filter(d => sites1.has(d)));
  if (collisionSiteDefIds.size > 0) {
    logDetail(`Hidden Haven site collision(s): ${[...collisionSiteDefIds].join(', ')} — those Hidden Havens are set aside (CRF 22)`);
  }

  // Non-colliding Hidden Haven conversions to apply after the player map is
  // assembled (each needs the cross-player collision verdict above).
  const conversionsToApply: { playerId: PlayerId; hhCard: CardInstance; siteDefId: CardDefinitionId }[] = [];

  const results = state.players.map((player, index) => {
    const drafted = draftState[index].drafted;
    const pool = draftState[index].pool;

    // Extract items from the pool (items are not drafted during character draft).
    // Keep the original instance IDs — every card minted into the game must keep
    // its instance ID for the lifetime of the game.
    const minorItems: CardInstance[] = [];
    // Undrafted Fallen-wizard Stage resources still in the pool must not be lost
    // when the character-deck-draft pass clears the remaining pool — sink them to
    // the sideboard (the no-card-disappears invariant).
    const strandedStageResources: CardInstance[] = [];
    for (const card of pool) {
      const def = defById(state, card.definitionId);
      if (isItemCard(def)) {
        minorItems.push(card);
      } else if (isStageResourceCard(def)) {
        strandedStageResources.push(card);
      }
    }

    // Promote drafted cards to characters-in-play using their existing instance IDs.
    const characters: Record<string, CharacterInPlay> = {};
    const characterInstanceIds: CardInstanceId[] = [];

    for (const card of drafted) {
      const def = defById(state, card.definitionId);
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

    // Resolve drafted Stage resources (rules 1.42/1.44/1.50):
    //  - Thrall of the Voice (recruitment-vehicle) is "placed with a character":
    //    attach it to a drafted character that needed it — prefer an agent, then
    //    the highest-mind character, so its "-1 to his mind" lands where the
    //    draft gate was lifted. Its mind reduction applies via recomputeDerived.
    //  - Hidden Haven (site-targeting Stage resource) paired with a non-colliding
    //    site enters play bound to that site (which becomes a starting
    //    Wizardhaven); a colliding pairing (both players chose the same site
    //    definition) is set aside to the hand instead (CRF 22).
    //  - A Stage resource that is "played with a starting company in lieu of a
    //    minor item" (`starting-company-placement`) waits in the hand until the
    //    item-draft step places it.
    //  - Any other Stage resource is put into play (CoE 1.9.F4: "if not
    //    duplicated, the Stage resource is put into play") — Bad Company (wh-63)
    //    must be in play for the Orc/Troll characters it let into the starting
    //    company to stay legal, and for its stage points to count from turn 1.
    //  - An unpaired Hidden Haven goes to the hand.
    const handAdditions: CardInstance[] = [];
    const cardsInPlayAdditions: CardInPlay[] = [];
    // Character each Thrall of the Voice (recruitment-vehicle Stage resource) is
    // placed with. Shared with the draft-board renderer so the displayed pairing
    // always matches the one applied here.
    const thrallTargetByResource = new Map(
      resolveThrallCharacterPairings(
        characterInstanceIds.map(id => ({ instanceId: id, definitionId: characters[id as string].definitionId })),
        draftState[index].draftedStageResources,
        defId => defById(state, defId),
      ).map(p => [p.stageResourceInstanceId as string, p.characterInstanceId]),
    );
    // Non-colliding Hidden Haven sites for this player → become starting sites.
    const convertedSites: { siteInstanceId: CardInstanceId; siteDefId: CardDefinitionId }[] = [];
    const myPairings = pairingsByPlayer[index];
    for (const card of draftState[index].draftedStageResources) {
      const def = defById(state, card.definitionId);
      if (hasRecruitmentVehicleEffect(def)) {
        const targetId = thrallTargetByResource.get(card.instanceId as string);
        if (targetId) {
          const target = characters[targetId as string];
          characters[targetId as string] = {
            ...target,
            items: [...target.items, { instanceId: card.instanceId, definitionId: card.definitionId, status: CardStatus.Untapped }],
          };
        } else {
          // No drafted character to place it with — keep it in hand so it is
          // never lost and can be played as a recruitment vehicle later.
          handAdditions.push(card);
        }
      } else if (stageResourceNeedsSite(def)) {
        const pairing = myPairings.find(p => p.stageResourceInstanceId === card.instanceId);
        if (!pairing) {
          // Defensive: a site-targeting Stage resource with no pairing — keep it
          // in hand so it is never lost and can be played later.
          logDetail(`${def?.name ?? (card.definitionId as string)} has no paired site — keeping in hand`);
          handAdditions.push(card);
        } else if (collisionSiteDefIds.has(pairing.siteDefId as string)) {
          // CRF 22: both players paired the same site definition — set aside to
          // hand; the site stays in the deck and the conversion does not apply.
          logDetail(`${def?.name ?? (card.definitionId as string)} set aside (site collision) — to hand`);
          handAdditions.push(card);
        } else {
          // Non-colliding pairing: the site becomes a starting Wizardhaven and
          // Hidden Haven enters play bound to it.
          logDetail(`${def?.name ?? (card.definitionId as string)} converts paired site to a starting Wizardhaven`);
          convertedSites.push({ siteInstanceId: pairing.siteInstanceId, siteDefId: pairing.siteDefId });
          cardsInPlayAdditions.push({
            instanceId: card.instanceId,
            definitionId: card.definitionId,
            status: CardStatus.Untapped,
            attachedToSite: pairing.siteDefId,
          });
          conversionsToApply.push({ playerId: player.id, hhCard: card, siteDefId: pairing.siteDefId });
        }
      } else if (hasStartingCompanyPlacementEffect(def)) {
        // Placed with the starting company "in lieu of a minor item" during the
        // item-draft step — keep it in hand until then.
        handAdditions.push(card);
      } else {
        // CoE 1.9.F4: a drafted Stage resource that needs neither a character nor
        // a site pairing is simply put into play (Bad Company, wh-63).
        logDetail(`${def?.name ?? (card.definitionId as string)} enters play with the starting company (CoE 1.9.F4)`);
        cardsInPlayAdditions.push({
          instanceId: card.instanceId,
          definitionId: card.definitionId,
          status: CardStatus.Untapped,
        });
      }
    }

    // Remove any converted site instances from the site deck — they are now
    // starting sites in play (the no-card-disappears invariant: they move to a
    // company's currentSite below).
    const convertedSiteInstanceIds = new Set(convertedSites.map(s => s.siteInstanceId as string));
    const remainingSiteDeck = player.siteDeck.filter(s => !convertedSiteInstanceIds.has(s.instanceId as string));

    // Base company holds all drafted characters; the first non-colliding paired
    // Hidden Haven site (if any) fills its currentSite. Each additional
    // converted site gets its own empty starting company.
    const baseCompany: Company = {
      id: `company-${player.id}-0` as CompanyId,
      characters: characterInstanceIds,
      currentSite: convertedSites.length > 0
        ? { instanceId: convertedSites[0].siteInstanceId, definitionId: convertedSites[0].siteDefId, status: CardStatus.Untapped }
        : null,
      siteCardOwned: true,
      destinationSite: null,
      movementPath: [],
      moved: false,
      siteOfOrigin: null,
      onGuardCards: [],
      hazards: [],
    };
    const companies: Company[] = [baseCompany];
    for (let s = 1; s < convertedSites.length; s++) {
      companies.push({
        id: `company-${player.id}-${s}` as CompanyId,
        characters: [],
        currentSite: { instanceId: convertedSites[s].siteInstanceId, definitionId: convertedSites[s].siteDefId, status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite: null,
        movementPath: [],
        moved: false,
        siteOfOrigin: null,
        onGuardCards: [],
        hazards: [],
      });
    }

    // GI and MP are left at zero — recomputeDerived() runs after the reducer
    return {
      player: {
        ...player,
        companies,
        characters,
        siteDeck: remainingSiteDeck,
        cardsInPlay: [...player.cardsInPlay, ...cardsInPlayAdditions],
        hand: [...player.hand, ...handAdditions],
        sideboard: [...player.sideboard, ...strandedStageResources],
      } satisfies PlayerState,
      unassignedItems: minorItems,
    };
  });

  const newPlayers: readonly [PlayerState, PlayerState] = [results[0].player, results[1].player];

  // Apply Hidden Haven Wizardhaven conversion constraints for every
  // non-colliding pairing. These bind to the chosen site definition and the
  // owning player, so they must be applied once the player roster (and thus the
  // sites in play) is assembled. Thread the resulting state through the rest of
  // the transition so the constraints survive.
  let workState: GameState = { ...state, players: newPlayers };
  for (const conv of conversionsToApply) {
    workState = applyStageResourceSiteConstraints(workState, conv.playerId, conv.hhCard, conv.siteDefId);
  }

  // Remaining pool for character deck draft: undrafted characters + this player's set-aside characters
  // (items are excluded — already extracted above). Each player keeps the collided instances that
  // originated from their own pick, so every instance remains in exactly one location.
  // Items go to item draft; undrafted Stage resources were sunk to the sideboard
  // above; only undrafted characters (plus this player's collided set-aside)
  // carry into the character-deck-draft pool.
  const carriesToDeckDraft = (card: CardInstance): boolean => {
    const def = defById(state, card.definitionId);
    return !isItemCard(def) && !isStageResourceCard(def);
  };
  const remainingPool: readonly [readonly CardInstance[], readonly CardInstance[]] = [
    [...draftState[0].pool.filter(carriesToDeckDraft), ...setAside[0]],
    [...draftState[1].pool.filter(carriesToDeckDraft), ...setAside[1]],
  ];
  // A player is auto-done in the item draft only if they have neither a minor
  // item to assign nor a play-deck card that "may be played with a starting
  // company in lieu of a minor item" (Open to the Summons wh-46, Orders from
  // Lugbúrz as-94…). Otherwise the step stays open so the placement is offered.
  const itemDraftState: readonly [ItemDraftPlayerState, ItemDraftPlayerState] = [
    { unassignedItems: results[0].unassignedItems, done: results[0].unassignedItems.length === 0 && !hasStartingCompanyPlacementInDeck(workState, newPlayers[0]) },
    { unassignedItems: results[1].unassignedItems, done: results[1].unassignedItems.length === 0 && !hasStartingCompanyPlacementInDeck(workState, newPlayers[1]) },
  ];

  // If neither player has items to assign, skip to character deck draft (or Untap)
  if (itemDraftState[0].done && itemDraftState[1].done) {
    return transitionAfterItemDraft(workState, remainingPool);
  }

  return {
    ...workState,
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
    hazardHosts: [],
    rng,
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    cheated: false,
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
  const playerState = makeInitialPlayerState({
    id: config.id,
    name: config.name,
    alignment: config.alignment,
    hand,
    playDeck: remainingDeck,
    siteDeck: siteDeckCards,
    sideboard: sideboardCards,
    companies: [company],
    characters,
  });

  return [playerState, rng];
}
