/**
 * @module ba-42.test
 *
 * Card test: Prone to Violence (ba-42)
 * Type: minion-resource-event (permanent)
 *
 * "Any minion company without a Ringwraith may attack another minion company
 *  without a Ringwraith. The attacking company may contain The Balrog. Discard
 *  when any play deck is exhausted. Cannot be duplicated."
 *
 * Effects tested:
 * 1. cvcc-attack-permission: while in play, a minion (Ringwraith/Balrog)
 *    company without a Ringwraith may declare a CvCC attack against another
 *    minion company without a Ringwraith — an attack the default alignment
 *    matrix (CoE 8.41) forbids. The permission is gated so that a company
 *    containing a Ringwraith (attacker or defender) is still barred, and a
 *    Balrog company (which the "may contain The Balrog" clause allows) qualifies.
 *    The declared attack initiates a real CvCC combat.
 * 2. on-event play-deck-exhausted: the card moves to the discard pile when a
 *    play deck exhaust completes.
 * 3. duplication-limit scope:game max:1: cannot be played while a copy is
 *    already in cardsInPlay.
 *
 * Without the permanent-event in play, none of these minion-vs-minion attacks
 * are legal — the baseline is asserted so the test proves the engine reacts to
 * the card, not to the fixtures.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  addCardInPlay,
  dispatch, viableActions,
  RESOURCE_PLAYER,
  expectInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, CompanyId, SitePhaseState, EndOfTurnPhaseState, Alignment } from '../../index.js';
import { computeLegalActions } from '../../index.js';

const PRONE_TO_VIOLENCE = 'ba-42' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId; // Man, minion — no Ringwraith
const ASTERNAK = 'le-1' as CardDefinitionId; // Man, minion — no Ringwraith
const BURAT = 'as-1' as CardDefinitionId; // Troll, minion — for a Balrog company
const UVATHA = 'le-57' as CardDefinitionId; // Ûvatha the Ringwraith (race: ringwraith)
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const CARN_DUM_MINION = 'le-359' as CardDefinitionId;

const SITE_PHASE_STATE: SitePhaseState = {
  phase: Phase.Site,
  step: 'play-resources',
  activeCompanyIndex: 0,
  handledCompanyIds: [],
  siteEntered: true,
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

describe('Prone to Violence (ba-42)', () => {
  beforeEach(() => resetMint());

  // --- 1. cvcc-attack-permission --------------------------------------------

  test('baseline: a Ringwraith company cannot attack another Ringwraith company', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
  });

  test('with Prone to Violence in play, a Ringwraith company (no Ringwraith) may attack another Ringwraith company (no Ringwraith)', () => {
    const base = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const state = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(1);
  });

  test('declaring the attack initiates a real CvCC combat', () => {
    const base = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const state = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const declareActions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(declareActions).toHaveLength(1);

    const targetCompanyId = (declareActions[0].action as { targetCompanyId: CompanyId }).targetCompanyId;
    const attackingCompanyId = state.players[0].companies[0].id;
    const afterDeclare = dispatch(afterPass, {
      type: 'declare-company-attack', player: PLAYER_1, attackingCompanyId, targetCompanyId,
    });

    expect(afterDeclare.combat).not.toBeNull();
    expect(afterDeclare.combat?.isCvCC).toBe(true);
    expect(afterDeclare.combat?.strikesTotal).toBe(1); // one strike per attacking character
  });

  test('a company containing a Ringwraith cannot be the attacker', () => {
    const base = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN, UVATHA] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const state = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
  });

  test('a company containing a Ringwraith cannot be the defender', () => {
    const base = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK, UVATHA] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const state = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
  });

  test('the attacking company may be a Balrog company', () => {
    const base = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: 'balrog' as Alignment, companies: [{ site: DOL_GULDUR, characters: [BURAT] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    // Sanity: without the card a Balrog company cannot attack a Ringwraith company.
    const afterPassNoCard = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPassNoCard, PLAYER_1, 'declare-company-attack')).toHaveLength(0);

    const state = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(1);
  });

  // --- 2. play-deck-exhausted -----------------------------------------------

  test('card discards when a play deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION], playDeck: [], discardPile: [ASTERNAK] },
        { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
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
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PRONE_TO_VIOLENCE)).toBe(true);

    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    expectInPile(afterPass, RESOURCE_PLAYER, 'playDeck', PRONE_TO_VIOLENCE);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PRONE_TO_VIOLENCE)).toBe(false);
  });

  // --- 3. duplication-limit -------------------------------------------------

  test('cannot be duplicated — not playable when a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: 'ringwraith' as Alignment, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [PRONE_TO_VIOLENCE], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, alignment: 'ringwraith' as Alignment, companies: [{ site: MINAS_MORGUL, characters: [ASTERNAK] }], hand: [], siteDeck: [CARN_DUM_MINION] },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, PRONE_TO_VIOLENCE);

    const playActions = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.action.type === 'play-permanent-event');
    expect(playActions.every(a => !a.viable)).toBe(true);
  });
});
