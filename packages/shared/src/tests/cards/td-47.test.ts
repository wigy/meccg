/**
 * @module td-47.test
 *
 * Card test: Marsh-drake (td-47)
 * Type: hazard-creature (Drake)
 *
 * Text: "Drake. Two strikes."
 *
 * Base stats: strikes 2, prowess 11, body — (no body check), kill MP 1,
 * race Drake.
 *
 * keyedTo (canonical playable "{c}{s}" from data/cards.json TD-47):
 * | # | Entry                                     | When   | Notes                        |
 * |---|-------------------------------------------|--------|------------------------------|
 * | 1 | regionTypes: [shadow, coastal]            | always | {s}{c} — either type suffices |
 *
 * Distinct region types within a single `keyedTo` entry are alternatives
 * (OR'd, per `regionTypesMatch`): the Marsh-drake keys when the resolved
 * site path contains at least one shadow-land OR at least one coastal-sea
 * region. All keying is handled structurally by the engine
 * (mh-hazard-play.ts region-type keying); the card carries no special
 * abilities beyond its keying and base combat stats. "Drake" and "Two
 * strikes" are carried by the base `race` and `strikes` fields.
 *
 * Effects: none.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const MARSH_DRAKE = 'td-47' as CardDefinitionId;

const SHADOW_KEYING = { method: 'region-type' as const, value: RegionType.Shadow };
const COASTAL_KEYING = { method: 'region-type' as const, value: RegionType.Coastal };

function baseStateWithHazardInHand() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [MARSH_DRAKE],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** MH state arriving via a coastal-sea region. */
function makeCoastalMHState() {
  return makeMHState({
    resolvedSitePath: [RegionType.Coastal],
    resolvedSitePathNames: ['Belfalas'],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Dol Amroth',
  });
}

describe('Marsh-drake (td-47)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats: two strikes at prowess 11, no body, Drake race ──────────

  test('attack uses 2 strikes at prowess 11, drake race, no body via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, SHADOW_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(11);
    expect(after.combat!.creatureRace).toBe('drake');
    expect(after.combat!.creatureBody).toBeNull();
  });

  test('attack uses 2 strikes at prowess 11 via coastal keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };
    const drakeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, drakeId, companyId, COASTAL_KEYING,
    );

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(11);
    expect(after.combat!.creatureRace).toBe('drake');
  });

  // ─── Keying: playable via shadow region ──────────────────────────────────

  test('playable on a shadow path via shadow keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  // ─── Keying: playable via coastal-sea region ─────────────────────────────

  test('playable on a coastal path via coastal keying', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = { ...state, phaseState: makeCoastalMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Coastal;
    })).toBe(true);
  });

  // ─── Keying: shadow+coastal path offers both keying options ──────────────

  test('shadow+coastal path offers both shadow and coastal keyings', () => {
    const state = baseStateWithHazardInHand();
    const mixedMH = makeMHState({
      resolvedSitePath: [RegionType.Shadow, RegionType.Coastal],
      resolvedSitePathNames: ['Imlad Morgul', 'Belfalas'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Dol Amroth',
    });
    const ready: GameState = { ...state, phaseState: mixedMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    const keyings = new Set(plays.map(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.value;
    }));
    expect(keyings.has(RegionType.Shadow)).toBe(true);
    expect(keyings.has(RegionType.Coastal)).toBe(true);
  });

  // ─── Keying: NOT playable on a pure wilderness path to R&L ────────────────

  test('NOT playable on a pure wilderness path (neither shadow nor coastal)', () => {
    const state = baseStateWithHazardInHand();
    const wildMH = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: wildMH };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  // ─── Keying: NOT playable on a free-domain path to free-hold ─────────────

  test('NOT playable on a free-domain path to free-hold', () => {
    const state = baseStateWithHazardInHand();
    const freeMH = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Anórien'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
    });
    const ready: GameState = { ...state, phaseState: freeMH };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
