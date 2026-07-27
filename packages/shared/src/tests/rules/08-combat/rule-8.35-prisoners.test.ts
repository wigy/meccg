/**
 * @module rule-8.35-prisoners
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.35: Prisoners
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Certain hazards may have an effect on an attack or strike that results in a character being taken prisoner. These hazards are called "hazard hosts," and will take the character prisoner at a site called the "rescue site."
 * A hazard host can only be played if the rescue site is available to come from the hazard player's location deck AND if that rescue site adheres to the following restrictions:
 * • If the character is moving with Starter Movement, the rescue site must be located in the region containing the site of origin or the region containing the new site.
 * • If the character is moving with Region Movement, the rescue site must be located in a region in which the character was moving or in a region adjacent to a region in which the character was moving.
 * • If the character is not moving, the rescue site must be located in the same region as the character's site.
 * If a character is at or moving to a site adjacent to an Under-deeps site, the rescue site may be that Under-deeps site (even if the character is not using Under-deeps Movement).
 * When a character is taken prisoner, all of its followers revert to general influence but their mind value(s) are not subtracted from general influence until their player's next organization phase. Any other non-ring cards on the character taken prisoner are immediately discarded.
 * While taken prisoner, a character does not cost influence to control, cannot take any actions including healing or untapping, cannot be affected except by cards that specifically affect prisoners, and is worth negative marshalling points to its player (and continues to be worth negative marshalling points if eliminated while prisoner).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { CardStatus, Phase, CardDefinitionId, CardInstanceId, Race } from '../../../index.js';
import type { PlayerState } from '../../../index.js';
import {
  ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR,
  buildTestState, attachHazardToChar, attachItemToChar, findCharInstanceId,
  companyIdAt, PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, resetMint,
  dispatch, viableActions, makeShadowMHState,
} from '../../test-helpers.js';

const FLIES_AND_SPIDERS = 'dm-58' as CardDefinitionId;
const DAGGER = 'tw-095' as CardDefinitionId; // Dagger of Westernesse (minor item)

describe('Rule 8.35 — Prisoners', () => {
  beforeEach(() => resetMint());

  test('Hazard hosts take characters prisoner at rescue site; followers revert to GI; prisoner cannot act; worth negative MP', () => {
    // Build state with Aragorn facing a resolved strike from Flies and Spiders.
    // Aragorn has a Dagger equipped; hazard player has Bandit Lair (ruins-and-lairs) in site deck.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [RIVENDELL, MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [BANDIT_LAIR],
        },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);

    // Attach a Dagger to Aragorn (will be discarded when taken prisoner).
    const withDagger = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER);

    // Attach Flies and Spiders as a hazard to Aragorn (owned by hazard player).
    const withHazard = attachHazardToChar(withDagger, RESOURCE_PLAYER, ARAGORN, FLIES_AND_SPIDERS, HAZARD_PLAYER);

    // Set Bilbo as a follower under Aragorn's direct influence.
    const withFollower = {
      ...withHazard,
      players: withHazard.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        return {
          ...p,
          characters: {
            ...p.characters,
            [aragornId as string]: {
              ...p.characters[aragornId],
              followers: [bilboId],
            },
            [bilboId as string]: {
              ...p.characters[bilboId],
              controlledBy: aragornId,
            },
          },
        };
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    // Build combat state at resolve-strike phase with Aragorn facing Spider attack.
    const companyId = companyIdAt(withFollower, RESOURCE_PLAYER);
    const combat = {
      attackSource: { type: 'creature' as const, instanceId: 'fake-spider' as CardInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // Guaranteed win for creature
      creatureBody: null,
      creatureRace: Race.Spider,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike' as const,
      assignmentPhase: 'done' as const,
      bodyCheckTarget: null,
      detainment: false,
    };

    // Force lowest roll (2) so creature wins.
    const combatState = {
      ...withFollower,
      combat,
      phaseState: makeShadowMHState(),
      cheatRollTotal: 2,
    };

    const resolveActions = viableActions(combatState, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true) ?? resolveActions[0];
    const afterStrike = dispatch(combatState, tapAction.action);

    // Assert: hazardHosts has one entry.
    expect(afterStrike.hazardHosts).toHaveLength(1);
    const host = afterStrike.hazardHosts[0];
    expect(host.ownedBy).toBe(PLAYER_2);
    expect(host.prisoners).toContain(aragornId);

    // Assert: Aragorn has character-is-prisoner constraint.
    const prisonerConstraint = afterStrike.activeConstraints.find(
      c => c.target.kind === 'character'
        && c.target.characterId === aragornId
        && c.kind.type === 'character-is-prisoner',
    );
    expect(prisonerConstraint).toBeDefined();

    // Assert: Dagger is in discard pile (non-ring item discarded by prisoner rule).
    const aragornPlayer = afterStrike.players[RESOURCE_PLAYER];
    const aragornChar = aragornPlayer.characters[aragornId];
    expect(aragornChar.items).toHaveLength(0);
    expect(aragornPlayer.discardPile.some(c => c.definitionId === DAGGER)).toBe(true);

    // Assert: Aragorn is not wounded — prisoner rule prevents wound.
    expect(aragornChar.status).toBe(CardStatus.Untapped);

    // Assert: Bilbo reverted to general influence with the mind
    // subtraction deferred (rule 8.35: follower minds "are not subtracted
    // from general influence until their player's next organization phase").
    expect(aragornPlayer.characters[bilboId]?.controlledBy).toBe('general');
    expect(aragornPlayer.characters[bilboId]?.influenceUnsubtracted).toBe(true);

    // Assert: rescue site removed from hazard player's location deck.
    const hazardPlayer = afterStrike.players[HAZARD_PLAYER];
    expect(hazardPlayer.siteDeck.some(s => s.definitionId === BANDIT_LAIR)).toBe(false);
    expect(host.rescueSiteCard.definitionId).toBe(BANDIT_LAIR);

    // Assert: prisoner worth negative MP.
    expect(aragornPlayer.marshallingPoints.character).toBeLessThan(0);

    // Assert: prisoner costs 0 GI — Aragorn's mind (6) not counted — and
    // Bilbo's mind (5) is deferred until the next organization phase, so
    // nothing counts against general influence yet.
    expect(aragornPlayer.generalInfluenceUsed).toBe(0);
  });
});
