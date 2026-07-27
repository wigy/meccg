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
 * | 0 | Playable only with a gold ring, after a test     | IMPLEMENTED | subtype "special" (never in a site's                 |
 * |   | that indicates The One Ring                      |             | playableResources) + keyword "the-one-ring" matched  |
 * |   |                                                  |             | against the gold ring's `ring-test-table` categories |
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
 *
 * The One Ring is a `special` item with 6 corruption points; the company-scoped
 * +1 reaches the bearer too (7 in total for him), since "every character in the
 * bearer's company" includes the bearer.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  getCharacter, pool, makeMHState,
  findCharInstanceId, findHandCardId, handCardId, companyIdAt, resolveChain, dispatch, actionAs,
  attachItemToChar, addCardToHand, enqueueGoldRingTest, viableActions,
} from '../test-helpers.js';
import {
  ARAGORN, FRODO, LEGOLAS, THE_ONE_RING,
  ORC_LIEUTENANT, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  computeLegalActions, RegionType, SiteType,
} from '../../index.js';
import type { CardDefinitionId, CharacterCard, GameState, CancelStrikeAction, CorruptionCheckAction } from '../../index.js';

/** Precious Gold Ring (tw-306) — its test table indicates The One Ring on a total of 10+. */
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
/** Ûvatha the Horseman (tw-107) — a Nazgûl (race `ringwraith`) hazard creature. */
const UVATHA = 'tw-107' as CardDefinitionId;

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

  // ── Playability: only with a gold ring, after a test indicating The One Ring ──

  test('cannot be played as an ordinary item at a site', () => {
    // Moria allows minor, major, greater and gold-ring items — but The One Ring
    // is a `special` item, which no site lists as a playable resource, so the
    // only route into play is a gold-ring test.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [THE_ONE_RING],
    });
    const ringId = findHandCardId(state, RESOURCE_PLAYER, THE_ONE_RING);
    const plays = computeLegalActions(state, PLAYER_1).filter(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: string }).cardInstanceId === (ringId as string),
    );
    expect(plays).toHaveLength(0);
  });

  test('offered after a gold-ring test whose total indicates The One Ring (10+ on Precious Gold Ring)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withGoldRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, THE_ONE_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 10 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    expect(viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')).toHaveLength(1);
  });

  test('NOT offered when the test total indicates only a Dwarven-ring (8)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withGoldRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, THE_ONE_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 8 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    expect(viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')).toHaveLength(0);
  });

  test('Unique: NOT offered while a One Ring is already in play (opponent bears one)', () => {
    // "Unique." — the ring-test route may not put a second copy into play, even
    // though both players may legally hold one in hand.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [{ defId: LEGOLAS, items: [THE_ONE_RING] }] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withGoldRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, THE_ONE_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 12 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    expect(viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')).toHaveLength(0);
  });

  test('played via the test: moves from hand onto the gold ring bearer and grants its bonuses', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withGoldRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, THE_ONE_RING);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 12 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );
    const afterPlay = dispatch(afterRoll, viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action);

    // The tested gold ring is gone (discarded by the test), The One Ring is borne.
    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THE_ONE_RING)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === THE_ONE_RING),
    ).toBeDefined();
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess)
      .toBe(aragornDef.prowess + 5);
  });

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

  test('the bearer is also "a character in the bearer\'s company": 6 printed + 1 = 7', () => {
    // The ring's own 6 corruption points are borne by its holder; the +1 the ring
    // gives "every character in the bearer's company" reaches him as well.
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(7);
  });

  // ── Effect 5: corruption-check cancel-strike (not vs Undead / Nazgûl) ──

  /**
   * Drive a single-strike creature attack to the resolve-strike sub-phase with
   * Aragorn (bearing The One Ring) facing the strike at Moria (a shadow-hold).
   * Aragorn has no innate corruption check-modifier, so the ring's -2 is the
   * whole modifier — unlike Frodo, whose printed +4 would mask it.
   *
   * A Nazgûl (`ringwraith`) creature keys to a Dark-hold in a Dark-domain path
   * instead, so `keying` overrides the declared M/H destination for that case.
   */
  function ringBearerFacingStrike(
    creature: CardDefinitionId,
    keying: { siteType: SiteType; siteName: string; regionTypes: RegionType[]; regionNames: string[] } = {
      siteType: SiteType.ShadowHold, siteName: 'Moria', regionTypes: [], regionNames: [],
    },
  ): GameState {
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
      resolvedSitePath: keying.regionTypes,
      resolvedSitePathNames: keying.regionNames,
      destinationSiteType: keying.siteType,
      destinationSiteName: keying.siteName,
    });
    const gameState = { ...base, phaseState: mh };

    const creatureId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: creatureId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: keying.siteType as string },
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

  test('does NOT offer the cancel-strike against a Nazgûl strike (Ûvatha the Horseman)', () => {
    // The other half of "does not work against Undead and Nazgûl strikes": a
    // ringwraith creature keyed to a Dark-hold in a Dark-domain path.
    const r = ringBearerFacingStrike(UVATHA, {
      siteType: SiteType.DarkHold,
      siteName: 'Barad-dûr',
      regionTypes: [RegionType.Dark],
      regionNames: ['Gorgoroth'],
    });
    expect(r.combat?.phase).toBe('resolve-strike');
    expect(r.combat?.creatureRace).toBe('ringwraith');

    const cancelActions = computeLegalActions(r, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelActions).toHaveLength(0);
  });
});
