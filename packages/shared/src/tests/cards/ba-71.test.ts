/**
 * @module ba-71.test
 *
 * Card test: Out He Sprang (ba-71)
 * Type: minion-resource-event (alignment ringwraith), Permanent-event. 0 MP.
 * Non-unique. Balrog specific.
 *
 * Card text:
 *   "Balrog specific. If Great Shadow is not in play, The Balrog may move with
 *    region movement (overriding his card) to an Under-deeps surface site or
 *    from an Under-deeps surface site. Based on his marshalling point (MP)
 *    total, he may use the following number of regions: 0-8 MPs – 1 region;
 *    9-16 MPs – 2 regions; 17-24 MPs – 3 regions; 25+ MPs – 4 regions. This
 *    region allowance may not be modified by any other effects except A More
 *    Evil Hour."
 *
 * Effects:
 *   1. balrog-surface-region-movement (suppressedByInPlay Great Shadow,
 *      regionAllowanceByMp [[8,1],[16,2],[24,3],[25,4]], modifiableBy A More
 *      Evil Hour)
 *
 * The grant is enforced at the Movement/Hazard reveal-path (declare-path) — the
 * authoritative movement-legality gate, the same place The Balrog's printed
 * "may not use region or starter movement" lock is applied (see ba-3.test) —
 * and the MP-derived region cap is fixed at Movement/Hazard select-company.
 *
 * | # | Rule                                                       | Status |
 * |---|------------------------------------------------------------|--------|
 * | 1 | Grants region movement from an Under-deeps surface site    | OK     |
 * | 2 | Without the card The Balrog is region-locked (control)     | OK     |
 * | 3 | Suppressed while Great Shadow is in play                   | OK     |
 * | 4 | No grant unless an endpoint is an Under-deeps surface site | OK     |
 * | 5 | Region allowance from MP total (1/2/3/4 bands)             | OK     |
 * | 6 | Allowance not modifiable by other effects (No Way Forward) | OK     |
 * | 7 | Starter movement stays suppressed (region-only grant)      | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildTestState, addCardInPlay, companyIdAt,
  makeMHState, reduce, viableFor,
  Alignment, Phase,
} from '../test-helpers.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState } from '../../index.js';
import type { DeclarePathAction } from '../../types/actions-movement-hazard.js';

const OUT_HE_SPRANG = 'ba-71' as CardDefinitionId;
const GREAT_SHADOW = 'ba-62' as CardDefinitionId;
const NO_WAY_FORWARD = 'dm-75' as CardDefinitionId; // region-movement-limit (−1, min 2)

const THE_BALROG = 'ba-3' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific, non-avatar

// Balrog sites (regions in parentheses).
const BARAD_DUR = 'ba-84' as CardDefinitionId;      // dark-hold, Gorgoroth — Under-deeps SURFACE site
const CIRITH_GORGOR = 'ba-86' as CardDefinitionId;  // dark-hold, Udûn — non-surface (Gorgoroth↔Udûn dist 1)
const CIRITH_UNGOL = 'ba-87' as CardDefinitionId;   // dark-hold, Imlad Morgul — non-surface
const MINAS_MORGUL = 'ba-92' as CardDefinitionId;   // dark-hold, Imlad Morgul — non-surface (same region)

/**
 * Build an M/H reveal-new-site state for a Balrog company moving origin → dest.
 * `mp` sets the player's marshalling-point total, which drives the region
 * allowance; the default 12 (band 9–16 → 2 regions) fits a 2-region move.
 */
function buildRevealState(
  originSite: CardDefinitionId,
  destSite: CardDefinitionId,
  character: CardDefinitionId,
  mp = 12,
): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Balrog,
        companies: [{ site: originSite, characters: [character], destinationSite: destSite }],
        hand: [],
        siteDeck: [],
        marshallingPoints: { misc: mp },
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
    ],
  });
  return { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }) };
}

function declarePathActions(state: GameState): DeclarePathAction[] {
  return viableFor(state, PLAYER_1)
    .filter(a => a.action.type === 'declare-path')
    .map(a => a.action as DeclarePathAction);
}

describe('Out He Sprang (ba-71)', () => {
  beforeEach(() => resetMint());

  describe('grants region movement to/from an Under-deeps surface site', () => {
    test('The Balrog may region-move FROM a surface site (Barad-dûr) when the card is in play', () => {
      const base = buildRevealState(BARAD_DUR, CIRITH_GORGOR, THE_BALROG);

      // Without the card: region movement suppressed (Balrog Under-deeps lock).
      expect(declarePathActions(base).some(a => a.movementType === MovementType.Region)).toBe(false);

      // With the card in play: region movement is offered.
      const withCard = addCardInPlay(base, RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(withCard).some(a => a.movementType === MovementType.Region)).toBe(true);
    });

    test('negative control: a Balrog-less company already has region movement between the same sites', () => {
      const base = buildRevealState(BARAD_DUR, CIRITH_GORGOR, CROOK_LEGGED_ORC);
      expect(declarePathActions(base).some(a => a.movementType === MovementType.Region)).toBe(true);
    });
  });

  describe('suppressed while Great Shadow is in play', () => {
    test('no region movement when both Out He Sprang and Great Shadow are in play', () => {
      const withCard = addCardInPlay(buildRevealState(BARAD_DUR, CIRITH_GORGOR, THE_BALROG), RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(withCard).some(a => a.movementType === MovementType.Region)).toBe(true);

      const suppressed = addCardInPlay(withCard, RESOURCE_PLAYER, GREAT_SHADOW);
      expect(declarePathActions(suppressed).some(a => a.movementType === MovementType.Region)).toBe(false);
    });
  });

  describe('requires an Under-deeps surface-site endpoint', () => {
    test('no grant when neither origin nor destination is a surface site', () => {
      // Cirith Ungol → Minas Morgul: both Imlad Morgul, neither a surface site.
      const base = buildRevealState(CIRITH_UNGOL, MINAS_MORGUL, THE_BALROG);
      const withCard = addCardInPlay(base, RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(withCard).some(a => a.movementType === MovementType.Region)).toBe(false);

      // Control: a Balrog-less company region-moves between the same two sites,
      // proving the region path exists and only the surface-site gate blocks it.
      const control = buildRevealState(CIRITH_UNGOL, MINAS_MORGUL, CROOK_LEGGED_ORC);
      expect(declarePathActions(control).some(a => a.movementType === MovementType.Region)).toBe(true);
    });
  });

  describe('region allowance derived from The Balrog player MP total', () => {
    // select-company fixes maxRegionDistance at the MP-derived allowance.
    const bands: readonly [number, number][] = [
      [0, 1], [8, 1],   // 0–8 MPs → 1 region
      [9, 2], [16, 2],  // 9–16 MPs → 2 regions
      [17, 3], [24, 3], // 17–24 MPs → 3 regions
      [25, 4], [40, 4], // 25+ MPs → 4 regions
    ];

    for (const [mp, expected] of bands) {
      test(`${mp} MP total → ${expected} region(s) allowed`, () => {
        const base = buildTestState({
          activePlayer: PLAYER_1,
          phase: Phase.MovementHazard,
          players: [
            {
              id: PLAYER_1,
              alignment: Alignment.Balrog,
              companies: [{ site: BARAD_DUR, characters: [THE_BALROG], destinationSite: CIRITH_GORGOR }],
              hand: [],
              siteDeck: [],
              marshallingPoints: { misc: mp },
            },
            { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
          ],
        });
        const withCard = addCardInPlay(base, RESOURCE_PLAYER, OUT_HE_SPRANG);
        const companyId = companyIdAt(withCard, RESOURCE_PLAYER);
        const atSelect: GameState = { ...withCard, phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [] }) };

        const result = reduce(atSelect, { type: 'select-company', player: PLAYER_1, companyId });
        expect(result.error).toBeUndefined();
        expect((result.state.phaseState as MovementHazardPhaseState).maxRegionDistance).toBe(expected);
      });
    }
  });

  describe('the MP-derived allowance is enforced at the reveal path', () => {
    test('a 2-region move is refused at 1-region allowance (5 MP) but offered at 2 (12 MP)', () => {
      // Barad-dûr (Gorgoroth) → Cirith Gorgor (Udûn) is a 2-region span.
      const low = addCardInPlay(buildRevealState(BARAD_DUR, CIRITH_GORGOR, THE_BALROG, 5), RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(low).some(a => a.movementType === MovementType.Region)).toBe(false);

      const high = addCardInPlay(buildRevealState(BARAD_DUR, CIRITH_GORGOR, THE_BALROG, 12), RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(high).some(a => a.movementType === MovementType.Region)).toBe(true);
    });
  });

  describe('region allowance may not be modified by any other effects', () => {
    test('a No Way Forward region reduction does not raise/lower the fixed MP allowance', () => {
      // MP total 5 → allowance 1. No Way Forward reduces region distance by one
      // (min 2) game-wide; the Balrog's fixed allowance must stay 1, not be
      // pulled up to No Way Forward's floor of 2 nor left at the base cap.
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Balrog,
            companies: [{ site: BARAD_DUR, characters: [THE_BALROG], destinationSite: CIRITH_GORGOR }],
            hand: [],
            siteDeck: [],
            marshallingPoints: { misc: 5 },
          },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const withCard = addCardInPlay(base, RESOURCE_PLAYER, OUT_HE_SPRANG);
      const withEnv = addCardInPlay(withCard, HAZARD_PLAYER, NO_WAY_FORWARD);
      const companyId = companyIdAt(withEnv, RESOURCE_PLAYER);
      const atSelect: GameState = { ...withEnv, phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [] }) };

      const result = reduce(atSelect, { type: 'select-company', player: PLAYER_1, companyId });
      expect(result.error).toBeUndefined();
      expect((result.state.phaseState as MovementHazardPhaseState).maxRegionDistance).toBe(1);
    });
  });

  describe('starter movement stays suppressed (region-only grant)', () => {
    test('The Balrog is never offered starter movement even with Out He Sprang in play', () => {
      // Barad-dûr → Cirith Gorgor is not a starter adjacency, but assert no
      // starter path is ever produced regardless.
      const withCard = addCardInPlay(buildRevealState(BARAD_DUR, CIRITH_GORGOR, THE_BALROG), RESOURCE_PLAYER, OUT_HE_SPRANG);
      expect(declarePathActions(withCard).some(a => a.movementType === MovementType.Starter)).toBe(false);
    });
  });
});
