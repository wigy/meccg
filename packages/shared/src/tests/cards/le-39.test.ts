/**
 * @module le-39.test
 *
 * Card test: Shagrat (le-39)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Leader. Discard on a body check result of 9.
 *  +4 direct influence against Orcs and Orc factions."
 *
 * Effects tested:
 * 1. stat-modifier: +4 DI during influence-check when target race is orc
 * 2. stat-modifier: +4 DI during faction-influence-check when faction race is orc
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

const SHAGRAT = 'le-39' as CardDefinitionId;

// Minion candidate characters for influence-check tests
const RADBUG = 'le-38' as CardDefinitionId;      // orc, mind 4 — at the +4 bonus limit
const ORC_CAPTAIN = 'le-31' as CardDefinitionId; // orc, mind 5 — above +4 bonus
const LUITPRAND = 'le-23' as CardDefinitionId;   // man, mind 1, no effects

// Minion sites
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (Goblins of Goblin-gate's site)

// Minion orc faction with positive influenceNumber
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9

describe('Shagrat (le-39)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonuses do not inflate base stats) ──────────────

  test('base effective DI is 0 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const baseDef = pool[SHAGRAT as string] as CharacterCard;
    expect(baseDef.directInfluence).toBe(0);
    expect(getCharacter(state, RESOURCE_PLAYER, SHAGRAT).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +4 DI during influence-check (character control) ──────────────

  test('+4 DI vs Orcs allows Shagrat to control Radbug (orc, mind 4) as a follower', () => {
    // Shagrat base DI = 0. Radbug is an orc with mind 4.
    // Without the +4 DI bonus against Orcs: DI 0 < mind 4 → cannot control.
    // With the bonus: DI 4 >= mind 4 → can control as a follower. This is the
    // key distinguishing test vs Gorbag's +3 bonus (le-11) — the extra +1
    // enables controlling a mind-4 orc that Gorbag cannot.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [RADBUG],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const radbugUnderShagrat = actions.filter(a => a.controlledBy === shagratId);
    expect(radbugUnderShagrat.length).toBeGreaterThanOrEqual(1);
  });

  test('+4 DI bonus is capped at +4 — cannot control Orc Captain (orc, mind 5)', () => {
    // Orc Captain is race "orc" with mind 5. Shagrat's bonus gives DI 4,
    // which is still < mind 5, so Orc Captain cannot come in under his DI.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [ORC_CAPTAIN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [LUITPRAND] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcCaptainUnderShagrat = actions.filter(a => a.controlledBy === shagratId);
    expect(orcCaptainUnderShagrat).toHaveLength(0);
  });

  test('+4 DI bonus does NOT apply to non-Orc characters', () => {
    // Luitprand is race "man" with mind 1. Shagrat's +4 DI bonus is
    // race-gated (orc only), so DI stays at 0 < mind 1 → Shagrat cannot
    // take Luitprand as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [LUITPRAND],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: BARAD_DUR, characters: [RADBUG] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const luitprandUnderShagrat = actions.filter(a => a.controlledBy === shagratId);
    expect(luitprandUnderShagrat).toHaveLength(0);
  });

  // ─── Effect 2: +4 DI during faction-influence-check (orc factions) ───────────

  test('+4 DI bonus applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Shagrat (orc, base DI 0) attempts to influence Goblins of Goblin-gate
    // (orc faction, influenceNumber 9) at Goblin-gate.
    // With the +4 DI bonus vs Orc factions: modifier = DI 0 + 4 = 4 → need 9 - 4 = 5.
    const state = buildSitePhaseState({
      characters: [SHAGRAT],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const shagratId = findCharInstanceId(state, RESOURCE_PLAYER, SHAGRAT);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const shagratAttempt = influenceActions.find(
      a => a.influencingCharacterId === shagratId,
    );
    expect(shagratAttempt).toBeDefined();

    // influenceNumber(9) - baseDI(0) - diBonusVsOrcFaction(4) = 5
    expect(shagratAttempt!.need).toBe(5);
  });
});
