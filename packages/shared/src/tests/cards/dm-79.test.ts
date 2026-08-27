/**
 * @module dm-79.test
 *
 * Card test: Pierced by Many Wounds (dm-79)
 * Type: hazard-event (short)
 *
 * "Playable on an attack with more strikes than defending characters
 *  before strikes are assigned; does not count against the hazard
 *  limit. The first excess strike assigned to each character gives a
 *  -4 modification to his prowess instead of -1. Cannot be duplicated
 *  on a given attack."
 *
 * Engine support: only the play-window gate is certified so far — the
 * card requires an actual attack (combat) to exist and is therefore
 * pinned out of the movement-hazard phase's plain hazard menu, which
 * runs before any creature attack exists. The excess-strike prowess
 * modifier itself is not yet implemented.
 *
 * Regression: game mtasepv8-2pzfv3 seq 850. The card was offered as
 * playable during movement-hazard phase on a company that faced no
 * creature attack at all — it had no `play-window` gate, so the
 * generic "unimplemented short event" fallback marked it unconditionally
 * playable regardless of combat state.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId } from '../../index.js';
import {
  buildTestState, resetMint, viableActions, makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
} from '../test-helpers.js';

const PIERCED_BY_MANY_WOUNDS = 'dm-79' as CardDefinitionId;

describe('dm-79: Pierced by Many Wounds', () => {
  beforeEach(() => resetMint());

  test('NOT offered during movement-hazard phase when the company faces no creature attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PIERCED_BY_MANY_WOUNDS], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeMHState() };

    expect(state.combat).toBeNull();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });
});
