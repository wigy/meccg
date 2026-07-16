/**
 * @module le-152.test
 *
 * Card test: Blackbole (le-152)
 * Type: minion-resource-ally
 * Stats: prowess 5, body 9, mind 3, MP 2 (ally)
 *
 * Card text:
 *   "Unique. Playable at any site in Western Mirkwood, Heart of Mirkwood, or
 *    Southern Mirkwood (except Dol Guldur). May not face any strike at a site
 *    or from an automatic-attack."
 *
 * Blackbole is the minion (Ringwraith) counterpart of the Ent ally Quickbeam
 * (tw-307): a rooted tree-being that cannot be struck by attacks faced at a
 * site. The two rules map to existing engine primitives:
 *
 * | # | Feature                                               | Status      | Notes                                                          |
 * |---|-------------------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | Unique — only one copy allowed                        | IMPLEMENTED | standard uniqueness check                                      |
 * | 2 | Playable only in the three Mirkwood regions           | IMPLEMENTED | playableAt [{any,when: site.region $in […] & site.name != Dol Guldur}] |
 * | 3 | Except Dol Guldur (name exclusion)                    | IMPLEMENTED | `site.name` `$ne` "Dol Guldur"                                 |
 * | 4 | Immune to automatic-attacks (defender + attacker)     | IMPLEMENTED | play-flag: no-attack-site-keyed, unconditional for auto-attacks |
 * | 5 | Immune to site-type-keyed creature at its site        | IMPLEMENTED | play-flag: no-attack-site-keyed + attackSiteKeyingTypes check  |
 * | 6 | NOT immune to region-only creature hazards            | IMPLEMENTED | no-attack-site-keyed only triggers when site types match       |
 *
 * Fixture alignment: minion-character (le-1 Asternak) with minion sites.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint,
  attachAllyToChar, findCharInstanceId,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState,
  AssignStrikeAction, PlayHeroResourceAction,
} from '../../index.js';

const BLACKBOLE = 'le-152' as CardDefinitionId;

// Minion character — clean fixture with no combat/immunity effects of its own.
const ASTERNAK = 'le-1' as CardDefinitionId; // man, mind 5

// Minion sites in the three permitted Mirkwood regions.
const WOODMEN_TOWN = 'le-414' as CardDefinitionId; // border-hold, Western Mirkwood
const SARN_GORIWING = 'le-401' as CardDefinitionId; // shadow-hold, Heart of Mirkwood
const RHOSGOBEL = 'as-159' as CardDefinitionId; // free-hold, Southern Mirkwood
// Named exclusion — a *non-haven* Dol Guldur so the test exercises the name
// filter, not a haven gate.
const DOL_GULDUR = 'ba-88' as CardDefinitionId; // dark-hold, Southern Mirkwood
// Outside the permitted regions.
const MORIA = 'le-392' as CardDefinitionId; // shadow-hold, Redhorn Gate

describe('Blackbole (le-152)', () => {
  beforeEach(() => resetMint());

  // ─── Playable-at: the three Mirkwood regions ─────────────────────────────

  test.each([
    ['Woodmen-town (Western Mirkwood)', WOODMEN_TOWN],
    ['Sarn Goriwing (Heart of Mirkwood)', SARN_GORIWING],
    ['Rhosgobel (Southern Mirkwood)', RHOSGOBEL],
  ])('Blackbole IS playable at %s', (_label, site) => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site,
      hand: [BLACKBOLE],
    });
    const blackboleId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === blackboleId);

    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Blackbole is NOT playable at Dol Guldur (named exclusion, same region)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: DOL_GULDUR,
      hand: [BLACKBOLE],
    });
    const blackboleId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === blackboleId);

    expect(playActions).toHaveLength(0);
  });

  test('Blackbole is NOT playable outside the three Mirkwood regions', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: MORIA, // Redhorn Gate — not a permitted region
      hand: [BLACKBOLE],
    });
    const blackboleId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === blackboleId);

    expect(playActions).toHaveLength(0);
  });

  // ─── Immunity to automatic-attacks ───────────────────────────────────────

  test('Blackbole is NOT offered as a defender strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: SARN_GORIWING, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withBlackbole = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, BLACKBOLE);
    const withCombat = makeCancelWindowCombat(withBlackbole, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const asternakId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ASTERNAK);
    const blackboleId = withCombat.players[RESOURCE_PLAYER].characters[asternakId]?.allies[0]?.instanceId;
    expect(blackboleId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'assign-strike')
      .map(a => a.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === blackboleId)).toBe(false);
  });

  test('Blackbole is NOT offered as an attacker strike target against an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: SARN_GORIWING, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withBlackbole = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, BLACKBOLE);
    const withDefenderCombat = makeCancelWindowCombat(withBlackbole, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 2,
    });

    const asternakId = findCharInstanceId(withDefenderCombat, RESOURCE_PLAYER, ASTERNAK);
    const blackboleId = withDefenderCombat.players[RESOURCE_PLAYER].characters[asternakId]?.allies[0]?.instanceId;
    expect(blackboleId).toBeDefined();

    // Advance to the attacker-assignment window with Asternak already assigned.
    const combat: CombatState = {
      ...withDefenderCombat.combat!,
      strikeAssignments: [{ characterId: asternakId, excessStrikes: 0, resolved: false }],
      assignmentPhase: 'attacker',
    };
    const attackerState = { ...withDefenderCombat, combat };

    const assignActions = computeLegalActions(attackerState, PLAYER_2)
      .filter(a => a.viable && a.action.type === 'assign-strike')
      .map(a => a.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === blackboleId)).toBe(false);
  });

  // ─── Immunity to a site-type-keyed hazard creature at its site ───────────

  test('Blackbole is NOT offered as a strike target for a creature keyed to its site type', () => {
    // Company at Woodmen-town (border-hold); creature keyed to border-hold.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: SARN_GORIWING, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withBlackbole = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, BLACKBOLE);
    const withCombat = makeCancelWindowCombat(withBlackbole, {
      attackSiteKeyingTypes: [SiteType.BorderHold],
      strikesTotal: 2,
    });

    const asternakId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ASTERNAK);
    const blackboleId = withCombat.players[RESOURCE_PLAYER].characters[asternakId]?.allies[0]?.instanceId;
    expect(blackboleId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'assign-strike')
      .map(a => a.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === blackboleId)).toBe(false);
  });

  test('Blackbole IS offered as a strike target for a region-only-keyed creature (not at a site)', () => {
    // Creature keyed only by region type (no site-type keying) is not "at a
    // site" — Blackbole is a legal strike target.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: WOODMEN_TOWN, characters: [ASTERNAK] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: SARN_GORIWING, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const withBlackbole = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, BLACKBOLE);
    const withCombat = makeCancelWindowCombat(withBlackbole, {
      attackSiteKeyingTypes: [], // region-only keying
      strikesTotal: 2,
    });

    const asternakId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ASTERNAK);
    const blackboleId = withCombat.players[RESOURCE_PLAYER].characters[asternakId]?.allies[0]?.instanceId;
    expect(blackboleId).toBeDefined();

    const assignActions = computeLegalActions(withCombat, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'assign-strike')
      .map(a => a.action as AssignStrikeAction);

    expect(assignActions.some(a => a.characterId === blackboleId)).toBe(true);
  });
});
