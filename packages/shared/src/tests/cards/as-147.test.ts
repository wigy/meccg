/**
 * @module as-147.test
 *
 * Card test: The Gem-deeps (as-147)
 * Type: minion-site (ruins-and-lairs, under-deeps) in Gap of Isen
 *
 * Text:
 *   Adjacent Sites: Glittering Caves (0), The Pûkel-deeps (9), The Under-gates (6)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Undead — 3 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}].
 *   Special: Any Undead creature or Pûkel-creature may be played at this site.
 *
 * This is the minion reprint of The Gem-deeps (hero dm-30 / balrog ba-90);
 * identical rules, minion-side draws (2/3) and longer Pûkel-deeps adjacency (9).
 *
 * Data encoding (filled/added this pass; the imported data dropped all of these
 * vs cards.json — the recurring imported-site data-completion bug):
 *   - `automaticAttacks[0].creatureType` was `""` → `"Undead"`.
 *   - `keywords: ["under-deeps"]` — the site is an Under-deeps site.
 *   - `adjacentSites`: Glittering Caves (0), The Pûkel-deeps (9), The Under-gates (6).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} — 2nd attack.
 *   - `site-rule: allow-creature-by-race` race "undead" — first Special clause.
 *   - `site-rule: allow-creature-by-race` race "pûkel-creature" — second clause.
 *   - `text` re-lined to match cards.json paragraph breaks.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                            |
 * |---|-------------------|--------|--------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site                            |
 * | 4 | region            | OK     | "Gap of Isen"                                    |
 * | 5 | playableResources | OK     | [minor, major, gold-ring]                        |
 * | 6 | automaticAttacks  | OK     | Undead, 3 strikes, 9 prowess (1st attack)        |
 * | 7 | resourceDraws     | OK     | 2                                                |
 * | 8 | hazardDraws       | OK     | 3                                                |
 * | 9 | keywords          | OK     | ["under-deeps"] — added this pass                |
 * | 10| adjacentSites     | OK     | Glittering Caves (0), Pûkel-deeps (9), Under-gates (6) |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) + allow-creature-by-race (undead) + allow-creature-by-race (pûkel-creature) |
 *
 * Engine Support:
 * | # | Feature                                             | Status      | Notes                                              |
 * |---|-----------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Site phase flow                                     | IMPLEMENTED | select-company, enter-or-skip, play-resources       |
 * | 2 | Item playability (minor + major + gold-ring; greater denied) | IMPLEMENTED | site.ts enforces playableResources         |
 * | 3 | Automatic attacks (1st, static Undead 3/9)          | IMPLEMENTED | Undead 3x9 in automaticAttacks                      |
 * | 4 | Dynamic auto-attack (2nd, {S} keyed, non-unique)    | IMPLEMENTED | play-site-auto-attack step; shadow-hold filter      |
 * | 5 | Any Undead may be played here (Special)             | IMPLEMENTED | allow-creature-by-race race "undead" → M/H keying bypass |
 * | 6 | Any Pûkel-creature may be played here (Special)     | IMPLEMENTED | allow-creature-by-race race "pûkel-creature" → M/H keying bypass |
 * | 7 | Under-deeps adjacency movement                      | IMPLEMENTED | organization-companies.ts adjacentSites rolls       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN, ORC_PATROL, BERT_BURAT, BARROW_WIGHT,
  resetMint,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, PlayHazardAction,
} from '../../index.js';

const THE_GEM_DEEPS = 'as-147' as CardDefinitionId;
const THE_UNDER_GROTTOS = 'as-166' as CardDefinitionId; // ruins-and-lairs, under-deeps, NO allow-creature-by-race (baseline)
const THE_MOUTH = 'le-24' as CardDefinitionId; // plain minion company member
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // darkhaven (siteDeck filler)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item (denied)
const A_LITTLE_GOLD_RING = 'le-297' as CardDefinitionId; // non-unique gold-ring item
const SILENT_WATCHER = 'tw-88' as CardDefinitionId; // pûkel-creature, keyed {S}{D} only (not R&L, not Gap of Isen)
// BARROW_WIGHT (tw-015): undead, keyed to shadow/dark regions + shadow-hold/dark-hold
// sites — NOT ruins-and-lairs, NOT Gap of Isen — so it isolates the undead bypass.

/** Minion company (The Mouth) at The Gem-deeps in the site phase, given `hand`. */
function siteWithHand(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_GEM_DEEPS, characters: [THE_MOUTH] }], hand, siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Minion company at The Gem-deeps at a chosen site-phase step; hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_GEM_DEEPS, characters: [THE_MOUTH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A minion company at The Gem-deeps, sitting at the automatic-attacks step. */
function minionAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_GEM_DEEPS, characters: [THE_MOUTH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/**
 * Minion company at a ruins-and-lairs under-deeps site in the movement/hazard
 * phase (empty resolved path, destination R&L) so the hazard player (PLAYER_2)
 * may try to play a creature against it. Used for the Undead/Pûkel keying-bypass
 * tests. `site` selects The Gem-deeps (with the Special) or a baseline R&L.
 */
function mhAtSite(hazardHand: CardDefinitionId[], site: CardDefinitionId, siteName: string): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: siteName,
    }),
  };
}

describe('The Gem-deeps (as-147)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + gold-ring playable; greater not) ─────

  test('minor item (Strange Rations) is playable at The Gem-deeps', () => {
    const plays = viableActions(siteWithHand([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Gem-deeps', () => {
    const plays = viableActions(siteWithHand([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('gold-ring item (A Little Gold Ring) is playable at The Gem-deeps', () => {
    const plays = viableActions(siteWithHand([A_LITTLE_GOLD_RING]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Gem-deeps', () => {
    const plays = viableActions(siteWithHand([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── First automatic attack (static Undead 3/9) ─────────────────────────────

  test('first automatic attack is Undead — 3 strikes with 9 prowess', () => {
    const state = minionAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('undead');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Dynamic second auto-attack: step transitions ──────────────────────────

  test('entering The Gem-deeps advances to reveal-on-guard-attacks (static Undead attack present)', () => {
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

  // ─── Dynamic second auto-attack: non-unique {S}-keyed filter ────────────────

  test('hazard player may play a non-unique Shadow-hold keyed creature (Orc-patrol) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcPatrolInst);
  });

  test('hazard player may NOT play a unique Shadow-hold keyed creature (Bert/Bûrat) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [BERT_BURAT] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player may NOT play a non-{S}-keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold {B} / free-hold {F} — not shadow-hold, and
    // it is Men (not Undead/Pûkel), so no keying-bypass applies either.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('with both unique and non-unique {S}-keyed creatures, only the non-unique is offered', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL, BERT_BURAT] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const bertInst = state.players[1].hand[1].instanceId;
    expect(actions.some(ea => (ea.action as PlaySiteAutoAttackAction).cardInstanceId === orcPatrolInst)).toBe(true);
    expect(actions.some(ea => (ea.action as PlaySiteAutoAttackAction).cardInstanceId === bertInst)).toBe(false);
  });

  test('playing Orc-patrol as 2nd auto-attack initiates combat with played-auto-attack source', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, { type: 'play-site-auto-attack', player: PLAYER_2, cardInstanceId: orcPatrolInst });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Special: any Undead may be played at this site ────────────────────────

  test('Barrow-wight (Undead, keyed {S}/{D}, not R&L) is a viable hazard play at The Gem-deeps via undead bypass', () => {
    // Barrow-wight keys to shadow/dark regions and shadow-hold/dark-hold sites —
    // NOT ruins-and-lairs and not the Gap of Isen region. Without the Special it
    // would not be keyable at The Gem-deeps; allow-creature-by-race (undead) bypasses.
    const state = mhAtSite([BARROW_WIGHT], THE_GEM_DEEPS, 'The Gem-deeps');
    const barrowWightInst = state.players[1].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === barrowWightInst)).toBe(true);
  });

  test('Barrow-wight is NOT keyable at a baseline R&L under-deeps site without the Special (The Under-grottos)', () => {
    // The Under-grottos (as-166) is ruins-and-lairs, under-deeps, with no
    // allow-creature-by-race rule — proving the Special is what enables the bypass.
    const state = mhAtSite([BARROW_WIGHT], THE_UNDER_GROTTOS, 'The Under-grottos');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Special: any Pûkel-creature may be played at this site ────────────────

  test('Silent Watcher (Pûkel-creature, keyed {S}/{D}, not R&L) is a viable hazard play at The Gem-deeps via pûkel bypass', () => {
    // Silent Watcher keys only to shadow-hold/dark-hold — not ruins-and-lairs.
    // allow-creature-by-race (pûkel-creature) bypasses the keying at The Gem-deeps.
    const state = mhAtSite([SILENT_WATCHER], THE_GEM_DEEPS, 'The Gem-deeps');
    const silentWatcherInst = state.players[1].hand[0].instanceId;
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === silentWatcherInst)).toBe(true);
  });

  // ─── Special does not leak to unrelated races ──────────────────────────────

  test('Assassin (Men, not Undead/Pûkel) is NOT made viable at The Gem-deeps by the Special', () => {
    const state = mhAtSite([ASSASSIN], THE_GEM_DEEPS, 'The Gem-deeps');
    const assassinInst = state.players[1].hand[0].instanceId;
    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    const assassinActions = all.filter(ea => (ea.action as PlayHazardAction).cardInstanceId === assassinInst);
    expect(assassinActions.length).toBeGreaterThan(0);
    expect(assassinActions.every(ea => !ea.viable)).toBe(true);
  });
});
