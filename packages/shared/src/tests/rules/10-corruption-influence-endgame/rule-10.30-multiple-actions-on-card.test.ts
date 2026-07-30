/**
 * @module rule-10.30-multiple-actions-on-card
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.30: Multiple Actions on a Card
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a card specifies that multiple separate actions are performed when the card resolves, the actions are considered to have been declared in the reverse order of how they are printed, and thus resolve in the same order as printed.
 * If a card is negated between the declaration of being played and resolving, it is immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus, Phase } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, grantedActionsFor,
  findCharInstanceId, expectCharStatus, makeMHState,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../../test-helpers.js';

// Multiple printed actions are modelled by the DSL as a `sequence` apply whose
// `apps` run in array (= printed) order. Strangling Coils (ba-76) makes the
// order observable from the final board state: "you may untap all tapped
// characters in The Balrog's company. If then untapped, tap The Balrog." is a
// sequence of (1) untap the whole company, (2) tap the bearer. In printed
// order a tapped Balrog is first swept up by the company untap and then
// re-tapped by the second action; in the reverse order he would be tapped
// first and then left *untapped* by the company sweep. The declaration half of
// the rule (reverse print order) has no separate observable: the sequence is
// declared as one atomic action, so only the resolve-in-print-order half can
// be exercised.
const STRANGLING_COILS = 'ba-76' as CardDefinitionId;
const THE_BALROG = 'ba-3' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
const BARAD_DUR_BA = 'ba-84' as CardDefinitionId;

describe('Rule 10.30 — Multiple Actions on a Card', () => {
  beforeEach(() => resetMint());

  test('multiple actions printed on a card resolve in print order', () => {
    // Both The Balrog (bearer of Strangling Coils) and his Orc companion start
    // tapped in the movement/hazard phase.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{
            site: BARAD_DUR_BA,
            characters: [
              { defId: THE_BALROG, status: CardStatus.Tapped, items: [STRANGLING_COILS] },
              { defId: CROOK_LEGGED_ORC, status: CardStatus.Tapped },
            ],
          }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };
    const balrogId = findCharInstanceId(state, RESOURCE_PLAYER, THE_BALROG);

    const [action] = grantedActionsFor(state, balrogId, 'untap-balrog-company', PLAYER_1);
    expect(action).toBeDefined();
    const after = dispatch(state, action);

    // Print order: the company untap (first action) catches the tapped Balrog,
    // then the second action taps him again — so he ends tapped while his
    // companion ends untapped. Reverse resolution order would instead leave
    // The Balrog untapped (tapped first, then swept by the company untap).
    expectCharStatus(after, RESOURCE_PLAYER, CROOK_LEGGED_ORC, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, THE_BALROG, CardStatus.Tapped);
  });
});
