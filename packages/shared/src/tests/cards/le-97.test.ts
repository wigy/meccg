/**
 * @module le-97.test
 *
 * Card test: Wandering Eldar (le-97)
 * Type: hazard-creature (Elves)
 * Effects: 2 (combat-one-strike-per-character, combat-detainment
 *   vs hero and covert-fallen-wizard)
 *
 * Text:
 *   "Elves. Each character in the company faces one strike (detainment
 *    against covert and hero companies). If Doors of Night is not in
 *    play, may also be played keyed to Free-domains [{f}]."
 *
 * Base stats: strikes 1/each (runtime = company size), prowess 9,
 *   body — (no body check), kill MP 1.
 *
 * Effects:
 * | # | Effect Type                     | Status | Notes                                                    |
 * |---|---------------------------------|--------|----------------------------------------------------------|
 * | 1 | combat-one-strike-per-character | OK     | strikesTotal = company.characters.length                 |
 * | 2 | combat-detainment               | OK     | Hero or covert fallen-wizard defender → detainment       |
 *
 * keyedTo:
 * | # | Entry                   | When                        | Notes                         |
 * |---|-------------------------|-----------------------------|-------------------------------|
 * | 1 | wilderness / border     | always                      | base keying {w}{w}{b}         |
 * | 2 | free                    | Doors of Night NOT in play  | conditional alt keying        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, GIMLI, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const WANDERING_ELDAR = 'le-97' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;
const AZOG = 'ba-2' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };
const BORDER_KEYING = { method: 'region-type' as const, value: RegionType.Border };
const FREE_KEYING = { method: 'region-type' as const, value: RegionType.Free };

describe('Wandering Eldar (le-97)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: "Each character in the company faces one strike" ────────────

  test('1-character company: strikesTotal = 1, detainment vs hero', () => {
    const state = buildTestState({
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
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(9);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('2-character company: strikesTotal = 2', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('3-character company: strikesTotal = 3', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  // ─── Detainment depends on defender alignment ───────────────────────────

  test('attack on Ringwraith (minion) company: no detainment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('attack on Balrog company: no detainment', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA, characters: [AZOG] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  // ─── Keying ──────────────────────────────────────────────────────────────

  test('keyable to Wilderness (base keying, always)', () => {
    const state = buildTestState({
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
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('keyable to Border (base keying, always)', () => {
    const state = buildTestState({
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
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhBorder = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mhBorder };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Border;
    })).toBe(true);
  });

  test('keyable to Free-domain when Doors of Night is NOT in play', () => {
    const state = buildTestState({
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
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhFree = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bag End',
    });
    const ready: GameState = { ...state, phaseState: mhFree };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Free;
    })).toBe(true);
  });

  test('NOT keyable to Free-domain when Doors of Night IS in play', () => {
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const state = buildTestState({
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
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const mhFree = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bag End',
    });
    const ready: GameState = { ...state, phaseState: mhFree };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Free;
    })).toBe(false);
  });

  // ─── Invoke the Free-domain keying path end-to-end ─────────────────────

  test('combat initiates from Free-domain keying when Doors of Night absent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhFree = makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['The Shire'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Bag End',
    });
    const ready: GameState = { ...state, phaseState: mhFree };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, FREE_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  // ─── Border keying path end-to-end ──────────────────────────────────────

  test('combat initiates from Border keying', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA, characters: [ARAGORN, BILBO, GIMLI] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [WANDERING_ELDAR],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhBorder = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Eriador'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mhBorder };
    const creatureId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, creatureId, companyId, BORDER_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(3);
  });
});
