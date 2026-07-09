/**
 * @module ba-91.test
 *
 * Card test: The Iron-deeps (ba-91)
 * Type: balrog-site (dark-hold, under-deeps) in Angmar
 *
 * Text:
 *   Adjacent Sites: Carn Dûm (0), The Under-leas (6), The Under-vaults (7)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 3 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Ruins and Lairs.
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *            Any Drake creature (except Sea Serpent) may be keyed to this site.
 *
 * Rules interpretation:
 *   - "Creatures keyed to this site attack normally, not as detainment"
 *     overrides CoE §3.II.2.B1 (which would otherwise make an attack keyed to a
 *     Dark-hold detainment against a Balrog defender) for EVERY attack at this
 *     site. Neither of the site's own attacks is marked "(detainment)" — the
 *     Trolls attack has no marker and the 2nd is a dynamically-played creature —
 *     so the override is unconditional (no filter), exactly like The
 *     Under-galleries (ba-99) and unlike The Under-leas (ba-102, whose 1st
 *     attack is explicitly detainment and is carved out by a filter).
 *   - "Any Drake creature (except Sea Serpent) may be keyed to this site" is a
 *     keying permission: a Drake (except Sea Serpent) becomes keyable to this
 *     site regardless of its printed keying. It feeds both normal hazard-creature
 *     play against a company here AND the 2nd (dynamic) automatic-attack pool.
 *
 * Data encoding (filled/added this pass; the imported data dropped both):
 *   - `playableResources: [minor, major]` — was `[]` despite the printed
 *     "Playable" line (the recurring BA/LE-site empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Ruins & Lairs {R} (2nd attack).
 *   - `site-rule: attacks-not-detainment` with NO filter (the first Special
 *     sentence).
 *   - `site-rule: allow-creature-by-race` race "drake" with
 *     `except: { name: "Sea Serpent" }` (the second Special sentence).
 *   - `text` extended with the missing "Special:" line to match cards.json.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                        |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                            |
 * | 4 | region            | OK     | "Angmar"                                         |
 * | 5 | playableResources | OK     | [minor, major] — fixed this pass                 |
 * | 6 | automaticAttacks  | OK     | Trolls, 3 strikes, 9 prowess (1st attack)        |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 3                                                |
 * | 9 | keywords          | OK     | ["under-deeps"]                                  |
 * | 10| adjacentSites     | OK     | Carn Dûm (0), Under-leas (6), Under-vaults (7)   |
 * | 11| effects           | OK     | dynamic-auto-attack (R&L) + attacks-not-detainment (no filter) + allow-creature-by-race (drake, except Sea Serpent) |
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                              |
 * |---|----------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                                    | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Item playability (minor + major; greater denied)   | IMPLEMENTED | site.ts enforces playableResources                  |
 * | 3 | Automatic attacks (1st, static Trolls)             | IMPLEMENTED | Trolls 3x9 in automaticAttacks                      |
 * | 4 | Dynamic auto-attack (2nd, R&L keyed)               | IMPLEMENTED | play-site-auto-attack step; ruins-and-lairs filter  |
 * | 5 | Creatures keyed to this site attack normally       | IMPLEMENTED | attacks-not-detainment (no filter)                  |
 * | 6 | Any Drake (except Sea Serpent) may be keyed here   | IMPLEMENTED | allow-creature-by-race + except → both M/H play and 2nd auto-attack |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN, ORC_PATROL,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, SiteCard,
} from '../../index.js';

const THE_IRON_DEEPS = 'ba-91' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const TRUE_FIRE_DRAKE = 'td-78' as CardDefinitionId; // non-unique Drake, keyed to Wilderness only
const SEA_SERPENT = 'td-66' as CardDefinitionId; // non-unique Drake, keyed to Coastal-sea — the exception

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

/** Balrog company at The Iron-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_IRON_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Iron-deeps, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_IRON_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/**
 * Balrog company at The Iron-deeps in the movement/hazard phase (destination is
 * a Dark-hold, no wilderness in the path) so the hazard player (PLAYER_2) may
 * try to play a creature against it. Used for the Drake keying-bypass tests.
 */
function mhAtIronDeeps(hazardHand: CardDefinitionId[], site: CardDefinitionId = THE_IRON_DEEPS): GameState {
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
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'The Iron-deeps',
    }),
  };
}

describe('The Iron-deeps (ba-91)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Iron-deeps', () => {
    const plays = viableActions(siteWithHand(THE_IRON_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Iron-deeps', () => {
    const plays = viableActions(siteWithHand(THE_IRON_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Iron-deeps', () => {
    const plays = viableActions(siteWithHand(THE_IRON_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Iron-deeps advances to reveal-on-guard-attacks (static Troll attack present)', () => {
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

  test('hazard player may play a Ruins-&-Lairs keyed creature (Orc-patrol) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcPatrolInst);
  });

  test('hazard player may NOT play a non-R&L keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold {B} / free-hold {F} — not R&L.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player MAY play a Drake (True Fire-drake, keyed to Wilderness) as 2nd auto-attack — Drake keying special', () => {
    // True Fire-drake is keyed only to Wilderness, so it does NOT satisfy the
    // R&L keying of the 2nd auto-attack on its own. "Any Drake may be keyed to
    // this site" makes it eligible.
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

  test('playing Orc-patrol as 2nd auto-attack initiates a normal (non-detainment) combat', () => {
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
    // The Special line: creatures keyed to this site attack normally.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Drake keying special: normal M/H hazard-creature play ─────────────────

  test('a Drake (True Fire-drake) is a viable hazard play against the company at The Iron-deeps via keying-bypass', () => {
    // Destination is a Dark-hold with no wilderness in the path, so the drake is
    // not normally keyable here; the site's Drake special makes the play viable.
    const state = mhAtIronDeeps([TRUE_FIRE_DRAKE]);
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe('drake');
  });

  test('Sea Serpent (excepted Drake) is NOT a viable hazard play at The Iron-deeps', () => {
    const state = mhAtIronDeeps([SEA_SERPENT]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
    // The play-hazard entry exists but is non-viable (a keying error).
    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all).toHaveLength(1);
    expect(all[0].viable).toBe(false);
  });

  test('baseline: a Drake is NOT keyable at a Dark-hold WITHOUT the Drake special (hero Moria shadow-hold)', () => {
    // Swap in hero Moria (tw-413), a shadow-hold with no allow-creature-by-race
    // rule; the wilderness-keyed drake is not keyable there → proves the special
    // is what makes it viable at The Iron-deeps.
    const state = mhAtIronDeeps([TRUE_FIRE_DRAKE], MORIA_HERO);
    const withMoriaDest: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };
    expect(viableActions(withMoriaDest, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('1st Trolls automatic attack against the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[THE_IRON_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: same dark-hold auto-attack WITHOUT the override IS detainment vs a Balrog defender', () => {
    // Same inputs but no site effects → §3.II.2.B1 fires (dark-hold keyed vs
    // Balrog) → detainment. Proves the override is what flips the flag.
    const detainment = isDetainmentAttack({
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('Balrog company at The Iron-deeps faces the 1st Troll attack normally, not detainment (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.detainment).toBe(false);
  });
});
