/**
 * @module le-249.test
 *
 * Card test: Veils of Shadow (le-249)
 * Type: minion-resource-event (short, sorcery)
 *
 * Card text: "Magic. Sorcery. Playable on a sorcery-using character facing an
 * automatic-attack. The number of strikes of all automatic-attacks at the
 * site this turn are reduced to one. Unless he is a Ringwraith, character
 * makes a corruption check modified by -4."
 *
 * Effects:
 *   1. modify-attack (fromHand, defender) — `requiredSkill: "sorcery"` (one
 *      action per sorcery-using defending character, carried as
 *      `casterInstanceId`); `when: attack.automatic` (site automatic-attack or
 *      played auto-attack only); `setStrikesTo: 1` (the attack being faced);
 *      `siteAutoAttacksStrikesTo: 1` (a turn-scoped `auto-attack-strikes-set`
 *      constraint caps every later automatic-attack at the site);
 *      `cost: corruption check -4`, `costExemptRace: "ringwraith"`.
 *
 * Fixtures: Hador (le-14, dunadan, sorcery — makes the -4 check), Dwar the
 * Ringwraith (le-52, sorcery — exempt), Bill Ferny (dm-3, no sorcery), at Bag
 * End (le-350: Hobbits 5 strikes, then Dúnedain 3 strikes).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildMinionSitePhaseState, resetMint,
  PLAYER_1, RESOURCE_PLAYER,
  viableActions, dispatch, expectInDiscardPile,
  setupAutoAttackStep, attachSiteAutomaticAttackCombat,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, GameState, ModifyAttackAction, SitePhaseState } from '../../index.js';

const VEILS_OF_SHADOW = 'le-249' as CardDefinitionId;
const HADOR = 'le-14' as CardDefinitionId;        // dunadan, sorcery
const DWAR = 'le-52' as CardDefinitionId;          // ringwraith, sorcery
const BILL_FERNY = 'dm-3' as CardDefinitionId;     // man, no sorcery
const BAG_END = 'le-350' as CardDefinitionId;      // Hobbits 5 strikes, Dúnedain 3 strikes

describe('Veils of Shadow (le-249)', () => {
  beforeEach(() => resetMint());

  // ── Playability ─────────────────────────────────────────────────────

  test('playable on each sorcery-using character facing an automatic-attack', () => {
    const base = buildMinionSitePhaseState({ characters: [HADOR, BILL_FERNY, DWAR], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const state = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    expect(state.combat?.attackSource.type).toBe('automatic-attack');
    expect(state.combat?.strikesTotal).toBe(5);

    const chars = state.players[RESOURCE_PLAYER].characters;
    const casters = viableActions(state, PLAYER_1, 'modify-attack')
      .map(ea => (ea.action as ModifyAttackAction).casterInstanceId!)
      .map(id => chars[id].definitionId)
      .sort();
    expect(casters).toEqual([HADOR, DWAR].sort());
  });

  test('not playable without a sorcery-using character', () => {
    const base = buildMinionSitePhaseState({ characters: [BILL_FERNY], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const state = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    expect(state.combat).not.toBeNull();
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  test('not playable against an attack that is not an automatic-attack', () => {
    const base = buildMinionSitePhaseState({ characters: [HADOR], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const withCombat = attachSiteAutomaticAttackCombat(base, { strikesTotal: 3 });
    const state: GameState = {
      ...withCombat,
      combat: { ...withCombat.combat!, attackSource: { type: 'creature', instanceId: 'fake-creature' as CardInstanceId } },
    };
    expect(viableActions(state, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  // ── Resolution ──────────────────────────────────────────────────────

  test('reduces the faced automatic-attack to one strike; non-Ringwraith makes a corruption check at -4', () => {
    const base = buildMinionSitePhaseState({ characters: [HADOR], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const state = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    const hadorId = state.players[RESOURCE_PLAYER].companies[0].characters[0];

    const play = viableActions(state, PLAYER_1, 'modify-attack').map(ea => ea.action as ModifyAttackAction)[0];
    expect(play.casterInstanceId).toBe(hadorId);
    const after = dispatch(state, play);

    expect(after.combat?.strikesTotal).toBe(1);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, VEILS_OF_SHADOW);
    expect(after.pendingResolutions).toHaveLength(1);
    const check = after.pendingResolutions[0].kind as { type: string; characterId: CardInstanceId; modifier: number };
    expect(check.type).toBe('corruption-check');
    expect(check.characterId).toBe(hadorId);
    expect(check.modifier).toBe(-4);
  });

  test('a Ringwraith caster makes no corruption check', () => {
    const base = buildMinionSitePhaseState({ characters: [DWAR], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const state = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });
    const play = viableActions(state, PLAYER_1, 'modify-attack').map(ea => ea.action as ModifyAttackAction)[0];
    const after = dispatch(state, play);

    expect(after.combat?.strikesTotal).toBe(1);
    expectInDiscardPile(after, RESOURCE_PLAYER, VEILS_OF_SHADOW);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('all later automatic-attacks at the site this turn are also reduced to one strike', () => {
    const base = buildMinionSitePhaseState({ characters: [DWAR], site: BAG_END, hand: [VEILS_OF_SHADOW] });
    const first = dispatch(setupAutoAttackStep(base), { type: 'pass', player: PLAYER_1 });

    // Baseline: without Veils of Shadow the second (Dúnedain) attack has 3 strikes.
    const baseline = dispatch(
      { ...first, combat: null, phaseState: { ...(first.phaseState as SitePhaseState), step: 'automatic-attacks', automaticAttacksResolved: 1 } },
      { type: 'pass', player: PLAYER_1 },
    );
    expect(baseline.combat?.strikesTotal).toBe(3);

    const play = viableActions(first, PLAYER_1, 'modify-attack').map(ea => ea.action as ModifyAttackAction)[0];
    const played = dispatch(first, play);
    const constraint = played.activeConstraints.find(c => c.kind.type === 'auto-attack-strikes-set');
    expect(constraint?.scope.kind).toBe('turn');
    expect(constraint?.kind).toEqual({ type: 'auto-attack-strikes-set', siteDefinitionId: BAG_END, strikes: 1 });

    // First attack done; the site's second automatic-attack is initiated.
    const second = dispatch(
      { ...played, combat: null, phaseState: { ...(played.phaseState as SitePhaseState), step: 'automatic-attacks', automaticAttacksResolved: 1 } },
      { type: 'pass', player: PLAYER_1 },
    );
    expect(second.combat?.attackSource.type).toBe('automatic-attack');
    expect(second.combat?.strikesTotal).toBe(1);
    expect(second.combat?.strikeProwess).toBe(11);
  });
});
