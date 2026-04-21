/**
 * @module le-69.test
 *
 * Card test: Elf-lord Revealed in Wrath (le-69)
 * Type: hazard-creature (Elves)
 * Effects: 2 (combat-detainment vs hero, +4 prowess vs Ringwraiths)
 *
 * Text:
 *   "Elf. One strike (detainment against hero companies). +4 prowess versus
 *    Ringwraiths. If Doors of Night is not in play, may also be played keyed
 *    to Shadow-lands [{s}]."
 *
 * Base stats: strikes 1, prowess 15, body 9, kill MP 3.
 *
 * Effects:
 * | # | Effect Type      | Status | Notes                                                  |
 * |---|------------------|--------|--------------------------------------------------------|
 * | 1 | combat-detainment| OK     | Hero defenders (+covert fallen-wizard) take detainment |
 * | 2 | stat-modifier    | OK     | +4 prowess when defender.alignment === "ringwraith"    |
 *
 * keyedTo:
 * | # | Entry                                 | When                          | Notes                 |
 * |---|---------------------------------------|-------------------------------|-----------------------|
 * | 1 | wilderness / ruins-and-lairs          | always                        | base keying ({w}{w})  |
 * | 2 | shadow / shadow-hold                  | Doors of Night NOT in play    | conditional alt keying|
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, makeShadowMHState, makeDoubleWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const ELF_LORD_REVEALED = 'le-69' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;
const AZOG = 'ba-2' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: RegionType.Wilderness };

describe('Elf-lord Revealed in Wrath (le-69)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: prowess + detainment depend on defender alignment ──────────

  test('attack on hero company: detainment, base prowess 15', () => {
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const elfLordId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, elfLordId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.detainment).toBe(true);
  });

  test('attack on Ringwraith (minion) company: +4 prowess (19), no detainment', () => {
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    // Wilderness keying avoids the rule 3.II.2.R1 keyed-to-dark-hold
    // detainment branch, isolating the card's own +4 prowess effect.
    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const elfLordId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, elfLordId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(19);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('attack on Balrog company: no +4 bonus, no detainment (base prowess 15)', () => {
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const ready: GameState = { ...state, phaseState: makeDoubleWildernessMHState() };
    const elfLordId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, elfLordId, companyId, WILDERNESS_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.detainment).toBe(false);
  });

  // ─── Keying: base wilderness always, shadow only without Doors of Night ──

  test('keyable to wilderness regardless of Doors of Night', () => {
    // Without Doors of Night
    const stateNoDoN = buildTestState({
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const readyNoDoN: GameState = { ...stateNoDoN, phaseState: makeDoubleWildernessMHState() };

    const playsNoDoN = viableActions(readyNoDoN, PLAYER_2, 'play-hazard');
    expect(playsNoDoN.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);

    // With Doors of Night in play
    const donInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT,
      status: CardStatus.Untapped,
    };
    const stateWithDoN = buildTestState({
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const readyWithDoN: GameState = { ...stateWithDoN, phaseState: makeDoubleWildernessMHState() };

    const playsWithDoN = viableActions(readyWithDoN, PLAYER_2, 'play-hazard');
    expect(playsWithDoN.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Wilderness;
    })).toBe(true);
  });

  test('keyable to shadow when Doors of Night is NOT in play', () => {
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: makeShadowMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { cardInstanceId: CardInstanceId; keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-type' && a.keyedBy?.value === RegionType.Shadow;
    })).toBe(true);
  });

  test('NOT keyable to shadow when Doors of Night IS in play', () => {
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
          hand: [ELF_LORD_REVEALED],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });

    // Arrival via pure shadow path + shadow-hold destination. Wilderness
    // keying is not available here, and the shadow keying entry is gated
    // off by Doors of Night being in play.
    const mhShadowOnly = makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Imlad Morgul'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready: GameState = { ...state, phaseState: mhShadowOnly };

    // No viable play-hazard for Elf-lord; the entry is present but
    // non-viable with a "not keyable" reason citing its requirements.
    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });
});
