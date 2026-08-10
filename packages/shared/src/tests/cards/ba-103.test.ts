/**
 * @module ba-103.test
 *
 * Card test: The Under-vaults (ba-103)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in Angmar
 *
 * Text:
 *   Adjacent Sites: Mount Gram (0), The Iron-deeps (7), The Under-leas (5),
 *     The Drowning-deeps (8)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Undead — 3 strikes with 8 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold.
 *   Special: Any Undead creature may be keyed to this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|----------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                           |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                              |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                            |
 * | 4 | region            | OK     | "Angmar" — correct per card data                                    |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text (was [] before this pass) |
 * | 6 | automaticAttacks  | OK     | Undead, 3 strikes, 8 prowess (1st attack)                           |
 * | 7 | resourceDraws     | OK     | 1                                                                    |
 * | 8 | hazardDraws       | OK     | 1                                                                    |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                      |
 * | 10| adjacentSites     | OK     | Mount Gram (0), The Iron-deeps (7), The Under-leas (5), The Drowning-deeps (8) |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) + allow-creature-by-race (undead) — added this pass |
 *
 * Engine Support:
 * | # | Feature                                   | Status          | Notes                                           |
 * |---|--------------------------------------------|-----------------|--------------------------------------------------|
 * | 1 | Site phase flow                           | IMPLEMENTED     | select-company, enter-or-skip, play-resources   |
 * | 2 | Item playability (minor, major)           | IMPLEMENTED     | site.ts enforces playableResources              |
 * | 3 | Automatic attacks (1st, static)            | IMPLEMENTED     | Undead 3x8 in automaticAttacks                  |
 * | 4 | Dynamic auto-attack (2nd)                  | IMPLEMENTED     | play-site-auto-attack step; shadow-hold filter  |
 * | 5 | Allow Undead creatures by site rule        | IMPLEMENTED     | siteAllowsCreatureByRace in movement-hazard.ts  |
 * | 6 | Under-deeps movement roll                 | NOT IMPLEMENTED | General rule 3.45; not specific to this card    |
 *
 * Playable: YES
 * Certified: 2026-07-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN,
  resetMint,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction,
} from '../../index.js';

const THE_UNDER_VAULTS = 'ba-103' as CardDefinitionId;
const THE_UNDER_GROTTOS = 'ba-101' as CardDefinitionId;  // ruins-and-lairs, under-deeps, NO allow-creature-by-race
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;     // Balrog-specific orc, homesite "any non-Dark-hold Under-deeps site"
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater minion item
const BARROW_WIGHT = 'le-61' as CardDefinitionId;        // Undead, keyed shadow-hold/dark-hold, non-unique

/** Balrog company (Crook-legged Orc) at `site` in the site phase, given `hand`. */
function siteWithHand(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Balrog company at The Under-vaults in the site phase, with the hazard player's hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

describe('The Under-vaults (ba-103)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Strange Rations) is playable at The Under-vaults', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_VAULTS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-vaults', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_VAULTS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-vaults', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_VAULTS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ───────────────────

  test('entering The Under-vaults advances to reveal-on-guard-attacks (static Undead attack present)', () => {
    const state = dualHandState({ step: 'enter-or-skip' });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing at reveal-on-guard-attacks advances to automatic-attacks (printed 1st attack faced first)', () => {
    const state = dualHandState({ step: 'reveal-on-guard-attacks', siteEntered: true });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('passing at play-site-auto-attack advances to automatic-attacks without combat', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ───────────────────────────────────

  test('hazard player may play a Shadow-hold keyed creature (Barrow-wight) as 2nd auto-attack', () => {
    // Barrow-wight is keyed to shadow-hold [{S}] and dark-hold [{D}]. The site
    // rule requires shadow-hold [{S}] — Barrow-wight matches.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [BARROW_WIGHT] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(barrowWightInst);
  });

  test('hazard player may NOT play a non-Shadow-hold keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold [{B}] and free-hold [{F}] — not shadow-hold.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Shadow-hold keyed creature offered, non-matching creature suppressed', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [BARROW_WIGHT, ASSASSIN] });
    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(playActions).toHaveLength(1);
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const action = playActions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(barrowWightInst);

    const passActions = viableActions(state, PLAYER_2, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('playing Barrow-wight as 2nd auto-attack initiates combat with played-auto-attack source', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [BARROW_WIGHT] });
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

  test('Barrow-wight (Undead, normally keyed to shadow/dark) is viable against a company at The Under-vaults', () => {
    // Barrow-wight keys to shadow-land/dark-domain regions and shadow-hold/
    // dark-hold sites. The Under-vaults is ruins-and-lairs with an empty
    // (under-deeps) region path. Without the site rule, Barrow-wight would
    // NOT match. With allow-creature-by-race for "undead", the keying check
    // is bypassed.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
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
    // Assassin is keyed to border-hold/free-hold — not ruins-and-lairs. The
    // site rule only helps Undead creatures, not Men.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_VAULTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ASSASSIN], siteDeck: [MINAS_TIRITH] },
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
    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    const assassinActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (assassinInst as string);
    });
    expect(assassinActions.length).toBeGreaterThan(0);
    expect(assassinActions.every(ea => !ea.viable)).toBe(true);
  });

  test('Barrow-wight is NOT made viable at a regular under-deeps site without the site rule (The Under-grottos)', () => {
    // The Under-grottos (ba-101) is also a ruins-and-lairs under-deeps site
    // but carries only dynamic-auto-attack, no allow-creature-by-race. Barrow-
    // wight is keyed to shadow-hold/dark-hold, not ruins-and-lairs — so
    // without the site rule it is not viable here.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GROTTOS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BARROW_WIGHT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Under-grottos',
      }),
    };

    const barrowWightInst = mhState.players[1].hand[0].instanceId;
    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    const bwActions = all.filter(ea => {
      const a = ea.action as { cardInstanceId?: string };
      return a.cardInstanceId === (barrowWightInst as string);
    });
    expect(bwActions.length).toBeGreaterThan(0);
    expect(bwActions.every(ea => !ea.viable)).toBe(true);
  });
});
