/**
 * @module tw-66.test
 *
 * Card test: Mûmak (Oliphant) (tw-66)
 * Type: hazard-creature (Animal), non-unique
 *
 * Text:
 *   "Animals. Two strikes. May be played keyed to Dagorlad, Gorgoroth, Horse
 *    Plains, Ithilien, Khand, Nûrn, Ûdun; and may also be played at sites in
 *    these regions. May also be played (on the same turn and on the same
 *    company as Corsairs of Umbar) keyed to Andrast, Anfalas, Belfalas,
 *    Lebennin; and at Ruins & Lairs [{R}] and Shadow-holds [{S}] in these
 *    regions. This card has no effect on a minion player."
 *
 * Base stats: 2 strikes, 12 prowess, no body check, race animal, 1 kill MP.
 *
 * keyedTo:
 * | # | Entry                                                     | When                                            |
 * |---|-----------------------------------------------------------|--------------------------------------------------|
 * | 1 | regionNames + siteInRegionNames: the 7 base regions       | always — path OR destination site's own region    |
 * | 2 | regionNames: the 4 Corsairs regions                       | Corsairs of Umbar already attacked this company    |
 * | 3 | siteTypes: [ruins-and-lairs, shadow-hold]                 | destinationSite.region ∈ the 4 Corsairs regions   |
 * |   |                                                             AND Corsairs of Umbar already attacked          |
 *
 * The "on the same turn and on the same company as Corsairs of Umbar" clause
 * is modeled with the generic `when` condition gate on a keyedTo entry,
 * exposing `hazardsEncountered` (the target company's already-faced
 * creature-attack names this M/H sub-phase — the same list backing
 * `followsAttackRaces`) so entries 2/3 only fire once Corsairs of Umbar
 * (tw-24) has already attacked the target company earlier this turn.
 *
 * "This card has no effect on a minion player" is modeled as a
 * `play-restriction unplayable-when opponent.alignment $in [ringwraith,
 * balrog]` (the standard convention for hazard cards that fizzle entirely
 * against a minion opponent — the card is simply never offered).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, SiteType, Alignment,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const MUMAK = 'tw-66' as CardDefinitionId;

/** Shadow-hold whose own `region` field is Gorgoroth (base "sites in these regions" clause). */
const MOUNT_DOOM = 'tw-414' as CardDefinitionId;
/** Ruins & Lairs whose own `region` field is Andrast (Corsairs alt-keying site-type entry). */
const THE_STONES = 'tw-429' as CardDefinitionId;
/** Haven in Andrast, wrong site type for the Corsairs alt-keying site-type entry. */
const EDHELLOND = 'tw-393' as CardDefinitionId;

/** Minion fixtures for the "no effect on a minion player" tests. */
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId;

function baseTwoPlayerState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [MUMAK],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Mûmak (Oliphant) (tw-66)', () => {
  beforeEach(() => resetMint());

  // ─── Combat: 2 strikes, 12 prowess, no body, race animal ──────────────

  test('combat initiates with 2 strikes at 12 prowess, no body, race animal', () => {
    const state = baseTwoPlayerState();
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Dagorlad'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const mumakId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, mumakId, companyId,
      { method: 'region-name' as const, value: 'Dagorlad' },
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(2);
    expect(afterChain.combat!.strikeProwess).toBe(12);
    expect(afterChain.combat!.creatureBody).toBe(null);
    expect(afterChain.combat!.creatureRace).toBe('animal');
  });

  // ─── Base keying: the 7 named regions (path) ──────────────────────────

  test('keyable via region-name when moving through Dagorlad', () => {
    const state = baseTwoPlayerState();
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Dagorlad'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Dagorlad';
    })).toBe(true);
  });

  // ─── Base keying: "sites in these regions" (site-in-region, any type) ──

  test('keyable via site-in-region at Mount Doom (Shadow-hold in Gorgoroth) with no matching path', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MOUNT_DOOM }],
          hand: [],
          siteDeck: [MOUNT_DOOM],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Mount Doom',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-in-region' && a.keyedBy?.value === 'Gorgoroth';
    })).toBe(true);
  });

  test('NOT keyable outside the base 7 regions with no path and no Corsairs of Umbar attack faced', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      hazardsEncountered: [],
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Corsairs of Umbar alt-keying: regionNames gate ───────────────────

  test('NOT keyable via Andrast region-name without Corsairs of Umbar having attacked this company', () => {
    const state = baseTwoPlayerState();
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
      hazardsEncountered: [],
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('keyable via Andrast region-name once Corsairs of Umbar has already attacked this company', () => {
    const state = baseTwoPlayerState();
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Andrast'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
      hazardsEncountered: ['Corsairs of Umbar'],
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'region-name' && a.keyedBy?.value === 'Andrast';
    })).toBe(true);
  });

  // ─── Corsairs of Umbar alt-keying: region-scoped site-type gate ───────

  test('keyable via site-type at The Stones (R&L in Andrast) once Corsairs of Umbar has already attacked', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: THE_STONES }],
          hand: [],
          siteDeck: [THE_STONES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Stones',
      hazardsEncountered: ['Corsairs of Umbar'],
    });
    const ready: GameState = { ...state, phaseState: mh };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays.some(p => {
      const a = p.action as { keyedBy?: { method: string; value: string } };
      return a.keyedBy?.method === 'site-type' && a.keyedBy?.value === SiteType.RuinsAndLairs;
    })).toBe(true);
  });

  test('NOT keyable at The Stones without Corsairs of Umbar having attacked', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: THE_STONES }],
          hand: [],
          siteDeck: [THE_STONES],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'The Stones',
      hazardsEncountered: [],
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT keyable at Edhellond (Haven in Andrast) even with Corsairs of Umbar already attacked — wrong site type', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: EDHELLOND }],
          hand: [],
          siteDeck: [EDHELLOND],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.Haven,
      destinationSiteName: 'Edhellond',
      hazardsEncountered: ['Corsairs of Umbar'],
    });
    const ready: GameState = { ...state, phaseState: mh };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── "This card has no effect on a minion player" ─────────────────────

  test('NOT playable at all against a Ringwraith opponent, even when otherwise keyable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_BALROG, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [MORIA_BALROG],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Dagorlad'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const mumakId = handCardId(ready, HAZARD_PLAYER);
    const notPlayable = computeLegalActions(ready, PLAYER_2).find(
      ea => ea.action.type === 'not-playable' && (ea.action as { cardInstanceId: string }).cardInstanceId === mumakId,
    );
    expect(notPlayable).toBeDefined();
    expect(notPlayable!.reason).toMatch(/cannot be played against a minion player/);
    expect(viableActions(ready, PLAYER_2, 'play-hazard').some(
      p => (p.action as { cardInstanceId?: string }).cardInstanceId === mumakId,
    )).toBe(false);
  });

  test('NOT playable at all against a Balrog opponent, even when otherwise keyable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_BALROG, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [MORIA_BALROG],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [] }],
          hand: [MUMAK],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mh = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: ['Dagorlad'],
      destinationSiteType: SiteType.BorderHold,
      destinationSiteName: 'Bree',
    });
    const ready: GameState = { ...state, phaseState: mh };

    const mumakId = handCardId(ready, HAZARD_PLAYER);
    const notPlayable = computeLegalActions(ready, PLAYER_2).find(
      ea => ea.action.type === 'not-playable' && (ea.action as { cardInstanceId: string }).cardInstanceId === mumakId,
    );
    expect(notPlayable).toBeDefined();
    expect(notPlayable!.reason).toMatch(/cannot be played against a minion player/);
    expect(viableActions(ready, PLAYER_2, 'play-hazard').some(
      p => (p.action as { cardInstanceId?: string }).cardInstanceId === mumakId,
    )).toBe(false);
  });
});
