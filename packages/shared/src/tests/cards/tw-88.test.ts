/**
 * @module tw-88.test
 *
 * Card test: Silent Watcher (tw-88)
 * Type: hazard-creature
 * Race: Pûkel-creature. One strike per character at prowess 8.
 *
 * Card text:
 *   "Pûkel-creature. Each character in the company faces one strike."
 *
 * Base stats: strikes 1/each (runtime = company size), prowess 8,
 *   body — (no body check), kill MP 1.
 *
 * Keying (playable: {S}{D}):
 * | # | Entry                                     | When   |
 * |---|--------------------------------------------|--------|
 * | 1 | siteTypes: [shadow-hold, dark-hold]        | always |
 *
 * Effects:
 * | # | Effect Type                     | Status | Notes                                    |
 * |---|---------------------------------|--------|-------------------------------------------|
 * | 1 | combat-one-strike-per-character | OK     | strikesTotal = company.characters.length |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, GIMLI, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const SILENT_WATCHER = 'tw-88' as CardDefinitionId;
const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };
const DARK_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.DarkHold };

function baseState(characters: CardDefinitionId[] = [ARAGORN, LEGOLAS]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SILENT_WATCHER], siteDeck: [RIVENDELL] },
    ],
  });
}

function mhStateKeyedToShadowHold() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Dol Guldur',
  });
}

function mhStateKeyedToDarkHold() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.DarkHold,
    destinationSiteName: 'Barad-dûr',
  });
}

describe('Silent Watcher (tw-88)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: Shadow-hold / Dark-hold ({S}{D}) ─────────────────────────

  test('playable keyed to Shadow-hold', () => {
    const ready: GameState = { ...baseState(), phaseState: mhStateKeyedToShadowHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => {
        if (a.action.type !== 'play-hazard') return false;
        const act = a.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
        return act.cardInstanceId === watcherId && act.keyedBy?.method === 'site-type' && act.keyedBy?.value === 'shadow-hold' && a.viable;
      });
    expect(plays.length).toBeGreaterThan(0);
  });

  test('playable keyed to Dark-hold', () => {
    const ready: GameState = { ...baseState(), phaseState: mhStateKeyedToDarkHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const plays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => {
        if (a.action.type !== 'play-hazard') return false;
        const act = a.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
        return act.cardInstanceId === watcherId && act.keyedBy?.method === 'site-type' && act.keyedBy?.value === 'dark-hold' && a.viable;
      });
    expect(plays.length).toBeGreaterThan(0);
  });

  test('NOT playable at a Free-hold', () => {
    const ready: GameState = {
      ...baseState(),
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Edoras',
      }),
    };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === watcherId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat: "Each character in the company faces one strike" ─────────

  test('1-character company: strikesTotal = 1', () => {
    const ready: GameState = { ...baseState([ARAGORN]), phaseState: mhStateKeyedToShadowHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, SHADOW_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('2-character company: strikesTotal = 2', () => {
    const ready: GameState = { ...baseState([ARAGORN, BILBO]), phaseState: mhStateKeyedToShadowHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, SHADOW_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('3-character company: strikesTotal = 3', () => {
    const ready: GameState = { ...baseState([ARAGORN, BILBO, GIMLI]), phaseState: mhStateKeyedToShadowHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, SHADOW_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });

  test('combat initiates from Dark-hold keying with correct strikes', () => {
    const ready: GameState = { ...baseState([ARAGORN, LEGOLAS]), phaseState: mhStateKeyedToDarkHold() };
    const watcherId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, watcherId, companyId, DARK_HOLD_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(8);
  });
});
