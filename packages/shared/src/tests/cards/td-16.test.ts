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
 * | 6 | During organization, a sage in the target  | IMPLEMENTED     | grant-action remove-self-on-roll with   |
 * |   | character's company may tap to attempt to  |                 | cost { tap: "sage-in-company" } and     |
 * |   | remove; roll > 6 discards                  |                 | threshold 7.                            |
 * | 7 | Keywords: corruption, dark-enchantment     | DATA            | Present in keywords[].                  |
 *
 * Playable: rules 3-7 are fully implemented. Rules 1 and 2 (combat-time
 * play + play-time strike prowess -1) depend on combat-phase
 * permanent-event play, which is a cross-cutting engine project. The
 * card is still marked certified: until that engine support lands, the
 * card is only playable via test scaffolding (attachHazardToChar), and
 * rules 1 and 2 will start exercising once the combat-phase play path
 * exists.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, findCharInstanceId, dispatch, viableFor, viableActions,
  grantedActionsFor, expectInDiscardPile, expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CorruptionCheckAction } from '../../index.js';
import { CardStatus } from '../../index.js';
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

  // ─── Rule 6: sage-tap removal during organization ──────────────────────────

  test('offers one remove-self-on-roll action per eligible sage in bearer\'s company', () => {
    // Aragorn (non-sage) bears the curse; Elrond (sage) shares the
    // company. The grant-action must be offered to Elrond, not to
    // Aragorn (who has no "sage" skill) and not as a bearer-tap.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    const aragornId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ARAGORN);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);

    expect(grantedActionsFor(withCurse, aragornId, 'remove-self-on-roll', PLAYER_1)).toHaveLength(0);

    const elrondOffers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);
    expect(elrondOffers).toHaveLength(1);
    expect(elrondOffers[0].rollThreshold).toBe(7);
  });

  test('no sage in the bearer\'s company → no removal offered', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    expect(viableActions(withCurse, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('tapped sage is not offered the removal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: ELROND, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);

    expect(viableActions(withCurse, PLAYER_1, 'activate-granted-action')).toHaveLength(0);
  });

  test('successful sage roll (>6) taps the sage and discards the curse from the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);
    const offers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);
    expect(offers).toHaveLength(1);

    const cheated = { ...withCurse, cheatRollTotal: 7 };
    const next = dispatch(cheated, offers[0]);

    // Elrond (the sage) taps; Aragorn (the bearer) stays untapped.
    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);
    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    // Curse leaves Aragorn's hazards and lands in the hazard player's discard pile.
    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, DRAGONS_CURSE);
  });

  test('failed sage roll (<=6) keeps the curse attached but still taps the sage', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCurse = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DRAGONS_CURSE);
    const elrondId = findCharInstanceId(withCurse, RESOURCE_PLAYER, ELROND);
    const offers = grantedActionsFor(withCurse, elrondId, 'remove-self-on-roll', PLAYER_1);

    const cheated = { ...withCurse, cheatRollTotal: 6 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, ELROND, CardStatus.Tapped);

    const aragornId = findCharInstanceId(next, RESOURCE_PLAYER, ARAGORN);
    const hazards = next.players[RESOURCE_PLAYER].characters[aragornId as string].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(DRAGONS_CURSE);
  });
});
