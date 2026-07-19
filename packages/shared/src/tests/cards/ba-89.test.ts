/**
 * @module ba-89.test
 *
 * Card test: The Drowning-deeps (ba-89)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in Númeriador
 *
 * Text:
 *   Adjacent Sites: Blue Mountain Dwarf-hold (13), The Under-vaults (8),
 *                   Remains of Thangorodrim (9)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Drake — 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to Coastal Seas.
 *   Special: Creatures keyed to Coastal Sea and any Drakes may be keyed to
 *            this site.
 *
 * Rules interpretation: the "Special" line has two independent keying-bypass
 * clauses that let the opponent play, as a normal hazard against a company
 * here, creatures that would otherwise fail keying at a Ruins & Lairs in
 * Númeriador:
 *   (A) any creature whose own keying lists Coastal Sea [{c}] — modeled by the
 *       new `site-rule: allow-creature-by-keying` (regionTypes [coastal]),
 *       which grants the bypass when a creature's `keyedTo` names coastal.
 *   (B) any Drake-race creature — modeled by `site-rule: allow-creature-by-race`
 *       race "drake" (no `except`: unlike ba-91, ba-89 lists no Sea Serpent
 *       carve-out, since a coastal-keyed Sea Serpent is already covered by (A)).
 * These bypasses feed only the normal M/H hazard-creature play path. The 2nd
 * automatic-attack is governed separately by its own `dynamic-auto-attack`
 * keying filter (Coastal Seas), so a non-coastal Drake is a legal normal hazard
 * here but NOT a legal 2nd auto-attack.
 *
 * Data encoding (cross-checked against data/cards.json attributes):
 *   - `playableResources: [minor, major]` — filled this pass (was `[]` in the
 *     imported data despite the printed "Playable" line — the recurring BA-site
 *     empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Coastal Seas {c} (2nd attack;
 *     already present).
 *   - `site-rule: allow-creature-by-keying` keying regionTypes [coastal] —
 *     Special clause (A), added this pass (new primitive).
 *   - `site-rule: allow-creature-by-race` race "drake" — Special clause (B),
 *     added this pass.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                          |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                    |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                  |
 * | 4 | region            | OK     | "Númeriador" — per card data                             |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text this pass      |
 * | 6 | automaticAttacks  | OK     | Drake, 2 strikes, 11 prowess (1st attack)                |
 * | 7 | resourceDraws     | OK     | 1                                                         |
 * | 8 | hazardDraws       | OK     | 2                                                        |
 * | 9 | keywords          | OK     | ["under-deeps"]                                          |
 * | 10| adjacentSites     | OK     | Blue Mountain Dwarf-hold (13), Under-vaults (8), RoT (9) |
 * | 11| effects           | OK     | dynamic-auto-attack + allow-creature-by-keying (coastal) + allow-creature-by-race (drake) |
 *
 * Engine Support:
 * | # | Feature                                          | Status          | Notes                                            |
 * |---|--------------------------------------------------|-----------------|--------------------------------------------------|
 * | 1 | Site phase flow                                  | IMPLEMENTED     | select-company, enter-or-skip, play-resources    |
 * | 2 | Item playability (minor + major; greater not)    | IMPLEMENTED     | site.ts enforces playableResources               |
 * | 3 | Automatic attacks (1st, static Drake)            | IMPLEMENTED     | Drake 2x11 in automaticAttacks                    |
 * | 4 | Dynamic auto-attack (2nd, Coastal-Seas keyed)    | IMPLEMENTED     | play-site-auto-attack; coastal filter; non-unique |
 * | 5 | Coastal-keyed creatures keyable here (Special A) | IMPLEMENTED     | allow-creature-by-keying (new primitive)          |
 * | 6 | Any Drake keyable here (Special B)               | IMPLEMENTED     | allow-creature-by-race race "drake"               |
 * | 7 | Under-deeps movement roll                        | NOT IMPLEMENTED | General rule 3.45; not specific to this card      |
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

const THE_DROWNING_DEEPS = 'ba-89' as CardDefinitionId;
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
// Corsairs of Umbar: non-unique, race Men, keyed to Coastal Seas {c} only
// (region-names aside). Not a Drake, not keyed to Ruins & Lairs / Númeriador —
// so it isolates the coastal keying-bypass clause (A).
const CORSAIRS_OF_UMBAR = 'tw-24' as CardDefinitionId;
// True Fire-drake: non-unique Drake keyed to three Wildernesses — not coastal,
// not keyed to R&L / Númeriador — so it isolates the Drake keying-bypass (B)
// and proves the Drake bypass does NOT leak into the coastal 2nd auto-attack.
const TRUE_FIRE_DRAKE = 'le-95' as CardDefinitionId;

/** Balrog company (Crook-legged Orc) at The Drowning-deeps in the site phase, given `hand`. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_DROWNING_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand, siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Balrog company at The Drowning-deeps at a chosen site-phase step; hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_DROWNING_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** Balrog company at The Drowning-deeps in the M/H phase; PLAYER_2 holds `hazardHand`. */
function mhWithHazardHand(hazardHand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_DROWNING_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
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

describe('The Drowning-deeps (ba-89)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Drowning-deeps', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Drowning-deeps', () => {
    const plays = viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Drowning-deeps', () => {
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic 2nd auto-attack: step transitions ─────────────────────────────

  test('entering The Drowning-deeps advances to reveal-on-guard-attacks (static Drake attack present)', () => {
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

  test('the Drake keying-bypass does NOT leak into the 2nd auto-attack: a non-coastal Drake is not eligible', () => {
    // True Fire-drake is a Drake but keyed to Wildernesses, not Coastal Seas.
    // The 2nd auto-attack requires Coastal-Seas keying, so it must be rejected
    // even though the Special line lets it be played as a normal hazard here.
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

  // ─── Special (A): creatures keyed to Coastal Sea may be keyed here ──────────

  test('a Coastal-Seas keyed creature (Corsairs of Umbar) is playable as a normal hazard against the company here', () => {
    const state = mhWithHazardHand([CORSAIRS_OF_UMBAR]);
    const corsairsInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, corsairsInst)).toBe(true);
  });

  // ─── Special (B): any Drake may be keyed here ──────────────────────────────

  test('a non-coastal Drake (True Fire-drake) is playable as a normal hazard against the company here', () => {
    const state = mhWithHazardHand([TRUE_FIRE_DRAKE]);
    const drakeInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, drakeInst)).toBe(true);
  });

  // ─── Negative: neither coastal nor Drake, and not keyed to this site ────────

  test('a creature that is neither coastal-keyed nor a Drake (Assassin) is NOT playable as a normal hazard here', () => {
    // Assassin (Men, keyed to {B}{F}) — no bypass applies, normal keying at a
    // Ruins & Lairs in Númeriador fails, so it is rejected.
    const state = mhWithHazardHand([ASSASSIN]);
    const assassinInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(canPlayHazard(state, assassinInst)).toBe(false);
  });
});
