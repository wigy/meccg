/**
 * @module tw-124.test
 *
 * Card test: Bard Bowman (tw-124)
 * Type: hero-character, unique
 * Prowess 5 / Body 6 / Mind 4 / DI 0 / race man
 *
 * "Unique. +2 direct influence against the Men of Northern Rhovanion faction."
 *
 * Engine Support:
 * | # | Feature                                      | Status      | Notes                                                     |
 * |---|----------------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | +2 DI when influencing Men of N. Rhovanion   | IMPLEMENTED | stat-modifier, reason=faction-influence-check, faction.name |
 *
 * The bonus is conditional (only during a faction influence check against the
 * named faction), so it must lower the influence-attempt `need` without ever
 * inflating Bard's ordinary effective direct influence.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, getCharacter,
} from '../test-helpers.js';
import { BARD_BOWMAN, LEGOLAS, RIVENDELL, LORIEN, MORIA, MINAS_TIRITH } from '../../index.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction } from '../../index.js';

/** Men of Northern Rhovanion (influence # 7), playable at Lake-town. */
const MEN_OF_NORTHERN_RHOVANION = 'tw-281' as CardDefinitionId;
/** Lake-town (hero border-hold), where the faction is influenceable. */
const LAKE_TOWN = 'tw-406' as CardDefinitionId;

describe('Bard Bowman (tw-124)', () => {
  beforeEach(() => resetMint());

  test('direct-influence +2 during faction influence check, for Men of Northern Rhovanion', () => {
    // Bard (DI 0) attempts to influence Men of Northern Rhovanion (influence # 7)
    // at Lake-town. The +2 DI bonus lowers the need from 7 to 5.
    const state = buildSitePhaseState({
      characters: [BARD_BOWMAN],
      site: LAKE_TOWN,
      hand: [MEN_OF_NORTHERN_RHOVANION],
    });

    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const attempts = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.influencingCharacterId === bardId);

    expect(attempts.length).toBeGreaterThanOrEqual(1);
    // influenceNumber(7) - baseDI(0) - factionDIBonus(2) = 5
    expect(attempts[0].need).toBe(5);
  });

  // ── Sanity: the conditional bonus does not inflate base stats ──

  test('base effective direct influence is 0 (the faction bonus does not leak into base stats)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BARD_BOWMAN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, BARD_BOWMAN).effectiveStats.directInfluence).toBe(0);
  });
});
