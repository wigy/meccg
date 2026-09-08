/**
 * @module dm-65.test
 *
 * Card test: In Darkness Bind Them (dm-65)
 * Type: hazard-event (permanent), non-unique
 *
 * Card text:
 *   "Any creature that can be keyed to one single Shadow-land [{s}] may be
 *   keyed to Ithilien, Harondor, Horse Plains, Khand, Imlad Morgul, Nurn,
 *   Gorgoroth, Udûn, or Dagorlad. Any creature that can be keyed to a
 *   Dark-domain [{d}] may be keyed to Khand, Imlad Morgul, Nurn, Gorgoroth,
 *   Udûn, or Dagorlad. Discard this card when a creature keyed to one of
 *   these regions (not to the region symbol) is defeated."
 *
 * Effects:
 *   1. `grant-creature-keying` — creatures whose printed `keyedTo` requires
 *      exactly one Shadow-land [{s}] may also be keyed to the 9 named
 *      regions (`requiresKeyedToRegionType: { regionType: "shadow",
 *      exactCount: 1 }`, `siteFilter.regionNames`).
 *   2. `grant-creature-keying` — creatures whose printed `keyedTo` requires
 *      any Dark-domain [{d}] may also be keyed to the 6-name subset
 *      (`requiresKeyedToRegionType: { regionType: "dark" }`).
 *   3. `on-event: attack-defeated` — discards the card when the defeated
 *      attack was keyed (natively or via the grant) to one of the 9 named
 *      regions (`attack.keyingRegionNames`).
 *
 * Test fixtures:
 *   - Barrow-wight (le-61): keyedTo [{regionTypes:["shadow","dark"]}] — a
 *     single Shadow-land AND a Dark-domain in one entry (one strike, prowess
 *     12, body null); satisfies both grants.
 *   - Akhôrahil (tw-4): keyedTo [{regionTypes:["dark"],siteTypes:["dark-hold"]},
 *     {regionNames:["Harondor","Horse Plains","Gorgoroth","Khand"]}] — a
 *     Dark-domain requirement with NO Shadow-land entry at all, isolating the
 *     second grant; its native `regionNames` deliberately excludes "Nurn" so
 *     a grant-sourced match to "Nurn" cannot be confused with native keying.
 *   - Wild Fell Beast (td-81): keyedTo [{regionTypes:["shadow","shadow"]}] —
 *     a DOUBLE Shadow-land requirement, excluded by the "one single" qualifier.
 *   - Assassin (tw-8): keyedTo [{siteTypes:["free-hold","border-hold"]}] — no
 *     region-type keying at all, so neither grant applies.
 *
 * | # | Rule                                                              | Status      | Notes |
 * |---|--------------------------------------------------------------------|-------------|-------|
 * | 1 | Single-Shadow-land creatures keyable to the 9 named regions        | IMPLEMENTED | grant-creature-keying siteFilter.regionNames |
 * | 2 | Double-Shadow-land creatures excluded ("one single")               | IMPLEMENTED | requiresKeyedToRegionType exactCount:1 |
 * | 3 | Dark-domain creatures keyable to the 6-name subset                 | IMPLEMENTED | grant-creature-keying (no exactCount) |
 * | 4 | Dark-domain grant does not open names outside its own list        | IMPLEMENTED | siteFilter.regionNames per-effect list |
 * | 5 | Creatures with neither keying are unaffected                      | IMPLEMENTED | requiresKeyedToRegionType gate |
 * | 6 | Discards itself when a grant-keyed creature's attack is defeated  | IMPLEMENTED | on-event attack-defeated + attack.keyingRegionNames |
 * | 7 | Not discarded when the defeated attack is keyed elsewhere         | IMPLEMENTED | when: $or of $includes gates on the 9 names only |
 *
 * Playable: YES
 * Certified: 2026-09-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  resetMint, buildTestState, makeMHState,
  viableActions, dispatch, resolveChain, findCharInstanceId,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayHazardAction,
} from '../../index.js';

const IN_DARKNESS_BIND_THEM = 'dm-65' as CardDefinitionId;
const BARROW_WIGHT = 'le-61' as CardDefinitionId;       // single Shadow-land + Dark-domain in one entry
const AKHORAHIL = 'tw-4' as CardDefinitionId;           // Dark-domain only, no Shadow-land at all
const WILD_FELL_BEAST = 'td-81' as CardDefinitionId;    // double Shadow-land ({s}{s})
const ASSASSIN = 'tw-8' as CardDefinitionId;            // Border/Free-hold site keying only

const inDarknessInPlay: CardInPlay = {
  instanceId: 'idbt-1' as CardInstanceId,
  definitionId: IN_DARKNESS_BIND_THEM,
  status: CardStatus.Untapped,
};

/**
 * Movement/Hazard state for the hazard player's company arriving through a
 * path with an empty region-type list (so no *native* region-type/site-type
 * keying can match) but named `regionName` — isolating whichever
 * `grant-creature-keying` named-region branch is under test.
 */
function regionState(
  regionName: string,
  hazardHand: CardDefinitionId[],
  withCard: boolean,
): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: hazardHand, siteDeck: [MORIA],
        cardsInPlay: withCard ? [inDarknessInPlay] : [],
      },
    ],
  });
  return { ...base, phaseState: makeMHState({ resolvedSitePathNames: [regionName] }) };
}

/** The offered `play-hazard` action for `instanceId`, if keyed via keying-bypass. */
function keyingBypassAction(state: GameState, instanceId: CardInstanceId): PlayHazardAction | undefined {
  const ea = viableActions(state, PLAYER_2, 'play-hazard').find(ea => {
    const a = ea.action as PlayHazardAction;
    return a.cardInstanceId === instanceId && a.keyedBy?.method === 'keying-bypass';
  });
  return ea?.action as PlayHazardAction | undefined;
}

describe('In Darkness Bind Them (dm-65)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: single-Shadow-land grant ────────────────────────────────

  test('a single-Shadow-land creature (Barrow-wight) is keyable to Ithilien while the card is in play', () => {
    const state = regionState('Ithilien', [BARROW_WIGHT], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const action = keyingBypassAction(state, instanceId);
    expect(action).toBeDefined();
    expect(action!.keyedBy?.grantedRegionName).toBe('Ithilien');
  });

  test('without the card in play, Barrow-wight is NOT keyable to Ithilien (no viable play-hazard at all)', () => {
    const state = regionState('Ithilien', [BARROW_WIGHT], false);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(keyingBypassAction(state, instanceId)).toBeUndefined();
    expect(viableActions(state, PLAYER_2, 'play-hazard').some(ea => (ea.action as PlayHazardAction).cardInstanceId === instanceId)).toBe(false);
  });

  test('a DOUBLE-Shadow-land creature (Wild Fell Beast) is NOT granted keying to Ithilien ("one single" qualifier)', () => {
    const state = regionState('Ithilien', [WILD_FELL_BEAST], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(keyingBypassAction(state, instanceId)).toBeUndefined();
  });

  // ─── Effect 2: Dark-domain grant ───────────────────────────────────────

  test('a Dark-domain-only creature (Akhôrahil, no Shadow-land keying) is keyable to Nurn while the card is in play', () => {
    const state = regionState('Nurn', [AKHORAHIL], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const action = keyingBypassAction(state, instanceId);
    expect(action).toBeDefined();
    expect(action!.keyedBy?.grantedRegionName).toBe('Nurn');
  });

  test('Akhôrahil is NOT keyable to Ithilien (outside the Dark-domain grant\'s 6-name list, and it has no Shadow-land keying)', () => {
    const state = regionState('Ithilien', [AKHORAHIL], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(keyingBypassAction(state, instanceId)).toBeUndefined();
    // Akhôrahil may also be offered as a permanent-event (creature-alt-event,
    // unrelated to keying) — only the creature-mode plays (no altEventMode)
    // are relevant here, and none should be viable.
    expect(viableActions(state, PLAYER_2, 'play-hazard').some(ea => {
      const a = ea.action as PlayHazardAction;
      return a.cardInstanceId === instanceId && !a.altEventMode;
    })).toBe(false);
  });

  // ─── Neither grant applies ──────────────────────────────────────────────

  test('a creature with no Shadow-land/Dark-domain keying at all (Assassin) is unaffected by either grant', () => {
    const state = regionState('Ithilien', [ASSASSIN], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(keyingBypassAction(state, instanceId)).toBeUndefined();
    expect(viableActions(state, PLAYER_2, 'play-hazard').some(ea => (ea.action as PlayHazardAction).cardInstanceId === instanceId)).toBe(false);
  });

  // ─── Effect 3: discard when a creature keyed to a listed region is defeated ──

  test('discards itself when a creature keyed via the grant to a listed region (Ithilien) is defeated', () => {
    const state = regionState('Ithilien', [BARROW_WIGHT], true);
    const instanceId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const action = keyingBypassAction(state, instanceId);
    expect(action).toBeDefined();
    expect(action!.keyedBy?.grantedRegionName).toBe('Ithilien');

    let s = resolveChain(dispatch(state, action!));
    expect(s.combat?.strikesTotal).toBe(1);
    expect(s.combat?.strikeProwess).toBe(12);

    // Aragorn takes the single strike; roll 12 + prowess 6 = 18 > 12 → parried.
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    s = dispatch({ ...s, cheatRollTotal: 12 }, resolveActions[0].action);

    expect(s.combat).toBeNull();
    expect(s.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(IN_DARKNESS_BIND_THEM);
    expect(s.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(IN_DARKNESS_BIND_THEM);
  });

  test('does NOT discard when a creature is defeated via NATIVE Shadow-land keying to an unlisted region', () => {
    // Barrow-wight keyed natively (region-type "shadow") to a region named
    // "Mirkwood" — not one of the 9 named regions dm-65 lists, and the
    // native match records keyedBy.method "region-type" (not "region-name"
    // or a grant), so attack.keyingRegionNames stays empty.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        {
          id: PLAYER_2, alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BARROW_WIGHT], siteDeck: [MORIA],
          cardsInPlay: [inDarknessInPlay],
        },
      ],
    });
    const state = {
      ...base,
      phaseState: makeMHState({ resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Mirkwood'] }),
    };

    let s = resolveChain(dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: state.players[HAZARD_PLAYER].hand[0].instanceId,
      targetCompanyId: state.players[RESOURCE_PLAYER].companies[0].id,
      keyedBy: { method: 'region-type' as const, value: 'shadow' },
    }));
    expect(s.combat?.strikesTotal).toBe(1);

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const resolveActions = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
    s = dispatch({ ...s, cheatRollTotal: 12 }, resolveActions[0].action);

    expect(s.combat).toBeNull();
    // Defeated, but not keyed to any of the 9 listed regions → card stays in play.
    expect(s.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(IN_DARKNESS_BIND_THEM);
  });
});
