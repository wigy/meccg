/**
 * @module td-20.test
 *
 * Card test: Eärcaraxë (td-20)
 * Type: hazard-creature (Dragon)
 * Effects: 1
 *
 * Text:
 *   "Unique. May be played at Isle of the Ulond. Dragon. Two strikes.
 *    Attacker chooses defending characters. If Doors of Night is in play,
 *    may also be played keyed to Andrast Coast, Bay of Belfalas, Eriadoran
 *    Coast, and Andrast; and may also be played at sites in these regions."
 *
 * Base stats: strikes 2, prowess 17, body 7, kill MP 4.
 *
 * Effects:
 * | # | Effect Type                      | Status | Notes                            |
 * |---|----------------------------------|--------|----------------------------------|
 * | 1 | combat-attacker-chooses-defenders| OK     | Cancel-window before assignment  |
 *
 * keyedTo:
 * | # | Entry                                                                                 | When                        |
 * |---|---------------------------------------------------------------------------------------|-----------------------------|
 * | 1 | siteNames: [Isle of the Ulond]                                                        | always                      |
 * | 2 | regionNames: [Andrast Coast, Bay of Belfalas, Eriadoran Coast, Andrast]               | Doors of Night in play      |
 *
 * Note: "may also be played at sites in these regions" is covered by the
 * same regionNames entry — the engine adds the destination site's region
 * to `resolvedSitePathNames`, so the regionNames matcher catches both
 * "company keyed to the region" and "destination site in the region".
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeWildernessMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, RegionType, SiteType, CardStatus,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const EARCARAXE = 'td-20' as CardDefinitionId;

/** MH state simulating arrival at Isle of the Ulond (no DoN needed). */
function mhAtIsleOfUlond(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Coastal, RegionType.Coastal],
    resolvedSitePathNames: ['Anfalas', 'Andrast Coast'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Isle of the Ulond',
  });
}

/** MH state simulating arrival at a site in Bay of Belfalas. */
function mhInBayOfBelfalas(): ReturnType<typeof makeMHState> {
  return makeMHState({
    resolvedSitePath: [RegionType.Coastal],
    resolvedSitePathNames: ['Bay of Belfalas'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Tolfalas',
  });
}

describe('Eärcaraxë (td-20)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 2 strikes, 17 prowess, attacker chooses defenders ─────────

  test('combat starts with cancel-window (attacker-chooses-defenders), 2 strikes at 17', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIsleOfUlond() };

    const earcaraxeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, earcaraxeId, companyId,
      { method: 'site-name' as const, value: 'Isle of the Ulond' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    // attacker-chooses-defenders: cancel window precedes attacker assignment
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(17);
    expect(afterChain.combat!.creatureBody).toBe(7);
    expect(afterChain.combat!.creatureRace).toBe('dragon');
  });

  // ─── Keying: at Isle of the Ulond, no DoN required ─────────────────────

  test('keyable at Isle of the Ulond without Doors of Night', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIsleOfUlond() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-name' && a.keyedBy?.value === 'Isle of the Ulond';
    })).toBe(true);
  });

  // ─── Keying: regions require Doors of Night ────────────────────────────

  test('NOT keyable to Bay of Belfalas region without Doors of Night', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInBayOfBelfalas() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    // The play-hazard entry exists but is non-viable, tagged with a keying error.
    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/Not keyable/);
  });

  test('keyable to Bay of Belfalas region when Doors of Night IS in play', () => {
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhInBayOfBelfalas() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Bay of Belfalas';
    })).toBe(true);
  });

  test('keyable at a site in Eriadoran Coast with Doors of Night (site-in-region clause)', () => {
    // Destination site is a non-Isle-of-the-Ulond site in Eriadoran Coast.
    // Engine adds destination site's region to resolvedSitePathNames, so the
    // regionNames keying entry matches.
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Coastal],
      resolvedSitePathNames: ['Eriadoran Coast'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Isles of the Dead that Live',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Eriadoran Coast';
    })).toBe(true);
  });

  test('keyable to Andrast region with Doors of Night', () => {
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Stones',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Andrast';
    })).toBe(true);
  });

  test('keyable to Andrast Coast region with Doors of Night', () => {
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIsleOfUlond() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Andrast Coast';
    })).toBe(true);
  });

  test('NOT keyable to an unrelated region even with Doors of Night', () => {
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
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
          cardsInPlay: [donInPlay],
        },
      ],
    });
    // Rhudaur wilderness path to Moria — none of Eärcaraxë's four regions.
    const ready: GameState = { ...state, phaseState: makeWildernessMHState() };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── Attacker picks defenders (verifies effect wired into combat) ──────

  test('attacker gets assign-strike actions after cancel-window pass', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [EARCARAXE],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const ready: GameState = { ...state, phaseState: mhAtIsleOfUlond() };

    const earcaraxeId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, earcaraxeId, companyId,
      { method: 'site-name' as const, value: 'Isle of the Ulond' },
    );

    // Defender has no assign-strike during cancel-window (attacker chooses)
    expect(viableActions(afterChain, PLAYER_1, 'assign-strike')).toHaveLength(0);

    // After defender passes the cancel-window, attacker (P2) gets assignment.
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.combat!.assignmentPhase).toBe('attacker');
    expect(viableActions(afterPass, PLAYER_2, 'assign-strike').length).toBeGreaterThan(0);
  });
});
