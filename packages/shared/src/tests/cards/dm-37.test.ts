/**
 * @module dm-37.test
 *
 * Card test: The Under-galleries (dm-37)
 * Type: hero-site (dark-hold) in Ûdun — Under-deeps
 *
 * Card text:
 *   Adjacent Sites: Any site in Ûdun (0), The Under-courts (4), The Sulfur-deeps (8)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 4 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *           from his hand normally keyed to Shadow-holds [S]
 *   Special: Stolen Knowledge. When Under-galleries would be placed in your discard
 *     pile, place it in your marshalling points pile instead for 3 marshalling
 *     points—this card is considered stored.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                        |
 * | 2 | sitePath          | OK     | [] — under-deeps sites have no surface path                |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven               |
 * | 4 | region            | OK     | "Ûdun"                                                     |
 * | 5 | playableResources | OK     | ["minor", "major", "greater"]                              |
 * | 6 | automaticAttacks  | OK     | 1st: Trolls 4/9, 2nd: dynamic (shadow-hold keyed)         |
 * | 7 | resourceDraws     | OK     | 1                                                          |
 * | 8 | hazardDraws       | OK     | 4                                                          |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                          |
 * |---|------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, etc.            |
 * | 2 | First auto-attack (Trolls 4 str / 9 p)   | IMPLEMENTED | passes through as data                         |
 * | 3 | Item playability (minor, major, greater)  | IMPLEMENTED | playableResources gate                         |
 * | 4 | Gold-ring NOT playable                   | IMPLEMENTED | not in playableResources                       |
 * | 5 | 2nd auto-attack (shadow-hold keyed)      | IMPLEMENTED | dynamic-auto-attack site-rule                  |
 * | 6 | Stolen Knowledge (site→MP pile, 3 MPs)   | IMPLEMENTED | stolen-knowledge site-rule, outOfPlayPile      |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ORC_WARBAND, BERT_BURAT,
  buildSitePhaseState, buildDualHandSitePhaseState, buildTestState,
  setupAutoAttackStep,
  dispatch, viableActions,
  resetMint, makeMHState,
  Phase,
  LORIEN,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction, GameState } from '../../index.js';

const THE_UNDER_GALLERIES = 'dm-37' as CardDefinitionId;
const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;

describe('The Under-galleries (dm-37)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-galleries', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GALLERIES,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-galleries', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GALLERIES,
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is playable at The Under-galleries', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GALLERIES,
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item is NOT playable at The Under-galleries', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GALLERIES,
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── First automatic attack: Trolls 4/9 ─────────────────────────────────────

  test('first automatic attack: Trolls — 4 strikes with 9 prowess', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GALLERIES }));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── 2nd auto-attack: dynamic (shadow-hold keyed) ───────────────────────────

  test('shadow-hold keyed Orc-warband (non-unique) is offered as 2nd auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcInst);
  });

  test('Cave-drake (ruins-and-lairs keyed) is NOT offered at The Under-galleries (shadow-hold keying)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('unique creature (Bert Burat, shadow-hold keyed) is NOT offered as dynamic attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GALLERIES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BERT_BURAT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  // ─── Stolen Knowledge: site goes to outOfPlayPile for 3 misc MPs ─────────────

  test('Stolen Knowledge: tapped Under-galleries goes to out-of-play pile (not site discard) on departure', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GALLERIES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_COURTS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[RESOURCE_PLAYER].companies[0];
    const destSite = built.players[RESOURCE_PLAYER].siteDeck.find(
      c => c.definitionId === THE_UNDER_COURTS,
    )!;
    const originInstanceId = company.currentSite!.instanceId;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: { instanceId: destSite.instanceId, definitionId: destSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: originInstanceId,
          }],
        },
        built.players[HAZARD_PLAYER],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[RESOURCE_PLAYER];
    expect(p1.siteDiscardPile.some(c => c.instanceId === originInstanceId)).toBe(false);
    expect(p1.outOfPlayPile.some(c => c.instanceId === originInstanceId)).toBe(true);
  });

  test('Stolen Knowledge: player earns 3 misc marshalling points when Under-galleries is stored', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GALLERIES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_COURTS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[RESOURCE_PLAYER].companies[0];
    const destSite = built.players[RESOURCE_PLAYER].siteDeck.find(
      c => c.definitionId === THE_UNDER_COURTS,
    )!;
    const originInstanceId = company.currentSite!.instanceId;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: { instanceId: destSite.instanceId, definitionId: destSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: originInstanceId,
          }],
        },
        built.players[HAZARD_PLAYER],
      ],
    };

    const beforeMiscMp = state.players[RESOURCE_PLAYER].marshallingPoints.misc;
    const afterBothPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterBothPass.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(beforeMiscMp + 3);
  });

  test('Stolen Knowledge does NOT trigger when Under-galleries is untapped (returns to deck normally)', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GALLERIES, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [THE_UNDER_COURTS],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[RESOURCE_PLAYER].companies[0];
    const destSite = built.players[RESOURCE_PLAYER].siteDeck.find(
      c => c.definitionId === THE_UNDER_COURTS,
    )!;
    const originInstanceId = company.currentSite!.instanceId;

    // Site is untapped — should return to deck, not trigger Stolen Knowledge
    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Untapped },
            siteCardOwned: true,
            destinationSite: { instanceId: destSite.instanceId, definitionId: destSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: originInstanceId,
          }],
        },
        built.players[HAZARD_PLAYER],
      ],
    };

    const afterBothPass = dispatch(dispatch(state, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[RESOURCE_PLAYER];
    // Untapped site returns to site deck, not out-of-play or site discard
    expect(p1.siteDiscardPile.some(c => c.instanceId === originInstanceId)).toBe(false);
    expect(p1.outOfPlayPile.some(c => c.instanceId === originInstanceId)).toBe(false);
    expect(p1.siteDeck.some(c => c.instanceId === originInstanceId)).toBe(true);
    // No extra misc MPs
    expect(p1.marshallingPoints.misc).toBe(state.players[RESOURCE_PLAYER].marshallingPoints.misc);
  });
});
