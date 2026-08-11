/**
 * @module td-99.test
 *
 * Card test: Arrows Shorn of Ebony (td-99)
 * Type: hero-resource-item (minor), non-unique, 1 corruption point, hoard item.
 *
 * Card text:
 *   "Hoard item. Warrior only: discard Arrows Shorn of Ebony to modify a
 *    strike from a hazard creature attack not keyed to a site by -1
 *    prowess, -2 body. If this strike is defeated, all other subsequent
 *    failed strikes from this attack are automatically defeated."
 *
 * Effects:
 * | # | Effect Type                           | Notes                                                             |
 * |---|-----------------------------------------|--------------------------------------------------------------------|
 * | 1 | item-play-site                          | playable only at hoard sites                                       |
 * | 2 | modify-attack (scope: "current-strike") | cost: discard self; prowessModifier +1 (= creature -1 prowess),    |
 * |   |                                          | bodyModifier -2 (creature body, this strike only); when: warrior + |
 * |   |                                          | attack.source creature + attack.siteKeyed false;                   |
 * |   |                                          | cascadeDefeatOnSuccess: true                                       |
 *
 * Playable: YES.
 *
 * The "-1 prowess" is modeled as +1 to the defender's `strikeProwessBonus`
 * (mathematically equivalent for the single strike-roll comparison, same
 * convention as Shield of Iron-bound Ash tw-327). The "-2 body" is modeled
 * as a per-strike `strikeCreatureBodyModifier`, distinct from a whole-attack
 * `modify-attack`'s persistent `creatureBody` change — it affects only the
 * creature body check this one strike triggers. "If this strike is
 * defeated, all other subsequent failed strikes ... are automatically
 * defeated" reuses `CombatState.forcedStrikeDefeat` (the same flag Liquid
 * Fire wh-52 sets at combat initiation), set here mid-combat once the
 * triggering strike's fate — including any creature body check it triggers
 * — is finally known.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, SAM_GAMGEE, LEGOLAS, FRODO,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  resetMint, dispatch, executeAction,
  buildSitePhaseState, buildTestState,
  viableActions, attachItemToChar, findCharInstanceId, companyIdAt,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, CombatState, GameState, TapItemForStrikeAction } from '../../index.js';
import { Phase, Race, RegionType, SiteType } from '../../index.js';

const ARROWS = 'td-99' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // hoard site (Smaug's lair)

/**
 * Build a two-player M/H state with `bearerDefId` (and, if given,
 * `secondDefId`) in PLAYER_1's company at Moria, `ARROWS` attached to the
 * bearer, poised in a `resolve-strike` combat against a synthetic creature
 * attack. `strikeOverrides` seeds fields directly onto the bearer's own
 * (first) strike assignment — used by the cascade tests to skip straight to
 * "the item's ability has already been activated" without re-testing the
 * legal-action offering.
 */
function arrowsCombat(opts: {
  bearerDefId: CardDefinitionId;
  secondDefId?: CardDefinitionId;
  strikeProwess: number;
  creatureBody?: number | null;
  attackSource?: CombatState['attackSource'];
  attackKeying?: readonly RegionType[];
  attackSiteKeyingTypes?: readonly SiteType[];
  strikeOverrides?: Partial<CombatState['strikeAssignments'][number]>;
}): { state: GameState; bearerId: CardInstanceId; secondId?: CardInstanceId } {
  const characters = opts.secondDefId ? [opts.bearerDefId, opts.secondDefId] : [opts.bearerDefId];
  let base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  base = attachItemToChar(base, RESOURCE_PLAYER, opts.bearerDefId, ARROWS);
  const bearerId = findCharInstanceId(base, RESOURCE_PLAYER, opts.bearerDefId);
  const secondId = opts.secondDefId ? findCharInstanceId(base, RESOURCE_PLAYER, opts.secondDefId) : undefined;
  const companyId = companyIdAt(base, RESOURCE_PLAYER);

  const strikeAssignments: CombatState['strikeAssignments'] = [
    { characterId: bearerId, excessStrikes: 0, resolved: false, ...(opts.strikeOverrides ?? {}) },
    ...(secondId ? [{ characterId: secondId, excessStrikes: 0, resolved: false }] : []),
  ];

  const combat: CombatState = {
    attackSource: opts.attackSource ?? { type: 'creature', instanceId: 'synthetic-creature' as CardInstanceId },
    companyId,
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: strikeAssignments.length,
    strikeProwess: opts.strikeProwess,
    creatureBody: opts.creatureBody ?? null,
    creatureRace: Race.Orc,
    attackKeying: opts.attackKeying && opts.attackKeying.length > 0 ? opts.attackKeying : undefined,
    attackSiteKeyingTypes: opts.attackSiteKeyingTypes && opts.attackSiteKeyingTypes.length > 0 ? opts.attackSiteKeyingTypes : undefined,
    strikeAssignments,
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };

  return { state: { ...base, combat }, bearerId, secondId };
}

describe('Arrows Shorn of Ebony (td-99)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: hoard-item site restriction ───────────────────────────────

  test('playable at a hoard site (Lonely Mountain)', () => {
    const state = buildSitePhaseState({ site: LONELY_MOUNTAIN, characters: [ARAGORN], hand: [ARROWS] });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a non-hoard site (Moria)', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [ARROWS] });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Effect 2: legal-action offering (warrior / source / siteKeyed gates) ─

  test('tap-item-for-strike (discard) IS offered for a warrior bearer against a hazard creature attack not keyed to a site', () => {
    const { state, bearerId } = arrowsCombat({ bearerDefId: ARAGORN, strikeProwess: 8, attackKeying: [RegionType.Wilderness] });
    const actions = viableActions(state, PLAYER_1, 'tap-item-for-strike');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as TapItemForStrikeAction;
    expect(act.characterInstanceId).toBe(bearerId);
  });

  test('NOT offered for a non-warrior bearer (Sam Gamgee)', () => {
    const { state } = arrowsCombat({ bearerDefId: SAM_GAMGEE, strikeProwess: 8, attackKeying: [RegionType.Wilderness] });
    expect(viableActions(state, PLAYER_1, 'tap-item-for-strike')).toHaveLength(0);
  });

  test('NOT offered when the attack is keyed to a site type (no region keying)', () => {
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      strikeProwess: 8,
      attackSiteKeyingTypes: [SiteType.ShadowHold],
    });
    expect(viableActions(state, PLAYER_1, 'tap-item-for-strike')).toHaveLength(0);
  });

  test('NOT offered against an automatic-attack (not a hazard creature)', () => {
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      strikeProwess: 8,
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
    });
    expect(viableActions(state, PLAYER_1, 'tap-item-for-strike')).toHaveLength(0);
  });

  test('NOT offered against an on-guard-creature attack (keyed to the site by definition)', () => {
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      strikeProwess: 8,
      attackSource: { type: 'on-guard-creature', cardInstanceId: 'og-creature' as CardInstanceId },
    });
    expect(viableActions(state, PLAYER_1, 'tap-item-for-strike')).toHaveLength(0);
  });

  test('NOT offered when the bearer is not the character currently facing the strike', () => {
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      secondDefId: LEGOLAS,
      strikeProwess: 8,
      attackKeying: [RegionType.Wilderness],
    });
    // currentStrikeIndex is 0 (Aragorn's strike); swap it to Legolas's so the
    // bearer (Aragorn) is no longer the one being struck.
    const swapped: GameState = { ...state, combat: { ...state.combat!, currentStrikeIndex: 1 } };
    expect(viableActions(swapped, PLAYER_1, 'tap-item-for-strike')).toHaveLength(0);
  });

  // ─── Effect 2: activating discards the item and sets the strike fields ───

  test('activating discards Arrows (not tap) and sets +1 strikeProwessBonus, -2 strikeCreatureBodyModifier, cascadesOnDefeat', () => {
    const { state, bearerId } = arrowsCombat({ bearerDefId: ARAGORN, strikeProwess: 8, attackKeying: [RegionType.Wilderness] });
    const action = viableActions(state, PLAYER_1, 'tap-item-for-strike')[0].action;
    const after = dispatch(state, action);

    // The item is gone from the bearer and sits in the owner's discard pile —
    // not merely tapped.
    const bearer = after.players[RESOURCE_PLAYER].characters[bearerId];
    expect(bearer.items.some(i => i.definitionId === ARROWS)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === ARROWS)).toBe(true);

    const strike = after.combat!.strikeAssignments[0];
    expect(strike.strikeProwessBonus ?? 0).toBe(1);
    expect(strike.strikeCreatureBodyModifier ?? 0).toBe(-2);
    expect(strike.cascadesOnDefeat).toBe(true);
    expect(after.combat!.phase).toBe('resolve-strike');
  });

  // ─── Cascade: no creature body (result is final at the strike roll) ──────

  test('cascade (no body): defeating the modified strike auto-defeats a second strike that would otherwise wound', () => {
    // Creature prowess 9. Aragorn (prowess 6) rolls 3: without the item's
    // +1, 3+6=9 ties (not a defeat); with it, 3+6+1=10 > 9 — defeated. The
    // creature has no body, so 'success' is final immediately.
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      secondDefId: LEGOLAS,
      strikeProwess: 9,
      creatureBody: null,
      strikeOverrides: { strikeProwessBonus: 1, cascadesOnDefeat: true },
    });

    const afterStrike1 = executeAction(state, PLAYER_1, 'resolve-strike', 3, true);
    expect(afterStrike1.combat!.strikeAssignments[0].result).toBe('success');
    expect(afterStrike1.combat!.forcedStrikeDefeat).toBe(true);
    expect(afterStrike1.combat!.currentStrikeIndex).toBe(1);

    // Legolas (prowess 5) rolls a terrible 2: 2+5=7 < 9 would normally wound
    // him, but the cascade forces the strike to succeed regardless.
    const afterStrike2 = executeAction(afterStrike1, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike2.combat).toBeNull(); // both strikes resolved — combat over
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(afterStrike2.players[RESOURCE_PLAYER].characters[legolasId].status).not.toBe('inverted');
  });

  test('no cascade when the modified strike ties instead of winning (item bonus omitted)', () => {
    // Same roll (3) and creature prowess (9) as above, but WITHOUT the +1
    // bonus: 3+6=9 ties the creature — not a defeat, so no cascade.
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      secondDefId: LEGOLAS,
      strikeProwess: 9,
      creatureBody: null,
      strikeOverrides: { cascadesOnDefeat: true }, // item's prowess bonus NOT applied
    });

    const afterStrike1 = executeAction(state, PLAYER_1, 'resolve-strike', 3, true);
    expect(afterStrike1.combat!.strikeAssignments[0].result).toBe('tie');
    expect(afterStrike1.combat!.forcedStrikeDefeat ?? false).toBe(false);

    // Legolas faces the strike normally: a bad roll (2) against prowess 9 wounds him.
    const afterStrike2 = executeAction(afterStrike1, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike2.combat!.bodyCheckTarget).toBe('character');
  });

  // ─── Cascade: creature has body (result is final only after body check) ──

  test('cascade (with body): confirmed only once the strike-scoped -2 body check kills the creature', () => {
    // Creature prowess 9, body 8. Aragorn rolls 3 → strike total 10 > 9 with
    // the +1 bonus — defeated, opening a creature body check against body
    // 8-2=6 (the item's -2, this strike only). A roll of 7 beats 6 → creature dies.
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      secondDefId: LEGOLAS,
      strikeProwess: 9,
      creatureBody: 8,
      strikeOverrides: { strikeProwessBonus: 1, strikeCreatureBodyModifier: -2, cascadesOnDefeat: true },
    });

    const afterStrike1 = executeAction(state, PLAYER_1, 'resolve-strike', 3, true);
    expect(afterStrike1.combat!.bodyCheckTarget).toBe('creature');
    // Cascade not yet decided — the triggering strike's fate isn't final until the body check.
    expect(afterStrike1.combat!.forcedStrikeDefeat ?? false).toBe(false);

    const afterBodyCheck = executeAction(afterStrike1, PLAYER_1, 'body-check-roll', 7);
    expect(afterBodyCheck.combat!.forcedStrikeDefeat).toBe(true);
    expect(afterBodyCheck.combat!.currentStrikeIndex).toBe(1);

    // Legolas rolls terribly (2) against prowess 9 — would normally wound
    // him, but the cascade forces this strike to succeed too. The creature
    // still has body 8 (unmodified — the item's -2 only applied to Aragorn's
    // own triggering strike), so a second creature body check follows.
    const afterStrike2 = executeAction(afterBodyCheck, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike2.combat!.bodyCheckTarget).toBe('creature');
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(afterStrike2.players[RESOURCE_PLAYER].characters[legolasId].status).not.toBe('inverted');

    const afterFinalBodyCheck = executeAction(afterStrike2, PLAYER_1, 'body-check-roll', 9);
    expect(afterFinalBodyCheck.combat).toBeNull();
  });

  test('no cascade when the creature survives its (strike-scoped) body check', () => {
    // Same setup, but the body check rolls a 5: 5 <= reduced body 6 — the
    // creature survives, so the triggering strike is NOT "defeated" and no
    // cascade fires.
    const { state } = arrowsCombat({
      bearerDefId: ARAGORN,
      secondDefId: LEGOLAS,
      strikeProwess: 9,
      creatureBody: 8,
      strikeOverrides: { strikeProwessBonus: 1, strikeCreatureBodyModifier: -2, cascadesOnDefeat: true },
    });

    const afterStrike1 = executeAction(state, PLAYER_1, 'resolve-strike', 3, true);
    expect(afterStrike1.combat!.bodyCheckTarget).toBe('creature');

    const afterBodyCheck = executeAction(afterStrike1, PLAYER_1, 'body-check-roll', 5);
    expect(afterBodyCheck.combat!.strikeAssignments[0].result).toBe('survived');
    expect(afterBodyCheck.combat!.forcedStrikeDefeat ?? false).toBe(false);

    // Legolas faces the strike normally: a bad roll (2) against prowess 9 wounds him.
    const afterStrike2 = executeAction(afterBodyCheck, PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike2.combat!.bodyCheckTarget).toBe('character');
  });
});
