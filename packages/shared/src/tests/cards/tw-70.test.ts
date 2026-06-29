/**
 * @module tw-70.test
 *
 * Card test: Old Man Willow (tw-70)
 * Type: hazard-creature
 * Race: Awakened Plant. One strike at prowess 13 (no body check).
 *
 * Card text:
 *   "Awakened Plant. One strike. 15 prowess against Hobbits. May also be played
 *    keyed to Fangorn, Heart of Mirkwood, Southern Mirkwood, and Western
 *    Mirkwood; and may also be played at Ruins & Lairs [{R}], Shadow-holds
 *    [{S}], and Dark-holds [{D}] in these regions. Also playable at Old Forest
 *    and Drúadan Forest."
 *
 * Canonical playable cost (`data/cards.json`, TW-70): `{w}{w}` — two
 * wildernesses in the company's site path.
 *
 * Keying (`keyedTo`):
 *   - Base: two wildernesses {w}{w}.
 *   - Alt: named regions Fangorn, Heart/Southern/Western Mirkwood (a region-name
 *     match also covers the "at R&L/S/D in these regions" clause — a company at
 *     such a site is moving through that named region; same modeling as Giant
 *     Spiders tw-40).
 *   - Alt: specific sites Old Forest (Cardolan) and Drúadan Forest (Anórien),
 *     which lie outside the named Mirkwood regions, so they need explicit
 *     site-name entries.
 *
 * Effects:
 * | # | Effect Type   | Status      | Notes                                            |
 * |---|---------------|-------------|--------------------------------------------------|
 * | 1 | stat-modifier | IMPLEMENTED | +2 prowess (13→15) against a defending Hobbit    |
 *
 * The "15 prowess against Hobbits" bonus depends on the struck character's
 * race, which is unknown when combat is initiated, so it is applied per strike
 * in `resolveStrikeCore` (see `creatureDefenderProwessDelta`). `strikeProwess`
 * therefore stays at the base 13; the +2 only changes the strike comparison.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeDoubleWildernessMHState, makeMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve,
  executeAction, dispatch,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const OLD_MAN_WILLOW = 'tw-70' as CardDefinitionId;
const DOUBLE_WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

// ─── Helper: set up a single-character company facing Old Man Willow ─────────

function setupWillowCombat(defender: CardDefinitionId): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [defender] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
    ],
  });
  const ready = { ...state, phaseState: makeDoubleWildernessMHState() };
  const willowId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, willowId, companyId, DOUBLE_WILDERNESS_KEYING);
}

describe('Old Man Willow (tw-70)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: base {w}{w} ────────────────────────────────────────────────────

  test('playable keyed to double-wilderness path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeDoubleWildernessMHState() };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable on a single-wilderness path ({w}{w} requires two)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Keying: named regions ───────────────────────────────────────────────────

  test('playable keyed to a named Mirkwood region in path (covers R&L/S/D there)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    // Company arrives at a Dark-hold (Dol Guldur) in Southern Mirkwood — no
    // double-wilderness, but the named region keys the creature.
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Southern Mirkwood'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Dol Guldur',
    });
    const ready = { ...state, phaseState: mhState };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable on a non-keyed path/site (no wilderness, no named region, no listed site)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Gondor'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready = { ...state, phaseState: mhState };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Keying: specific sites Old Forest / Drúadan Forest ──────────────────────

  test('playable at Old Forest by site name (path does not satisfy region keying)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    // Old Forest is a Border-hold in Cardolan — not a named region, not double
    // wilderness — so only the site-name entry can key it here.
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Cardolan'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Old Forest',
    });
    const ready = { ...state, phaseState: mhState };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const matched = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(matched.length).toBeGreaterThan(0);
    // The match is by site-name, not region.
    expect(matched.some(a => a.action.type === 'play-hazard' && a.action.keyedBy?.method === 'site-name'
      && a.action.keyedBy.value === 'Old Forest')).toBe(true);
  });

  test('playable at Drúadan Forest by site name', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [OLD_MAN_WILLOW], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Drúadan Forest',
    });
    const ready = { ...state, phaseState: mhState };
    const willowId = handCardId(ready, HAZARD_PLAYER);
    const matched = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === willowId && a.viable);
    expect(matched.some(a => a.action.type === 'play-hazard' && a.action.keyedBy?.method === 'site-name'
      && a.action.keyedBy.value === 'Drúadan Forest')).toBe(true);
  });

  // ─── Combat: one strike, base prowess 13 ─────────────────────────────────────

  test('combat initiates with 1 strike, prowess 13, no body', () => {
    const afterChain = setupWillowCombat(ARAGORN);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    // Base prowess is 13: the "+2 vs Hobbits" is NOT folded in at initiation.
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.creatureBody).toBeNull();
  });

  // ─── "15 prowess against Hobbits" ───────────────────────────────────────────

  test('against a Hobbit: prowess is 15 — a roll that would tie at 13 instead wounds', () => {
    // Frodo: race hobbit, prowess 1, body 9. Roll 12 → 12 + 1 = 13.
    //   - At base prowess 13 this would be a tie (ineffectual, no wound).
    //   - At 15 (the Hobbit bonus) 13 < 15 → the strike wounds Frodo.
    const afterChain = setupWillowCombat(FRODO);
    const frodoId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FRODO);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: frodoId });
    // Single strike auto-advances to resolution.
    expect(s.combat!.phase).toBe('resolve-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12, true); // tap to fight at full prowess 1

    // Frodo was wounded → a body check against the character is pending.
    expect(s.combat).not.toBeNull();
    expect(s.combat!.phase).toBe('body-check');
    expect(s.combat!.bodyCheckTarget).toBe('character');

    // Body check 5 < body 9 → Frodo survives, wounded.
    s = executeAction(s, PLAYER_2, 'body-check-roll', 5);
    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[frodoId].status).toBe(CardStatus.Inverted);
  });

  test('against a non-Hobbit: prowess stays 13 — the same effective bonus does not apply', () => {
    // Aragorn: race dunadan, prowess 6. Roll 8 → 8 + 6 = 14.
    //   - At base prowess 13 the character defeats the strike (14 > 13).
    //   - If the Hobbit +2 wrongly applied (15), 14 < 15 would wound him.
    // Old Man Willow has no body, so a defeated strike ends combat.
    const afterChain = setupWillowCombat(ARAGORN);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expect(s.combat!.phase).toBe('resolve-strike');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 8, true); // 14 vs prowess 13 → success

    // Strike defeated, no body (creature) → combat ends, Aragorn unharmed.
    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
    expect(s.players[RESOURCE_PLAYER].outOfPlayPile.find(c => c.instanceId === aragornId)).toBeUndefined();
  });
});
