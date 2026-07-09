/**
 * @module ba-99.test
 *
 * Card test: The Under-galleries (ba-99)
 * Type: balrog-site (dark-hold, under-deeps) in Ûdun
 *
 * Text:
 *   Adjacent Sites: Any site in Ûdun (0), The Under-courts (6), The Sulfur-deeps (9)
 *   Playable: Information, Items (minor, major)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 4 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold.
 *   Special: Creatures keyed to this site attack normally, not as detainment.
 *
 * Rules interpretation: the "Special" line overrides CoE §3.II.2.R1/B1 (which
 * would otherwise make an attack keyed to a Dark-hold/Shadow-hold detainment
 * against a Ringwraith/Balrog defender) for every creature at this site.
 * Unlike The Under-leas (ba-102) — whose 1st attack is explicitly
 * "(detainment)" and is therefore carved out via an `attack.automatic: false`
 * filter — NONE of The Under-galleries' attacks are detainment: the 1st Trolls
 * attack has no "(detainment)" marker and the 2nd is a dynamically-played
 * hazard creature. So the override is unconditional (no filter) and flips the
 * detainment flag off for the site's own automatic-attacks and for hazard
 * creatures played normally against a company here alike.
 *
 * Data encoding:
 *   - `playableResources: [information, minor, major]` — filled this pass
 *     (was `[]` in the imported data despite the printed "Playable" line, the
 *     recurring BA/LE-site empty-playableResources bug).
 *   - `site-rule: dynamic-auto-attack` keyed to Shadow-hold {S} (2nd attack).
 *   - `site-rule: attacks-not-detainment` with NO filter — all creatures at
 *     this site attack normally (the Special line).
 *   - `text` extended with the missing "Special:" line to match cards.json.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                              |
 * |---|-------------------|--------|--------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid ({D})                                          |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                           |
 * | 4 | region            | OK     | "Ûdun" — correct per card data                                     |
 * | 5 | playableResources | OK     | [information, minor, major] — fixed to match card text this pass  |
 * | 6 | automaticAttacks  | OK     | Trolls, 4 strikes, 9 prowess (1st attack)                         |
 * | 7 | resourceDraws     | OK     | 2                                                                   |
 * | 8 | hazardDraws       | OK     | 2                                                                   |
 * | 9 | keywords          | OK     | ["under-deeps"]                                                     |
 * | 10| adjacentSites     | OK     | Any Ûdun site (0), The Under-courts (6), The Sulfur-deeps (9)     |
 * | 11| effects           | OK     | dynamic-auto-attack (shadow-hold) + attacks-not-detainment (no filter) — added this pass |
 *
 * Engine Support:
 * | # | Feature                                        | Status          | Notes                                                    |
 * |---|------------------------------------------------|-----------------|-----------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED     | select-company, enter-or-skip, play-resources             |
 * | 2 | Item playability (minor + major)               | IMPLEMENTED     | site.ts enforces playableResources                        |
 * | 3 | Automatic attacks (1st, static Trolls)         | IMPLEMENTED     | Trolls 4x9 in automaticAttacks                            |
 * | 4 | Dynamic auto-attack (2nd, Shadow-hold keyed)   | IMPLEMENTED     | play-site-auto-attack step; shadow-hold filter            |
 * | 5 | Creatures keyed to this site attack normally   | IMPLEMENTED     | attacks-not-detainment (no filter) — all attacks normal   |
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

const THE_UNDER_GALLERIES = 'ba-99' as CardDefinitionId;
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

/** Balrog company at The Under-galleries in the site phase, hazard hand configurable. */
function dualHandState(opts: {
  step?: SitePhaseState['step'];
  siteEntered?: boolean;
  hazardHand?: CardDefinitionId[];
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GALLERIES, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts.hazardHand ?? [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: opts.step ?? 'enter-or-skip', siteEntered: opts.siteEntered ?? false }) };
}

/** A Balrog company at The Under-galleries, sitting at the automatic-attacks step. */
function balrogAutoAttackStep(): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GALLERIES, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [THE_UNDER_GATES_BA] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ step: 'automatic-attacks', siteEntered: true }) };
}

describe('The Under-galleries (ba-99)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major playable; greater not) ────────────────

  test('minor item (Strange Rations) is playable at The Under-galleries', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GALLERIES, [STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-galleries', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GALLERIES, [SABLE_SHIELD]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-galleries', () => {
    const plays = viableActions(siteWithHand(THE_UNDER_GALLERIES, [SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Dynamic auto-attack (2nd attack): step transitions ────────────────────

  test('entering The Under-galleries advances to reveal-on-guard-attacks (static Troll attack present)', () => {
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

  test('1st Trolls automatic attack against the Balrog company is NOT detainment (direct helper)', () => {
    // Without the override, CoE §3.II.2.B1 would flag the site's own dark-hold
    // auto-attack as detainment against the Balrog defender. The unfiltered
    // attacks-not-detainment override (isAutomaticAttack: true) flips it off.
    const siteDef = pool[THE_UNDER_GALLERIES as string] as SiteCard;
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
    const siteDef = pool[THE_UNDER_GALLERIES as string] as SiteCard;
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

  test('Balrog company at The Under-galleries faces the 1st Troll attack normally, not detainment (integration)', () => {
    const state = balrogAutoAttackStep();
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.detainment).toBe(false);
  });

  test('minion company here facing Orc-patrol (Shadow-hold keyed): combat.detainment is false (integration)', () => {
    // PLAYER_1 is the Balrog/active player at The Under-galleries. PLAYER_2
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
          companies: [{ site: THE_UNDER_GALLERIES, characters: [CROOK_LEGGED_ORC] }],
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
        destinationSiteName: 'The Under-galleries',
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
    // Swap The Under-galleries for hero Moria (tw-413) — a shadow-hold with no
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
