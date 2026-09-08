/**
 * @module dm-81.test
 *
 * Card test: Reaching Shadow (dm-81)
 * Type: hazard-event (permanent), non-unique, Neutral.
 *
 * Card text (authoritative — data/cards.json DM-81):
 *   "Any creature that can be keyed to one single Shadow-land [{s}] may be
 *    keyed to Anduin Vales, Northern Rhovanion, Southern Rhovanion, Grey
 *    Mountain Narrows, Woodland Realm, Western Mirkwood, Heart of Mirkwood,
 *    Southern Mirkwood, Brown Lands, or Dagorlad. Any creature that can be
 *    keyed to a Dark-domain [{d}] may be keyed to Heart of Mirkwood, Southern
 *    Mirkwood, Brown Lands, or Dagorlad. Discard this card when a creature
 *    keyed to one of these regions (not to the region symbol) is defeated."
 *
 * CRF 22 ruling: "May not be used to play creatures keyed to double
 * Shadow-lands." / "This card allows you to key creatures to the mentioned
 * regions by name. It does not change the region type used to judge whether
 * an attack is detainment or not."
 *
 * Effects:
 *   1. `grant-creature-keying` — any creature whose own `keyedTo` requires a
 *      single Shadow-land [{s}] (`requiresKeyedToRegionType` shadow with
 *      `exactCount: 1` — a double-Shadow-land requirement does NOT qualify) may be
 *      keyed to any of the ten named regions via `siteFilter.regionNames`.
 *   2. `grant-creature-keying` — any creature whose own `keyedTo` requires a
 *      single Dark-domain [{d}] may be keyed to the four named regions that
 *      overlap Mordor/Mirkwood.
 *   3. `on-event: attack-defeated` — discard self when the defeated attack's
 *      `keyingRegionNames` includes one of the ten named regions (i.e. the
 *      creature was keyed via this card's grant, not its own printed region
 *      symbol elsewhere on the path).
 *
 * Test creatures:
 *   - Lesser Spiders (td-42): non-unique Spider, keyed to Wilderness+Shadow
 *     [{w}{s}] or Ruins & Lairs [{R}] — single Shadow-land → qualifies for
 *     effect 1.
 *   - Wild Fell Beast (td-81): non-unique Drake, keyed ONLY to double
 *     Shadow-land [{s}{s}] — does NOT qualify (CRF double-Shadow exclusion).
 *   - Dwar of Waw (tw-31): unique Nazgûl, keyed to Dark-domain [{d}] or
 *     Dark-hold [{D}] (plus unrelated Doors-of-Night named regions) — no
 *     Shadow-land keying at all, so only effect 2 (dark-domain) can grant it.
 *
 * | # | Effect                                              | Status      | Notes                                              |
 * |---|------------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | grant-creature-keying (single Shadow-land → 10 names) | IMPLEMENTED | grantsCreatureKeying siteFilter.regionNames         |
 * | 2 | grant-creature-keying (single Dark-domain → 4 names)  | IMPLEMENTED | same mechanism, narrower creatureFilter/regionNames |
 * | 3 | double-Shadow-land exclusion                          | IMPLEMENTED | creatureKeyedToSingleRegionTypes (per-entry count)  |
 * | 4 | on-event: attack-defeated, discard (via grant only)   | IMPLEMENTED | keyedBy.grantedRegionName → attackKeyingRegionNames |
 *
 * Playable: YES
 * Certified: 2026-09-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, FRODO,
  MINAS_TIRITH, LORIEN, WELLINGHALL, BANDIT_LAIR,
  resetMint, buildTestState, makeMHState,
  viableActions, dispatch, resolveChain, continueAutoAttackCombat,
  handCardId,
  CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayHazardAction, MovementHazardPhaseState,
} from '../../index.js';

const REACHING_SHADOW = 'dm-81' as CardDefinitionId;
// Lesser Spiders: non-unique Spider, keyed to {w}{s} or Ruins & Lairs [{R}] —
// single Shadow-land, so it qualifies for Reaching Shadow's shadow-land grant.
const LESSER_SPIDERS = 'td-42' as CardDefinitionId;
// Wild Fell Beast: non-unique Drake, keyed ONLY to double Shadow-land [{s}{s}]
// — must NOT qualify (CRF: "may not be used to play creatures keyed to
// double Shadow-lands").
const WILD_FELL_BEAST = 'td-81' as CardDefinitionId;
// Dwar of Waw: unique Nazgûl, keyed to Dark-domain [{d}] or Dark-hold [{D}]
// (plus unrelated Doors-of-Night named regions) — no Shadow-land keying at
// all, so only the dark-domain grant (effect 2) can key it.
const DWAR_OF_WAW = 'tw-31' as CardDefinitionId;

/** Reaching Shadow as a card in the hazard player's cardsInPlay. */
const reachingShadowInPlay: CardInPlay = {
  instanceId: 'rs-1' as CardInstanceId,
  definitionId: REACHING_SHADOW,
  status: CardStatus.Untapped,
};

/**
 * Hero company (PLAYER_1, active) at `site` with `heroChars`; the hazard
 * player (PLAYER_2) holds `hazardHand`, with Reaching Shadow in cardsInPlay
 * when `withReachingShadow`. `mh` overrides the movement/hazard phase state
 * (e.g. `resolvedSitePathNames` for the named-region grant).
 */
function mhAt(
  site: CardDefinitionId,
  hazardHand: CardDefinitionId[],
  heroChars: CardDefinitionId[],
  opts: { withReachingShadow?: boolean; mh?: Partial<MovementHazardPhaseState> } = {},
): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: heroChars }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [FRODO] }],
        hand: hazardHand,
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: opts.withReachingShadow ? [reachingShadowInPlay] : [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState(opts.mh) };
}

/**
 * The `play-hazard` action offered for `instanceId` in its creature mode
 * (carries `keyedBy`), if viable. Excludes a `creature-alt-event` dual-mode
 * card's alternate permanent-event play (offered independent of keying —
 * Dwar of Waw tw-31), which would otherwise mask a missing keying grant.
 */
function offeredPlay(state: GameState, instanceId: CardInstanceId) {
  return viableActions(state, PLAYER_2, 'play-hazard').find((ea) => {
    const a = ea.action as PlayHazardAction;
    return a.cardInstanceId === instanceId && a.altEventMode === undefined;
  });
}

describe('Reaching Shadow (dm-81)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: single-Shadow-land creature → 10 named regions ─────────────

  test('a single-Shadow-land creature (Lesser Spiders) is keyable via the grant at a named region', () => {
    // Free-hold (Wellinghall): not Ruins & Lairs, and the path carries no
    // Wilderness/Shadow region — the creature's own keying cannot match.
    const state = mhAt(WELLINGHALL, [LESSER_SPIDERS], [ARAGORN], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Woodland Realm'] },
    });
    const spidersId = handCardId(state, HAZARD_PLAYER);
    const play = offeredPlay(state, spidersId);
    expect(play?.viable).toBe(true);
    const action = play!.action as PlayHazardAction;
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.grantedRegionName).toBe('Woodland Realm');
  });

  test('without Reaching Shadow in play, the same creature at the same site/path is NOT keyable', () => {
    const state = mhAt(WELLINGHALL, [LESSER_SPIDERS], [ARAGORN], {
      mh: { resolvedSitePathNames: ['Woodland Realm'] },
    });
    const spidersId = handCardId(state, HAZARD_PLAYER);
    expect(offeredPlay(state, spidersId)).toBeUndefined();
  });

  test('a region name not on either list does not grant keying', () => {
    const state = mhAt(WELLINGHALL, [LESSER_SPIDERS], [ARAGORN], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Rhudaur'] },
    });
    const spidersId = handCardId(state, HAZARD_PLAYER);
    expect(offeredPlay(state, spidersId)).toBeUndefined();
  });

  // ─── CRF: double-Shadow-land creatures are excluded ────────────────────────

  test('a double-Shadow-land creature (Wild Fell Beast) is NOT granted keying by the shadow-land clause', () => {
    const state = mhAt(WELLINGHALL, [WILD_FELL_BEAST], [ARAGORN], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Woodland Realm'] },
    });
    const beastId = handCardId(state, HAZARD_PLAYER);
    expect(offeredPlay(state, beastId)).toBeUndefined();
  });

  // ─── Effect 2: single-Dark-domain creature → 4 named regions ──────────────

  test('a single-Dark-domain creature (Dwar of Waw) is keyable via the grant at a named region', () => {
    const state = mhAt(WELLINGHALL, [DWAR_OF_WAW], [ARAGORN], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Brown Lands'] },
    });
    const dwarId = handCardId(state, HAZARD_PLAYER);
    const play = offeredPlay(state, dwarId);
    expect(play?.viable).toBe(true);
    const action = play!.action as PlayHazardAction;
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.grantedRegionName).toBe('Brown Lands');
  });

  test('a Dark-domain-only creature is NOT granted keying by a shadow-only named region', () => {
    // "Woodland Realm" is on the shadow-land list but not the dark-domain
    // list, and Dwar of Waw has no Shadow-land keying at all.
    const state = mhAt(WELLINGHALL, [DWAR_OF_WAW], [ARAGORN], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Woodland Realm'] },
    });
    const dwarId = handCardId(state, HAZARD_PLAYER);
    expect(offeredPlay(state, dwarId)).toBeUndefined();
  });

  // ─── Effect 3: discard-on-defeat, gated on the grant (not the printed symbol) ──

  test('discards itself when a creature keyed via the grant is fully defeated', () => {
    const state = mhAt(WELLINGHALL, [LESSER_SPIDERS], [ARAGORN, LEGOLAS, GIMLI, FARAMIR], {
      withReachingShadow: true,
      mh: { resolvedSitePathNames: ['Woodland Realm'] },
    });
    const spidersId = handCardId(state, HAZARD_PLAYER);
    const play = offeredPlay(state, spidersId)!;
    expect((play.action as PlayHazardAction).keyedBy?.grantedRegionName).toBe('Woodland Realm');

    const afterChain = resolveChain(dispatch(state, play.action));
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4); // Lesser Spiders: 4 strikes

    const { state: after } = continueAutoAttackCombat(
      afterChain,
      [
        { characterDefId: ARAGORN, roll: 12 },
        { characterDefId: LEGOLAS, roll: 12 },
        { characterDefId: GIMLI, roll: 12 },
        { characterDefId: FARAMIR, roll: 12 },
      ],
      PLAYER_1, PLAYER_2,
    );

    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(REACHING_SHADOW);
    expect(after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).toContain(REACHING_SHADOW);
  });

  test('does NOT discard when the defeated creature was keyed by its own printed symbol, not the grant', () => {
    // Bandit Lair is a Ruins & Lairs site — Lesser Spiders' own site-type
    // keying applies directly; no grant is involved.
    const state = mhAt(BANDIT_LAIR, [LESSER_SPIDERS], [ARAGORN, LEGOLAS, GIMLI, FARAMIR], {
      withReachingShadow: true,
    });
    const spidersId = handCardId(state, HAZARD_PLAYER);
    const play = offeredPlay(state, spidersId)!;
    expect((play.action as PlayHazardAction).keyedBy?.method).toBe('site-type');
    expect((play.action as PlayHazardAction).keyedBy?.grantedRegionName).toBeUndefined();

    const afterChain = resolveChain(dispatch(state, play.action));
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(4);

    const { state: after } = continueAutoAttackCombat(
      afterChain,
      [
        { characterDefId: ARAGORN, roll: 12 },
        { characterDefId: LEGOLAS, roll: 12 },
        { characterDefId: GIMLI, roll: 12 },
        { characterDefId: FARAMIR, roll: 12 },
      ],
      PLAYER_1, PLAYER_2,
    );

    expect(after.combat).toBeNull();
    expect(after.players[HAZARD_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(REACHING_SHADOW);
    expect(after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId)).not.toContain(REACHING_SHADOW);
  });

  test('is playable as a hazard permanent-event during the movement/hazard phase', () => {
    const state = mhAt(WELLINGHALL, [REACHING_SHADOW], [ARAGORN]);
    const rsId = handCardId(state, HAZARD_PLAYER);
    const play = viableActions(state, PLAYER_2, 'play-hazard').find(
      ea => (ea.action as PlayHazardAction).cardInstanceId === rsId,
    );
    expect(play?.viable).toBe(true);
  });
});
