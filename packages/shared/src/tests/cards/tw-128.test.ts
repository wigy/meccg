/**
 * @module tw-128.test
 *
 * Card test: Beretar (tw-128)
 * Type: hero-character
 * Prowess 5 / Body 8 / Mind 5 / DI 1 / MP 2
 * Race: dúnadan
 * Skills: warrior, ranger
 * Homesite: Bree
 * Effects: 2 — stat-modifier direct-influence +2 vs Rangers of the North,
 *   on both the faction-influence-check path (playing your own copy) and the
 *   opponent-influence-check path (re-influencing the opponent's in-play copy)
 *
 * "Unique. +2 direct influence against the Rangers of the North faction."
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                                |
 * |---|-------------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | +2 DI vs Rangers of the North (own faction play) | IMPLEMENTED | stat-modifier, reason=faction-influence-check      |
 * | 2 | +2 DI vs Rangers of the North (opponent steal)   | IMPLEMENTED | stat-modifier, reason=opponent-influence-check     |
 *
 * Playable: YES
 * Certified: 2026-04-24
 *
 * Bug report f569e9bab70b7853 (game mt1v1qnq-9b11e9, seq 1142): Beretar's
 * bonus only had the faction-influence-check variant, so it never applied
 * when re-influencing an opponent's already-in-play Rangers of the North —
 * the exact case a unique faction forces (a second copy can't be played from
 * hand while the opponent controls one, CoE rule 8.2-8.4). Mirrors the
 * two-effect pattern certified for Elwen (dm-8).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  BREE, EDORAS, LORIEN, MORIA, MINAS_TIRITH,
  RANGERS_OF_THE_NORTH, RIDERS_OF_ROHAN,
  buildTestState, resetMint,
  findCharInstanceId, buildSitePhaseState,
  getCharacter, RESOURCE_PLAYER, HAZARD_PLAYER,
  addCardInPlay, firstOpponentInfluenceAttempt, dispatchResult, makeSitePhase,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, CharacterCard, GameState, InfluenceAttemptAction } from '../../index.js';

const BERETAR = 'tw-128' as CardDefinitionId;

describe('Beretar (tw-128)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +2 DI against Rangers of the North faction ──

  test('base effective DI is 1 (conditional bonus does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [BERETAR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const baseDef = pool[BERETAR] as CharacterCard;
    expect(getCharacter(state, RESOURCE_PLAYER, BERETAR).effectiveStats.directInfluence).toBe(baseDef.directInfluence);
    expect(baseDef.directInfluence).toBe(1);
  });

  test('+2 DI bonus applies when influencing Rangers of the North', () => {
    // Beretar (dúnadan, base DI 1) attempts to influence Rangers of the North at Bree.
    // Rangers of the North influence number = 10.
    // Rangers of the North give dúnedain +1 check modifier.
    // With Beretar's +2 DI bonus vs Rangers:
    //   modifier = DI(1) + DI bonus(2) + dúnadan check mod(1) = 4
    //   need = 10 - 4 = 6
    const state = buildSitePhaseState({
      characters: [BERETAR],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const beretarId = findCharInstanceId(state, RESOURCE_PLAYER, BERETAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const beretarAttempt = influenceActions.find(
      a => a.influencingCharacterId === beretarId,
    );
    expect(beretarAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(1) - DIbonus(2) - dúnadanCheckMod(1) = 6
    expect(beretarAttempt!.need).toBe(6);
  });

  test('+2 DI bonus does NOT apply when influencing a different faction', () => {
    // Beretar (dúnadan, base DI 1) attempts to influence Riders of Rohan at Edoras.
    // Riders of Rohan influence number = 10, +1 check modifier for hobbits and dúnedain.
    // Beretar is dúnadan so gets +1 check mod, but has no DI bonus vs Riders of Rohan.
    //   modifier = DI(1) + dúnadanCheckMod(1)
    //   need = 10 - 1 - 1 = 8
    // vs Rangers of the North: need = 10 - 1(DI) - 2(DIbonus) - 1(checkMod) = 6
    // The 2-point difference confirms the DI bonus is Rangers-specific.
    const state = buildSitePhaseState({
      characters: [BERETAR],
      site: EDORAS,
      hand: [RIDERS_OF_ROHAN],
    });

    const beretarId = findCharInstanceId(state, RESOURCE_PLAYER, BERETAR);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const beretarAttempt = influenceActions.find(
      a => a.influencingCharacterId === beretarId,
    );
    expect(beretarAttempt).toBeDefined();

    // No DI bonus: influenceNumber(10) - baseDI(1) - dúnadanCheckMod(1) = 8
    expect(beretarAttempt!.need).toBe(8);
  });

  test('non-Beretar character does not benefit from the DI bonus vs Rangers of the North', () => {
    // Legolas (elf, base DI 2) at Bree with Rangers of the North.
    // Rangers influence number = 10, dúnedain +1 check modifier (Legolas is elf, not dúnadan).
    //   modifier = DI(2), no dunadan check mod, no Beretar bonus
    //   need = 10 - 2 = 8
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BREE,
      hand: [RANGERS_OF_THE_NORTH],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // influenceNumber(10) - baseDI(2) = 8
    expect(legolasAttempt!.need).toBe(8);
  });

  // ── Effect 2: +2 DI vs Rangers of the North on the opponent-influence (steal) path ──

  test('+2 DI bonus applies to an opponent-influence attempt against an in-play Rangers of the North', () => {
    // Beretar (base DI 1) tries to re-influence the opponent's already-in-play
    // Rangers of the North — the path a unique faction forces once an
    // opponent controls the only legal copy. Base DI 1 + Beretar's +2 bonus = 3.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [BERETAR] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, RANGERS_OF_THE_NORTH);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.explanation).toContain('Influencer DI: 3');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    expect(pending.kind.attempt.influencerDI).toBe(3);
  });

  test('non-Beretar character gets no DI bonus re-influencing an in-play Rangers of the North', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, RANGERS_OF_THE_NORTH);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === RANGERS_OF_THE_NORTH)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    // Legolas base DI 2, no Beretar bonus.
    expect(attempt!.explanation).toContain('Influencer DI: 2');
  });
});
