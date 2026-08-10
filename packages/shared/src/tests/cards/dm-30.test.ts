/**
 * @module dm-30.test
 *
 * Card test: The Gem-deeps (dm-30)
 * Type: hero-site (ruins-and-lairs, under-deeps) in Gap of Isen
 * Effects: 3
 *
 * Text:
 *   Adjacent Sites: Glittering Caves (0), The Pûkel-deeps (9), The Under-gates (6)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Undead — 3 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *           from his hand normally keyed to a Shadow-hold [{S}]
 *   Special: Any Undead creature or Pûkel-creature may also be played at this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                    |
 * | 2 | sitePath          | OK     | [] — under-deeps sites use adjacentSites, not sitePath       |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven                 |
 * | 4 | region            | OK     | "Gap of Isen"                                                |
 * | 5 | playableResources | OK     | ["minor", "major", "gold-ring"] — matches card text          |
 * | 6 | automaticAttacks  | OK     | Undead, 3 strikes / 9 prowess (1st attack listed in data)    |
 * | 7 | resourceDraws     | OK     | 2                                                            |
 * | 8 | hazardDraws       | OK     | 3                                                            |
 * | 9 | keywords          | OK     | ["under-deeps"]                                              |
 * | 10| effects           | OK     | dynamic-auto-attack (nonUnique, shadow-hold keying),         |
 * |   |                   |        | allow-creature-by-race (undead),                             |
 * |   |                   |        | allow-creature-by-race (pûkel-creature)                      |
 *
 * Engine Support:
 * | # | Feature                                     | Status          | Notes                                             |
 * |---|---------------------------------------------|-----------------|---------------------------------------------------|
 * | 1 | Site phase flow                             | IMPLEMENTED     | select-company, enter-or-skip, play-resources     |
 * | 2 | Item playability (minor, major, gold-ring)  | IMPLEMENTED     | playableResources gate                            |
 * | 3 | First auto-attack (Undead 3/9)              | IMPLEMENTED     | combat initiated with correct stats               |
 * | 4 | Dynamic second auto-attack (non-unique {S}) | IMPLEMENTED     | play-site-auto-attack step, nonUnique filter      |
 * | 5 | allow-creature-by-race (undead)             | IMPLEMENTED     | M/H keying bypass for undead creatures            |
 * | 6 | allow-creature-by-race (pûkel-creature)     | IMPLEMENTED     | M/H keying bypass for pûkel-creatures             |
 * | 7 | Under-deeps movement (adjacentSites)        | NOT IMPLEMENTED | engine skips under-deeps as movement destinations |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — under-deeps movement via adjacentSites is not implemented in
 * the engine. Companies cannot navigate to or from this site; the movement
 * system ignores under-deeps sites as valid destinations.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING, THE_MITHRIL_COAT,
  ORC_PATROL, BERT_BURAT, ASSASSIN,
  LORIEN, MINAS_TIRITH,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState, buildTestState,
  setupAutoAttackStep, dispatch,
  viableActions,
  makeMHState,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction, PlayHazardAction } from '../../index.js';

const GEM_DEEPS = 'dm-30' as CardDefinitionId;
const PUKEL_MEN = 'tw-82' as CardDefinitionId;
const STIRRING_BONES = 'le-92' as CardDefinitionId;

describe('The Gem-deeps (dm-30)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Gem-deeps', () => {
    const state = buildSitePhaseState({
      site: GEM_DEEPS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Gem-deeps', () => {
    const state = buildSitePhaseState({
      site: GEM_DEEPS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item is playable at The Gem-deeps', () => {
    const state = buildSitePhaseState({
      site: GEM_DEEPS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (Mithril Coat) is NOT playable at The Gem-deeps', () => {
    const state = buildSitePhaseState({
      site: GEM_DEEPS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── First automatic attack ────────────────────────────────────────────────

  test('first automatic attack is Undead — 3 strikes with 9 prowess', () => {
    const state = buildSitePhaseState({
      site: GEM_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);
    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('undead');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Dynamic second auto-attack: step transitions ─────────────────────────

  test('entering The Gem-deeps advances to reveal-on-guard-attacks (static attack present)', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect((next.phaseState as import('../../index.js').SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('after reveal-on-guard-attacks pass, advances to automatic-attacks (printed 1st attack faced first)', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'reveal-on-guard-attacks',
      siteEntered: true,
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect((next.phaseState as import('../../index.js').SitePhaseState).step).toBe('automatic-attacks');
  });

  test('hazard player passing play-site-auto-attack advances to automatic-attacks', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });

    expect(next.combat).toBeNull();
    expect((next.phaseState as import('../../index.js').SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic second auto-attack: non-unique filter ────────────────────────

  test('non-unique Shadow-hold keyed creature (Orc-patrol) IS eligible as dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    const orcPatrolInst = state.players[HAZARD_PLAYER].hand[0].instanceId;

    expect(actions.some(ea => (ea.action as PlaySiteAutoAttackAction).cardInstanceId === orcPatrolInst)).toBe(true);
  });

  test('unique Shadow-hold keyed creature (Bert/Burat) is NOT eligible — site requires non-unique', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [BERT_BURAT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');

    expect(actions).toHaveLength(0);
  });

  test('with both unique and non-unique creatures, only non-unique offered', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL, BERT_BURAT],
    });
    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    const orcPatrolInst = state.players[HAZARD_PLAYER].hand[0].instanceId;
    const bertInst = state.players[HAZARD_PLAYER].hand[1].instanceId;

    expect(playActions.some(ea => (ea.action as PlaySiteAutoAttackAction).cardInstanceId === orcPatrolInst)).toBe(true);
    expect(playActions.some(ea => (ea.action as PlaySiteAutoAttackAction).cardInstanceId === bertInst)).toBe(false);
  });

  test('resource player has no actions during play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: GEM_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL],
    });
    const actions = viableActions(state, PLAYER_1, 'play-site-auto-attack');

    expect(actions).toHaveLength(0);
  });

  // ─── allow-creature-by-race: undead ────────────────────────────────────────

  test('Stirring Bones (undead, no keying) is playable against company at The Gem-deeps', () => {
    // Stirring Bones has no keyedTo entries — normally unplayable at any site.
    // The allow-creature-by-race (undead) rule on The Gem-deeps bypasses keying.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GEM_DEEPS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [STIRRING_BONES],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const stirringBonesInst = mhState.players[HAZARD_PLAYER].hand[0].instanceId;

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    const found = plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === stirringBonesInst);

    expect(found).toBe(true);
  });

  test('Assassin (Men, keyed to {B}{F}) is NOT playable against company at The Gem-deeps', () => {
    // Assassin is not undead, not pûkel-creature, and not keyed to shadow-hold or ruins-and-lairs.
    // The allow-creature-by-race rules do not apply to Men. Keying check fails.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GEM_DEEPS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [ASSASSIN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const assassinInst = mhState.players[HAZARD_PLAYER].hand[0].instanceId;

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    const found = plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === assassinInst);

    expect(found).toBe(false);
  });

  // ─── allow-creature-by-race: pûkel-creature ───────────────────────────────

  test('Pûkel-men (pûkel-creature, no keying) is playable against company at The Gem-deeps', () => {
    // Pûkel-men has no keyedTo entries — normally unplayable at any site.
    // The allow-creature-by-race (pûkel-creature) rule on The Gem-deeps bypasses keying.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: GEM_DEEPS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [LORIEN],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [PUKEL_MEN],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const pukelMenInst = mhState.players[HAZARD_PLAYER].hand[0].instanceId;

    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    const found = plays.some(ea => (ea.action as PlayHazardAction).cardInstanceId === pukelMenInst);

    expect(found).toBe(true);
  });
});
