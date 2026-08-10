/**
 * @module ba-102.test
 *
 * Card test: The Under-leas (ba-102)
 * Type: balrog-site (shadow-hold, under-deeps) in Gundabad
 *
 * Text:
 *   Adjacent Sites: Mount Gundabad (0), The Wind-deeps (5), The Iron-deeps (6),
 *     The Under-grottos (6), The Under-gates (4), The Under-vaults (5)
 *   Playable: Items (minor)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 5 strikes with 7 prowess (detainment)
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Ruins and Lairs.
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to Shadow-hold detainment against a
 * Ringwraith/Balrog defender) for creatures normally keyed to this site's
 * type, played against a company here. The 1st automatic-attack is carved
 * out of that override — it is unconditionally detainment per its own
 * "(detainment)" text, regardless of the defender's alignment. The 2nd,
 * dynamically-played attack is likewise carved out of the override (it is
 * the site's own automatic-attack mechanism, not a "creature played
 * normally"), but is not separately forced detainment either — same as the
 * equivalent 2nd attacks on The Under-grottos (ba-101) and The Under-vaults
 * (ba-103).
 *
 * Data encoding:
 *   - `site-rule: dynamic-auto-attack` keyed to Ruins & Lairs {R} (2nd attack).
 *   - `combat-detainment` (unconditional) — forces the 1st automatic-attack
 *     to be detainment regardless of defender alignment.
 *   - `site-rule: attacks-not-detainment` filtered to `{ "attack.automatic":
 *     false }` — excludes the site's own automatic-attacks (1st and 2nd)
 *     from the override, so only genuinely "played against the company"
 *     hazard creatures get the normal-attack treatment.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|----------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid ({S})                                         |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                              |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                            |
 * | 4 | region            | OK     | "Gundabad" — correct per card data                                  |
 * | 5 | playableResources | OK     | [minor] — fixed to match card text (was [] before this pass)       |
 * | 6 | automaticAttacks  | OK     | Orcs, 5 strikes, 7 prowess (1st attack)                             |
 * | 7 | resourceDraws     | OK     | 1                                                                    |
 * | 8 | hazardDraws       | OK     | 1                                                                    |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                      |
 * | 10| adjacentSites     | OK     | Mount Gundabad (0), Wind-deeps (5), Iron-deeps (6), Under-grottos (6), Under-gates (4), Under-vaults (5) |
 * | 11| effects           | OK     | dynamic-auto-attack (ruins-and-lairs) + combat-detainment + attacks-not-detainment (attack.automatic: false) — added this pass |
 *
 * Engine Support:
 * | # | Feature                                       | Status          | Notes                                                    |
 * |---|-------------------------------------------------|-----------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                                 | IMPLEMENTED     | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor only)                   | IMPLEMENTED     | site.ts enforces playableResources                        |
 * | 3 | Automatic attacks (1st, static)                 | IMPLEMENTED     | Orcs 5x7 in automaticAttacks                              |
 * | 4 | Dynamic auto-attack (2nd, Ruins & Lairs keyed)  | IMPLEMENTED     | play-site-auto-attack step; ruins-and-lairs filter        |
 * | 5 | 1st attack forced detainment (unconditional)    | IMPLEMENTED     | combat-detainment effect, `attack.automatic` carve-out    |
 * | 6 | Creatures keyed to this site attack normally    | IMPLEMENTED     | attacks-not-detainment filtered to non-automatic attacks  |
 * | 7 | Under-deeps movement roll                       | NOT IMPLEMENTED | General rule 3.45; not specific to this card              |
 *
 * Playable: YES
 * Certified: 2026-07-01
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

const THE_UNDER_LEAS = 'ba-102' as CardDefinitionId;
const MORIA_HERO = 'tw-413' as CardDefinitionId; // hero shadow-hold, no attacks-not-detainment (baseline)
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc, homesite "any non-Dark-hold Under-deeps site"
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const ORC_RAIDERS = 'le-85' as CardDefinitionId; // non-unique Orc, keyed ONLY to Ruins & Lairs
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Shadow-hold (also Ruins & Lairs, Dark-hold)

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

/** Balrog company at The Under-leas in the site phase, with the hazard player's hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_LEAS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A hero company at The Under-leas, sitting at the automatic-attacks step. */
function heroAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: THE_UNDER_LEAS, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GATES_BA, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Under-leas (ba-102)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Strange Rations) is playable at The Under-leas', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_LEAS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is NOT playable at The Under-leas', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_LEAS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ───────────────────

  test('entering The Under-leas advances to reveal-on-guard-attacks (static Orc attack present)', () => {
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

  test('hazard player may play a Ruins & Lairs keyed creature (Orc-raiders) as 2nd auto-attack', () => {
    // Orc-raiders is keyed only to ruins-and-lairs [{R}] (plus wilderness/
    // border regions). The site rule requires ruins-and-lairs — matches.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_RAIDERS] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcRaidersInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcRaidersInst);
  });

  test('hazard player may NOT play a non-Ruins & Lairs keyed creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold [{B}] and free-hold [{F}] — not ruins-and-lairs.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('playing Orc-raiders as 2nd auto-attack initiates combat with played-auto-attack source, not detainment', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_RAIDERS] });
    const orcRaidersInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: orcRaidersInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(6);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
    // The 2nd (dynamically-played) attack is not itself forced detainment.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── 1st automatic attack: unconditional detainment ────────────────────────

  test('1st automatic attack is forced detainment even against a hero (non-minion) defender (direct helper)', () => {
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('baseline: without isAutomaticAttack, the attacks-not-detainment override would suppress the same attack', () => {
    // Regression guard: `attack.automatic: false` is what makes the site
    // override skip the 1st attack. Same inputs but isAutomaticAttack
    // omitted (defaults to false) → override fires → not detainment.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: without any site effects, a hero defender would not face detainment anyway', () => {
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
    });
    expect(detainment).toBe(false);
  });

  test('hero company at The Under-leas faces the 1st Orc automatic attack as detainment (integration)', () => {
    const state = heroAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── Special rule: creatures keyed to this site attack normally ───────────

  test('attacks-not-detainment override applies to a general hazard-creature attack (attack.automatic default false)', () => {
    // CoE §3.II.2.B1 would normally flag this as detainment (Balrog
    // defender, Orc keyed to Shadow-hold). The Under-leas' special rule
    // overrides it for creatures played normally against the company.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('minion company at The Under-leas facing Orc-patrol: combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Balrog/active player with a company at The Under-leas.
    // PLAYER_2 (hero/hazard) plays Orc-patrol keyed to Shadow-hold — this
    // would trigger B1 detainment (Orc keyed to Shadow-hold vs Balrog
    // defender) without the site's special rule. The override fires because
    // this is not the site's own automatic-attack, forcing detainment: false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: THE_UNDER_LEAS, characters: [CROOK_LEGGED_ORC] }],
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
        destinationSiteName: 'The Under-leas',
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

  test('baseline: same Orc-patrol vs minion company at a shadow-hold WITHOUT the override is detainment', () => {
    // Swap The Under-leas for a shadow-hold without attacks-not-detainment
    // to prove the override is what flips the flag. Use hero Moria (tw-413)
    // — same site type (shadow-hold) but no site-rule on it.
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
