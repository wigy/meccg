/**
 * @module le-141.test
 *
 * Card test: Stench of Mordor (le-141)
 * Type: hazard-event (permanent, global environment)
 * Text:
 *   "Environment. At the start of its site phase, each company at a site in a
 *    Dark-domain [{d}] (or Shadow-land [{s}], if Doors of Night is in play)
 *    must tap one untapped character if available. Discard when any play deck
 *    is exhausted. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect                                                    | Status | Notes                                                   |
 * |---|-----------------------------------------------------------|--------|---------------------------------------------------------|
 * | 1 | duplication-limit: scope=game max=1                       | OK     | duplication-limit global check in reducer.ts            |
 * | 2 | on-event: play-deck-exhausted → discard-self              | OK     | completeDeckExhaust fires play-deck-exhausted           |
 * | 3 | on-event: site-phase-company-begins → tap-one-character   | OK     | fireSitePhaseCompanyBeginsEvents in reducer-site.ts     |
 *    3a. at Dark-domain site: always fires                                                                                |
 *    3b. at Shadow-land site with DoN in play: fires                                                                     |
 *    3c. at Shadow-land site without DoN: does not fire                                                                  |
 *    3d. at non-dark/shadow site: does not fire                                                                          |
 *    3e. no untapped characters: pass is the only action                                                                 |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LORIEN,
  resetMint, buildTestState, Phase, Alignment, CardStatus,
  dispatch, RESOURCE_PLAYER, HAZARD_PLAYER, addCardInPlay,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, SitePhaseState, EndOfTurnPhaseState } from '../../index.js';

const STENCH_OF_MORDOR = 'le-141' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;

// Minion characters
const GORBAG = 'le-11' as CardDefinitionId;       // orc, prowess 6
const SHAGRAT = 'le-39' as CardDefinitionId;      // orc, prowess 6

// Minion havens
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

// Sites in Dark-domain regions (Gorgoroth is regionType "dark")
const BARAD_DUR = 'le-352' as CardDefinitionId;       // dark-hold in Gorgoroth (dark)

// Sites in Shadow-land regions (Dagorlad is regionType "shadow")
const DEAD_MARSHES = 'le-364' as CardDefinitionId;    // shadow-hold in Dagorlad (shadow)

// Site in a wilderness region — Redhorn Gate is "wilderness"
const MORIA = 'le-392' as CardDefinitionId;           // shadow-hold in Redhorn Gate (wilderness)

/** Build a SitePhaseState at the select-company step. */
function makeSelectCompanyPhase(): SitePhaseState {
  return {
    phase: Phase.Site,
    step: 'select-company',
    activeCompanyIndex: -1,
    handledCompanyIds: [],
    siteEntered: false,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
}

describe('Stench of Mordor (le-141)', () => {
  beforeEach(() => resetMint());

  // ── Effect 3a: tap-one-character fires at Dark-domain site ───────────────────

  test('tap-one-character resolution enqueued when company is at a Dark-domain (Gorgoroth) site', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    const tapPending = afterSelect.pendingResolutions.find(r => r.kind.type === 'tap-one-character');
    expect(tapPending).toBeDefined();
    expect(tapPending!.actor).toBe(PLAYER_1);
  });

  test('legal actions after select-company at Dark-domain include tap-character-by-effect per untapped character', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GORBAG, SHAGRAT] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    const actions = computeLegalActions(afterSelect, PLAYER_1);
    const viableTypes = actions.filter(a => a.viable).map(a => a.action.type);
    // One tap action per untapped character
    expect(viableTypes.filter(t => t === 'tap-character-by-effect')).toHaveLength(2);
    // The tap is mandatory ("must tap one untapped character if available"):
    // pass is not offered while an untapped character remains
    expect(viableTypes).not.toContain('pass');
    // enter-site blocked until pending clears
    expect(viableTypes).not.toContain('enter-site');
  });

  test('tapping a character via tap-character-by-effect resolves pending and character becomes tapped', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    const tapAction = computeLegalActions(afterSelect, PLAYER_1)
      .find(a => a.viable && a.action.type === 'tap-character-by-effect')!.action;
    const afterTap = dispatch(afterSelect, tapAction);

    // Pending resolution cleared
    expect(afterTap.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(false);
    // Phase advances to enter-or-skip
    expect((afterTap.phaseState as SitePhaseState).step).toBe('enter-or-skip');
    // The tapped character instance is now Tapped
    const charId = (tapAction as { characterInstanceId: CardInstanceId }).characterInstanceId;
    expect(afterTap.players[RESOURCE_PLAYER].characters[charId].status).toBe(CardStatus.Tapped);
  });

  // ── Effect 3b: fires at Shadow-land site WITH Doors of Night ─────────────────

  test('fires at Shadow-land (Dagorlad) site when Doors of Night is in play', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DEAD_MARSHES, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay, donInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    expect(afterSelect.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(true);
  });

  // ── Effect 3c: does NOT fire at Shadow-land without Doors of Night ────────────

  test('does not fire at Shadow-land (Dagorlad) site when Doors of Night is NOT in play', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DEAD_MARSHES, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    expect(afterSelect.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(false);
    expect((afterSelect.phaseState as SitePhaseState).step).toBe('enter-or-skip');
  });

  // ── Effect 3d: does NOT fire at non-dark/shadow sites ────────────────────────

  test('does not fire at Moria (Redhorn Gate is wilderness, not dark or shadow)', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [CARN_DUM],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    expect(afterSelect.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(false);
    expect((afterSelect.phaseState as SitePhaseState).step).toBe('enter-or-skip');
  });

  // ── Effect 3e: no untapped characters → only pass available ──────────────────

  test('when all characters are already tapped only pass is offered', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: GORBAG, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    expect(afterSelect.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(true);

    const actions = computeLegalActions(afterSelect, PLAYER_1);
    const viableTypes = actions.filter(a => a.viable).map(a => a.action.type);
    expect(viableTypes.filter(t => t === 'tap-character-by-effect')).toHaveLength(0);
    expect(viableTypes).toContain('pass');
  });

  test('passing with no untapped characters clears the pending and advances to enter-or-skip', () => {
    const stenchInPlay: CardInPlay = {
      instanceId: 'stench-1' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: GORBAG, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [stenchInPlay],
        },
      ],
    });

    const withSelectCompany = { ...state, phaseState: makeSelectCompanyPhase() };
    const companyId = withSelectCompany.players[RESOURCE_PLAYER].companies[0].id;
    const afterSelect = dispatch(withSelectCompany, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });
    const afterPass = dispatch(afterSelect, { type: 'pass', player: PLAYER_1 });

    expect(afterPass.pendingResolutions.some(r => r.kind.type === 'tap-one-character')).toBe(false);
    expect((afterPass.phaseState as SitePhaseState).step).toBe('enter-or-skip');
  });

  // ── Effect 2: discard when any play deck is exhausted ────────────────────────

  test('discards when the resource player completes deck exhaustion', () => {
    // Set up EOT reset-hand step with PLAYER_1's deck empty (triggers exhaust)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }],
          hand: [],
          siteDeck: [BARAD_DUR],
          playDeck: [],
          discardPile: [SHAGRAT],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    // Add Stench of Mordor to PLAYER_2's cardsInPlay
    const withStench = addCardInPlay(resetHandState, HAZARD_PLAYER, STENCH_OF_MORDOR);

    const afterExhaust = dispatch(withStench, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].deckExhaustPending).toBe(true);
    // Card still in play before completion
    expect(afterExhaust.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === STENCH_OF_MORDOR,
    )).toBe(true);

    const afterComplete = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });

    // Card must be discarded after exhaustion completes
    expect(afterComplete.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === STENCH_OF_MORDOR,
    )).toBe(false);
    expect(afterComplete.players[HAZARD_PLAYER].discardPile.some(
      c => c.definitionId === STENCH_OF_MORDOR,
    )).toBe(true);
  });

  // ── Effect 1: cannot be duplicated globally ───────────────────────────────────

  test('cannot be duplicated — a second copy cannot be played when one is already in play', () => {
    const existingStench: CardInPlay = {
      instanceId: 'stench-existing' as CardInstanceId,
      definitionId: STENCH_OF_MORDOR,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [STENCH_OF_MORDOR],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [existingStench],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_2);
    const hazardPlays = actions.filter(a => a.viable && a.action.type === 'play-hazard');
    expect(hazardPlays).toHaveLength(0);
  });
});
