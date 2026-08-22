/**
 * @module ba-26.test
 *
 * Card test: Unabated in Malice (ba-26)
 * Type: hazard-event (short), non-unique
 *
 * Card text:
 *   "Playable on an automatic-attack or an attack from Shelob; does not
 *    count against the hazard limit. The attack receives +1 strike, +1
 *    prowess, and -2 body. The first attempt to cancel this attack instead
 *    cancels the effects of this card. Cannot be duplicated on a given
 *    attack."
 *
 * Effects:
 *   1. play-flag: no-hazard-limit — the buff never consumes a hazard slot
 *      (combat modify-attack plays are outside the M/H hazard-limit path).
 *   2. modify-attack (fromHand, player "attacker") — +1 strike, +1 prowess,
 *      -2 body; gated `when` = attack is automatic OR the attacker is Shelob;
 *      `firstCancelRemovesEffect: true` grants cancel protection.
 *   3. duplication-limit — scope "attack", max 1.
 *
 * Engine support:
 * | # | Rule                                               | Status      | Notes                                           |
 * |---|----------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Playable on an automatic-attack                    | IMPLEMENTED | `attack.automatic` in from-hand `when` context  |
 * | 2 | Playable on an attack from Shelob                  | IMPLEMENTED | `enemy.name === "Shelob"` in `when` context     |
 * | 3 | Not playable on an ordinary creature attack        | IMPLEMENTED | `when` fails → action suppressed                |
 * | 4 | Attacker-only (defender cannot play)               | IMPLEMENTED | `player: "attacker"` gate                       |
 * | 5 | +1 strike / +1 prowess / -2 body                   | IMPLEMENTED | from-hand `strikesModifier`/prowess/body        |
 * | 6 | Does not count against the hazard limit            | IMPLEMENTED | combat modify-attack bypasses the limit path    |
 * | 7 | First cancel strips the buff, attack continues     | IMPLEMENTED | `cancelProtection` + `resolveCancelAttackEntry` |
 * | 8 | A later cancel then ends the attack normally       | IMPLEMENTED | protection consumed after the first attempt     |
 * | 9 | Cannot be duplicated on a given attack             | IMPLEMENTED | `duplication-limit` scope `attack`              |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  viableActions, dispatch, nonViableOfType,
  makeCancelWindowCombat, makeMHState, placeOnGuard,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  ORC_PATROL,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, Race, computeLegalActions, RegionType, SiteType } from '../../index.js';
import { resolveCancelAttackEntry } from '../../engine/combat-cancel.js';
import type { CardDefinitionId, GameState, ModifyAttackAction } from '../../index.js';

const UNABATED_IN_MALICE = 'ba-26' as CardDefinitionId;
const SHELOB = 'tw-86' as CardDefinitionId; // unique Spider, race "spider"

/** Base two-Wizard state with the hazard player (PLAYER_2) holding the given hand. */
function baseWithHazardHand(hand: CardDefinitionId[], resourceHand: CardDefinitionId[] = []): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: resourceHand,
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand,
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Unabated in Malice (ba-26)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate ───────────────────────────────────────────────────

  test('attacker can play it on a site automatic-attack', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as ModifyAttackAction;
    expect(act.player).toBe(PLAYER_2);
    expect(act.cardInstanceId).toBe(combat.players[HAZARD_PLAYER].hand[0].instanceId);
  });

  test('attacker can reveal it from on-guard on a site automatic-attack', () => {
    // Regression (game mrahfk9s-eaeybx, seq 76): the hazard player placed
    // Unabated in Malice on-guard, but was never offered any chance to reveal
    // it when the company faced the site's automatic-attack. An on-guard hazard
    // event that affects the automatic-attack must be revealable on it
    // (rule 2.V.i), reusing the same from-hand modify-attack machinery.
    const base = baseWithHazardHand([]); // ba-26 not in hand — it is on-guard
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });
    // Hazard player (PLAYER_2, the attacker) placed ba-26 on-guard on the
    // defending (PLAYER_1) company during the M/H phase.
    const { state: placed, ogCard } = placeOnGuard(combat0, RESOURCE_PLAYER, 0, UNABATED_IN_MALICE);
    const combat: GameState = { ...placed, combat: { ...placed.combat!, creatureBody: 9 } };

    // The attacker is offered the on-guard card as a modify-attack (reveal).
    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ModifyAttackAction).cardInstanceId).toBe(ogCard.instanceId);

    // The defender is NOT offered it (attacker-only, and on-guard is the
    // hazard player's card).
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);

    // Revealing it applies +1 strike, +1 prowess, -2 body, removes it from the
    // on-guard zone, and discards it to the attacker's pile.
    const after = dispatch(combat, actions[0].action);
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(13);
    expect(after.combat!.creatureBody).toBe(7);
    expect(after.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
    expect(
      after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === UNABATED_IN_MALICE),
    ).toBe(true);
    expect(after.combat!.cancelProtection).toBeDefined();
  });

  test('NOT playable as an open hazard during the movement/hazard phase', () => {
    // Regression (game mruvf51s-a9ge5j, seq 227): the hazard player played
    // Unabated in Malice openly as a short-event during a company's
    // movement/hazard phase while it was moving to Glittering Caves (a
    // Ruins & Lairs with a Pûkel-creature automatic-attack). The card resolved
    // to a no-op — its +1 strike / +1 prowess / -2 body buff was silently
    // dropped and never reached the automatic-attack, which stayed at its base
    // 1 strike / 9 prowess. A from-hand modify-attack is a combat modifier with
    // no open M/H play: during M/H there is no active attack to modify. It must
    // be played on the active attack (via the combat modify-attack action) or
    // placed on-guard to be revealed when the company faces the site's
    // automatic-attack (rule 2.V.i). The open play must therefore be suppressed.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [UNABATED_IN_MALICE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness],
        destinationSiteType: SiteType.RuinsAndLairs,
      }),
    };
    const ba26Inst = state.players[HAZARD_PLAYER].hand[0].instanceId;

    // No viable open play-hazard is offered for Unabated in Malice.
    const viable = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ba26Inst);
    expect(viable).toHaveLength(0);

    // It is explicitly gated non-viable (not merely absent from the list),
    // so the UI can explain why the open play is unavailable.
    const gated = nonViableOfType(computeLegalActions(state, PLAYER_2), 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === ba26Inst);
    expect(gated).toHaveLength(1);
  });

  test('attacker can play it on an attack from Shelob', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      creatureDefId: SHELOB,
      creatureRace: Race.Spider,
      attackSourceType: 'creature',
      strikesTotal: 1,
      strikeProwess: 18,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
  });

  test('attacker can play it on an on-guard-revealed Shelob attack (enemy.name gate)', () => {
    // Regression: buildPlayedModifyAttackContext resolved enemy.name only for
    // an in-play `creature` source, so a played modify-attack gated on
    // `enemy.name === "Shelob"` was never offered when Shelob attacked from
    // on-guard (attackSource type on-guard-creature). ba-26's `enemy.name`
    // branch of the `$or` gate must fire for an on-guard Shelob just as it
    // does for an in-play one.
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    // Place Shelob on-guard on the defending (PLAYER_1) company so its
    // instance resolves to the Shelob definition, then key the active attack
    // to that on-guard creature.
    const { state: placed, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, SHELOB, { revealed: true });
    const combat0 = makeCancelWindowCombat(placed, {
      creatureDefId: SHELOB,
      creatureRace: Race.Spider,
      attackSourceType: 'on-guard-creature',
      strikesTotal: 1,
      strikeProwess: 18,
    });
    const combat: GameState = {
      ...combat0,
      combat: { ...combat0.combat!, attackSource: { type: 'on-guard-creature', cardInstanceId: ogCard.instanceId } },
    };

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ModifyAttackAction).cardInstanceId).toBe(combat.players[HAZARD_PLAYER].hand[0].instanceId);
  });

  test('NOT playable on an ordinary creature attack (not automatic, not Shelob)', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: Race.Orc,
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });

    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('defender cannot play it (attacker-only effect)', () => {
    // ba-26 in the RESOURCE (defending) player's hand.
    const base = baseWithHazardHand([], [UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });

    const actions = viableActions(combat, PLAYER_1, 'modify-attack');
    expect(actions).toHaveLength(0);
  });

  test('does not count against the hazard limit (offered even at cap)', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });
    const atCap: GameState = {
      ...combat,
      phaseState: {
        ...(combat.phaseState as import('../../index.js').MovementHazardPhaseState),
        hazardsPlayedThisCompany: 5,
        hazardLimitAtReveal: 2,
      },
    };
    const actions = viableActions(atCap, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
  });

  // ─── The buff: +1 strike, +1 prowess, -2 body ───────────────────────────

  test('playing it adds +1 strike, +1 prowess, -2 body and discards the card', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });
    // Give the attack a body value so the -2 body modifier is observable.
    const combat: GameState = { ...combat0, combat: { ...combat0.combat!, creatureBody: 9 } };

    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);   // 1 + 1
    expect(after.combat!.strikeProwess).toBe(13);  // 12 + 1
    expect(after.combat!.creatureBody).toBe(7);    // 9 - 2
    expect(after.combat!.phase).toBe('assign-strikes');

    // Card moved from hand to hazard player's discard pile.
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(
      after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === UNABATED_IN_MALICE),
    ).toBe(true);

    // Cancel protection is now armed.
    expect(after.combat!.cancelProtection).toBeDefined();
    expect(after.combat!.cancelProtection!.strikesModifier).toBe(1);
    expect(after.combat!.cancelProtection!.prowessModifier).toBe(1);
    expect(after.combat!.cancelProtection!.bodyModifier).toBe(-2);
  });

  // ─── Duplication limit (scope: attack) ──────────────────────────────────

  test('cannot be duplicated on a given attack', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE, UNABATED_IN_MALICE]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });

    // Both copies offered before either is played.
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(2);

    const first = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, first);

    // After one copy is played, the second copy is suppressed (attack-scoped
    // duplication limit reached).
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(1);
    expect(viableActions(after, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  // ─── Cancel protection ──────────────────────────────────────────────────

  test('first attempt to cancel strips the buff and leaves the attack in play; a later cancel ends it', () => {
    const base = baseWithHazardHand([UNABATED_IN_MALICE]);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });
    const combat: GameState = { ...combat0, combat: { ...combat0.combat!, creatureBody: 9 } };

    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const buffed = dispatch(combat, action);
    expect(buffed.combat!.strikesTotal).toBe(2);
    expect(buffed.combat!.strikeProwess).toBe(13);
    expect(buffed.combat!.creatureBody).toBe(7);

    // First cancellation: redirected to strip this card's effects. The attack
    // reverts to its original values and remains in play.
    const afterFirst = resolveCancelAttackEntry(buffed);
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.strikesTotal).toBe(1);
    expect(afterFirst.combat!.strikeProwess).toBe(12);
    expect(afterFirst.combat!.creatureBody).toBe(9);
    expect(afterFirst.combat!.cancelProtection).toBeUndefined();

    // Second cancellation: protection is spent, so the attack is cancelled.
    const afterSecond = resolveCancelAttackEntry(afterFirst);
    expect(afterSecond.combat).toBeNull();
  });

  test('an unprotected (unbuffed) automatic-attack is cancelled by the first cancel', () => {
    // Control: without the ba-26 buff there is no cancel protection, so the
    // first cancellation ends the attack immediately.
    const base = baseWithHazardHand([]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 12,
    });
    expect(combat.combat!.cancelProtection).toBeUndefined();

    const afterCancel = resolveCancelAttackEntry(combat);
    expect(afterCancel.combat).toBeNull();
  });
});
