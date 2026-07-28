/**
 * @module le-210.test
 *
 * Card test: No More Nonsense (le-210)
 * Type: minion-resource-event (permanent), alignment ringwraith, non-unique
 *
 * Text: "Playable on a leader during the organization phase. Make a roll for
 *  the leader. Choose another character in the company and do the same. If the
 *  leader's result plus his prowess is greater than the other character's
 *  result plus his prowess, discard any hazard permanent-events on the other
 *  character and the leader receives +2 direct influence. Otherwise, the leader
 *  receives -2 direct influence. Cannot be duplicated on a given leader."
 *
 * Effects:
 *   1. play-condition phase [organization] — the card is only offered during
 *      the organization phase (a permanent event is otherwise offered in the
 *      site and movement/hazard phases too).
 *   2. play-target character, filter `target.keywords $includes "leader"`.
 *   3. duplication-limit scope character, max 1 — "Cannot be duplicated on a
 *      given leader."
 *   4. opposed-roll { opponent: chosen-company-member, addStat: prowess,
 *      comparison: gt } — the leader (challenger) and a second character chosen
 *      at play time each roll 2d6 and add their prowess; the higher total wins.
 *      onWin: discard-attached (opponent, permanent hazard-events) +
 *      stat-modifier (challenger, direct-influence +2).
 *      onLose: stat-modifier (challenger, direct-influence -2).
 *
 * Engine Support:
 * | # | Feature                                             | Status      | Notes                                                     |
 * |---|-----------------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | Organization-phase-only play window                 | IMPLEMENTED | play-condition `phase` (organization-events.ts / site.ts)  |
 * | 2 | Playable on a leader                                | IMPLEMENTED | play-target filter on `target.keywords`                    |
 * | 3 | Choose another character in the company             | IMPLEMENTED | opposed-roll fan-out → `opposedCharacterId` on the action  |
 * | 4 | Two rolls, prowess added, "greater than" comparison | IMPLEMENTED | `opposed-roll` pending resolution (one action per roll)    |
 * | 5 | Win: discard hazard permanent-events on the other   | IMPLEMENTED | `discard-attached` outcome → move `hazards-on-target`      |
 * | 6 | Win: leader receives +2 direct influence            | IMPLEMENTED | `stat-modifier` outcome → character-stat-modifier constraint|
 * | 7 | Lose: leader receives -2 direct influence           | IMPLEMENTED | same, value -2                                             |
 * | 8 | The ±2 lasts only while the card stays on the leader| IMPLEMENTED | constraint `requiresSourceBorne` (effects/resolver.ts)      |
 * | 9 | Cannot be duplicated on a given leader              | IMPLEMENTED | duplication-limit scope character                          |
 *
 * Fixtures are minion (LE): Lieutenant of Morgul (le-22, Troll **leader**,
 * prowess 8, direct influence 2), Grishnákh (le-12, Orc, prowess 4) and Layos
 * (le-19, Man, prowess 3) as the non-leader company mates, at the minion
 * Darkhaven Minas Morgul (le-390) — or, for the site-phase test, the minion
 * Shadow-hold Moria (le-392), where the site phase actually offers resource
 * plays. The prowess gap (8 vs 4) is deliberately large enough that the tests
 * can make the *lower* roll still win, proving both the roll and the prowess
 * feed the comparison.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  buildTestState, resetMint, recomputeDerived,
  viableActions, dispatch, makePlayDeck,
  playPermanentEventAndResolve,
  attachHazardToChar, findCharInstanceId, getCharacter,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type {
  GameState,
  PlayPermanentEventAction,
  OpposedRollAction,
  CardDefinitionId,
  CardInstanceId,
  SitePhaseState,
} from '../../index.js';

// ─── Local card-ID constants ────────────────────────────────────────────────
const NO_MORE_NONSENSE = 'le-210' as CardDefinitionId; // permanent event under test
const LIEUTENANT_MORGUL = 'le-22' as CardDefinitionId; // Troll leader, prowess 8, DI 2
const GRISHNAKH = 'le-12' as CardDefinitionId; // Orc, prowess 4, no leader keyword
const LAYOS = 'le-19' as CardDefinitionId; // Man, prowess 3, no leader keyword
const GORBAG = 'le-11' as CardDefinitionId; // Orc leader (second leader for the duplication test)
const RUMOR_OF_THE_ONE = 'le-224' as CardDefinitionId; // minion permanent event with no phase gate
const FOOLISH_WORDS = 'td-25' as CardDefinitionId; // hazard-event, permanent
const LURE_OF_THE_SENSES = 'tw-60' as CardDefinitionId; // hazard-event, permanent
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion Darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId; // minion Shadow-hold
const BARAD_DUR_MINION = 'le-352' as CardDefinitionId; // minion Darkhaven (opponent)

describe('No More Nonsense (le-210)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2/3: play-target leader + "another character in the company" ────

  test('offers one play per (leader, other company member) pair', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH, LAYOS] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction);

    // Only the leader may be targeted, and the two non-leaders are each offered
    // as the opposing roller.
    expect(actions).toHaveLength(2);
    expect(actions.every(a => a.targetCharacterId === leaderId)).toBe(true);
    expect(new Set(actions.map(a => a.opposedCharacterId as string))).toEqual(new Set([
      findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH) as string,
      findCharInstanceId(state, RESOURCE_PLAYER, LAYOS) as string,
    ]));
  });

  test('NOT playable when the company holds no leader', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [GRISHNAKH, LAYOS] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('NOT playable on a leader who has no company mate to roll against', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Effect 1: organization phase only ─────────────────────────────────────

  test('NOT offered during the site phase, while an ungated permanent event still is', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          // Rumor of the One (le-224) is the control: a minion permanent event
          // with no phase gate, so the site phase still offers it.
          hand: [NO_MORE_NONSENSE, RUMOR_OF_THE_ONE],
          siteDeck: [MINAS_MORGUL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
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
    const state: GameState = { ...base, phaseState: sitePhaseState };

    const nonsenseId = base.players[RESOURCE_PLAYER].hand
      .find(c => c.definitionId === NO_MORE_NONSENSE)!.instanceId;
    const offered = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as PlayPermanentEventAction).cardInstanceId);

    // The site-phase menu is live (the control card is offered) but the
    // organization-phase-only card is absent.
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(nonsenseId);
  });

  // ── Effect 4: the two rolls ───────────────────────────────────────────────

  test('the leader rolls first, then the chosen company mate', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: otherId },
    );

    const first = viableActions(played, PLAYER_1, 'opposed-roll');
    expect(first).toHaveLength(1);
    expect((first[0].action as OpposedRollAction).characterId).toBe(leaderId);

    const afterFirst = dispatch({ ...played, cheatRollTotal: 7 }, first[0].action);
    const second = viableActions(afterFirst, PLAYER_1, 'opposed-roll');
    expect(second).toHaveLength(1);
    expect((second[0].action as OpposedRollAction).characterId).toBe(otherId);

    // After both rolls the contest is finished — no further roll is offered.
    const afterSecond = dispatch({ ...afterFirst, cheatRollTotal: 7 }, second[0].action);
    expect(viableActions(afterSecond, PLAYER_1, 'opposed-roll')).toHaveLength(0);
  });

  // ── Effect 4 onWin ────────────────────────────────────────────────────────

  test('leader wins: opponent loses his hazard permanent-events and the leader gains +2 direct influence', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    // Two hazard permanent-events on the company mate, one on the leader: only
    // the mate's are discarded.
    state = attachHazardToChar(state, RESOURCE_PLAYER, GRISHNAKH, FOOLISH_WORDS, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, GRISHNAKH, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL, FOOLISH_WORDS, HAZARD_PLAYER);
    state = recomputeDerived(state);

    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL).effectiveStats.directInfluence).toBe(2);

    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: otherId },
    );

    // Leader rolls 7 (+8 prowess = 15); Grishnákh rolls 10 (+4 prowess = 14).
    // The leader's *lower* roll still wins on prowess — 15 > 14.
    const leaderRoll = viableActions(played, PLAYER_1, 'opposed-roll')[0].action;
    const afterLeader = dispatch({ ...played, cheatRollTotal: 7 }, leaderRoll);
    const otherRoll = viableActions(afterLeader, PLAYER_1, 'opposed-roll')[0].action;
    const after = dispatch({ ...afterLeader, cheatRollTotal: 10 }, otherRoll);

    // The mate's hazard permanent-events are gone, routed to their owner's pile.
    expect(after.players[RESOURCE_PLAYER].characters[otherId].hazards).toHaveLength(0);
    const hazardDiscard = after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId);
    expect(hazardDiscard).toContain(FOOLISH_WORDS);
    expect(hazardDiscard).toContain(LURE_OF_THE_SENSES);
    // The leader's own hazard is untouched — the card only clears the other character.
    expect(after.players[RESOURCE_PLAYER].characters[leaderId].hazards).toHaveLength(1);

    // +2 direct influence for the leader (printed 2 → 4).
    expect(after.players[RESOURCE_PLAYER].characters[leaderId].effectiveStats.directInfluence).toBe(4);
  });

  // ── Effect 4 onLose ───────────────────────────────────────────────────────

  test('leader loses: hazards stay and the leader takes -2 direct influence', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, GRISHNAKH, FOOLISH_WORDS, HAZARD_PLAYER);
    state = recomputeDerived(state);

    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);

    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: otherId },
    );

    // Leader rolls 3 (+8 = 11); Grishnákh rolls 8 (+4 = 12) → the leader loses.
    const leaderRoll = viableActions(played, PLAYER_1, 'opposed-roll')[0].action;
    const afterLeader = dispatch({ ...played, cheatRollTotal: 3 }, leaderRoll);
    const otherRoll = viableActions(afterLeader, PLAYER_1, 'opposed-roll')[0].action;
    const after = dispatch({ ...afterLeader, cheatRollTotal: 8 }, otherRoll);

    // The mate keeps his hazard, and the hazard player's discard stays empty.
    expect(after.players[RESOURCE_PLAYER].characters[otherId].hazards).toHaveLength(1);
    expect(after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).not.toContain(FOOLISH_WORDS);
    // -2 direct influence for the leader (printed 2 → 0).
    expect(after.players[RESOURCE_PLAYER].characters[leaderId].effectiveStats.directInfluence).toBe(0);
  });

  test('a tie counts as a loss — the leader must be strictly greater', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);

    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: otherId },
    );

    // Leader rolls 6 (+8 = 14); Grishnákh rolls 10 (+4 = 14) — an exact tie.
    const leaderRoll = viableActions(played, PLAYER_1, 'opposed-roll')[0].action;
    const afterLeader = dispatch({ ...played, cheatRollTotal: 6 }, leaderRoll);
    const otherRoll = viableActions(afterLeader, PLAYER_1, 'opposed-roll')[0].action;
    const after = dispatch({ ...afterLeader, cheatRollTotal: 10 }, otherRoll);

    expect(after.players[RESOURCE_PLAYER].characters[leaderId].effectiveStats.directInfluence).toBe(0);
  });

  // ── The card stays on the leader, and so does its modifier ────────────────

  test('the card stays attached to the leader and its bonus lapses when it leaves him', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);

    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: otherId },
    );
    const leaderRoll = viableActions(played, PLAYER_1, 'opposed-roll')[0].action;
    const afterLeader = dispatch({ ...played, cheatRollTotal: 12 }, leaderRoll);
    const otherRoll = viableActions(afterLeader, PLAYER_1, 'opposed-roll')[0].action;
    const after = dispatch({ ...afterLeader, cheatRollTotal: 2 }, otherRoll);

    // Permanent event: it remains attached to the leader after resolving.
    const leader = after.players[RESOURCE_PLAYER].characters[leaderId];
    expect(leader.items.some(i => i.definitionId === NO_MORE_NONSENSE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === NO_MORE_NONSENSE)).toBe(false);
    expect(leader.effectiveStats.directInfluence).toBe(4);

    // The +2 is bound to the card: strip it off the leader and the bonus goes.
    const stripped = recomputeDerived({
      ...after,
      players: [
        {
          ...after.players[RESOURCE_PLAYER],
          characters: {
            ...after.players[RESOURCE_PLAYER].characters,
            [leaderId as string]: {
              ...leader,
              items: leader.items.filter(i => i.definitionId !== NO_MORE_NONSENSE),
            },
          },
        },
        after.players[HAZARD_PLAYER],
      ] as typeof after.players,
    });
    expect(stripped.players[RESOURCE_PLAYER].characters[leaderId].effectiveStats.directInfluence).toBe(2);
  });

  // ── Effect 3: duplication limit ───────────────────────────────────────────

  test('cannot be duplicated on a leader who already bears a copy', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [{ defId: LIEUTENANT_MORGUL, items: [NO_MORE_NONSENSE] }, GRISHNAKH],
          }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [LAYOS] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('a second copy is still playable on a different leader', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MINAS_MORGUL, characters: [{ defId: LIEUTENANT_MORGUL, items: [NO_MORE_NONSENSE] }, GRISHNAKH] },
            { site: MINAS_MORGUL, characters: [{ defId: GORBAG }, LAYOS] },
          ],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const gorbagId: CardInstanceId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => ea.action as PlayPermanentEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(gorbagId);
  });

  // ── Untargeted characters are unaffected ──────────────────────────────────

  test('only the two chosen rollers are touched', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_MORGUL, GRISHNAKH, LAYOS] }],
          hand: [NO_MORE_NONSENSE],
          siteDeck: [MORIA_MINION],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR_MINION, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });
    state = attachHazardToChar(state, RESOURCE_PLAYER, LAYOS, FOOLISH_WORDS, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, GRISHNAKH, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = recomputeDerived(state);

    const leaderId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_MORGUL);
    const grishnakhId = findCharInstanceId(state, RESOURCE_PLAYER, GRISHNAKH);
    const layosId = findCharInstanceId(state, RESOURCE_PLAYER, LAYOS);

    const played = playPermanentEventAndResolve(
      state, PLAYER_1, state.players[RESOURCE_PLAYER].hand[0].instanceId, leaderId,
      { opposedCharacterId: grishnakhId },
    );
    const leaderRoll = viableActions(played, PLAYER_1, 'opposed-roll')[0].action;
    const afterLeader = dispatch({ ...played, cheatRollTotal: 12 }, leaderRoll);
    const otherRoll = viableActions(afterLeader, PLAYER_1, 'opposed-roll')[0].action;
    const after = dispatch({ ...afterLeader, cheatRollTotal: 2 }, otherRoll);

    // Grishnákh (the chosen opponent) is cleared; Layos, who was not chosen,
    // keeps his hazard and his status.
    expect(after.players[RESOURCE_PLAYER].characters[grishnakhId].hazards).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].characters[layosId].hazards).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].characters[layosId].status).toBe(CardStatus.Untapped);
  });
});
