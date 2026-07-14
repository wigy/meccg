/**
 * @module ba-104.test
 *
 * Card test: The Wind-deeps (ba-104)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in Grey Mountain Narrows
 *
 * Text:
 *   Adjacent Sites: The Wind Throne (0), The Under-leas (5), The Rusted-deeps (8)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 3 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold.
 *   Special: Any Drake creature (except Sea Serpent) may be keyed to this site.
 *
 * Rules interpretation:
 *   - "Opponent may play … keyed to a Shadow-hold" is the standard dynamic 2nd
 *     automatic-attack (site-rule: dynamic-auto-attack, keyed to {S}). Because it
 *     keys by SITE-type, the Drake special also feeds its eligibility pool: a
 *     Drake becomes a legal 2nd-attack choice even without shadow-hold keying.
 *   - "Any Drake creature (except Sea Serpent) may be keyed to this site" is a
 *     keying permission: a Drake (except Sea Serpent) becomes keyable to this
 *     site regardless of its printed keying — both for normal hazard-creature
 *     play against a company here AND the 2nd (dynamic) automatic-attack pool.
 *   - The site is a Ruins & Lairs, so its own attacks are not detainment against
 *     a Balrog defender; there is no attacks-not-detainment rule (unlike the
 *     Dark-hold Iron-deeps ba-91).
 *
 * Data encoding (filled/added this pass; the imported data dropped both):
 *   - `playableResources: [minor, major]` — was `[]` despite the printed
 *     "Playable" line (the recurring BA/LE-site empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} (2nd attack) —
 *     already present.
 *   - `site-rule: allow-creature-by-race` race "drake" with
 *     `except: { name: "Sea Serpent" }` (the Special sentence) — added.
 *   - `text` extended with the missing "Special:" line to match cards.json.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                            |
 * | 4 | region            | OK     | "Grey Mountain Narrows"                          |
 * | 5 | playableResources | OK     | [minor, major] — fixed this pass                 |
 * | 6 | automaticAttacks  | OK     | Orcs, 3 strikes, 7 prowess (1st attack)          |
 * | 7 | resourceDraws     | OK     | 1                                                |
 * | 8 | hazardDraws       | OK     | 1                                                |
 * | 9 | keywords          | OK     | ["under-deeps"]                                  |
 * | 10| adjacentSites     | OK     | Wind Throne (0), Under-leas (5), Rusted-deeps (8)|
 * | 11| effects           | OK     | dynamic-auto-attack ({S}) + allow-creature-by-race (drake, except Sea Serpent) |
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                              |
 * |---|----------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                                    | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Item playability (minor + major; greater denied)   | IMPLEMENTED | site.ts enforces playableResources                  |
 * | 3 | Automatic attacks (1st, static Orcs)               | IMPLEMENTED | Orcs 3x7 in automaticAttacks                        |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)       | IMPLEMENTED | play-site-auto-attack step; shadow-hold filter      |
 * | 5 | Any Drake (except Sea Serpent) may be keyed here   | IMPLEMENTED | allow-creature-by-race + except → both M/H play and 2nd auto-attack |
 *
 * Playable: YES
 * Certified: 2026-07-14
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

const THE_WIND_DEEPS = 'ba-104' as CardDefinitionId;
const THE_UNDER_GROTTOS = 'ba-101' as CardDefinitionId;  // ruins-and-lairs, under-deeps, NO allow-creature-by-race
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;     // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;    // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;       // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId;  // greater minion item
const BARROW_WIGHT = 'le-61' as CardDefinitionId;        // Undead, keyed shadow-hold/dark-hold, non-unique
const TRUE_FIRE_DRAKE = 'td-78' as CardDefinitionId;     // non-unique Drake, keyed to Wilderness only
const SEA_SERPENT = 'td-66' as CardDefinitionId;         // non-unique Drake, keyed to Coastal-sea — the exception

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

/** Balrog company at The Wind-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_WIND_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/**
 * A Balrog company at The Wind-deeps in the movement/hazard phase (destination is
 * a Ruins & Lairs, no wilderness in the path) so the hazard player (PLAYER_2) may
 * try to play a creature against it. Used for the Drake keying-bypass tests.
 */
function mhAtWindDeeps(hazardHand: CardDefinitionId[], site: CardDefinitionId = THE_WIND_DEEPS, destName = 'The Wind-deeps'): GameState {
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

describe('The Wind-deeps (ba-104)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Wind-deeps', () => {
    const plays = viableActions(siteWithHand(THE_WIND_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Wind-deeps', () => {
    const plays = viableActions(siteWithHand(THE_WIND_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Wind-deeps', () => {
    const plays = viableActions(siteWithHand(THE_WIND_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Wind-deeps advances to reveal-on-guard-attacks (static Orc attack present)', () => {
    const state = dualHandState({ step: 'enter-or-skip' });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing at reveal-on-guard-attacks advances to play-site-auto-attack (dynamic 2nd attack)', () => {
    const state = dualHandState({ step: 'reveal-on-guard-attacks', siteEntered: true });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((next.phaseState as SitePhaseState).step).toBe('play-site-auto-attack');
  });

  test('passing at play-site-auto-attack advances to automatic-attacks without combat', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ────────────────────────────────────

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
    // Assassin is keyed to border-hold {B} / free-hold {F} — not shadow-hold.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player MAY play a Drake (True Fire-drake, keyed to Wilderness) as 2nd auto-attack — Drake keying special', () => {
    // True Fire-drake is keyed only to Wilderness, so it does NOT satisfy the
    // shadow-hold keying of the 2nd auto-attack on its own. "Any Drake may be
    // keyed to this site" makes it eligible (the attack keys by site-type).
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [TRUE_FIRE_DRAKE] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const drakeInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(drakeInst);
  });

  test('hazard player may NOT play Sea Serpent (the excepted Drake) as 2nd auto-attack', () => {
    // Sea Serpent is a Drake but explicitly excepted — the allow-creature-by-race
    // `except` clause keeps it ineligible (it is keyed only to Coastal-sea).
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [SEA_SERPENT] });
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

  // ─── Drake keying special: normal M/H hazard-creature play ─────────────────

  test('a Drake (True Fire-drake) is a viable hazard play against the company at The Wind-deeps via keying-bypass', () => {
    // Destination is a Ruins & Lairs with no wilderness in the path, so the drake
    // is not normally keyable here; the site's Drake special makes the play viable.
    const state = mhAtWindDeeps([TRUE_FIRE_DRAKE]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe('drake');
  });

  test('Sea Serpent (excepted Drake) is NOT a viable hazard play at The Wind-deeps', () => {
    const state = mhAtWindDeeps([SEA_SERPENT]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
    // The play-hazard entry exists but is non-viable (a keying error).
    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all).toHaveLength(1);
    expect(all[0].viable).toBe(false);
  });

  test('a Drake is NOT keyable at a regular under-deeps R&L site WITHOUT the Drake special (The Under-grottos)', () => {
    // The Under-grottos (ba-101) is also a ruins-and-lairs under-deeps site but
    // carries no allow-creature-by-race rule; the wilderness-keyed drake is not
    // keyable there → proves the special is what makes it viable at The Wind-deeps.
    const state = mhAtWindDeeps([TRUE_FIRE_DRAKE], THE_UNDER_GROTTOS, 'The Under-grottos');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
