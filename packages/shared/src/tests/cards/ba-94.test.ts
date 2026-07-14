/**
 * @module ba-94.test
 *
 * Card test: The Pûkel-deeps (ba-94)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in Rohan
 *
 * Text:
 *   Adjacent Sites: Dunharrow (0), The Gem-deeps (8), The Sulfur-deeps (9)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Pûkel-creature — 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}].
 *   Special: Any Undead creature or Pûkel-creature may be keyed to this site.
 *
 * Rules interpretation: The Pûkel-deeps is a near-mirror of the other BA
 * under-deeps sites — same dynamically-played 2nd automatic-attack (a non-unique
 * hazard creature normally keyed to a Shadow-hold). Two features distinguish it:
 *   - It is a Ruins-&-Lairs {R} site (not a Dark-/Shadow-hold), so its own 1st
 *     automatic-attack (a Pûkel-creature keyed to this R&L site) is NOT
 *     detainment against the Balrog defender — §3.II.2.B1 only fires for
 *     Dark-domain / Dark-hold / Shadow-hold keying, and a Pûkel-creature is not
 *     a Shadow-land race. It carries no "attacks normally" Special either, so a
 *     Shadow-hold-keyed hazard creature played here (1st- or 2nd-attack) still
 *     IS detainment per §3.II.2.B1.
 *   - The "Special:" line grants a keying bypass: any Undead or Pûkel-creature
 *     may be keyed to this site, even though its own keying (typically
 *     Shadow-hold / Dark-hold) would not otherwise reach an R&L site. This is
 *     the `allow-creature-by-race` site-rule (the same mechanism as The
 *     Iron-deeps ba-91's Drake special), applied here to two races.
 *
 * Data encoding (filled/added this pass):
 *   - `playableResources: [minor, major, gold-ring]` — was `[]` in the imported
 *     data despite the printed "Playable" line (the recurring BA/LE-site
 *     empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} (2nd attack) —
 *     already present.
 *   - `site-rule: allow-creature-by-race` for race "undead" and for race
 *     "pûkel-creature" — added this pass, matching the "Special:" text line
 *     (which was also missing from the imported `text` and restored from
 *     cards.json).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                                   |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                           |
 * | 4 | region            | OK     | "Rohan" — correct per card data                                   |
 * | 5 | playableResources | FIXED  | [minor, major, gold-ring] — filled from card text this pass       |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 2 strikes, 11 prowess (1st attack)               |
 * | 7 | resourceDraws     | OK     | 2                                                                   |
 * | 8 | hazardDraws       | OK     | 2                                                                   |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                     |
 * | 10| adjacentSites     | OK     | Dunharrow (0), The Gem-deeps (8), The Sulfur-deeps (9)           |
 * | 11| effects           | FIXED  | dynamic-auto-attack (shadow-hold) + allow-creature-by-race (undead, pûkel) |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                            |
 * |---|------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources    |
 * | 2 | Item playability (minor/major/gold-ring)       | IMPLEMENTED | site.ts enforces playableResources               |
 * | 3 | Automatic attack (1st, static Pûkel-creature)  | IMPLEMENTED | Pûkel-creature 2x11 in automaticAttacks          |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)   | IMPLEMENTED | play-site-auto-attack step; shadow-hold filter   |
 * | 5 | Default detainment (R&L site, no override)     | IMPLEMENTED | 1st attack NOT detainment; shadow-hold-keyed IS  |
 * | 6 | Undead/Pûkel keying-bypass (Special)           | IMPLEMENTED | allow-creature-by-race → M/H play + 2nd attack   |
 *
 * Playable: YES
 * Certified: 2026-07-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN, PRECIOUS_GOLD_RING,
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
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, SiteCard, CreatureCard,
} from '../../index.js';

const THE_PUKEL_DEEPS = 'ba-94' as CardDefinitionId;
const THE_UNDER_GATES_BA = 'ba-100' as CardDefinitionId; // haven, under-deeps (siteDeck filler only)
const BANDIT_LAIR = 'tw-373' as CardDefinitionId; // plain hero R&L site, no special rules (bypass baseline)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId; // Balrog-specific orc
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Shadow-hold (also R&L, Dark-hold)
const BARROW_WIGHT = 'le-61' as CardDefinitionId; // non-unique Undead, keyed to Shadow-hold/Dark-hold + shadow/dark region
const SILENT_WATCHER = 'tw-88' as CardDefinitionId; // non-unique Pûkel-creature, keyed to Shadow-hold/Dark-hold only

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

/** Balrog company at The Pûkel-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_PUKEL_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Pûkel-deeps, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_PUKEL_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/**
 * Balrog company at `site` (an R&L site) in the movement/hazard phase, so the
 * hazard player (PLAYER_2) may try to play a creature against it. Used for the
 * Undead/Pûkel keying-bypass tests.
 */
function mhAtSite(hazardHand: CardDefinitionId[], site: CardDefinitionId, siteName: string): GameState {
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
      destinationSiteName: siteName,
    }),
  };
}

describe('The Pûkel-deeps (ba-94)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + gold-ring playable; greater not) ─────

  test('minor item (Strange Rations) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [PRECIOUS_GOLD_RING]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Pûkel-deeps advances to reveal-on-guard-attacks (static Pûkel attack present)', () => {
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

  test('hazard player may NOT play a non-Shadow-hold, non-Undead/Pûkel creature (Assassin) as 2nd auto-attack', () => {
    // Assassin is keyed to border-hold {B} / free-hold {F} — not shadow-hold,
    // and it is neither Undead nor a Pûkel-creature, so no keying-bypass either.
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('hazard player may play an Undead creature (Barrow-wight) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [BARROW_WIGHT] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
  });

  test('hazard player may play a Pûkel-creature (Silent Watcher) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [SILENT_WATCHER] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
  });

  test('playing Orc-patrol as 2nd auto-attack initiates combat — detainment vs the Balrog company (Shadow-hold keyed, no override)', () => {
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
    // No "attacks normally" Special line: a Shadow-hold-keyed creature vs the
    // Balrog company here is detainment per §3.II.2.B1.
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── 1st automatic-attack (Pûkel-creature) at an R&L site: NOT detainment ───

  test('Balrog company at The Pûkel-deeps faces the 1st Pûkel-creature attack (2x11) as a NORMAL attack (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('pukel-creature');
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.strikesTotal).toBe(2);
    // R&L site keying is not Dark-hold/Shadow-hold and Pûkel-creature is not a
    // Shadow-land race → §3.II.2.B1 does not fire → normal attack.
    expect(next.combat!.detainment).toBe(false);
  });

  test('1st Pûkel-creature automatic attack against the Balrog company is NOT detainment (direct helper)', () => {
    const siteDef = pool[THE_PUKEL_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.PukelCreature,
      attackKeyedTo: [{ siteTypes: [SiteType.RuinsAndLairs] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('contrast: a Shadow-hold-keyed attack at this site WOULD be detainment vs the Balrog defender (§3.II.2.B1)', () => {
    // Same site (no attacks-not-detainment override), but a Shadow-hold-keyed
    // attacker → §3.II.2.B1 fires. Proves the 1st attack is normal only because
    // R&L keying is outside the Dark-hold/Shadow-hold branch, not because of an
    // override.
    const siteDef = pool[THE_PUKEL_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Balrog,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  // ─── Special: Undead/Pûkel keying-bypass (normal M/H hazard-creature play) ──

  test('an Undead creature (Barrow-wight) is a viable hazard play against the company at The Pûkel-deeps via keying-bypass', () => {
    // Barrow-wight keys to Shadow-hold/Dark-hold + shadow/dark region — none of
    // which reach an R&L site with no region path. The Undead special makes the
    // play viable.
    const state = mhAtSite([BARROW_WIGHT], THE_PUKEL_DEEPS, 'The Pûkel-deeps');
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe((pool[BARROW_WIGHT as string] as CreatureCard).race);
  });

  test('a Pûkel-creature (Silent Watcher) is a viable hazard play at The Pûkel-deeps via keying-bypass', () => {
    const state = mhAtSite([SILENT_WATCHER], THE_PUKEL_DEEPS, 'The Pûkel-deeps');
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as { keyedBy?: { method: string; value: string } };
    expect(action.keyedBy?.method).toBe('keying-bypass');
    expect(action.keyedBy?.value).toBe((pool[SILENT_WATCHER as string] as CreatureCard).race);
  });

  test('baseline: an Undead creature is NOT keyable at a plain R&L site (Bandit Lair) WITHOUT the special', () => {
    // Bandit Lair (tw-373) is a hero R&L site with no allow-creature-by-race
    // rule; Barrow-wight is not keyable there → proves the special is what makes
    // it viable at The Pûkel-deeps.
    const state = mhAtSite([BARROW_WIGHT], BANDIT_LAIR, 'Bandit Lair');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('a non-Undead/Pûkel creature (Assassin) is NOT a viable hazard play at The Pûkel-deeps', () => {
    // Assassin (border-hold/free-hold) has no keying reaching an R&L site and is
    // outside the Undead/Pûkel special → no bypass.
    const state = mhAtSite([ASSASSIN], THE_PUKEL_DEEPS, 'The Pûkel-deeps');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Integration: Shadow-hold hazard creature played here IS detainment ─────

  test('Balrog company here facing Orc-patrol (Shadow-hold keyed) via M/H: combat.detainment is true (integration)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_PUKEL_DEEPS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'The Pûkel-deeps',
      }),
    };
    const orcPatrolId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterChain = playCreatureHazardAndResolve(
      ready, PLAYER_2, orcPatrolId, companyId, SHADOW_HOLD_KEYING,
    );

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');
    expect(afterChain.combat!.detainment).toBe(true);
  });
});
