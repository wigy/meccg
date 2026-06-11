/**
 * @module le-16.test
 *
 * Card test: Horseman in the Night (le-16)
 * Type: minion-character
 * Effects: 1
 *
 * "+1 direct influence against any faction."
 *
 * Effects tested:
 * 1. stat-modifier: +1 DI during faction-influence-check, with no faction
 *    filter — the bonus applies against every faction regardless of race.
 *    The bonus is check-scoped only: it must not inflate the character's
 *    base effective DI and must not help control characters (influence-check).
 *
 * Fixture alignment: minion-character (ringwraith), so tests use minion sites
 * (LE) and minion factions/characters (LE).
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

const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;

// Minion candidate character for the influence-check negative test
const LAGDUF = 'le-18' as CardDefinitionId; // orc, mind 3

// Minion companion character for fixtures
const OSTISEN = 'le-36' as CardDefinitionId;

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // haven
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold
const BARAD_DUR = 'le-352' as CardDefinitionId;      // dark-hold
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold (Goblins of Goblin-gate's site)
const THE_WORTHY_HILLS = 'le-415' as CardDefinitionId; // ruins-and-lairs (Woses' site)

// Minion factions of different races (the bonus applies against ANY faction)
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc, influence# 9
const WOSES_OF_THE_ERYN_VORN = 'le-296' as CardDefinitionId; // wose, influence# 12

describe('Horseman in the Night (le-16)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional bonus does not inflate base stats) ──────────────

  test('base effective DI is 2 (faction bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [HORSEMAN_IN_THE_NIGHT] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const baseDef = pool[HORSEMAN_IN_THE_NIGHT as string] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT).effectiveStats.directInfluence)
      .toBe(baseDef.directInfluence);
  });

  // ─── Effect 1: +1 DI during faction-influence-check (any faction) ────────────

  test('+1 DI applies when influencing an Orc faction (Goblins of Goblin-gate)', () => {
    // Horseman base DI = 2. Goblins of Goblin-gate influenceNumber = 9.
    // Without the +1 DI bonus: need = 9 - 2 = 7.
    // With the +1 DI bonus against any faction: need = 9 - (2 + 1) = 6.
    const state = buildSitePhaseState({
      characters: [HORSEMAN_IN_THE_NIGHT],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const horsemanId = findCharInstanceId(state, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const horsemanAttempt = influenceActions.find(a => a.influencingCharacterId === horsemanId);
    expect(horsemanAttempt).toBeDefined();
    expect(horsemanAttempt!.need).toBe(6);
  });

  test('+1 DI applies against a faction of a different race (Woses of the Eryn Vorn)', () => {
    // The bonus has no race gate: it applies against ANY faction. Woses of the
    // Eryn Vorn (wose faction, influenceNumber 12) at The Worthy Hills.
    // need = 12 - (2 + 1) = 9.
    const state = buildSitePhaseState({
      characters: [HORSEMAN_IN_THE_NIGHT],
      site: THE_WORTHY_HILLS,
      hand: [WOSES_OF_THE_ERYN_VORN],
    });

    const horsemanId = findCharInstanceId(state, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const horsemanAttempt = influenceActions.find(a => a.influencingCharacterId === horsemanId);
    expect(horsemanAttempt).toBeDefined();
    expect(horsemanAttempt!.need).toBe(9);
  });

  // ─── Negative: bonus is faction-only, does not help control characters ───────

  test('+1 DI does NOT apply when controlling characters (influence-check)', () => {
    // Lagduf is an orc with mind 3. Horseman's base DI is 2 < 3, and the +1
    // bonus is gated on faction-influence-check, so it must not leak into
    // character control: Horseman cannot take Lagduf as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [LAGDUF],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const horsemanId = findCharInstanceId(state, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const lagdufUnderHorseman = actions.filter(a => a.controlledBy === horsemanId);
    expect(lagdufUnderHorseman).toHaveLength(0);
  });
});
