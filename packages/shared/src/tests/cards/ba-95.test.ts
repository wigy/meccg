/**
 * @module ba-95.test
 *
 * Card test: Remains of Thangorodrim (ba-95)
 * Type: balrog-site (ruins-and-lairs, under-deeps)
 *
 * Text:
 *   Adjacent Sites: no surface site, The Drowning-deeps (9)
 *   Playable: Information, Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Drake — 2 strikes with 12 prowess
 *     (2nd) Opponent may play as an automatic-attack one hazard creature from
 *           his hand normally keyed to Coastal Sea.
 *   Special: Creatures keyed to Coastal Seas may be keyed to this site.
 *
 * Rules interpretation:
 *   - The 2nd automatic-attack lets the opponent play, as a site auto-attack,
 *     a non-unique hazard creature from hand whose own keying names Coastal
 *     Seas [{c}] — modeled by `site-rule: dynamic-auto-attack` (regionTypes
 *     [coastal]). The English text drops the "non-unique" qualifier printed on
 *     the sibling BA under-deeps sites (and on the Spanish/French text of this
 *     card); the engine applies the general non-unique restriction to every
 *     dynamically-played site auto-attack, so this card inherits it.
 *   - The "Special" line is a keying-bypass: any creature whose own keying
 *     lists Coastal Sea [{c}] may be played as a normal hazard against a
 *     company here, even though this is a Ruins & Lairs — modeled by the new
 *     `site-rule: allow-creature-by-keying` (regionTypes [coastal]). Unlike
 *     The Drowning-deeps (ba-89), there is NO Drake-race bypass here: a Drake
 *     that is not coastal-keyed cannot be played as a normal hazard.
 *   The bypass feeds only the normal M/H hazard-creature play path. The 2nd
 *   auto-attack is governed separately by its own `dynamic-auto-attack` keying
 *   filter (Coastal Seas).
 *
 * Data encoding (cross-checked against data/cards.json attributes):
 *   - `playableResources: [information, minor, major, greater]` — filled this
 *     pass (was `[]` in the imported data despite the printed "Playable" line —
 *     the recurring BA-site empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Coastal Seas {c} (2nd attack;
 *     already present).
 *   - `site-rule: allow-creature-by-keying` keying regionTypes [coastal] —
 *     Special clause, added this pass (new primitive).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                          |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                    |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                  |
 * | 4 | region            | OK     | "" — under-deeps, no surface region                      |
 * | 5 | playableResources | OK     | [information, minor, major, greater] — fixed this pass    |
 * | 6 | automaticAttacks  | OK     | Drake, 2 strikes, 12 prowess (1st attack)                |
 * | 7 | resourceDraws     | OK     | 2                                                         |
 * | 8 | hazardDraws       | OK     | 2                                                        |
 * | 9 | keywords          | OK     | ["under-deeps"]                                          |
 * | 10| adjacentSites     | OK     | The Drowning-deeps (9)                                   |
 * | 11| effects           | OK     | dynamic-auto-attack + allow-creature-by-keying (coastal)  |
 *
 * Engine Support:
 * | # | Feature                                          | Status          | Notes                                            |
 * |---|--------------------------------------------------|-----------------|--------------------------------------------------|
 * | 1 | Site phase flow                                  | IMPLEMENTED     | select-company, enter-or-skip, play-resources    |
 * | 2 | Item playability (minor/major/greater playable)  | IMPLEMENTED     | site.ts enforces playableResources               |
 * | 3 | Automatic attacks (1st, static Drake)            | IMPLEMENTED     | Drake 2x12 in automaticAttacks                    |
 * | 4 | Dynamic auto-attack (2nd, Coastal-Seas keyed)    | IMPLEMENTED     | play-site-auto-attack; coastal filter; non-unique |
 * | 5 | Coastal-keyed creatures keyable here (Special)   | IMPLEMENTED     | allow-creature-by-keying (new primitive)          |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN,
  resetMint,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlaySiteAutoAttackAction, PlayHazardAction,
} from '../../index.js';

const REMAINS_OF_THANGORODRIM = 'ba-95' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
// Corsairs of Umbar: non-unique, race Men, keyed to Coastal Seas {c} only
// (region-names aside). Not keyed to Ruins & Lairs — so it isolates the coastal
// keying-bypass Special.
const CORSAIRS_OF_UMBAR = 'tw-24' as CardDefinitionId;
// True Fire-drake: non-unique Drake keyed to three Wildernesses — not coastal,
// not keyed to R&L. Unlike ba-89 (which grants a Drake bypass), ba-95 has NO
// Drake bypass, so this Drake must NOT be playable as a normal hazard here.
const TRUE_FIRE_DRAKE = 'le-95' as CardDefinitionId;

/** Balrog company (Crook-legged Orc) at Remains of Thangorodrim in the site phase, given `hand`. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: REMAINS_OF_THANGORODRIM, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Balrog company at Remains of Thangorodrim at a chosen site-phase step; hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: REMAINS_OF_THANGORODRIM, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** Balrog company at Remains of Thangorodrim in the M/H phase; PLAYER_2 holds `hazardHand`. */
function mhWithHazardHand(hazardHand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: REMAINS_OF_THANGORODRIM, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** True when the hazard player may play `instanceId` as a normal M/H hazard against the company here. */
function canPlayHazard(state: GameState, instanceId: string): boolean {
  const plays = viableActions(state, PLAYER_2, 'play-hazard');
  return plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === instanceId);
}

describe('Remains of Thangorodrim (ba-95)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + greater all playable) ───────────────

  test('minor item (Strange Rations) is playable at Remains of Thangorodrim', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at Remains of Thangorodrim', () => {
    const plays = viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) IS playable at Remains of Thangorodrim', () => {
    // Unlike the sibling BA under-deeps sites, this site lists greater items as
    // playable — the filled playableResources must include "greater".
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  // ─── Dynamic 2nd auto-attack: step transitions ─────────────────────────────

  test('entering the site advances to reveal-on-guard-attacks (static Drake attack present)', () => {
    const state = dualHandState({ step: 'enter-or-skip' });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing at play-site-auto-attack advances to automatic-attacks without combat', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic 2nd auto-attack: legal actions (Coastal-Seas keyed only) ───────

  test('hazard player may play a Coastal-Seas keyed creature (Corsairs of Umbar) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [CORSAIRS_OF_UMBAR] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const corsairsInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(corsairsInst);
  });

  test('hazard player may NOT play a non-coastal creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold {B} / free-hold {F} — not coastal.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('a non-coastal Drake (True Fire-drake) is NOT eligible as the 2nd auto-attack', () => {
    // True Fire-drake is a Drake but keyed to Wildernesses, not Coastal Seas.
    // The 2nd auto-attack requires Coastal-Seas keying, so it must be rejected.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [TRUE_FIRE_DRAKE] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('playing Corsairs of Umbar as 2nd auto-attack initiates combat', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [CORSAIRS_OF_UMBAR] });
    const corsairsInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: corsairsInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.strikeProwess).toBe(9);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Special: creatures keyed to Coastal Sea may be keyed here ─────────────

  test('a Coastal-Seas keyed creature (Corsairs of Umbar) is playable as a normal hazard against the company here', () => {
    const state = mhWithHazardHand([CORSAIRS_OF_UMBAR]);
    const corsairsInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, corsairsInst)).toBe(true);
  });

  // ─── Negative: no Drake bypass here (unlike ba-89) ─────────────────────────

  test('a non-coastal Drake (True Fire-drake) is NOT playable as a normal hazard here (no Drake bypass)', () => {
    // ba-95 grants only the coastal keying-bypass — there is no "any Drake"
    // clause, so a Wilderness-keyed Drake fails normal keying at this R&L.
    const state = mhWithHazardHand([TRUE_FIRE_DRAKE]);
    const drakeInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, drakeInst)).toBe(false);
  });

  test('a creature that is neither coastal-keyed nor keyed here (Assassin) is NOT playable as a normal hazard here', () => {
    // Assassin (Men, keyed to {B}{F}) — no bypass applies, normal keying at a
    // Ruins & Lairs fails, so it is rejected.
    const state = mhWithHazardHand([ASSASSIN]);
    const assassinInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, assassinInst)).toBe(false);
  });
});
