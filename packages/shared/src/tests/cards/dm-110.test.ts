/**
 * @module dm-110.test
 *
 * Card test: Spider of the Môrlat (dm-110)
 * Type: hazard-creature (dual creature / permanent-event), unique Spider,
 * Spawn. Two strikes, prowess 16, body 9, 4 kill MP.
 *
 * Card text:
 *   "Unique. Spider. Spawn. May be played as a hazard creature (with two
 *    strikes) or as a permanent-event. As a creature, she may be played at
 *    Dol Guldur and The Sulfur-deeps. If Doors of Night is in play, she may
 *    also be keyed to Southern Mirkwood, Heart of Mirkwood, or Woodland
 *    Realm; or at any adjacent site of The Sulfur-deeps.
 *    If played as a permanent-event, all Spider attacks receive +1 strike.
 *    Additionally, any company moving in Southern Mirkwood, Heart of
 *    Mirkwood, Woodland Realm, Dagorlad, or Brown Lands faces a Spider
 *    attack of 2 strikes with 10 prowess (detainment against minion
 *    companies). You can return Spider of the Môrlat as a permanent-event to
 *    your hand—which counts as one against the hazard limit."
 *
 * Engine support:
 * | # | Rule                                                        | Encoding                                                     |
 * |---|--------------------------------------------------------------|----------------------------------------------------------------|
 * | 1 | Two strikes, prowess 16, body 9, 4 kill MP                   | structural data                                                |
 * | 2 | Keyed to Dol Guldur / The Sulfur-deeps                        | keyedTo siteNames                                              |
 * | 3 | DoN: also keyed to Southern Mirkwood/Heart of Mirkwood/Woodland Realm | keyedTo regionNames, when inPlay DoN                  |
 * | 4 | DoN: also keyed to any adjacent site of The Sulfur-deeps      | keyedTo adjacentToSiteNames, when inPlay DoN (dm-107 field)     |
 * | 5 | Permanent-event mode                                          | creature-alt-event mode:"permanent-event", persistent:true      |
 * | 6 | +1 strike to all Spider attacks while in play                | stat-modifier target:"all-attacks", enemy.race spider           |
 * | 7 | Region ahunt attack (2 strikes/10 prowess) while in play      | ahunt-attack                                                    |
 * | 8 | "(detainment against minion companies)"                      | new AhuntAttackEffect.detainmentAgainstMinion field             |
 * | 9 | Voluntary return to hand, counts against hazard limit         | new CreatureAltEventEffect.returnToHandOption + return-alt-permanent-event action |
 *
 * The ahunt-attack (rule 7/8) only ever fires while the card sits in
 * `cardsInPlay`, which only happens in permanent-event mode — so it is
 * naturally scoped to "if played as a permanent-event" with no extra gating.
 * The card's own +1-strike stat-modifier (rule 6) self-applies to its own
 * ahunt-attack (both are "Spider" race), so the ahunt-attack in play deals 3
 * strikes, not 2 — verified below.
 *
 * `detainmentAgainstMinion` (rule 8) is a new `ahunt-attack`-only field
 * (distinct from the card-level `combat-detainment` effect) because the
 * detainment note is scoped to this one ahunt-attack sub-effect, not to the
 * card's own direct hazard-creature attack mode — engine gap found and fixed
 * by this certification: `buildAhuntCombat` (mh-steps.ts) previously computed
 * detainment from race/alignment alone, with no way for an ahunt-attack to
 * declare its own detainment rule.
 *
 * `returnToHandOption` (rule 9) is a new field alongside `persistent: true`:
 * a persistent permanent-event normally has no tap conversion at all, but
 * this card's sole conversion is "return to hand" rather than "become a
 * short-event" — a new `return-alt-permanent-event` action/reducer pair.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, RIVENDELL, LORIEN, MOUNT_DOOM,
  DOORS_OF_NIGHT,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions, dispatch, resolveChain,
  addCardInPlay,
  buildAhuntOrderEffectsState, runAhuntSequence,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, Alignment, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const SPIDER_OF_MORLAT = 'dm-110' as CardDefinitionId;
const SHELOB = 'tw-86' as CardDefinitionId; // another certified Spider creature

/** Basic M/H setup: P1 (moving) vs P2 (hazard, holding Spider of the Môrlat). */
function setup(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MOUNT_DOOM] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [SPIDER_OF_MORLAT], siteDeck: [] },
    ],
  });
}

describe('Spider of the Môrlat (dm-110)', () => {
  beforeEach(() => resetMint());

  // ─── Creature keying: base site names ──────────────────────────────────────

  test('playable as a creature at Dol Guldur', () => {
    const state = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Dol Guldur', destinationSiteType: SiteType.DarkHold }) };
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, { method: 'site-name', value: 'Dol Guldur' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(16);
  });

  test('playable as a creature at The Sulfur-deeps', () => {
    const state = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'The Sulfur-deeps', destinationSiteType: SiteType.DarkHold }) };
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, { method: 'site-name', value: 'The Sulfur-deeps' });
    expect(after.combat).not.toBeNull();
  });

  test('NOT playable at an unrelated site without Doors of Night', () => {
    const state = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Moria', destinationSiteType: SiteType.RuinsAndLairs }) };
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(plays).toHaveLength(0);
  });

  // ─── Creature keying: Doors of Night alternates ────────────────────────────

  test('NOT playable keyed to Southern Mirkwood without Doors of Night', () => {
    const state = {
      ...setup(),
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Southern Mirkwood'],
        destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
      }),
    };
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(plays).toHaveLength(0);
  });

  test('playable keyed to Southern Mirkwood with Doors of Night in play', () => {
    const base = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Moria', destinationSiteType: SiteType.RuinsAndLairs }) };
    const withDon = addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const state = {
      ...withDon,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Southern Mirkwood'],
        destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
      }),
    };
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, { method: 'region-name', value: 'Southern Mirkwood' });
    expect(after.combat).not.toBeNull();
  });

  test('NOT playable at an adjacent site of The Sulfur-deeps without Doors of Night', () => {
    const state = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold }) };
    const plays = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(plays).toHaveLength(0);
  });

  test('playable at The Under-gates (adjacent to The Sulfur-deeps) with Doors of Night in play', () => {
    const base = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold }) };
    const state = addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, creatureId, companyId, { method: 'adjacent-to-site-name', value: 'The Sulfur-deeps' },
    );
    expect(after.combat).not.toBeNull();
  });

  // ─── Dual mode: permanent-event ────────────────────────────────────────────

  test('permanent-event mode is offered with no Doors of Night gate and enters play untapped', () => {
    const state = { ...setup(), phaseState: makeMHState({ destinationSiteName: 'Moria', destinationSiteType: SiteType.RuinsAndLairs }) };
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const offered = viableActions(state, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(state, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: creatureId, targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === creatureId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  test('NOT offered as a permanent-event once the hazard limit is already reached', () => {
    const state = setup();
    const ready = {
      ...state,
      phaseState: makeMHState({
        destinationSiteName: 'Moria', destinationSiteType: SiteType.RuinsAndLairs,
        hazardLimitAtReveal: 2,
        hazardsPlayedThisCompany: 2,
      }),
    };
    const spiderId = handCardId(ready, HAZARD_PLAYER);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spiderId
        && (a.action as { altEventMode?: string }).altEventMode === 'permanent-event' && a.viable);
    expect(offered).toBe(false);
  });

  test('persistent — tap-alt-permanent-event is never offered once in play', () => {
    const base = setup();
    const state = addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT);
    const spiderId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SPIDER_OF_MORLAT)!.instanceId;
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const tapActions = viableActions(ready, PLAYER_2, 'tap-alt-permanent-event')
      .filter(a => a.action.type === 'tap-alt-permanent-event' && a.action.cardInstanceId === spiderId);
    expect(tapActions).toHaveLength(0);
  });

  // ─── Ahunt attack while in play, with self-boosted strikes and detainment ──

  test('a company moving through a listed region faces her ahunt attack: 2+1=3 strikes at 10 prowess', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Dagorlad'],
      pathTypes: [RegionType.Shadow],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat!;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.creatureRace).toBe('spider');
    // Printed 2 strikes + the card's own "+1 strike to all Spider attacks"
    // while she is in play (both effects are sourced from the same card).
    expect(combat.strikesTotal).toBe(3);
    expect(combat.strikeProwess).toBe(10);
  });

  test('a company moving elsewhere faces no attack', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Rhudaur'],
      pathTypes: [RegionType.Wilderness],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('the strike boost also reaches an unrelated Spider creature\'s attack while Spider of the Môrlat is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MOUNT_DOOM] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [SHELOB], siteDeck: [] },
      ],
    });
    const readyState = {
      ...addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT),
      phaseState: makeMHState({
        resolvedSitePathNames: ['Gorgoroth'],
        destinationSiteName: 'Barad-dûr',
      }),
    };
    const shelobId = handCardId(readyState, HAZARD_PLAYER);
    const companyId = companyIdAt(readyState, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      readyState, PLAYER_2, shelobId, companyId,
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    // Shelob's printed 1 strike + the Spider of the Môrlat's "+1 strike to all Spider attacks".
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(18);
  });

  test('the ahunt attack is detainment against a minion (Ringwraith) company', () => {
    const base = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Brown Lands'],
      pathTypes: [RegionType.Shadow],
    });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], alignment: Alignment.Ringwraith },
        base.players[1],
      ] as typeof base.players,
    };
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.detainment).toBe(true);
  });

  test('the ahunt attack is NOT detainment against a hero company', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Brown Lands'],
      pathTypes: [RegionType.Shadow],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).not.toBeNull();
    expect(next.combat!.detainment).toBe(false);
  });

  test('a defeated ahunt attack awards no kill MP even though it is detainment (minion defender)', () => {
    const base = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Woodland Realm'],
      pathTypes: [RegionType.Border],
    });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], alignment: Alignment.Ringwraith },
        base.players[1],
      ] as typeof base.players,
    };
    const start = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    const { end } = runAhuntSequence(start, 12);
    expect(end.combat).toBeNull();
    expect(end.players[RESOURCE_PLAYER].marshallingPoints.kill).toBe(0);
  });

  // ─── Voluntary return to hand ───────────────────────────────────────────────

  test('offers return-alt-permanent-event (not tap-alt-permanent-event) once in play', () => {
    const base = setup();
    const state = addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT);
    const spiderId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SPIDER_OF_MORLAT)!.instanceId;
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const returnActions = viableActions(ready, PLAYER_2, 'return-alt-permanent-event')
      .filter(a => a.action.type === 'return-alt-permanent-event' && a.action.cardInstanceId === spiderId && a.viable);
    expect(returnActions).toHaveLength(1);
  });

  test('returning to hand moves the card out of play and counts against the hazard limit', () => {
    const base = setup();
    const state = addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT);
    const spiderId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SPIDER_OF_MORLAT)!.instanceId;
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    const after = dispatch(ready, { type: 'return-alt-permanent-event', player: PLAYER_2, cardInstanceId: spiderId });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === spiderId)).toBe(false);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.instanceId === spiderId)).toBe(true);
    expect((after.phaseState as { hazardsPlayedThisCompany: number }).hazardsPlayedThisCompany).toBe(1);
  });

  test('return-alt-permanent-event is not viable once the hazard limit is reached', () => {
    const base = setup();
    const state = addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT);
    const spiderId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SPIDER_OF_MORLAT)!.instanceId;
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 }) };

    const returnActions = viableActions(ready, PLAYER_2, 'return-alt-permanent-event')
      .filter(a => a.action.type === 'return-alt-permanent-event' && a.action.cardInstanceId === spiderId);
    expect(returnActions.every(a => !a.viable)).toBe(true);
  });
});
