/**
 * @module td-16.test
 *
 * Card test: Dragon's Curse (td-16)
 * Type: hazard-event (permanent)
 * Effects: 3 partial of 7 rules — see Engine Support table below.
 *
 * "Corruption. Dark enchantment. Playable on a non-Wizard character
 *  facing a strike from a Dragon hazard creature attack. The strike's
 *  prowess is modified by -1. The character receives 2 corruption
 *  points. The target character makes a corruption check at the end of
 *  his untap phase. Cannot be duplicated on a given character. During
 *  his organization phase, a sage in the target character's company may
 *  tap to attempt to remove this card. Make a roll: if this result is
 *  greater than 6, discard this card."
 *
 * Engine Support:
 * | # | Rule                                       | Status          | Notes                                   |
 * |---|--------------------------------------------|-----------------|-----------------------------------------|
 * | 1 | Playable only during a Dragon creature     | NOT IMPLEMENTED | Combat-time play-restriction on a       |
 * |   | attack, on a character facing the strike   |                 | permanent event is not modelled         |
 * |   | (non-Wizard)                               |                 | (Rule 8.02 pre-assignment is todo).     |
 * | 2 | That strike's prowess is modified by -1    | NOT IMPLEMENTED | No strike modification from a           |
 * |   |                                            |                 | permanent event's play-time context.    |
 * | 3 | +2 corruption points while attached        | IMPLEMENTED     | stat-modifier corruption-points +2.     |
 * | 4 | Corruption check at end of untap phase     | IMPLEMENTED     | on-event untap-phase-end enqueues a     |
 * |   | (any site — no haven gate)                 |                 | corruption-check pending resolution.    |
 * | 5 | Cannot be duplicated on a given character  | ENGINE READY    | duplication-limit scope:character max:1 |
 * |   |                                            |                 | is honoured by play-hazard legal-action |
 * |   |                                            |                 | once rule 1 is implementable.           |
 * | 6 | During organization, a sage in the target  | NOT IMPLEMENTED | remove-self-on-roll grant-action only   |
 * |   | character's company may tap to attempt to  |                 | supports cost:tap bearer/self; there is |
 * |   | remove; roll > 6 discards                  |                 | no sage-in-company tap variant.         |
 * | 7 | Keywords: corruption, dark-enchantment     | DATA            | Present in keywords[].                  |
 *
 * Playable: PARTIALLY — rules 1, 2, 6 are unimplemented.
 *
 * NOT CERTIFIED. This test exercises only the partial behaviour that
 * does work when the card is attached to a character via a test helper:
 * the +2 corruption stat modifier and the unconditional
 * untap-phase-end corruption check. A future PR that lands combat-time
 * permanent-event play, the companion strike-prowess modifier, and a
 * sage-tap grant-action variant should extend this file with tests for
 * rules 1, 2, and 6 and set the `certified` field on the card data.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, dispatch, viableFor, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const DRAGONS_CURSE = 'td-16' as CardDefinitionId;

describe("Dragon's Curse (td-16)", () => {
  beforeEach(() => resetMint());

  test('attached Dragon\'s Curse adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    const withCurse = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE));
    expect(withCurse.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(2);
  });

  test('untap → org transition enqueues a corruption check regardless of site (non-haven)', () => {
    // Unlike Lure of the Senses (which is haven-gated), Dragon's Curse
    // fires the untap-end corruption check at any site.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const afterUntap = dispatch(withCurse, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe("Dragon's Curse");

    const aragornId = charIdAt(afterPass, RESOURCE_PLAYER);
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Legal actions for P1 should collapse to the corruption-check resolution
    const viable = viableFor(afterPass, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');

    const cc = viable[0].action as CorruptionCheckAction;
    // Aragorn base corruptionPoints 0 + 2 from curse = 2; Aragorn's corruptionModifier is 0
    expect(cc.corruptionPoints).toBe(2);
    expect(cc.corruptionModifier).toBe(0);
  });

  test('untap → org transition at a haven still fires the corruption check', () => {
    // Gate-less trigger: a haven should not suppress the check either.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const afterUntap = dispatch(withCurse, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });
});
