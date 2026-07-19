/**
 * @module tw-347.test
 *
 * Card test: The One Ring (tw-347)
 * Type: hero-resource-item (special), unique
 *
 * "Unique. The One Ring. Playable only with a Gold Ring and after a test
 *  indicates The One Ring. +5 prowess (to a maximum of double the bearer's
 *  starting prowess). +5 to body (to a maximum of 10). +5 to direct influence.
 *  Bearer may make a corruption check modified by -2 to cancel a strike against
 *  himself; this does not work against Undead and Nazgûl strikes. +1 corruption
 *  point to every character in the bearer's company."
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                                |
 * |---|--------------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | +5 prowess (max = double base prowess)           | IMPLEMENTED | stat-modifier, max "bearer.baseProwess * 2"          |
 * | 2 | +5 body (max 10)                                 | IMPLEMENTED | stat-modifier, max 10                                |
 * | 3 | +5 direct influence                              | IMPLEMENTED | stat-modifier                                        |
 * | 4 | +1 corruption point to every company character   | IMPLEMENTED | stat-modifier target=company, corruption-points      |
 * | 5 | Corruption-check cancel-strike (-2), not Undead/ | IMPLEMENTED | cancel-strike, cost {check corruption, modifier -2}  |
 * |   | Nazgûl                                            |             |                                                      |
 *
 * The stat modifiers apply while the ring is borne. The prowess cap is *double
 * the bearer's starting prowess*, so a low-prowess bearer (Frodo) is capped
 * hard while a high-prowess bearer is not.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  getCharacter, pool, makeMHState,
  findCharInstanceId, handCardId, companyIdAt, resolveChain, dispatch, actionAs,
} from '../test-helpers.js';
import {
  ARAGORN, FRODO, LEGOLAS, THE_ONE_RING,
  ORC_LIEUTENANT, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  computeLegalActions, SiteType,
} from '../../index.js';
import type { CardDefinitionId, CharacterCard, GameState, CancelStrikeAction, CorruptionCheckAction } from '../../index.js';

/** Build an org-phase state with `bearer` (+ optional companion) in P1's company. */
function stateWithRing(bearer: CardDefinitionId, companion?: CardDefinitionId) {
  const characters = companion
    ? [{ defId: bearer, items: [THE_ONE_RING] }, { defId: companion }]
    : [{ defId: bearer, items: [THE_ONE_RING] }];
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

describe('The One Ring (tw-347)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +5 prowess (max = double the bearer's starting prowess) ──

  test('prowess +5 (max bearer.baseProwess * 2)', () => {
    // Frodo base prowess 1 → +5 would be 6, but the cap is 1 * 2 = 2.
    const frodoDef = pool[FRODO as string] as CharacterCard;
    expect(frodoDef.prowess).toBe(1);
    const state = stateWithRing(FRODO);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.prowess).toBe(2);
  });

  test('+5 prowess is NOT capped when double the base leaves room (Aragorn base 6)', () => {
    // Aragorn base prowess 6 → +5 = 11, cap = 6 * 2 = 12, so the full +5 applies.
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(aragornDef.prowess + 5);
  });

  // ── Effect 2: +5 body (max 10) ──

  test('body +5 (max 10)', () => {
    // Frodo base body 9 → +5 = 14, clamped to the maximum of 10.
    const frodoDef = pool[FRODO as string] as CharacterCard;
    expect(frodoDef.body).toBe(9);
    const state = stateWithRing(FRODO);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.body).toBe(10);
  });

  // ── Effect 3: +5 direct influence ──

  test('direct-influence +5', () => {
    // Frodo base DI 1 → +5 = 6 (no cap on direct influence).
    const frodoDef = pool[FRODO as string] as CharacterCard;
    const state = stateWithRing(FRODO);
    expect(getCharacter(state, RESOURCE_PLAYER, FRODO).effectiveStats.directInfluence).toBe(frodoDef.directInfluence + 5);
  });

  // ── Effect 4: +1 corruption point to every character in the bearer's company ──

  test('company modifier: corruption-points', () => {
    // The ring adds +1 corruption point to every character in the company —
    // isolate the company effect on a companion who does not bear the ring.
    const withRing = stateWithRing(FRODO, ARAGORN);
    const companionWith = getCharacter(withRing, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;

    // Baseline: same companion in a company with no ring present.
    const noRing = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companionWithout = getCharacter(noRing, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;

    expect(companionWith).toBe(companionWithout + 1);
  });

  // ── Effect 5: corruption-check cancel-strike (not vs Undead / Nazgûl) ──

  /**
   * Drive a single-strike creature attack to the resolve-strike sub-phase with
   * Aragorn (bearing The One Ring) facing the strike at Moria (a shadow-hold).
   * Aragorn has no innate corruption check-modifier, so the ring's -2 is the
   * whole modifier — unlike Frodo, whose printed +4 would mask it.
   */
  function ringBearerFacingStrike(creature: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [creature], siteDeck: [RIVENDELL] },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...base, phaseState: mh };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: creatureId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);
    let r = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    if (r.combat && r.combat.phase === 'choose-strike-order') {
      const idx = r.combat.strikeAssignments.findIndex(sa => sa.characterId === aragornId);
      r = dispatch(r, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: idx });
    }
    return r;
  }

  test('cancel strike ability conditional', () => {
    // Aragorn bears The One Ring and faces an Orc-lieutenant strike (not Undead/
    // Nazgûl) → the corruption-check cancel-strike is offered, keyed to the ring.
    const r = ringBearerFacingStrike(ORC_LIEUTENANT);
    expect(r.combat?.phase).toBe('resolve-strike');

    const aragornId = findCharInstanceId(r, RESOURCE_PLAYER, ARAGORN);
    const ringId = getCharacter(r, RESOURCE_PLAYER, ARAGORN).items[0].instanceId;

    const cancelActions = computeLegalActions(r, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'cancel-strike')
      .map(a => actionAs<CancelStrikeAction>(a.action));
    expect(cancelActions).toHaveLength(1);
    expect(cancelActions[0].cancellerInstanceId).toBe(ringId);
    expect(cancelActions[0].targetCharacterId).toBe(aragornId);

    // Paying the cost: the bearer makes a corruption check (modified by -2). The
    // strike is canceled; the ring is NOT tapped (a corruption check is not a tap).
    const after = dispatch(r, cancelActions[0]);

    const cc = after.pendingResolutions.find(p => p.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
    expect((cc!.kind as { characterId: string }).characterId).toBe(aragornId);
    expect((cc!.kind as { modifier: number }).modifier).toBe(-2);

    const ringAfter = getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.find(i => i.definitionId === THE_ONE_RING);
    expect(ringAfter?.status).toBe(CardStatus.Untapped);

    // The enqueued corruption check surfaces as the bearer's next legal action,
    // carrying the ring's -2 (Aragorn has no innate corruption modifier).
    const ccActions = computeLegalActions(after, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => actionAs<CorruptionCheckAction>(a.action));
    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].characterId).toBe(aragornId);
    expect(ccActions[0].corruptionModifier).toBe(-2);
  });

  test('does NOT offer the cancel-strike against an Undead strike (Barrow-wight)', () => {
    // The ability "does not work against Undead and Nazgûl strikes": a Barrow-wight
    // (undead) strike against the ring bearer offers no corruption-check cancel.
    const r = ringBearerFacingStrike(BARROW_WIGHT);
    expect(r.combat?.phase).toBe('resolve-strike');

    const cancelActions = computeLegalActions(r, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelActions).toHaveLength(0);
  });
});
