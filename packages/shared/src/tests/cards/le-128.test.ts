/**
 * @module le-128.test
 *
 * Card test: Nothing to Eat or Drink (le-128)
 * Type: hazard-event (permanent, company-targeting)
 * Text:
 *   "Playable on a minion company at or moving to a Free-hold [{F}] or
 *    Border-hold [{B}], or playable on a hero company at or moving to a
 *    Shadow-hold [{S}] or Dark-hold [{D}]. The prowess and body of each
 *    character in the company is modified by -1. Discard this card during
 *    its organization phase if the company is at a Haven/Darkhaven [{H}].
 *    Cannot be duplicated on a given company."
 *
 * Effects:
 * | # | Effect                                              | Status | Notes                                        |
 * |---|-----------------------------------------------------|--------|----------------------------------------------|
 * | 1 | play-target: company filter (alignment+siteType)    | OK     | company-targeting filter in movement-hazard  |
 * | 2 | company-modifier: prowess -1                        | OK     | collectCompanyPermanentEventEffects resolver |
 * | 3 | company-modifier: body -1                           | OK     | collectCompanyPermanentEventEffects resolver |
 * | 4 | on-event: organization-phase-begins discard at haven| OK     | sweep in advanceToOrganization (reducer-untap)|
 * | 5 | duplication-limit: scope=company max=1              | OK     | company-dup check in movement-hazard         |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, getCharacter,
  companyIdAt, makeMHState,
  P1_COMPANY,
  baseProwess,
  runActions,
  Alignment, CardStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const NOTHING_TO_EAT = 'le-128' as CardDefinitionId;

// Minion fixtures
const GORBAG = 'le-11' as CardDefinitionId;        // minion-character, orc, prowess 6, body 9
const ASTERNAK = 'le-1' as CardDefinitionId;       // minion-character, man, prowess 5, body 7

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;       // minion-site, haven
const BAG_END_MINION = 'le-350' as CardDefinitionId;   // minion-site, free-hold
const DALE_MINION = 'le-363' as CardDefinitionId;      // minion-site, border-hold
const MORIA_MINION = 'le-392' as CardDefinitionId;     // minion-site, shadow-hold (wrong type for minion)

// Hero sites
// MORIA (tw-413) is shadow-hold hero-site — valid for hero company
// RIVENDELL is haven — for hero company at haven tests

describe('Nothing to Eat or Drink (le-128)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: minion company at free-hold ─────────────────────────

  test('playable against minion company at a free-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCompanyId?: unknown }).targetCompanyId).toBe(
      companyIdAt(readyState, RESOURCE_PLAYER),
    );
  });

  test('playable against minion company at a border-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DALE_MINION, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable against minion company at a shadow-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ── Play restriction: hero company at shadow-hold ─────────────────────────

  test('playable against hero company at a shadow-hold (Moria)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
  });

  test('not playable against hero company at a free-hold (Rivendell)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ── Effect: -1 prowess and -1 body to all company members ─────────────────

  test('-1 prowess applied to all characters in the targeted company', () => {
    const nteInPlay: CardInPlay = {
      instanceId: 'nte-1' as CardInstanceId,
      definitionId: NOTHING_TO_EAT,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG, ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [nteInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    }));

    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.prowess).toBe(baseProwess(GORBAG) - 1);
    expect(getCharacter(state, RESOURCE_PLAYER, ASTERNAK).effectiveStats.prowess).toBe(baseProwess(ASTERNAK) - 1);

    // Character in a different company is unaffected
    expect(getCharacter(state, HAZARD_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess(ARAGORN));
  });

  test('-1 body applied to all characters in the targeted company', () => {
    const nteInPlay: CardInPlay = {
      instanceId: 'nte-1' as CardInstanceId,
      definitionId: NOTHING_TO_EAT,
      status: CardStatus.Untapped,
      companyId: P1_COMPANY,
    };

    const state = recomputeDerived(buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG, ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
          cardsInPlay: [nteInPlay],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    }));

    const gorbagBody = (state.cardPool[GORBAG as string] as { body: number }).body;
    const asternakBody = (state.cardPool[ASTERNAK as string] as { body: number }).body;

    expect(getCharacter(state, RESOURCE_PLAYER, GORBAG).effectiveStats.body).toBe(gorbagBody - 1);
    expect(getCharacter(state, RESOURCE_PLAYER, ASTERNAK).effectiveStats.body).toBe(asternakBody - 1);
  });

  // ── Auto-discard at haven during organization phase ────────────────────────

  test('discards at start of organization phase when company is at a Haven (Dol Guldur)', () => {
    // Start in Untap phase with the card bound to a company at Dol Guldur (haven).
    // When both players advance to Organization, the card should be discarded.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [BAG_END_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    // Manually add the card to PLAYER_2's cardsInPlay bound to PLAYER_1's company
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const nteInPlay: CardInPlay = {
      instanceId: 'nte-1' as CardInstanceId,
      definitionId: NOTHING_TO_EAT,
      status: CardStatus.Untapped,
      companyId,
    };
    const withCard = {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], cardsInPlay: [nteInPlay] },
      ] as typeof state.players,
    };

    // Advance to Organization: resource player untaps, hazard player passes
    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);

    // Card should be in PLAYER_2's discard pile, not cardsInPlay
    expect(afterOrg.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === NOTHING_TO_EAT,
    )).toBe(false);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(
      c => c.definitionId === NOTHING_TO_EAT,
    )).toBe(true);
  });

  test('not discarded at organization phase when company is NOT at a haven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const nteInPlay: CardInPlay = {
      instanceId: 'nte-1' as CardInstanceId,
      definitionId: NOTHING_TO_EAT,
      status: CardStatus.Untapped,
      companyId,
    };
    const withCard = {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], cardsInPlay: [nteInPlay] },
      ] as typeof state.players,
    };

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    // Card should still be in cardsInPlay (company is at free-hold, not haven)
    expect(afterOrg.players[HAZARD_PLAYER].cardsInPlay.some(
      c => c.definitionId === NOTHING_TO_EAT,
    )).toBe(true);
  });

  // ── Duplication limit: one copy per company ────────────────────────────────

  test('cannot be duplicated on the same company', () => {
    const companyId = P1_COMPANY;
    const existingCopy: CardInPlay = {
      instanceId: 'nte-existing' as CardInstanceId,
      definitionId: NOTHING_TO_EAT,
      status: CardStatus.Untapped,
      companyId,
    };

    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [NOTHING_TO_EAT],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [existingCopy],
        },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const actions = viableActions(readyState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
