/**
 * @module ba-96.test
 *
 * Card test: The Rusted-deeps (ba-96)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in Iron Hills
 *
 * Text:
 *   Adjacent Sites: Iron Hill Dwarf-hold (13), The Wind-deeps (8)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Drake — 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}].
 *   Special: Any Dragon creature (except Eärcaraxë) may be keyed to this site.
 *
 * Rules interpretation:
 *   - The 1st automatic-attack is a static Drake (2 strikes, 11 prowess).
 *   - The 2nd automatic-attack is dynamic: the hazard player may play a
 *     non-unique hazard creature normally keyed to a Shadow-hold [{S}] from hand
 *     as the site's auto-attack (`site-rule: dynamic-auto-attack`, siteType
 *     shadow-hold).
 *   - "Any Dragon creature (except Eärcaraxë) may be keyed to this site" is a
 *     keying permission: a Dragon (except Eärcaraxë) becomes keyable to this site
 *     regardless of its printed keying. In the shared data the great named
 *     Dragons carry race "dragon" (Smaug, Scatha, Cave-drake tw-020, …); the
 *     lesser drakes carry race "drake". It feeds both normal hazard-creature play
 *     against a company here AND the 2nd (dynamic) automatic-attack pool (the
 *     dynamic attack keys by SITE-TYPE {S}, so being keyable to this site
 *     satisfies its site-type requirement — see The Iron-deeps ba-91).
 *
 * Data encoding (filled/added this pass; the imported data dropped all three):
 *   - `playableResources: [minor, major]` — was `[]` despite the printed
 *     "Playable" line (the recurring BA/LE-site empty-playableResources bug).
 *   - `site-rule: allow-creature-by-race` race "dragon" with
 *     `except: { name: "Eärcaraxë" }` (the Special line).
 *   - `text` extended with the missing "Special:" line to match cards.json.
 *   (The `dynamic-auto-attack` keyed to Shadow-hold {S} was already present.)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                            |
 * | 4 | region            | OK     | "Iron Hills"                                     |
 * | 5 | playableResources | OK     | [minor, major] — fixed this pass                 |
 * | 6 | automaticAttacks  | OK     | Drake, 2 strikes, 11 prowess (1st attack)        |
 * | 7 | resourceDraws     | OK     | 1                                                |
 * | 8 | hazardDraws       | OK     | 2                                                |
 * | 9 | keywords          | OK     | ["under-deeps"]                                  |
 * | 10| adjacentSites     | OK     | Iron Hill Dwarf-hold (13), The Wind-deeps (8)    |
 * | 11| effects           | OK     | dynamic-auto-attack ({S}) + allow-creature-by-race (dragon, except Eärcaraxë) |
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                              |
 * |---|----------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                                    | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Item playability (minor + major; greater denied)   | IMPLEMENTED | site.ts enforces playableResources                  |
 * | 3 | Automatic attacks (1st, static Drake)              | IMPLEMENTED | Drake 2x11 in automaticAttacks                      |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)       | IMPLEMENTED | play-site-auto-attack step; shadow-hold filter      |
 * | 5 | Any Dragon (except Eärcaraxë) may be keyed here    | IMPLEMENTED | allow-creature-by-race + except → both M/H play and 2nd auto-attack |
 *
 * Playable: YES
 * Certified: 2026-07-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN, ORC_PATROL,
  resetMint,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction,
} from '../../index.js';

const THE_RUSTED_DEEPS = 'ba-96' as CardDefinitionId;
const ETTENMOORS = 'tw-395' as CardDefinitionId; // plain hero ruins-and-lairs, no allow-creature-by-race (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const CAVE_DRAKE = 'tw-020' as CardDefinitionId; // non-unique Dragon, keyed to R&L/wilderness only (NOT shadow-hold)
const SMAUG = 'tw-90' as CardDefinitionId; // unique Dragon, keyed only to The Lonely Mountain
const EARCARAXE = 'td-20' as CardDefinitionId; // unique Dragon, keyed to Isle of the Ulond — the exception

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

/** Balrog company at The Rusted-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_RUSTED_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Rusted-deeps, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_RUSTED_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/**
 * Balrog company at The Rusted-deeps in the movement/hazard phase (destination is
 * a Ruins & Lairs, no wilderness in the path) so the hazard player (PLAYER_2) may
 * try to play a creature against it. Used for the Dragon keying-bypass tests.
 */
function mhAtRustedDeeps(hazardHand: CardDefinitionId[], site: CardDefinitionId = THE_RUSTED_DEEPS, destName = 'The Rusted-deeps'): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: destName,
    }),
  };
}

describe('The Rusted-deeps (ba-96)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Rusted-deeps', () => {
    const plays = viableActions(siteWithHand(THE_RUSTED_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Rusted-deeps', () => {
    const plays = viableActions(siteWithHand(THE_RUSTED_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Rusted-deeps', () => {
    const plays = viableActions(siteWithHand(THE_RUSTED_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Rusted-deeps advances to reveal-on-guard-attacks (static Drake attack present)', () => {
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

  // ─── Dynamic auto-attack: legal actions ────────────────────────────────────

  test('hazard player may play a Shadow-hold keyed creature (Orc-patrol) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcPatrolInst);
  });

  test('hazard player may NOT play a non-Shadow-hold keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold {B} / free-hold {F} — not Shadow-hold.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player MAY play a non-unique Dragon (Cave-drake, keyed to R&L) as 2nd auto-attack — Dragon keying special', () => {
    // Cave-drake tw-020 is a non-unique Dragon keyed to Ruins & Lairs / Wilderness,
    // NOT to a Shadow-hold, so it does not satisfy the 2nd auto-attack's {S} keying
    // on its own. "Any Dragon may be keyed to this site" makes it eligible.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [CAVE_DRAKE] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const drakeInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(drakeInst);
  });

  test('playing Orc-patrol as 2nd auto-attack initiates combat', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: orcPatrolInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dragon keying special: normal M/H hazard-creature play ────────────────

  test('a Dragon (Smaug, keyed to The Lonely Mountain) is a viable hazard play at The Rusted-deeps via keying-bypass', () => {
    // Destination is a Ruins & Lairs with no wilderness in the path, and Smaug is
    // keyed only to The Lonely Mountain, so it is not normally keyable here; the
    // site's Dragon special makes the play viable.
    const state = mhAtRustedDeeps([SMAUG]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe('dragon');
  });

  test('Eärcaraxë (the excepted Dragon) is NOT a viable hazard play at The Rusted-deeps', () => {
    const state = mhAtRustedDeeps([EARCARAXE]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
    // The play-hazard entry exists but is non-viable (a keying error).
    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all).toHaveLength(1);
    expect(all[0].viable).toBe(false);
  });

  test('baseline: a Dragon is NOT keyable at a plain Ruins & Lairs WITHOUT the Dragon special (Ettenmoors)', () => {
    // Ettenmoors (tw-395) is a Ruins & Lairs with no allow-creature-by-race rule;
    // Smaug (keyed only to The Lonely Mountain) is not keyable there → proves the
    // special is what makes it viable at The Rusted-deeps.
    const state = mhAtRustedDeeps([SMAUG], ETTENMOORS, 'Ettenmoors');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Static 1st automatic-attack (Drake) ────────────────────────────────────

  test('Balrog company at The Rusted-deeps faces the 1st Drake attack (2 strikes, 11 prowess)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('drake');
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.strikesTotal).toBe(2);
  });
});
