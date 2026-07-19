/**
 * @module test-helpers-core
 *
 * The foundation of the test harness: the instance-id mint (module-level
 * nextInstanceCounter + mint/resetMint), the base game-state builder
 * buildTestState with its setup option types (CharacterSetup, CharacterEntry,
 * CompanySetup, PlayerSetup, BuildTestStateOpts), and the card-placement helpers
 * (addCardInPlay, addToPile, pushCardInPlay, attachHazardToChar, attachItemToChar,
 * attachAllyToChar, addCardToHand, addCardToPlayDeck, addCardToDiscardPile,
 * setCharStatus). The mint counter and all its users live here together so the
 * shared minting state stays coherent in one module. Split out of test-helpers.ts
 * (re-exported from the barrel); imports only engine modules and the
 * constant/query base layers, so nothing imports it back (no cycle). Every other
 * builder imports buildTestState/mint, the setup types, and the placement helpers
 * from here.
 */

import { Phase, Alignment } from '../index.js';
import type { PlayerId, GameState, CardDefinitionId, CardInstanceId, CardInstance } from '../index.js';
import { PLAYER_1, pool } from './test-helpers-constants.js';
import { findCharInstanceId } from './test-helpers-queries.js';
import type { CompanyId, CardInPlay, CharacterInPlay, Company, PlayerState, MarshallingPointTotals } from '../index.js';
import { CardStatus, ZERO_EFFECTIVE_STATS, ZERO_MARSHALLING_POINTS } from '../index.js';
import { recomputeDerived } from '../engine/recompute-derived.js';
import { accrueRevealedInstances } from '../engine/visibility.js';
import { addConstraint } from '../engine/pending.js';

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
  /**
   * If set, mark the company as moving to this site this turn. A separate
   * site instance is minted and attached as `destinationSite`; tests that
   * need a moving company for hazards gated on arrival (River, Choking
   * Shadows, Incite Defenders) should use this instead of fabricating a
   * destination in-line after buildTestState.
   */
  destinationSite?: CardDefinitionId;
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
  /**
   * Override the Fallen-wizard stage-point total (defaults to 0). Normally
   * derived by `recomputeDerived`; set this for tests that assert directly on a
   * starting stage total without placing stage cards in play.
   */
  stagePoints?: number;
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

      const destDefId = companySetup.destinationSite;
      const destinationSite = destDefId
        ? (() => {
          const destInst = mintFor(destDefId);
          return { instanceId: destInst.instanceId, definitionId: destDefId, status: CardStatus.Untapped };
        })()
        : null;

      companies.push({
        id: `company-${setup.id as string}-${companies.length}` as CompanyId,
        characters: charInstIds,
        currentSite: { instanceId: siteInst.instanceId, definitionId: companySetup.site, status: CardStatus.Untapped },
        siteCardOwned: true,
        destinationSite,
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
      agents: [],
      characters,
      cardsInPlay: setup.cardsInPlay ?? ([] as CardInPlay[]),
      marshallingPoints: { ...ZERO_MARSHALLING_POINTS, ...(setup.marshallingPoints ?? {}) },
      callableMarshallingPoints: { ...ZERO_MARSHALLING_POINTS, ...(setup.marshallingPoints ?? {}) },
      stagePoints: setup.stagePoints ?? 0,
      generalInfluenceUsed: 0,
      generalInfluenceBonus: 0,
      deckExhaustionCount: setup.deckExhaustionCount ?? 0,
      freeCouncilCalled: false,
      lastDiceRoll: null,
      sideboardAccessedDuringUntap: false,
      deckExhaustPending: false,
      deckExhaustExchangeCount: 0,
      reservedCreatures: [],
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
    hazardHosts: [],
    rng: { seed: opts.seed ?? 42, counter: 0 },
    stateSeq: 0,
    reverseActions: [],
    lastTurnFor: null,
    cheatRollTotal: null,
    revealedInstances: {},
  } as unknown as GameState;

  const seeded = accrueRevealedInstances(baseState);
  if (opts.recompute) {
    return recomputeDerived(seeded);
  }
  return seeded;
}

/** Attach a hazard card to a character and return the updated GameState. */
export function attachHazardToChar(
  state: GameState,
  playerIdx: number,
  charDefId: CardDefinitionId,
  hazardDefId: CardDefinitionId,
  /** Index of the player who owns the hazard card. When provided, the instance ID is
   *  prefixed with that player's ID (e.g. "p2-inst3") so that `ownerOf(instanceId)`
   *  resolves correctly in the engine. Omit to use the generic "inst-N" format for
   *  backward-compatible test states where ownership is inferred contextually. */
  hazardOwnerIdx?: number,
): GameState {
  const charId = findCharInstanceId(state, playerIdx, charDefId);
  let instanceId: CardInstanceId;
  if (hazardOwnerIdx !== undefined) {
    const ownerPlayerId = state.players[hazardOwnerIdx].id as string;
    instanceId = `${ownerPlayerId}-inst${nextInstanceCounter++}` as CardInstanceId;
  } else {
    instanceId = mint();
  }
  const hazardCard: CardInstance = { instanceId, definitionId: hazardDefId };
  const char = state.players[playerIdx].characters[charId];
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
  const char = state.players[playerIdx].characters[charId];
  const updatedChar = { ...char, allies: [...char.allies, allyInPlay] };
  const updatedCharacters = { ...state.players[playerIdx].characters, [charId as string]: updatedChar };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedCharacters };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Push a {@link CardInstance} onto one of the player's list-valued piles.
 * Accepts `killPile` or `outOfPlayPile` — the two piles that store raw
 * instance records outside the normal play flow (kills + METD eliminated).
 */
export function addToPile(
  state: GameState,
  playerIdx: 0 | 1,
  pile: 'killPile' | 'outOfPlayPile',
  card: CardInstance,
): GameState {
  const updated = { ...state.players[playerIdx], [pile]: [...state.players[playerIdx][pile], card] };
  const players = playerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

/**
 * Append a CardInPlay entry to a player's `cardsInPlay` (e.g. a
 * permanent event). Mints a fresh `<playerId>-<n>` instance ID so
 * {@link ownerOf} resolves to the owning player. The counter starts
 * high (1000) to avoid colliding with IDs produced during initial state
 * setup. Pass `companyId` to bind the card to a specific company (e.g.
 * for testing CoE rule 2.07 — company permanent-events discarded when
 * the company loses all characters).
 */
export function addCardInPlay(state: GameState, ownerIdx: 0 | 1, defId: CardDefinitionId, companyId?: CompanyId): GameState {
  const ownerId = state.players[ownerIdx].id;
  const counter = 1000 + state.players[ownerIdx].cardsInPlay.length;
  const card: CardInPlay = {
    instanceId: `${ownerId as string}-${counter}` as CardInstanceId,
    definitionId: defId,
    status: CardStatus.Untapped,
    ...(companyId !== undefined ? { companyId } : {}),
  };
  const updated = { ...state.players[ownerIdx], cardsInPlay: [...state.players[ownerIdx].cardsInPlay, card] };
  const players = ownerIdx === 0 ? [updated, state.players[1]] : [state.players[0], updated];
  return { ...state, players: players as unknown as typeof state.players };
}

/**
 * Mark a site as **protected** for a player via an `until-cleared`
 * `site-protected` constraint — the effect The Fortress of Isen (wh-68),
 * Fortress of the Towers (wh-69), and Guarded Haven (wh-74) apply to a
 * Fallen-wizard's Wizardhaven. Combined with the site being a Fallen-wizard
 * haven, this makes it count toward `playerHasProtectedWizardhaven` /
 * `protectedWizardhavenCount`. `tag` disambiguates the synthetic source
 * instance id when protecting more than one site in the same test.
 */
export function protectSiteForPlayer(
  state: GameState,
  playerId: PlayerId,
  siteDefId: CardDefinitionId,
  tag = 'x',
): GameState {
  return addConstraint(state, {
    source: `protect-${tag}` as CardInstanceId,
    sourceDefinitionId: 'wh-74' as CardDefinitionId,
    scope: { kind: 'until-cleared' },
    target: { kind: 'player', playerId },
    kind: { type: 'site-flag', flag: 'site-protected', siteDefinitionId: siteDefId },
  });
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
  const char = state.players[playerIdx].characters[charId];
  const updatedChar = { ...char, items: [...char.items, itemInPlay] };
  const updatedCharacters = { ...state.players[playerIdx].characters, [charId as string]: updatedChar };
  const updatedPlayer = { ...state.players[playerIdx], characters: updatedCharacters };
  const p0 = playerIdx === 0 ? updatedPlayer : state.players[0];
  const p1 = playerIdx === 1 ? updatedPlayer : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Add a card (by definition ID) to a player's hand. Mints a new
 * instance and appends it. Useful for post-build hand setup when the
 * card isn't known at `buildTestState` time.
 */
export function addCardToHand(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): GameState {
  const card = { instanceId: mint(), definitionId: defId };
  const updated = { ...state.players[playerIdx], hand: [...state.players[playerIdx].hand, card] };
  const p0 = playerIdx === 0 ? updated : state.players[0];
  const p1 = playerIdx === 1 ? updated : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Add a card (by definition ID) to the front of a player's play deck.
 * Mints a new instance and prepends it so the card is at the top.
 */
export function addCardToPlayDeck(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): GameState {
  const card = { instanceId: mint(), definitionId: defId };
  const updated = { ...state.players[playerIdx], playDeck: [card, ...state.players[playerIdx].playDeck] };
  const p0 = playerIdx === 0 ? updated : state.players[0];
  const p1 = playerIdx === 1 ? updated : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

/**
 * Add a card (by definition ID) to the end of a player's discard pile.
 * Mints a new instance and appends it.
 */
export function addCardToDiscardPile(
  state: GameState,
  playerIdx: number,
  defId: CardDefinitionId,
): GameState {
  const card = { instanceId: mint(), definitionId: defId };
  const updated = { ...state.players[playerIdx], discardPile: [...state.players[playerIdx].discardPile, card] };
  const p0 = playerIdx === 0 ? updated : state.players[0];
  const p1 = playerIdx === 1 ? updated : state.players[1];
  return { ...state, players: [p0, p1] as unknown as typeof state.players };
}

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
  const char = state.players[playerIdx].characters[charId];
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

// ─── Effect / constraint fixture builders ───────────────────────────────────
