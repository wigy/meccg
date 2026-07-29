/**
 * @module rule-10.13-influence-success-play
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.13: Playing Card After Successful Influence
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If an influence attempt is successful after an identical card was revealed from the resource player's hand, that player may immediately play the identical card with the influencing character (without tapping the site and without another influence check required) if there are no other restrictions that would prohibit the play of the card. If the identical card is a character, it can only be played under general or direct influence with enough available influence to control the character, but playability restrictions on the character card itself are not applied (i.e. a Hobbit may be played in this way). If an influence attempt fails after an identical card was revealed, the identical card is discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildResolutionState, resetMint, viableActions, defendInfluence, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, ELROND, LEGOLAS, GIMLI, BILBO, DAGGER_OF_WESTERNESSE,
  CardStatus,
} from '../../test-helpers.js';
import { reduce } from '../../../engine/reducer.js';
import type { GameState } from '../../../types/state.js';
import type { CardInstanceId } from '../../../types/common.js';
import type { OpponentInfluenceAttemptAction, PlayRevealedCardAction } from '../../../types/actions.js';

/**
 * Declare the reveal variant of an opponent-influence attempt against
 * `targetInstanceId` and resolve it, forcing the attacker's roll to
 * `attackerRoll` and the defender's to `defenderRoll`. Rule 10.11's reveal is
 * a separate offered action from the plain attempt, so it is selected by the
 * presence of `revealedCardInstanceId` rather than by `attemptInfluence`, which
 * deliberately picks the non-reveal variant.
 */
function influenceRevealing(
  state: GameState,
  targetInstanceId: CardInstanceId,
  attackerRoll: number,
  defenderRoll: number,
): GameState {
  const offers = viableActions(state, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
  const reveal = offers.find(a =>
    a.action.targetInstanceId === targetInstanceId && a.action.revealedCardInstanceId !== undefined);
  expect(reveal).toBeDefined();
  const declared = reduce({ ...state, cheatRollTotal: attackerRoll }, reveal!.action);
  expect(declared.error).toBeUndefined();
  return defendInfluence({ ...declared.state, cheatRollTotal: defenderRoll }).state;
}

describe('Rule 10.13 — Playing Card After Successful Influence', () => {
  beforeEach(() => resetMint());

  test('a successful item attempt offers the revealed item, which enters play on the influencer', () => {
    // Legolas bears a Dagger of Westernesse; Aragorn holds an identical one,
    // whose reveal rule 10.11 makes mandatory to target an item at all. On
    // success the opponent's dagger is discarded and Aragorn is offered the
    // immediate play of his own.
    const base = buildResolutionState({
      p1Hand: [DAGGER_OF_WESTERNESSE],
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }, GIMLI, BILBO],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(base, HAZARD_PLAYER, LEGOLAS);
    const targetDagger = base.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;
    const revealedDagger = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const prowessBefore = base.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess;

    const resolved = influenceRevealing(base, targetDagger, 12, 2);
    // The attempt succeeded: the influenced dagger left play.
    expect(base.players[HAZARD_PLAYER].characters[legolasId].items).toHaveLength(1);
    expect(resolved.players[HAZARD_PLAYER].characters[legolasId].items).toHaveLength(0);
    // The revealed card came back to hand and the offer is queued on it.
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedDagger)).toBe(true);
    const offer = resolved.pendingResolutions.find(r => r.kind.type === 'influence-reveal-play-offer');
    expect(offer).toBeDefined();
    expect(offer!.actor).toBe(PLAYER_1);

    // One play action (an item needs no controller) plus the decline.
    const offered = viableActions(resolved, PLAYER_1, 'play-revealed-card') as { action: PlayRevealedCardAction }[];
    expect(offered).toHaveLength(1);
    expect(offered[0].action.cardInstanceId).toBe(revealedDagger);
    expect(viableActions(resolved, PLAYER_1, 'pass')).toHaveLength(1);

    const played = reduce(resolved, offered[0].action);
    expect(played.error).toBeUndefined();
    const aragorn = played.state.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.items.map(i => i.instanceId)).toContain(revealedDagger);
    expect(played.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedDagger)).toBe(false);
    // The item is genuinely in play, not just parked: its +1 prowess applies.
    expect(aragorn.effectiveStats.prowess).toBe(prowessBefore + 1);
    expect(played.state.pendingResolutions.some(r => r.kind.type === 'influence-reveal-play-offer')).toBe(false);
  });

  test('the follow-up play taps neither the site nor the influencing character further', () => {
    // The influencer was tapped by the attempt itself (rule 10.12) and stays
    // that way; what rule 10.13 waives is the site tap a resource play would
    // normally cost.
    const base = buildResolutionState({
      p1Hand: [DAGGER_OF_WESTERNESSE],
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }, GIMLI, BILBO],
    });
    const legolasId = findCharInstanceId(base, HAZARD_PLAYER, LEGOLAS);
    const targetDagger = base.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;

    const resolved = influenceRevealing(base, targetDagger, 12, 2);
    const siteBefore = resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status;
    expect(siteBefore).toBe(CardStatus.Untapped);

    const offered = viableActions(resolved, PLAYER_1, 'play-revealed-card');
    const played = reduce(resolved, offered[0].action);
    expect(played.error).toBeUndefined();
    expect(played.state.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('declining leaves the revealed card in hand', () => {
    // "May immediately play" — the offer is optional, and passing must leave
    // the card exactly where the successful attempt put it.
    const base = buildResolutionState({
      p1Hand: [DAGGER_OF_WESTERNESSE],
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }, GIMLI, BILBO],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(base, HAZARD_PLAYER, LEGOLAS);
    const targetDagger = base.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;
    const revealedDagger = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const resolved = influenceRevealing(base, targetDagger, 12, 2);
    const declined = reduce(resolved, { type: 'pass', player: PLAYER_1 });
    expect(declined.error).toBeUndefined();
    expect(declined.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedDagger)).toBe(true);
    expect(declined.state.players[RESOURCE_PLAYER].characters[aragornId].items).toHaveLength(0);
    expect(declined.state.pendingResolutions.some(r => r.kind.type === 'influence-reveal-play-offer')).toBe(false);
  });

  test('a revealed character joins the influencer\'s company, its own playability waived', () => {
    // Bilbo is a Hobbit whose home site is the Shire — he could never normally
    // be played at Moria. Rule 10.13 says he may be played this way anyway
    // ("i.e. a Hobbit may be played in this way"): the only requirement kept is
    // enough influence to control him.
    const base = buildResolutionState({
      p1Hand: [BILBO],
      p2Chars: [LEGOLAS, GIMLI, BILBO],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const targetBilbo = findCharInstanceId(base, HAZARD_PLAYER, BILBO);
    const revealedBilbo = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const companyId = base.players[RESOURCE_PLAYER].companies[0].id;
    const giBefore = base.players[RESOURCE_PLAYER].generalInfluenceUsed;

    const resolved = influenceRevealing(base, targetBilbo, 12, 2);
    expect(resolved.players[HAZARD_PLAYER].characters[targetBilbo]).toBeUndefined();

    // Aragorn's 3 direct influence cannot cover Bilbo's mind of 5, so general
    // influence is the only controller offered.
    const offered = viableActions(resolved, PLAYER_1, 'play-revealed-card') as { action: PlayRevealedCardAction }[];
    expect(offered.map(a => a.action.controlledBy)).toEqual(['general']);

    const played = reduce(resolved, offered[0].action);
    expect(played.error).toBeUndefined();
    const bilbo = played.state.players[RESOURCE_PLAYER].characters[revealedBilbo];
    expect(bilbo).toBeDefined();
    expect(bilbo.controlledBy).toBe('general');
    // He is in the influencing character's company, at Moria — not his home site.
    const company = played.state.players[RESOURCE_PLAYER].companies.find(c => c.id === companyId);
    expect(company!.characters).toContain(revealedBilbo);
    expect(company!.characters).toContain(aragornId);
    // His mind now costs general influence, which the rule does not waive.
    expect(played.state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(giBefore + 5);
  });

  test('a revealed character nobody can afford is not offered, but may still be declined', () => {
    // Aragorn (9) and Elrond (10) already spend 19 of the attacker's 20-point
    // pool, and neither has the 9 direct influence a second Aragorn would need
    // (3 and 4 respectively). Rule 10.13 waives the character's playability
    // restrictions but not the influence to control him, so no play may be
    // offered — yet the resolution still has to be dischargeable, or the
    // queue would deadlock on an empty action list.
    const base = buildResolutionState({
      p1Chars: [ARAGORN, ELROND],
      p1Hand: [ARAGORN],
      p2Chars: [{ defId: ARAGORN }, LEGOLAS, GIMLI],
    });
    expect(base.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(19);
    const targetAragorn = findCharInstanceId(base, HAZARD_PLAYER, ARAGORN);
    const revealedAragorn = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const resolved = influenceRevealing(base, targetAragorn, 12, 2);
    const offer = resolved.pendingResolutions.find(r => r.kind.type === 'influence-reveal-play-offer');
    expect(offer).toBeDefined();
    expect(viableActions(resolved, PLAYER_1, 'play-revealed-card')).toHaveLength(0);
    // Not a deadlock: passing discharges the offer and keeps the card in hand.
    const passes = viableActions(resolved, PLAYER_1, 'pass');
    expect(passes).toHaveLength(1);
    const declined = reduce(resolved, passes[0].action);
    expect(declined.error).toBeUndefined();
    expect(declined.state.pendingResolutions.some(r => r.kind.type === 'influence-reveal-play-offer')).toBe(false);
    expect(declined.state.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedAragorn)).toBe(true);
  });

  test('a failed attempt discards the revealed card and offers no play', () => {
    // The other half of the rule: "If an influence attempt fails after an
    // identical card was revealed, the identical card is discarded."
    const base = buildResolutionState({
      p1Hand: [DAGGER_OF_WESTERNESSE],
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }, GIMLI, BILBO],
    });
    const legolasId = findCharInstanceId(base, HAZARD_PLAYER, LEGOLAS);
    const targetDagger = base.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;
    const revealedDagger = base.players[RESOURCE_PLAYER].hand[0].instanceId;

    const resolved = influenceRevealing(base, targetDagger, 2, 12);
    // The influenced dagger survived — the attempt failed.
    expect(resolved.players[HAZARD_PLAYER].characters[legolasId].items).toHaveLength(1);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === revealedDagger)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === revealedDagger)).toBe(false);
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'influence-reveal-play-offer')).toBe(false);
  });

  test('a plain attempt with no reveal offers nothing to play', () => {
    // The follow-up play is a consequence of the reveal, not of success.
    const base = buildResolutionState({ p2Chars: [LEGOLAS, GIMLI, BILBO] });
    const targetBilbo = findCharInstanceId(base, HAZARD_PLAYER, BILBO);
    const offers = viableActions(base, PLAYER_1, 'opponent-influence-attempt') as { action: OpponentInfluenceAttemptAction }[];
    const plain = offers.find(a => a.action.targetInstanceId === targetBilbo && a.action.revealedCardInstanceId === undefined);
    expect(plain).toBeDefined();

    const declared = reduce({ ...base, cheatRollTotal: 12 }, plain!.action);
    const resolved = defendInfluence({ ...declared.state, cheatRollTotal: 2 }).state;
    expect(resolved.players[HAZARD_PLAYER].characters[targetBilbo]).toBeUndefined();
    expect(resolved.pendingResolutions.some(r => r.kind.type === 'influence-reveal-play-offer')).toBe(false);
  });

  test('the offer belongs to the attacker, not the defender', () => {
    const base = buildResolutionState({
      p1Hand: [DAGGER_OF_WESTERNESSE],
      p2Chars: [{ defId: LEGOLAS, items: [DAGGER_OF_WESTERNESSE] }, GIMLI, BILBO],
    });
    const legolasId = findCharInstanceId(base, HAZARD_PLAYER, LEGOLAS);
    const targetDagger = base.players[HAZARD_PLAYER].characters[legolasId].items[0].instanceId;

    const resolved = influenceRevealing(base, targetDagger, 12, 2);
    expect(viableActions(resolved, PLAYER_2, 'play-revealed-card')).toHaveLength(0);
  });
});
