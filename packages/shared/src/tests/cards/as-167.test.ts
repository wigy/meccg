/**
 * @module as-167.test
 *
 * Card test: The Under-leas (as-167)
 * Type: minion-site (shadow-hold, under-deeps) in Gundabad
 *
 * Text:
 *   Adjacent Sites: Mount Gundabad (0), The Iron-deeps (5), The Under-grottos (7),
 *     The Under-gates (5), The Under-vaults (6)
 *   Playable: Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 5 strikes with 7 prowess (detainment against overt company)
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Ruins & Lairs [{R}]
 *   Special: Non-Nazgûl creatures played at this site attack normally, not as
 *     detainment.
 *
 * Rules interpretation: as-167 is the Ringwraith (minion) twin of the Balrog
 * The Under-leas (ba-102, already certified). It combines two encodings whose
 * primitives are both shipped:
 *   1. The 1st automatic-attack is detainment ONLY against an overt company
 *      ("detainment against overt company") — a conditional `combat-detainment`
 *      gated on `defender.covert: false`. This is the overt mirror of Minas
 *      Tirith le-391's covert-gated detainment. Against a Ringwraith company
 *      (always overt) it is detainment (and CoE §3.II.2.R1 also applies since
 *      the site is a Shadow-hold); against a covert Fallen-wizard company it is
 *      a normal attack.
 *   2. The Special ("Non-Nazgûl creatures played at this site attack normally")
 *      is `site-rule: attacks-not-detainment` — the same encoding as Moria
 *      (le-392) and The Under-gates (as-165), which override CoE §3.II.2.R1 for
 *      creatures played normally against the company. The filter carries BOTH
 *      `enemy.race != nazgul` (the non-Nazgûl restriction) AND
 *      `attack.automatic: false` (the ba-102 carve-out), so the site's own 1st
 *      automatic-attack keeps its `combat-detainment` — the two rules coexist.
 *
 * Data encoding (filled/added this pass — the imported AS under-deeps entry was
 * missing all of these, the recurring AS-site import bug flagged for as-164..168):
 *   - `automaticAttacks[0].creatureType` filled to "Orcs" (was "").
 *   - `adjacentSites` (Mount Gundabad 0 / The Iron-deeps 5 / The Under-gates 5 /
 *     The Under-grottos 7 / The Under-vaults 6 — minion rolls per the printed
 *     line; cross-checked against the reciprocal entries on as-152/165/166/168).
 *   - the three `effects` above (was `[]`).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid ({S})                                        |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites                          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path                      |
 * | 4 | region            | OK     | "Gundabad"                                                         |
 * | 5 | playableResources | OK     | [minor, major] — matches text                                     |
 * | 6 | automaticAttacks  | FIXED  | Orcs, 5 strikes, 7 prowess (creatureType filled)                  |
 * | 7 | resourceDraws     | OK     | 2                                                                  |
 * | 8 | hazardDraws       | OK     | 2                                                                  |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                    |
 * | 10| adjacentSites     | FIXED  | Mount Gundabad 0 / Iron-deeps 5 / Under-gates 5 / Under-grottos 7 / Under-vaults 6 |
 * | 11| effects           | FIXED  | dynamic-auto-attack (R&L) + combat-detainment (overt) + attacks-not-detainment (non-automatic, non-Nazgûl) |
 *
 * Engine Support:
 * | # | Feature                                          | Status      | Notes                                                     |
 * |---|---------------------------------------------------|-------------|------------------------------------------------------------|
 * | 1 | Site phase flow                                  | IMPLEMENTED | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor, major)                  | IMPLEMENTED | site.ts enforces playableResources                        |
 * | 3 | Automatic attacks (1st, static)                  | IMPLEMENTED | Orcs 5x7 in automaticAttacks                              |
 * | 4 | Dynamic auto-attack (2nd, Ruins & Lairs keyed)   | IMPLEMENTED | play-site-auto-attack step; ruins-and-lairs filter        |
 * | 5 | 1st attack detainment vs OVERT company only      | IMPLEMENTED | combat-detainment `when defender.covert: false`           |
 * | 6 | Non-Nazgûl creatures played here attack normally | IMPLEMENTED | attacks-not-detainment, non-automatic + non-Nazgûl filter |
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
  viableActions, dispatch,
  handCardId, companyIdAt,
  playCreatureHazardAndResolve,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType } from '../../index.js';
import { isDetainmentAttack } from '../../engine/detainment.js';
import { Race, RegionType } from '../../types/common.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction, SiteCard,
} from '../../index.js';

const THE_UNDER_LEAS = 'as-167' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // minion haven (siteDeck filler only)
const THE_MOUTH = 'le-24' as CardDefinitionId;          // Ringwraith minion character (avatar of the company)
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;   // minor minion item
const SABLE_SHIELD = 'le-341' as CardDefinitionId;      // major minion item
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item (NOT playable here)
const ORC_RAIDERS = 'le-85' as CardDefinitionId;        // non-unique Orc, keyed ONLY to Ruins & Lairs (+ wilderness/border)
const ORC_PATROL = 'tw-074' as CardDefinitionId;        // non-unique Orc, keyed to Shadow-hold (also R&L, Dark-hold)
const GORBAG = 'le-11' as CardDefinitionId;             // Orc-race minion character — makes its company overt

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

/** Minion company at The Under-leas in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_LEAS, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/**
 * An OVERT minion company (The Mouth + Gorbag, an Orc — CoE glossary: a
 * company is covert unless it contains a Balrog, Orc, Troll, or Ringwraith in
 * Fell Rider mode) at The Under-leas, sitting at the automatic-attacks step.
 */
function minionAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_LEAS, characters: [THE_MOUTH, GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Under-leas (as-167)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Strange Rations) is playable at The Under-leas', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_LEAS, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-leas', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_LEAS, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-leas', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_LEAS, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
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
    // CoE: "(1st) Orcs … (2nd) Opponent may play … from his hand" — the
    // printed attack is faced before the dynamic (hand-played) one.
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
    // border regions). The site rule requires ruins-and-lairs — it matches.
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
    // The 2nd (dynamically-played) attack is NOT itself forced detainment: the
    // site's combat-detainment rides the SITE's effects (1st attack), not the
    // played creature's, and Orc-raiders keys only to Ruins & Lairs (no §3.II.2
    // Shadow-hold/Dark-hold keying), so no detainment branch fires.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── 1st automatic-attack: detainment against OVERT company only ───────────

  test('1st automatic-attack is detainment against an OVERT company (direct helper)', () => {
    // Hero (Wizard) defender so CoE §3.II.2.R1 does NOT fire — only the site's
    // `combat-detainment when defender.covert:false` decides. Overt (covert
    // false) → detainment.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingCovert: false,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(true);
  });

  test('1st automatic-attack is a NORMAL attack against a COVERT company (direct helper)', () => {
    // Covert Fallen-wizard defender: §3.II.2 keying does not apply to a
    // Fallen-wizard, and the combat-detainment when-clause (covert:false) does
    // not match a covert company → not detainment. This is exactly the
    // "detainment against overt company" wording.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.FallenWizard,
      defendingCovert: true,
      defendingSiteEffects: siteDef.effects,
      isAutomaticAttack: true,
    });
    expect(detainment).toBe(false);
  });

  test('baseline: the attack.automatic carve-out is what preserves the 1st attack detainment', () => {
    // Same inputs as the OVERT case but WITHOUT isAutomaticAttack (defaults to
    // false). Now the attacks-not-detainment override matches
    // (attack.automatic:false + Orc != nazgul) and suppresses detainment. This
    // proves the `attack.automatic: false` clause in the site filter is what
    // lets the 1st automatic-attack keep its combat-detainment.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackEffects: siteDef.effects,
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Wizard,
      defendingCovert: false,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('overt minion company at The Under-leas faces the 1st Orc attack as detainment (integration)', () => {
    const state = minionAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── Special: Non-Nazgûl creatures played here attack normally ─────────────

  test('non-Nazgûl creature played normally at The Under-leas: detainment overridden to false (direct helper)', () => {
    // CoE §3.II.2.R1 would normally flag this as detainment (Ringwraith
    // defender, Orc keyed to Shadow-hold). The Under-leas' special rule
    // overrides it for creatures played normally against the company (a
    // non-automatic attack) whose race is not Nazgûl.
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(false);
  });

  test('Nazgûl creature played normally at The Under-leas: override skips it, detainment preserved (direct helper)', () => {
    // The filter carries `enemy.race != nazgul`. A Nazgûl attack does NOT match
    // the filter, so the override does not fire; the attack is still detainment
    // via §3.II.2.R1 (keyed to Dark-domain, as Nazgûl are).
    const siteDef = pool[THE_UNDER_LEAS as string] as SiteCard;
    const detainment = isDetainmentAttack({
      attackRace: 'ringwraith' as Race,
      attackKeyedTo: [{ regionTypes: [RegionType.Dark] }],
      defendingAlignment: Alignment.Ringwraith,
      defendingSiteEffects: siteDef.effects,
    });
    expect(detainment).toBe(true);
  });

  test('baseline: same Orc attack WITHOUT The Under-leas effects is detainment (R1 keyed to Shadow-hold)', () => {
    // Regression guard: the override is what flips the value. Same inputs, no
    // site effects → §3.II.2.R1 makes it detainment.
    const detainment = isDetainmentAttack({
      attackRace: Race.Orc,
      attackKeyedTo: [{ siteTypes: [SiteType.ShadowHold] }],
      defendingAlignment: Alignment.Ringwraith,
    });
    expect(detainment).toBe(true);
  });

  test('minion company at The Under-leas facing Orc-patrol: combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Ringwraith/active player with a company at The Under-leas.
    // PLAYER_2 (hero/hazard) plays Orc-patrol keyed to Shadow-hold — this would
    // trigger R1 detainment (Orc keyed to Shadow-hold vs Ringwraith defender)
    // without the site's special rule. The override fires (non-automatic Orc ≠
    // Nazgûl), forcing detainment: false.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: THE_UNDER_LEAS, characters: [THE_MOUTH] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
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
});
