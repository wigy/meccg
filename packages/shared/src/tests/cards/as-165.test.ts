/**
 * @module as-165.test
 *
 * Card test: The Under-gates (as-165)
 * Type: minion-site (shadow-hold, under-deeps) in Redhorn Gate
 *
 * Text:
 *   Adjacent Sites: Moria (0), The Under-grottos (7), The Gem-deeps (6),
 *     The Sulfur-deeps (4), Under-leas (5)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Balrog — 2 strikes with 16 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Ruins & Lairs [{R}]
 *   Special: Non-Nazgûl creatures played at this site attack normally, not as
 *     detainment. If a manifestation of Balrog of Moria is in play or defeated,
 *     the first automatic-attack is canceled.
 *
 * Rules interpretation: as-165 is the Ringwraith (minion) twin of the hero
 * The Under-gates (dm-38) and the Balrog haven (ba-100). The three printed rules
 * map to the same engine primitives already certified on dm-38, plus one that
 * only matters for a minion defender:
 *   - `site-rule: cancel-auto-attacks` scope `first` (when "Balrog of Moria"
 *     is in play) — the
 *     Balrog-of-Moria manifestation cancel. The Balrog *avatar* in-play/defeated
 *     case is covered by the MEBA rule in manifestations.ts (it strips
 *     Balrog-typed automatic-attacks); tw-12 in play cancels the 1st attack.
 *   - `site-rule: dynamic-auto-attack` keyed to Ruins & Lairs {R} — the 2nd
 *     automatic-attack (opponent plays a non-unique R&L-keyed hazard creature
 *     from hand).
 *   - `site-rule: attacks-not-detainment` filtered to `enemy.race != nazgul` —
 *     the "Non-Nazgûl creatures attack normally, not as detainment" special.
 *     This is meaningful only for the minion (Ringwraith) company here: a
 *     Shadow-hold-keyed creature attacking a Ringwraith company is detainment
 *     by §3.II.2.R1; the override converts it to a normal attack. (No hazard
 *     creature has race "ringwraith" — Nazgûl are minion characters — so in
 *     practice every opponent-played creature attacks normally; the filter
 *     mirrors the certified Moria le-392 precedent.) The hero twin dm-38 has no
 *     such rule because §3.II.2 never applies to a hero defender.
 *
 * Data encoding (filled/added this pass — the imported AS under-deeps entry was
 * missing all of these, the recurring AS-site import bug):
 *   - `automaticAttacks[0].creatureType` filled to "Balrog" (was "").
 *   - `adjacentSites` (Moria 0 / The Under-grottos 7 / The Gem-deeps 6 /
 *     The Sulfur-deeps 4 / The Under-leas 5 — minion rolls per the printed line).
 *   - the three `effects` above (was `[]`).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid ({S})                             |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites               |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path           |
 * | 4 | region            | OK     | "Redhorn Gate"                                           |
 * | 5 | playableResources | OK     | [minor, major] — matches text (no greater/gold-ring)    |
 * | 6 | automaticAttacks  | FIXED  | Balrog, 2 strikes, 16 prowess (creatureType filled)     |
 * | 7 | resourceDraws     | OK     | 2                                                        |
 * | 8 | hazardDraws       | OK     | 2                                                        |
 * | 9 | keywords          | OK     | ["under-deeps"]                                          |
 * | 10| adjacentSites     | FIXED  | Moria 0 / Under-grottos 7 / Gem-deeps 6 / Sulfur 4 / Leas 5 |
 * | 11| effects           | FIXED  | cancel-first-attack-if-in-play + dynamic-auto-attack + attacks-not-detainment |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN,
  resetMint, pool,
  buildTestState, makeSitePhase, makeMHState,
  viableActions, dispatch, addCardInPlay,
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

const THE_UNDER_GATES = 'as-165' as CardDefinitionId;
const BALROG_OF_MORIA = 'tw-12' as CardDefinitionId; // manifestation whose presence cancels the 1st attack
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion haven (siteDeck filler only)
const THE_MOUTH = 'le-24' as CardDefinitionId; // Ringwraith minion character
const STRANGE_RATIONS = 'le-345' as CardDefinitionId; // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId; // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item (NOT playable here)
const ORC_PATROL = 'tw-074' as CardDefinitionId; // non-unique Orc, keyed to R&L (also Shadow-hold, Dark-hold)

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

/** Minion company at The Under-gates in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GATES, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Minion company at The Under-gates, sitting at the automatic-attacks step. */
function minionAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GATES, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Under-gates (as-165)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability: minor + major only (no greater/gold-ring) ────────────

  test('minor item (Strange Rations) is playable at The Under-gates', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GATES, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-gates', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GATES, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-gates (only minor/major)', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GATES, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── First automatic attack: Balrog 2/16 (normal) ───────────────────────────

  test('minion company faces the 1st Balrog attack (2x16) as a NORMAL attack', () => {
    const next = dispatch(minionAutoAttackStep(), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('balrog');
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(16);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    // Balrog is not a Nazgûl → attacks-not-detainment override → normal attack.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Cancel 1st attack when a Balrog-of-Moria manifestation is in play ───────

  test('first Balrog attack is canceled when Balrog of Moria (tw-12) is in play', () => {
    const state = addCardInPlay(minionAutoAttackStep(), 1, BALROG_OF_MORIA);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // With tw-12 in play the 1st (only) automatic-attack is stripped → no combat.
    expect(next.combat).toBeNull();
  });

  test('first Balrog attack fires normally when no Balrog-of-Moria manifestation is in play', () => {
    const next = dispatch(minionAutoAttackStep(), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('balrog');
  });

  // ─── 2nd auto-attack: dynamic, keyed to Ruins & Lairs {R} ───────────────────

  test('hazard player may play a Ruins-&-Lairs keyed creature (Orc-patrol) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcPatrolInst);
  });

  test('hazard player may NOT play a non-R&L creature (Assassin, border/free-hold) as 2nd auto-attack', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ASSASSIN] });
    expect(viableActions(state, PLAYER_2, 'play-site-auto-attack')).toHaveLength(0);
  });

  test('playing Orc-patrol as 2nd auto-attack initiates a NORMAL attack (Special override, not §3.II.2.R1 detainment)', () => {
    const state = dualHandState({ step: 'play-site-auto-attack', siteEntered: true, hazardHand: [ORC_PATROL] });
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, { type: 'play-site-auto-attack', player: PLAYER_2, cardInstanceId: orcPatrolInst });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    // Orc-patrol keys to Shadow-hold too → §3.II.2.R1 would make it detainment vs
    // the Ringwraith company, but the site's non-Nazgûl override converts it.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── Special: non-Nazgûl detainment override (direct helper) ────────────────

  test('a Shadow-hold-keyed Orc at The Under-gates is NOT detainment vs the minion defender (override)', () => {
    const siteDef = pool[THE_UNDER_GATES as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('the override is race-gated: a Nazgûl attack keyed to a Shadow-hold WOULD be detainment (§3.II.2.R1)', () => {
    // Proves the attacks-not-detainment filter genuinely tests `enemy.race != nazgul`
    // rather than blanket-cancelling every attack.
    const siteDef = pool[THE_UNDER_GATES as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  // ─── Integration: Shadow-hold hazard creature played here is NORMAL ─────────

  test('minion company here facing Orc-patrol (Shadow-hold keyed) via M/H: combat.detainment is false (override)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GATES, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ORC_PATROL], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [],
        resolvedSitePathNames: [],
        destinationSiteType: SiteType.ShadowHold,
        destinationSiteName: 'The Under-gates',
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
});
