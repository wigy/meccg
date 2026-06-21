/**
 * MEWH §3 — Wizardhavens.
 *
 * Source: The White Hand Insert, "Using MEWH / Wizardhavens".
 *
 * "When rules and non-site cards refer to Havens and Darkhavens, they apply
 * instead to your Wizardhavens. The special effects of METW Havens (i.e.
 * healing, bringing characters into play, etc.) now apply to your companies at
 * your Wizardhavens. These same effects do not apply to your companies at MELE
 * Darkhavens and METW Havens."
 *
 * Healing during the untap phase is the canonical haven-only effect, so these
 * tests exercise it: a Fallen-wizard heals at his own Wizardhaven (Isengard)
 * but not at a METW Haven (Rivendell), while a Wizard still heals at Rivendell.
 */
import { describe, test, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import {
  buildTestState, resetMint, dispatch, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';

const ISENGARD = 'wh-56' as CardDefinitionId; // fallen-wizard Wizardhaven (siteType: haven)

describe('MEWH §3 — Wizardhavens', () => {
  beforeEach(() => resetMint());

  test('a Fallen-wizard heals a wounded character at his Wizardhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    // Wizardhaven heals the wounded (inverted) character to tapped.
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('a Fallen-wizard does NOT heal at a METW Haven (not his Wizardhaven)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    // Rivendell is a METW Haven, not a Wizardhaven — no healing; stays wounded.
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
  });

  test('a Wizard still heals at a METW Haven (no regression)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });
    expectCharStatus(nextState, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });
});
