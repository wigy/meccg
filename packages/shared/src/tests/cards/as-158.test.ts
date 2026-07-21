/**
 * @module as-158.test
 *
 * Card test: The Pûkel-deeps (as-158)
 * Type: minion-site (ruins-and-lairs, under-deeps) in Rohan
 *
 * Text:
 *   Adjacent Sites: Dunharrow (0), The Gem-deeps (9), The Sulfur-deeps (9)
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Pûkel-creature – 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}].
 *   Special: Any Undead creature or Pûkel-creature may be played at this site.
 *
 * Rules interpretation: as-158 is the Ringwraith (minion) twin of the Balrog
 * ba-94 and hero dm-34 Pûkel-deeps. The Under-deeps machinery is
 * alignment-agnostic (proved by The Iron-deeps as-152), and the detainment
 * rule for a Ringwraith defender (§3.II.2.R1) mirrors the Balrog rule
 * (§3.II.2.B1): a Shadow-hold-keyed attack IS detainment, while the site's own
 * 1st Pûkel-creature attack (keyed to this R&L site, and Pûkel-creature is not a
 * Shadow-land race) is NOT. The only playability difference from the Balrog twin
 * is that as-158's printed "Playable" line grants greater items as well, so a
 * greater item (Scroll of Isildur) is playable here.
 *
 * The three effects encode the printed rules:
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} — the 2nd
 *     automatic-attack (opponent plays a non-unique hazard creature normally
 *     keyed to a Shadow-hold from hand).
 *   - `site-rule: allow-creature-by-race` for "undead" and for "pûkel-creature"
 *     — the "Special:" keying-bypass letting those two races be played (keyed) to
 *     this R&L site even though their own keying (Shadow-hold/Dark-hold) would
 *     not otherwise reach it.
 *
 * Data encoding (filled/added this pass — the imported AS under-deeps entry was
 * missing all of these, the recurring AS-site import bug):
 *   - `keywords: [under-deeps]` and `adjacentSites` (Dunharrow 0 / The Gem-deeps
 *     9 / The Sulfur-deeps 9 — minion rolls per the printed line).
 *   - `automaticAttacks[0].creatureType` filled to "Pûkel-creature" (was "").
 *   - the three `effects` above (was `[]`).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                             |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                       |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                     |
 * | 4 | region            | OK     | "Rohan"                                                      |
 * | 5 | playableResources | OK     | [minor, major, greater, gold-ring]                          |
 * | 6 | automaticAttacks  | FIXED  | Pûkel-creature, 2 strikes, 11 prowess (creatureType filled) |
 * | 7 | resourceDraws     | OK     | 2                                                            |
 * | 8 | hazardDraws       | OK     | 3                                                            |
 * | 9 | keywords          | FIXED  | ["under-deeps"] — added this pass                           |
 * | 10| adjacentSites     | FIXED  | Dunharrow 0 / The Gem-deeps 9 / The Sulfur-deeps 9          |
 * | 11| effects           | FIXED  | dynamic-auto-attack (shadow-hold) + allow-creature-by-race  |
 *
 * Playable: YES
 * Certified: 2026-07-21
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

const THE_PUKEL_DEEPS = 'as-158' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven (siteDeck filler only)
const ETTENMOORS = 'le-373' as CardDefinitionId; // plain minion R&L site, no special rules (bypass baseline)
const THE_MOUTH = 'le-24' as CardDefinitionId; // Ringwraith minion character
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item (playable here)
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to Shadow-hold (also R&L, Dark-hold)
const BARROW_WIGHT = 'le-61' as CardDefinitionId; // non-unique Undead, keyed to Shadow-hold/Dark-hold + shadow/dark region
const SILENT_WATCHER = 'tw-88' as CardDefinitionId; // non-unique Pûkel-creature, keyed to Shadow-hold/Dark-hold only

const SHADOW_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.ShadowHold };

/** Minion company (The Mouth) at `site` in the site phase, given `hand`. */
function siteWithHand(site: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand, siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** Minion company at The Pûkel-deeps in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_PUKEL_DEEPS, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Minion company at The Pûkel-deeps, sitting at the automatic-attacks step. */
function minionAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_PUKEL_DEEPS, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

/**
 * Minion company at `site` (an R&L site) in the movement/hazard phase, so the
 * hazard player (PLAYER_2) may try to play a creature against it. Used for the
 * Undead/Pûkel keying-bypass tests.
 */
function mhAtSite(hazardHand: CardDefinitionId[], site: CardDefinitionId, siteName: string): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
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

describe('The Pûkel-deeps (as-158)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + greater + gold-ring all playable) ────

  test('minor item (Strange Rations) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) IS playable at The Pûkel-deeps (unlike the Balrog twin)', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Pûkel-deeps', () => {
    const plays = viableActions(siteWithHand(THE_PUKEL_DEEPS, [PRECIOUS_GOLD_RING]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
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

  test('playing Orc-patrol as 2nd auto-attack initiates combat — detainment vs the minion company (Shadow-hold keyed, §3.II.2.R1)', () => {
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
    // A Shadow-hold-keyed creature vs the Ringwraith company is detainment per
    // §3.II.2.R1.
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── 1st automatic-attack (Pûkel-creature) at an R&L site: NOT detainment ───

  test('minion company at The Pûkel-deeps faces the 1st Pûkel-creature attack (2x11) as a NORMAL attack (integration)', () => {
    const state = minionAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('pukel-creature');
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.strikesTotal).toBe(2);
    // R&L site keying is not Dark-hold/Shadow-hold and Pûkel-creature is not a
    // Shadow-land race → §3.II.2.R1 does not fire → normal attack.
    expect(next.combat!.detainment).toBe(false);
  });

  test('1st Pûkel-creature automatic attack against the minion company is NOT detainment (direct helper)', () => {
    const siteDef = pool[THE_PUKEL_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.PukelCreature,
      attackKeyedTo: [{ siteTypes: [SiteType.RuinsAndLairs] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('contrast: a Shadow-hold-keyed attack at this site WOULD be detainment vs the minion defender (§3.II.2.R1)', () => {
    // Same site (no attacks-not-detainment override), but a Shadow-hold-keyed
    // attacker → §3.II.2.R1 fires. Proves the 1st attack is normal only because
    // R&L keying is outside the Dark-hold/Shadow-hold branch, not because of an
    // override.
    const siteDef = pool[THE_PUKEL_DEEPS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
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

  test('baseline: an Undead creature is NOT keyable at a plain R&L site (Ettenmoors) WITHOUT the special', () => {
    // Ettenmoors (le-373) is a minion R&L site with no allow-creature-by-race
    // rule; Barrow-wight is not keyable there → proves the special is what makes
    // it viable at The Pûkel-deeps.
    const state = mhAtSite([BARROW_WIGHT], ETTENMOORS, 'Ettenmoors');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('a non-Undead/Pûkel creature (Assassin) is NOT a viable hazard play at The Pûkel-deeps', () => {
    // Assassin (border-hold/free-hold) has no keying reaching an R&L site and is
    // outside the Undead/Pûkel special → no bypass.
    const state = mhAtSite([ASSASSIN], THE_PUKEL_DEEPS, 'The Pûkel-deeps');
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Integration: Shadow-hold hazard creature played here IS detainment ─────

  test('minion company here facing Orc-patrol (Shadow-hold keyed) via M/H: combat.detainment is true (integration)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_PUKEL_DEEPS, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
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
