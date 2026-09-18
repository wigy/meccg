/**
 * @module dm-102.test
 *
 * Card test: Wound of Long Burden (dm-102)
 * Type: hazard-event (permanent)
 *
 * "Corruption. Playable on a character facing a strike with a prowess of
 *  12 or greater. If the strike is not successful, discard this card.
 *  Otherwise, target character receives 1 corruption point and his body
 *  is lowered by 1. During his organization phase, a character at a
 *  Haven/Darkhaven [{H}] with this card may tap to attempt to remove it.
 *  Make a roll: if this result is greater than 7, discard this card."
 *
 * Engine Support:
 * | # | Rule                                        | Status      | Notes                                    |
 * |---|----------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Playable on a character facing a strike of   | IMPLEMENTED | play-window combat/resolve-strike +        |
 * |   | prowess >= 12                                 |             | play-target character filter on            |
 * |   |                                                |             | attack.prowess ($gte 12).                  |
 * | 2 | If the strike is not successful, discard     | IMPLEMENTED | attach-corruption-on-strike-wound: card     |
 * |   | (no lasting effect)                           |             | discards to hazard player's discard pile   |
 * |   |                                                |             | on play; stays there if the targeted       |
 * |   |                                                |             | strike doesn't wound the character.        |
 * | 3 | Otherwise: 1 corruption point + body -1       | IMPLEMENTED | finalizeCombat splices the card back onto  |
 * |   | while attached                                |             | the wounded target's hazards; stat-modifier|
 * |   |                                                |             | corruption-points +1 / body -1 apply once  |
 * |   |                                                |             | attached.                                  |
 * | 4 | During organization, a character at a        | IMPLEMENTED | grant-action remove-self-on-roll,          |
 * |   | Haven/Darkhaven with this card may tap to    |             | when: bearer.atHaven, cost tap:bearer,     |
 * |   | attempt to remove it; roll > 7 discards      |             | threshold 8 (success on total >= 8).       |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  charIdAt, companyIdAt, findCharInstanceId, dispatch, viableActions,
  grantedActionsFor, expectInDiscardPile, expectCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState, PlayHazardAction } from '../../index.js';
import { CardStatus, Race } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const WOUND_OF_LONG_BURDEN = 'dm-102' as CardDefinitionId;

/**
 * Build a resolve-strike combat state against a single defender, with Wound
 * of Long Burden in the hazard player's hand (unless `cardInHand: false`).
 * `strikeProwess` controls whether the play-target filter (>= 12) offers it.
 */
function makeResolveStrikeState(opts: {
  defender: CardDefinitionId;
  strikeProwess: number;
  cardInHand?: boolean;
}): { state: GameState } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [opts.defender] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.cardInHand === false ? [] : [WOUND_OF_LONG_BURDEN],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const defenderId = findCharInstanceId(base, RESOURCE_PLAYER, opts.defender);
  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: 'synthetic-creature' as CardInstanceId },
    companyId: companyIdAt(base, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: opts.strikeProwess,
    creatureBody: null,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId: defenderId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { state: { ...base, combat } };
}

describe('Wound of Long Burden (dm-102)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: play-target gate on strike prowess >= 12 ──────────────────────

  test('NOT offered when the facing strike\'s prowess is below 12', () => {
    const { state } = makeResolveStrikeState({ defender: ARAGORN, strikeProwess: 11 });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('offered when the facing strike\'s prowess is 12 or greater', () => {
    const { state } = makeResolveStrikeState({ defender: ARAGORN, strikeProwess: 12 });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays.filter(p => p.action.targetCharacterId === aragornId)).toHaveLength(1);
  });

  // ─── Rule 3: attached stat effects ─────────────────────────────────────────

  test('attached Wound of Long Burden adds 1 corruption point and lowers body by 1', () => {
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
    expect(base.players[0].characters[aragornId].effectiveStats.corruptionPoints).toBe(0);
    expect(base.players[0].characters[aragornId].effectiveStats.body).toBe(9);

    const withWound = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN));
    expect(withWound.players[0].characters[aragornId].effectiveStats.corruptionPoints).toBe(1);
    expect(withWound.players[0].characters[aragornId].effectiveStats.body).toBe(8);
  });

  // ─── Rules 1–3: full combat play-through ────────────────────────────────────

  test('if the strike succeeds (wounds), the card attaches with its corruption/body effects', () => {
    const { state } = makeResolveStrikeState({ defender: ARAGORN, strikeProwess: 12 });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    expect(plays).toHaveLength(1);
    const afterPlay = dispatch(state, plays[0].action);

    // The card discards immediately on play (deferred-attach shape) and is
    // marked pending reattachment to Aragorn specifically.
    expectInDiscardPile(afterPlay, HAZARD_PLAYER, WOUND_OF_LONG_BURDEN);
    expect(afterPlay.combat?.pendingCharacterCorruptionAttach?.targetCharacterId).toBe(aragornId);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);

    // Force the strike to wound Aragorn: roll 2 + prowess 6 = 8 < strikeProwess 12.
    const cheatedStrike = { ...afterPlay, cheatRollTotal: 2 };
    const resolveActions = viableActions(cheatedStrike, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true) ?? resolveActions[0];
    const woundedState = dispatch(cheatedStrike, tapAction.action);

    expectCharStatus(woundedState, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expect(woundedState.combat?.phase).toBe('body-check');

    // Body check: force Aragorn to survive well under his body of 9.
    const cheatedBodyCheck = { ...woundedState, cheatRollTotal: 2 };
    const [bodyCheckAction] = viableActions(cheatedBodyCheck, PLAYER_2, 'body-check-roll');
    const finalState = dispatch(cheatedBodyCheck, bodyCheckAction.action);

    expect(finalState.combat).toBeNull();
    // Spliced out of the hazard player's discard pile...
    expect(finalState.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WOUND_OF_LONG_BURDEN)).toBe(false);
    // ...and onto Aragorn's hazards, with its stat effects live.
    const aragorn = finalState.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.hazards.map(h => h.definitionId)).toContain(WOUND_OF_LONG_BURDEN);
    expect(aragorn.effectiveStats.corruptionPoints).toBe(1);
    expect(aragorn.effectiveStats.body).toBe(8);
  });

  test('if the strike is not successful, the card stays discarded with no lasting effect', () => {
    const { state } = makeResolveStrikeState({ defender: ARAGORN, strikeProwess: 12 });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const plays = viableActions(state, PLAYER_2, 'play-hazard') as { action: PlayHazardAction }[];
    const afterPlay = dispatch(state, plays[0].action);

    // Force the strike to fail against Aragorn: roll 11 + prowess 6 = 17 > strikeProwess 12.
    const cheatedStrike = { ...afterPlay, cheatRollTotal: 11 };
    const resolveActions = viableActions(cheatedStrike, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true) ?? resolveActions[0];
    const finalState = dispatch(cheatedStrike, tapAction.action);

    expect(finalState.combat).toBeNull();
    expectInDiscardPile(finalState, HAZARD_PLAYER, WOUND_OF_LONG_BURDEN);
    const aragorn = finalState.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.hazards).toHaveLength(0);
    expect(aragorn.effectiveStats.corruptionPoints).toBe(0);
    expect(aragorn.effectiveStats.body).toBe(9);
  });

  // ─── Rule 4: organization-phase removal at a Haven/Darkhaven ───────────────

  test('the tap-and-roll removal variant is offered only when the bearer is at a Haven/Darkhaven', () => {
    // Every corruption card also gets a no-tap −3 removal variant regardless
    // of location (METD §7 / rule 10.08) — Wound of Long Burden's own
    // `bearer.atHaven` gate only governs the standard tap-and-roll variant.
    const atHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withWoundAtHaven = attachHazardToChar(atHaven, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN);
    const aragornIdHaven = findCharInstanceId(withWoundAtHaven, RESOURCE_PLAYER, ARAGORN);
    const atHavenOffers = grantedActionsFor(withWoundAtHaven, aragornIdHaven, 'remove-self-on-roll', PLAYER_1);
    expect(atHavenOffers.filter(a => !a.noTap)).toHaveLength(1);
    expect(atHavenOffers.filter(a => a.noTap)).toHaveLength(1);

    // Minas Tirith is a free-hold, not a Haven — only the no-tap variant remains.
    const notHaven = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withWoundNotHaven = attachHazardToChar(notHaven, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN);
    const aragornIdNotHaven = findCharInstanceId(withWoundNotHaven, RESOURCE_PLAYER, ARAGORN);
    const notHavenOffers = grantedActionsFor(withWoundNotHaven, aragornIdNotHaven, 'remove-self-on-roll', PLAYER_1);
    expect(notHavenOffers.filter(a => !a.noTap)).toHaveLength(0);
    expect(notHavenOffers.filter(a => a.noTap)).toHaveLength(1);
  });

  test('successful removal roll (>7) taps the bearer and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withWound = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN);
    const aragornId = findCharInstanceId(withWound, RESOURCE_PLAYER, ARAGORN);
    const offers = grantedActionsFor(withWound, aragornId, 'remove-self-on-roll', PLAYER_1).filter(a => !a.noTap);
    expect(offers).toHaveLength(1);

    const cheated = { ...withWound, cheatRollTotal: 8 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(next.players[RESOURCE_PLAYER].characters[aragornId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, WOUND_OF_LONG_BURDEN);
  });

  test('failed removal roll (<=7) keeps the card attached but still taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withWound = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, WOUND_OF_LONG_BURDEN);
    const aragornId = findCharInstanceId(withWound, RESOURCE_PLAYER, ARAGORN);
    const offers = grantedActionsFor(withWound, aragornId, 'remove-self-on-roll', PLAYER_1).filter(a => !a.noTap);

    const cheated = { ...withWound, cheatRollTotal: 7 };
    const next = dispatch(cheated, offers[0]);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    const hazards = next.players[RESOURCE_PLAYER].characters[aragornId].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(WOUND_OF_LONG_BURDEN);
  });
});
