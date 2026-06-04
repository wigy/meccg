/**
 * @module le-22.test
 *
 * Card test: Lieutenant of Morgul (le-22)
 * Type: minion-character
 * Effects: 5
 *
 * "Unique. Half-troll. Leader. Manifestation of Gothmog. Discard on a body
 *  check result of 9. +3 direct influence against Trolls, Orcs, Troll
 *  factions, and Orc factions. When he is at Minas Morgul, you may keep one
 *  more card than normal in your hand."
 *
 * Effects tested:
 * 1. stat-modifier: +3 DI during faction-influence-check when faction race is troll
 * 2. stat-modifier: +3 DI during faction-influence-check when faction race is orc
 * 3. stat-modifier: +3 DI during influence-check when target race is troll
 * 4. stat-modifier: +3 DI during influence-check when target race is orc
 * 5. hand-size-modifier: +1 when self.location is Minas Morgul
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion candidate characters (LE/AS).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, InfluenceAttemptAction } from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;

// Minion candidate characters for influence-check tests
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;           // orc, mind 5
const WULUAG = 'as-6' as CardDefinitionId;                 // troll, mind 4
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId; // man, mind 4

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // haven (Lieutenant's homesite)
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven (away site)
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;   // shadow-hold (Goblins of Goblin-gate's site)

// Minion orc faction with positive influenceNumber
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9

describe('Lieutenant of Morgul (le-22)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 2 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[LIEUTENANT_OF_MORGUL as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effects 3 & 4: +3 DI during influence-check (character control) ─────────

  test('+3 DI vs Orcs allows Lieutenant to control Orc Captain (mind 5) as a follower', () => {
    // Lieutenant base DI = 2. Orc Captain is an orc with mind 5.
    // Without the +3 DI bonus against Orcs: DI 2 < mind 5 → cannot control.
    // With the bonus: DI 5 >= mind 5 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
          hand: [ORC_CAPTAIN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcCaptainUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(orcCaptainUnderLieutenant.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI vs Trolls allows Lieutenant to control Wûluag (mind 4) as a follower', () => {
    // Lieutenant base DI = 2. Wûluag is a troll with mind 4.
    // Without the +3 DI bonus against Trolls: DI 2 < mind 4 → cannot control.
    // With the bonus: DI 5 >= mind 4 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
          hand: [WULUAG],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [ORC_CAPTAIN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const wuluagUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(wuluagUnderLieutenant.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to non-Orc/non-Troll characters', () => {
    // Horseman in the Night is race "man" with mind 4. Lieutenant's +3 DI bonus
    // is race-gated (orc/troll only), so DI stays at 2 < mind 4 → Lieutenant
    // cannot take Horseman as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }],
          hand: [HORSEMAN_IN_THE_NIGHT],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const horsemanUnderLieutenant = actions.filter(a => a.controlledBy === lieutenantId);
    expect(horsemanUnderLieutenant).toHaveLength(0);
  });

  // ─── Effect 2: +3 DI during faction-influence-check (orc factions) ───────────

  test('+3 DI bonus applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Lieutenant (troll, base DI 2) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate.
    // With the +3 DI bonus vs Orc factions: modifier = DI 2 + 3 = 5 → need 9 - 5 = 4.
    const state = buildSitePhaseState({
      characters: [LIEUTENANT_OF_MORGUL],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const lieutenantId = findCharInstanceId(state, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const lieutenantAttempt = influenceActions.find(
      a => a.influencingCharacterId === lieutenantId,
    );
    expect(lieutenantAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(2) - diBonusVsOrcFaction(3) = 4
    expect(lieutenantAttempt!.need).toBe(4);
  });

  // ─── Effect 5: hand-size-modifier +1 at Minas Morgul ────────────────────────

  test('hand size is base + 1 when Lieutenant is at Minas Morgul', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // PLAYER_2 has no Lieutenant → base hand size
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is base when Lieutenant is NOT at Minas Morgul', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [LIEUTENANT_OF_MORGUL] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [WULUAG] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });
});
