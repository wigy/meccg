/**
 * @module ba-97.test
 *
 * Card test: The Sulfur-deeps (ba-97)
 * Type: balrog-site (dark-hold, under-deeps) in Southern Mirkwood
 *
 * Text:
 *   Adjacent Sites: Dol Guldur (0), The Under-gates (6), The Pûkel-deeps (9),
 *     The Under-galleries (9), The Under-courts (7)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Troll — 2 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold.
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to a Dark-hold/Shadow-hold detainment
 * against a Ringwraith/Balrog defender) for every creature at this site. Like
 * The Under-galleries (ba-99) — and unlike The Under-leas (ba-102), whose 1st
 * attack is explicitly "(detainment)" and is therefore carved out via an
 * `attack.automatic: false` filter — NONE of The Sulfur-deeps' attacks are
 * detainment: the 1st Troll attack has no "(detainment)" marker and the 2nd is
 * a dynamically-played hazard creature. So the override is unconditional (no
 * filter) and flips the detainment flag off for the site's own
 * automatic-attack and for hazard creatures played normally against a company
 * here alike.
 *
 * Data encoding (filled/added this pass):
 *   - `playableResources: [minor, major]` — was `[]` in the imported data
 *     despite the printed "Playable" line (the recurring BA/LE-site
 *     empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} (2nd attack).
 *   - `site-rule: attacks-not-detainment` with NO filter — all creatures at
 *     this site attack normally (the Special line, added this pass; both the
 *     effect and the missing "Special:" text line matched to cards.json).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                                          |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                           |
 * | 4 | region            | OK     | "Southern Mirkwood" — correct per card data                       |
 * | 5 | playableResources | OK     | [minor, major] — fixed to match card text this pass               |
 * | 6 | automaticAttacks  | OK     | Troll, 2 strikes, 9 prowess (1st attack)                          |
 * | 7 | resourceDraws     | OK     | 1                                                                   |
 * | 8 | hazardDraws       | OK     | 1                                                                   |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                     |
 * | 10| adjacentSites     | OK     | Dol Guldur (0), Under-gates (6), Pûkel-deeps (9), Galleries (9), Courts (7) |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) + attacks-not-detainment (no filter) — added this pass |
 *
 * Engine Support:
 * | # | Feature                                        | Status          | Notes                                                    |
 * |---|------------------------------------------------|-----------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED     | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor + major)               | IMPLEMENTED     | site.ts enforces playableResources                        |
 * | 3 | Automatic attack (1st, static Troll)           | IMPLEMENTED     | Troll 2x9 in automaticAttacks                            |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)   | IMPLEMENTED     | play-site-auto-attack step; shadow-hold filter            |
 * | 5 | Creatures keyed to this site attack normally   | IMPLEMENTED     | attacks-not-detainment (no filter) — all attacks normal   |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch,
  handCardId, companyIdAt,
  playCreatureHazardAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, SiteCard,
} from '../../index.js';

const THE_SULFUR_DEEPS = 'ba-97' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Shadow-hold (also R&L, Dark-hold)

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

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

/** Balrog company at The Sulfur-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_SULFUR_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Sulfur-deeps, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_SULFUR_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Sulfur-deeps (ba-97)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Sulfur-deeps', () => {
    const plays = viableActions(siteWithHand(THE_SULFUR_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Sulfur-deeps', () => {
    const plays = viableActions(siteWithHand(THE_SULFUR_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Sulfur-deeps', () => {
    const plays = viableActions(siteWithHand(THE_SULFUR_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Sulfur-deeps advances to reveal-on-guard-attacks (static Troll attack present)', () => {
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
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
    // The Special line: creatures keyed to this site attack normally.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Special rule: creatures keyed to this site attack normally ─────────────

  test('1st Troll automatic attack against the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[THE_SULFUR_DEEPS as string] as SiteCard;
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

  test('hazard creature keyed to Shadow-hold vs the Balrog company here is NOT detainment (direct helper)', () => {
    const siteDef = pool[THE_SULFUR_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
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

  test('Balrog company at The Sulfur-deeps faces the 1st Troll attack normally, not detainment (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.detainment).toBe(false);
  });

  test('Balrog company here facing Orc-patrol (Shadow-hold keyed): combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Balrog/active player at The Sulfur-deeps. PLAYER_2
    // (hero/hazard) plays Orc-patrol keyed to Shadow-hold — B1 detainment
    // without the site's Special rule. The override forces detainment: false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: THE_SULFUR_DEEPS, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [THE_UNDER_GATES_BA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.DarkHold,
        destinationSiteName: 'The Sulfur-deeps',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');
    expect(afterChain.combat!.detainment).toBe(false);
  });

  test('baseline: same Orc-patrol vs Balrog company at a shadow-hold WITHOUT the override IS detainment', () => {
    // Swap The Sulfur-deeps for hero Moria (tw-413) — a shadow-hold with no
    // attacks-not-detainment — to prove the override is what flips the flag.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_HERO, characters: [CROOK_LEGGED_ORC] }],
          hand: [],
          siteDeck: [THE_UNDER_GATES_BA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'Moria',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.detainment).toBe(true);
  });
});
