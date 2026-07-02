/**
 * @module rule-8.36-rescuing-prisoners
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.36: Rescuing Prisoners
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A company may attempt to rescue a prisoner after successfully entering the rescue site during its site phase by facing any rescue-attacks (which do not count as automatic-attacks) as specified on the hazard host. A character in the company may then be tapped to rescue all of the hazard host's prisoners, which immediately join the company under general influence. When a character is successfully rescued, the rescue site taps if it was untapped and one minor item (even for Under-deeps sites) may be played as the resource player's next declared action by tapping an untapped member in the company (as an active condition), and then upon resolution placing the item under that character's control.
 * A resource player who does not have a copy of a rescue site currently available in their location deck may use the rescue site card that has been played with the hazard host in order to move to the site, but cannot use that site card for any purpose other than rescuing the prisoner(s) and playing an accompanying minor item.
 * If there are no cards placed with a hazard host, the hazard host is immediately discarded and the rescue site card returns to its player's location deck.
 * If a hazard host is discarded, its prisoner is rescued and forms a new company at the rescue site (instead of being discarded per the normal rules for non-"hazard host" cards leaving play).
 * Allies cannot be taken prisoner and cannot be targeted to be taken prisoner. They may face strikes from untargeted attacks that would normally take a character prisoner, but in that case the ally is neither tapped nor wounded by the attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus, Phase } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId, CombatState, PlayerState } from '../../../index.js';
import {
  buildTestState, resetMint, dispatch, viableActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  findCharInstanceId, companyIdAt,
  makeShadowMHState,
} from '../../test-helpers.js';

const GWAIHIR = 'tw-251' as CardDefinitionId;

describe('Rule 8.36 — Rescuing Prisoners', () => {
  beforeEach(() => resetMint());

  // The full rescue flow (enter the rescue site, face the host's
  // rescue-attacks, prisoners freed and the host record cleared) is already
  // exercised end-to-end for two real hazard hosts: Troll-purse (dm-95) and
  // Flies and Spiders (dm-58). Both cover: rescue-attack = the host's own
  // rescue-attacks (not the site's automatic-attacks), the rescued
  // prisoner(s) protected from strike assignment during the rescue-attack,
  // and the prisoner constraint/host record being cleared on success.
  test.todo('Company enters rescue site, faces rescue-attacks, taps character to rescue all prisoners from host; may play minor item');

  test('an ally facing an untargeted prisoner-taking attack is neither tapped nor wounded', () => {
    // A re-faced Troll-purse-style automatic-attack (untargeted: whoever is
    // assigned to face the strike would normally be taken prisoner) is
    // assigned to an ally instead of a character. Allies cannot be taken
    // prisoner, so the strike must have no effect on the ally at all.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const allyInstanceId = 'gwaihir-1' as CardInstanceId;

    const withAlly = {
      ...base,
      players: base.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              allies: [{ instanceId: allyInstanceId, definitionId: GWAIHIR, status: CardStatus.Untapped }],
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // guaranteed to "succeed" against the ally
      creatureBody: null,
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: allyInstanceId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
      trollPursePrisoner: { hostInstanceId: 'host-1' as CardInstanceId, siteInstanceId: 'fake-site' as CardInstanceId },
    };
    const state = { ...withAlly, combat, phaseState: makeShadowMHState(), cheatRollTotal: 2 };

    const [resolveAction] = viableActions(state, PLAYER_1, 'resolve-strike');
    expect(resolveAction).toBeDefined();
    const after = dispatch(state, resolveAction.action);

    const ally = after.players[RESOURCE_PLAYER].characters[aragornId].allies[0];
    // Neither tapped nor wounded — completely untouched by the strike.
    expect(ally.status).toBe(CardStatus.Untapped);
    // No prisoner record was created for the ally.
    expect(after.hazardHosts).toHaveLength(0);
  });

  // "If a hazard host is discarded, its prisoner is rescued and forms a new
  // company at the rescue site": the current implementation instead prevents
  // a prisoner-holding hazard host from ever being discarded by the generic
  // orphan-sweep (`discardOrphanedSiteAttachedEvents` exempts hosts with
  // prisoners — see dm-95's "not discarded when no company occupies the
  // site" test) rather than modeling the discard-triggers-rescue path. There
  // is no card or engine path that discards a prisoner-holding host outside
  // of the normal rescue-attack flow, so this sub-clause is unreachable with
  // the current implementation.
  test.todo('If hazard host is discarded, prisoner is rescued and forms a new company at the rescue site');
});
