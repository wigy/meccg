/**
 * @module dm-41.test
 *
 * Card test: The Under-vaults (dm-41)
 * Type: hero-site (ruins-and-lairs, under-deeps) in Angmar
 *
 * Text:
 *   Adjacent Sites: Mount Gram (0), The Iron-deeps (7), The Under-leas (7)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Undead — 3 strikes with 8 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to Shadow-holds [{S}]
 *   Special: Any Undead creature may also be played at this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                   |
 * |---|-------------------|--------|---------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                               |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                   |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                 |
 * | 4 | region            | OK     | "Angmar" — correct per card data                        |
 * | 5 | playableResources | OK     | [minor, major, gold-ring] — matches card text           |
 * | 6 | automaticAttacks  | OK     | Undead, 3 strikes, 8 prowess (1st attack)               |
 * | 7 | resourceDraws     | OK     | 2                                                       |
 * | 8 | hazardDraws       | OK     | 3                                                       |
 * | 9 | keywords          | OK     | ["under-deeps"]                                         |
 * | 10| adjacentSites     | OK     | Mount Gram (0), The Iron-deeps (7), The Under-leas (7)  |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) + allow-creature-by-race (undead) |
 *
 * Engine Support:
 * | # | Feature                                   | Status          | Notes                                           |
 * |---|-------------------------------------------|-----------------|-------------------------------------------------|
 * | 1 | Site phase flow                           | IMPLEMENTED     | select-company, enter-or-skip, play-resources   |
 * | 2 | Item playability (minor, major, gold-ring) | IMPLEMENTED     | site.ts enforces playableResources              |
 * | 3 | Automatic attacks (1st, static)           | IMPLEMENTED     | Undead 3×8 in automaticAttacks                  |
 * | 4 | Dynamic auto-attack (2nd)                 | IMPLEMENTED     | play-site-auto-attack step; shadow-hold filter  |
 * | 5 | Allow Undead creatures by site rule       | IMPLEMENTED     | siteAllowsCreatureByRace in movement-hazard.ts  |
 * | 6 | Under-deeps movement roll                 | NOT IMPLEMENTED | General rule 3.45; not specific to this card    |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  BARROW_WIGHT, ASSASSIN,
  resetMint,
  buildTestState, buildSitePhaseState, buildDualHandSitePhaseState,
  viableActions, dispatch,
  makeMHState,
} from '../test-helpers.js';
import {
  Phase, SiteType, RegionType, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction } from '../../index.js';

const THE_UNDER_VAULTS = 'dm-41' as CardDefinitionId;

describe('The Under-vaults (dm-41)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-vaults', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_VAULTS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('major item (Glamdring) is playable at The Under-vaults', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_VAULTS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-vaults', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_VAULTS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('greater item (The Mithril-coat) is NOT playable at The Under-vaults', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_VAULTS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ───────────────────

  test('entering The Under-vaults advances to reveal-on-guard-attacks (static Undead attack present)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing at reveal-on-guard-attacks advances to automatic-attacks (printed 1st attack faced first)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'reveal-on-guard-attacks',
      siteEntered: true,
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('passing at play-site-auto-attack advances to automatic-attacks without combat', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ───────────────────────────────────

  test('hazard player may play a Shadow-hold keyed creature (Barrow-wight) as 2nd auto-attack', () => {
    // Barrow-wight is keyed to shadow-hold [{S}] and dark-hold [{D}].
    // The site rule requires shadow-hold [{S}] — Barrow-wight matches.
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [BARROW_WIGHT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(barrowWightInst);
  });

  test('hazard player may NOT play a non-Shadow-hold keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold [{B}] and free-hold [{F}] — not shadow-hold.
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Shadow-hold keyed creature offered, non-matching creature suppressed', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [BARROW_WIGHT, ASSASSIN],
    });
    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(playActions).toHaveLength(1);
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const action = playActions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(barrowWightInst);

    const passActions = viableActions(state, PLAYER_2, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('playing Barrow-wight as 2nd auto-attack initiates combat with played-auto-attack source', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_VAULTS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [BARROW_WIGHT],
    });
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: barrowWightInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(12);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Allow Undead by race (Special rule) ──────────────────────────────────

  test('Barrow-wight (Undead, normally keyed to shadow/dark) is viable against company at The Under-vaults', () => {
    // Barrow-wight keys to shadow-land/dark-domain regions and shadow-hold/dark-hold sites.
    // The Under-vaults is ruins-and-lairs with an empty (under-deeps) region path.
    // Without the site rule, Barrow-wight would NOT match. With allow-creature-by-race
    // for "undead", the keying check is bypassed.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_VAULTS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BARROW_WIGHT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-vaults',
      }),
    };

    const barrowWightInst = mhState.players[1].hand[0].instanceId;
    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    const barrowWightPlay = plays.find(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (barrowWightInst as string);
    });
    expect(barrowWightPlay).toBeDefined();
  });

  test('Assassin (Men, NOT Undead) is NOT made viable by the site rule at The Under-vaults', () => {
    // Assassin is keyed to border-hold/free-hold — not ruins-and-lairs.
    // The site rule only helps Undead creatures, not Men.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_VAULTS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ASSASSIN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-vaults',
      }),
    };

    const assassinInst = mhState.players[1].hand[0].instanceId;
    const all = computeLegalActions(mhState, PLAYER_2).filter(
      ea => ea.action.type === 'play-hazard',
    );
    const assassinActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (assassinInst as string);
    });
    expect(assassinActions.length).toBeGreaterThan(0);
    expect(assassinActions.every(ea => !ea.viable)).toBe(true);
  });

  test('Undead creature is NOT made viable at a regular ruins-and-lairs without the site rule', () => {
    // Verify the site rule is what enables Undead keying bypass.
    // Moria (shadow-hold) vs Barrow-wight: Barrow-wight IS keyed to shadow-hold.
    // Use a ruins-and-lairs with no allow-creature-by-race rule (e.g. MORIA is shadow-hold,
    // so test with a ruins-and-lairs site like MINAS_TIRITH which is free-hold).
    // Barrow-wight is keyed to shadow/dark — not free-hold. No site rule → not viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [BARROW_WIGHT],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Gondor'],
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
      }),
    };

    const barrowWightInst = mhState.players[1].hand[0].instanceId;
    const all = computeLegalActions(mhState, PLAYER_2).filter(
      ea => ea.action.type === 'play-hazard',
    );
    const bwActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (barrowWightInst as string);
    });
    expect(bwActions.length).toBeGreaterThan(0);
    expect(bwActions.every(ea => !ea.viable)).toBe(true);
  });
});
