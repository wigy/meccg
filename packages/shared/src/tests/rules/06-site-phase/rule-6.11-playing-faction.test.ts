/**
 * @module rule-6.11-playing-faction
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.11: Playing a Faction
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing a Faction - If a company has successfully entered a site during its site phase, the resource player may play a faction if they have an untapped character in the company, the site is untapped, and the faction is playable at the site. The resource player must reveal the faction and tap the character (as an active condition), but upon resolution must attempt an influence check by making a roll and adding the character's available direct influence and any other modifications (e.g. a bonus that the character may have when influencing that faction, "standard modifications" listed on the faction card based on the race of the influencer or what other factions the resource player already has in play, etc.). If the result is greater than the number listed on the faction, the resource player successfully plays the faction into their own marshalling point pile and taps the site; otherwise the faction is immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, viableActions, dispatch, resolveChain,
  PLAYER_1, RESOURCE_PLAYER,
  ARAGORN, GANDALF, RANGERS_OF_THE_NORTH,
  BREE,
  CardStatus,
  handCardId, charIdAt,
} from '../../test-helpers.js';
import type { GameState } from '../../../types/state.js';
import type { InfluenceAttemptAction } from '../../../types/actions-site.js';

describe('Rule 6.11 — Playing a Faction', () => {
  beforeEach(() => resetMint());

  test('Play faction with untapped character; reveal and tap character; make influence check; success stores faction and taps site', () => {
    // Rangers of the North is playable at Bree. With Aragorn untapped at
    // untapped Bree, the engine must offer an influence-attempt action.
    // The action includes the roll needed and the influencing character.
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
    });

    const attempts = viableActions(state, PLAYER_1, 'influence-attempt') as { action: InfluenceAttemptAction }[];
    expect(attempts.length).toBeGreaterThan(0);

    const factionInstId = handCardId(state, RESOURCE_PLAYER);
    const aragornInstId = charIdAt(state, RESOURCE_PLAYER);
    const attempt = attempts.find(a =>
      a.action.factionInstanceId === factionInstId &&
      a.action.influencingCharacterId === aragornInstId,
    );
    expect(attempt).toBeDefined();

    // When the site is tapped, the faction cannot be played
    const tappedState = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
      siteStatus: CardStatus.Tapped,
    });

    const tappedAttempts = viableActions(tappedState, PLAYER_1, 'influence-attempt');
    expect(tappedAttempts).toHaveLength(0);
  });

  test('a failed influence attempt discards the faction but leaves the site untapped', () => {
    // 2.V.1.1 / 2.V.3: the site "is tapped upon successful resolution of the
    // resource" — a failed influence check only discards the faction, it
    // must not tap the site (seed mseo5p0k-dcvpu8, stateSeq 122).
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN],
      hand: [RANGERS_OF_THE_NORTH],
    });

    const factionInstId = handCardId(state, RESOURCE_PLAYER);
    const aragornInstId = charIdAt(state, RESOURCE_PLAYER);
    const attempt = (viableActions(state, PLAYER_1, 'influence-attempt') as { action: InfluenceAttemptAction }[])
      .find(a => a.action.factionInstanceId === factionInstId && a.action.influencingCharacterId === aragornInstId)!;

    const afterChain = resolveChain(dispatch(state, attempt.action));
    const rollAction = viableActions(afterChain, PLAYER_1, 'faction-influence-roll')[0].action;
    // Minimum dice roll (2) + Aragorn's +6 modifier = 8, well under the
    // influence number of 10 — guaranteed failure.
    const resolved = dispatch({ ...afterChain, cheatRollTotal: 2 }, rollAction);

    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === factionInstId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionInstId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Untapped);
  });

  test('losing the influencer before the roll fails the attempt and discards the faction', () => {
    // The chain deliberately leaves an influence-attempt entry unresolved
    // while the pending faction-influence-roll awaits the player's commit.
    // If the influencing character leaves play in that window, the roll can
    // no longer be made. The attempt must fail and discard the faction —
    // offering nothing instead strands the chain in `resolving` mode, where
    // no actions are generated at all, and the game deadlocks with neither
    // player able to move (seed 90260).
    const state = buildSitePhaseState({
      site: BREE,
      characters: [ARAGORN, GANDALF],
      hand: [RANGERS_OF_THE_NORTH],
    });

    const factionInstId = handCardId(state, RESOURCE_PLAYER);
    const aragornInstId = charIdAt(state, RESOURCE_PLAYER, 0);
    const attempt = (viableActions(state, PLAYER_1, 'influence-attempt') as { action: InfluenceAttemptAction }[])
      .find(a => a.action.influencingCharacterId === aragornInstId);
    expect(attempt).toBeDefined();

    const afterChain = resolveChain(dispatch(state, attempt!.action));
    expect(viableActions(afterChain, PLAYER_1, 'faction-influence-roll')).toHaveLength(1);

    // Aragorn leaves play before the roll is committed; Gandalf keeps the
    // company alive so this is purely about the missing influencer.
    const remaining = { ...afterChain.players[0].characters };
    delete remaining[aragornInstId];
    const lostInfluencer: GameState = {
      ...afterChain,
      players: [
        {
          ...afterChain.players[0],
          characters: remaining,
          companies: afterChain.players[0].companies.map(c => ({
            ...c,
            characters: c.characters.filter(id => id !== aragornInstId),
          })),
        },
        afterChain.players[1],
      ],
    };

    // The game must still offer a way forward rather than deadlocking.
    const rolls = viableActions(lostInfluencer, PLAYER_1, 'faction-influence-roll');
    expect(rolls).toHaveLength(1);

    const resolved = dispatch(lostInfluencer, rolls[0].action);
    expect(resolved.players[0].discardPile.some(c => c.instanceId === factionInstId)).toBe(true);
    expect(resolved.players[0].cardsInPlay.some(c => c.instanceId === factionInstId)).toBe(false);
  });
});
