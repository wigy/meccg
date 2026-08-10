/**
 * @module ba-98.test
 *
 * Card test: The Under-courts (ba-98)
 * Type: balrog-site (dark-hold, under-deeps) in Gorgoroth
 *
 * Text:
 *   Adjacent Sites: Barad-dûr (0), The Under-galleries (6), The Sulfur-deeps (7)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 3 strikes with 10 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold.
 *
 * Rules interpretation: The Under-courts is a near-mirror of The Under-galleries
 * (ba-99) — same dynamically-played 2nd automatic-attack (a non-unique hazard
 * creature keyed to a Shadow-hold), same under-deeps dark-hold shape. The one
 * meaningful difference is that ba-98 has NO "Special:" line: it does NOT carry
 * an `attacks-not-detainment` override. So the standard CoE §3.II.2.B1 rule
 * applies unchanged — the site's own dark-hold-keyed automatic-attacks (and any
 * Shadow-hold-keyed hazard creature played here) ARE detainment against the
 * defending Balrog/Ringwraith company. This test asserts that default detainment
 * behaviour precisely to prove the absence of any override.
 *
 * Data encoding:
 *   - `playableResources: [minor, major]` — filled this pass (was `[]` in the
 *     imported data despite the printed "Playable" line, the recurring BA/LE-site
 *     empty-playableResources bug). Note: NO information (unlike ba-99).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} (2nd attack).
 *   - No `attacks-not-detainment` effect (no Special line).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                                          |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                           |
 * | 4 | region            | OK     | "Gorgoroth" — correct per card data                               |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text this pass               |
 * | 6 | automaticAttacks  | OK     | Trolls, 3 strikes, 10 prowess (1st attack)                        |
 * | 7 | resourceDraws     | OK     | 2                                                                   |
 * | 8 | hazardDraws       | OK     | 3                                                                   |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                     |
 * | 10| adjacentSites     | OK     | Barad-dûr (0), The Under-galleries (6), The Sulfur-deeps (7)      |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) only — no detainment override    |
 *
 * Engine Support:
 * | # | Feature                                        | Status          | Notes                                                    |
 * |---|------------------------------------------------|-----------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED     | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor + major; not greater)  | IMPLEMENTED     | site.ts enforces playableResources                        |
 * | 3 | Automatic attacks (1st, static Trolls 3x10)    | IMPLEMENTED     | Trolls in automaticAttacks                                |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)   | IMPLEMENTED     | play-site-auto-attack step; shadow-hold filter            |
 * | 5 | Default detainment (no override)               | IMPLEMENTED     | §3.II.2.B1 dark-hold/shadow-hold keyed vs Balrog          |
 * | 6 | Under-deeps movement roll                      | NOT IMPLEMENTED | General rule 3.45; not specific to this card              |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN,
  resetMint, pool,
  buildTestState, makeSitePhase,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, SiteCard,
} from '../../index.js';

const THE_UNDER_COURTS = 'ba-98' as CardDefinitionId;
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Shadow-hold (also R&L, Dark-hold)

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

/** Balrog company at The Under-courts in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_COURTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Under-courts, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_COURTS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Under-courts (ba-98)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Under-courts', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_COURTS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-courts', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_COURTS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-courts', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_COURTS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Under-courts advances to reveal-on-guard-attacks (static Troll attack present)', () => {
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
    // Assassin is keyed to border-hold {B} / free-hold {F} — not shadow-hold.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('playing Orc-patrol as 2nd auto-attack initiates combat — detainment vs the Balrog company (no override)', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: orcPatrolInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
    // No Special line: a Shadow-hold-keyed creature vs the Balrog company here is
    // detainment per §3.II.2.B1 (unlike ba-99, which overrides this to false).
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── Default detainment: no override at this site ──────────────────────────

  test('1st Trolls automatic attack against the Balrog company IS detainment (direct helper)', () => {
    // §3.II.2.B1: the site's own dark-hold-keyed auto-attack is detainment
    // against the Balrog defender. ba-98 carries no attacks-not-detainment
    // override, so the flag stays on.
    const siteDef = pool[THE_UNDER_COURTS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Troll,
      attackKeyedTo: [{ siteTypes: [SiteType.DarkHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('site effects carry the dynamic-auto-attack rule but NO attacks-not-detainment override', () => {
    const siteDef = pool[THE_UNDER_COURTS as string] as SiteCard;
    const rules = (siteDef.effects ?? []).filter((e) => e.type === 'site-rule');
    expect(rules.some((e) => (e as { rule?: string }).rule === 'dynamic-auto-attack')).toBe(true);
    expect(rules.some((e) => (e as { rule?: string }).rule === 'attacks-not-detainment')).toBe(false);
  });

  test('Balrog company at The Under-courts faces the 1st Troll attack (3x10) as detainment (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.strikesTotal).toBe(3);
    // No Special line → default §3.II.2.B1 detainment against the Balrog defender.
    expect(next.combat!.detainment).toBe(true);
  });
});
