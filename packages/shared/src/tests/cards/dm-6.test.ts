/**
 * @module dm-6.test
 *
 * Card test: Drór (dm-6)
 * Type: minion-character (agent, ringwraith alignment)
 *
 * Text: "Unique. Agent. +2 direct influence against Dwarves and Dwarf Factions."
 *
 * Stats: prowess 3, body 7, mind 4, directInfluence 2, skills: warrior/diplomat
 *
 * Effects:
 * | # | Rule                                            | Status      | Notes                              |
 * |---|-------------------------------------------------|-------------|-----------------------------------|
 * | 1 | +2 DI vs Dwarves (influence-check)              | IMPLEMENTED | stat-modifier, target.race=dwarf  |
 * | 2 | +2 DI vs Dwarf Factions (faction-influence-check)| IMPLEMENTED | stat-modifier, faction.race=dwarf |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, RESOURCE_PLAYER, BLUE_MOUNTAIN_DWARF_HOLD,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';

const DROR = 'dm-6' as CardDefinitionId;

// Dwarf character — mind 4; Drór (base DI 2) cannot control without bonus (2 < 4),
// but can with it (2 + 2 = 4 >= 4).
const FORI_THE_BEARDLESS = 'dm-11' as CardDefinitionId; // dwarf, mind 4

// Non-Dwarf character — mind 3; Drór (base DI 2) cannot control (2 < 3), bonus doesn't apply.
const BILL_FERNY = 'dm-3' as CardDefinitionId; // man, mind 3

// Dwarf faction playable at Blue Mountain Dwarf-hold; influenceNumber 9.
const BLUE_MOUNTAIN_DWARVES = 'tw-200' as CardDefinitionId;

// Minion sites for Drór's company (organization-phase tests)
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // minion haven
const BARAD_DUR = 'le-352' as CardDefinitionId;       // dark-hold

describe('Drór (dm-6)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [DROR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [FORI_THE_BEARDLESS] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[DROR as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, DROR).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +2 DI during influence-check (character control) ──────────────

  test('+2 DI vs Dwarves allows Drór to control Fori the Beardless (dwarf, mind 4) as a follower', () => {
    // Drór base DI = 2. Fori the Beardless is a dwarf with mind 4.
    // Without the +2 DI bonus against Dwarves: DI 2 < mind 4 → cannot control.
    // With the bonus: DI 4 >= mind 4 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [FORI_THE_BEARDLESS],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [BILL_FERNY] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const drorId = findCharInstanceId(state, RESOURCE_PLAYER, DROR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const foriUnderDror = actions.filter(a => a.controlledBy === drorId);
    expect(foriUnderDror.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does NOT apply to non-Dwarf characters', () => {
    // Bill Ferny is race "man" with mind 3. Drór's +2 DI bonus is
    // race-gated (dwarf only), so DI stays at 2 < mind 3 → Drór cannot
    // take Bill Ferny as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [BILL_FERNY],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [FORI_THE_BEARDLESS] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const drorId = findCharInstanceId(state, RESOURCE_PLAYER, DROR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const billyUnderDror = actions.filter(a => a.controlledBy === drorId);
    expect(billyUnderDror).toHaveLength(0);
  });

  // ─── Effect 2: +2 DI during faction-influence-check (Dwarf factions) ─────────

  test('+2 DI bonus applies when influencing Blue Mountain Dwarves (influenceNumber 9)', () => {
    // Drór (dwarf, base DI 2) attempts to influence Blue Mountain Dwarves
    // (dwarf faction, influenceNumber 9) at Blue Mountain Dwarf-hold.
    // Blue Mountain Dwarves grants +2 check bonus to Dwarf influencers (faction card effect).
    // Drór's stat-modifier adds +2 DI vs Dwarf factions.
    // Total: influenceNumber(9) - baseDI(2) - diBonusVsDwarfFaction(2) - checkBonusForDwarf(2) = 3.
    const state = buildSitePhaseState({
      characters: [DROR],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });

    const drorId = findCharInstanceId(state, RESOURCE_PLAYER, DROR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const drorAttempt = influenceActions.find(
      a => a.influencingCharacterId === drorId,
    );
    expect(drorAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(2) - diBonusVsDwarfFaction(2) - checkBonusForDwarf(2) = 3
    expect(drorAttempt!.need).toBe(3);
  });
});
