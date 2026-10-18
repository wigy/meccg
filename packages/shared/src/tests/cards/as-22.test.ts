/**
 * @module as-22.test
 *
 * Card test: Trolls from the Mountains (as-22)
 * Type: hazard-creature (Trolls), non-unique
 *
 * Text: "Trolls. Three strikes."
 * Stats: 3 strikes, 12 prowess, 5 body, 2 kill MP.
 * Playable: {w}{w}{w} — keyed to three Wildernesses in the site path.
 *
 * No special effects: keying and printed combat stats are handled
 * structurally by the engine (keyedTo matching in movement-hazard legal
 * actions; combat initiation from the creature's printed stats).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, playCreatureHazardAndResolve,
  handCardId, companyIdAt, hazardCreatureKeyings,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const TROLLS_FROM_THE_MOUNTAINS = 'as-22' as CardDefinitionId;

const TRIPLE_WILDERNESS = [RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness];

describe('Trolls from the Mountains (as-22)', () => {
  let base: GameState;

  beforeEach(() => {
    resetMint();
    base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TROLLS_FROM_THE_MOUNTAINS], siteDeck: [RIVENDELL] },
      ],
    });
  });

  test('playable keyed to Wilderness when the site path has three Wildernesses', () => {
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: TRIPLE_WILDERNESS,
        resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    expect(hazardCreatureKeyings(state, TROLLS_FROM_THE_MOUNTAINS)).toEqual(['region-type:wilderness']);
  });

  test('NOT playable when the site path has only two Wildernesses', () => {
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Border, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    expect(hazardCreatureKeyings(state, TROLLS_FROM_THE_MOUNTAINS)).toEqual([]);
  });

  test('NOT playable on a path of non-Wilderness regions', () => {
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Shadow, RegionType.Dark, RegionType.Border],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    expect(hazardCreatureKeyings(state, TROLLS_FROM_THE_MOUNTAINS)).toEqual([]);
  });

  test('attacks as Trolls with three strikes, 12 prowess and 5 body', () => {
    const state: GameState = {
      ...base,
      phaseState: makeMHState({
        resolvedSitePath: TRIPLE_WILDERNESS,
        resolvedSitePathNames: ['Rhudaur', 'Arthedain', 'Cardolan'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };
    const trollId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const after = playCreatureHazardAndResolve(
      state, PLAYER_2, trollId, companyId,
      { method: 'region-type', value: RegionType.Wilderness },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('troll');
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(12);
    expect(after.combat!.creatureBody).toBe(5);
  });
});
