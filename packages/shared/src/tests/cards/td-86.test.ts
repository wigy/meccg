/**
 * @module td-86.test
 *
 * Card test: Wolf-riders (td-86)
 * Type: hazard-creature (Creature/Short-event), non-unique
 *
 * Card text:
 *   "Orcs. May be played following any Orc attack not keyed to a site.
 *    Three strikes. If played as a short-event, modify the prowess and
 *    strikes of a Wolf attack by +1."
 *
 * CRF ruling: "The «playable on …» conditions of the first paragraph do
 * not apply to the second paragraph." — i.e. the short-event mode is NOT
 * restricted to following an Orc attack; it is independently playable
 * whenever there is a Wolf attack to boost.
 *
 * This tests:
 * 1. Creature mode: playable (via `followsAttackRaces` keying) as a
 *    follow-up attack once the company has faced an Orc attack not keyed
 *    to a site this M/H sub-phase; initiates an 8-prowess, 3-strike Orc
 *    attack.
 * 2. Creature mode: NOT playable when the company has faced no attack at
 *    all this sub-phase (keyedTo is otherwise empty).
 * 3. Creature mode: NOT playable when the only attack faced was not an
 *    Orc (e.g. a Wolf attack).
 * 4. Short-event mode: playable (`modify-attack`, fromHand) against a live
 *    Wolf attack, giving +1 prowess and +1 strike; discards the card and
 *    charges the hazard limit.
 * 5. Short-event mode: NOT playable against a non-Wolf attack.
 * 6. Short-event mode: playable even with NO prior Orc attack faced (CRF
 *    ruling — the two paragraphs' conditions are independent).
 * 7. Short-event mode: NOT viable once the hazard limit is already reached.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState,
  resolveChain, makeCancelWindowCombat, viableActions,
  handCardId, companyIdAt, charIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, SiteType, Race } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, ModifyAttackAction, PlayHazardAction } from '../../index.js';

const WOLF_RIDERS = 'td-86' as CardDefinitionId;
const WOLVES = 'tw-114' as CardDefinitionId;

function twoPlayerMHState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [ORC_LIEUTENANT, WOLF_RIDERS],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('Wolf-riders (td-86)', () => {
  beforeEach(() => resetMint());

  // ─── Creature mode: follow-up keying ──────────────────────────────────

  test('creature mode: playable as a follow-up after a real Orc attack resolves, 8 prowess / 3 strikes', () => {
    const state = twoPlayerMHState();
    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    // --- Play Orc-lieutenant normally (keyed by site type) and resolve it fully ---
    const ltId = handCardId(gameState, HAZARD_PLAYER, 0);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'shadow-hold' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.creatureRace).toBe('orc');

    const aragornId = charIdAt(afterChain, RESOURCE_PLAYER);
    let s = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: aragornId,
      tapped: false,
    });
    s = { ...s, cheatRollTotal: 12 };
    const resolveAction = computeLegalActions(s, PLAYER_1).find(a => a.viable && a.action.type === 'resolve-strike');
    expect(resolveAction).toBeDefined();
    s = dispatch(s, resolveAction!.action);
    expect(s.combat).toBeNull();
    expect(s.phaseState.phase).toBe(Phase.MovementHazard);
    expect((s.phaseState as MovementHazardPhaseState).hazardsEncountered).toContain('Orc-lieutenant');

    // --- Wolf-riders is now offered as a follow-up creature play ---
    const offered = viableActions(s, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === handCardId(s, HAZARD_PLAYER, 0),
    );
    const followUp = offered.find(a => (a.action as PlayHazardAction).keyedBy?.method === 'follows-attack');
    expect(followUp).toBeDefined();
    expect((followUp!.action as PlayHazardAction).keyedBy).toEqual({ method: 'follows-attack', value: 'orc' });

    const wrId = handCardId(s, HAZARD_PLAYER, 0);
    const afterWrPlay = dispatch(s, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: wrId,
      targetCompanyId: companyId,
      keyedBy: { method: 'follows-attack' as const, value: 'orc' },
    });
    const afterWrChain = resolveChain(afterWrPlay);
    expect(afterWrChain.combat).not.toBeNull();
    expect(afterWrChain.combat!.creatureRace).toBe('orc');
    expect(afterWrChain.combat!.strikeProwess).toBe(8);
    expect(afterWrChain.combat!.strikesTotal).toBe(3);
    expect(afterWrChain.combat!.attackSource.type).toBe('creature');
  });

  test('creature mode: NOT playable when the company has faced no attack this sub-phase', () => {
    const state = twoPlayerMHState();
    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      hazardsEncountered: [],
    });
    const gameState = { ...state, phaseState: mhState };

    const wrId = handCardId(gameState, HAZARD_PLAYER, 1);
    const offered = viableActions(gameState, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === wrId,
    );
    expect(offered).toHaveLength(0);
  });

  test('creature mode: NOT playable when the only attack faced was a Wolf, not an Orc', () => {
    const state = twoPlayerMHState();
    const mhState = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
      hazardsEncountered: ['Wolves'],
    });
    const gameState = { ...state, phaseState: mhState };

    const wrId = handCardId(gameState, HAZARD_PLAYER, 1);
    const offered = viableActions(gameState, PLAYER_2, 'play-hazard').filter(
      a => a.action.type === 'play-hazard' && (a.action).cardInstanceId === wrId,
    );
    expect(offered).toHaveLength(0);
  });

  // ─── Short-event mode: modify a Wolf attack by +1/+1 ──────────────────

  test('short-event mode: +1 prowess and +1 strike to a live Wolf attack, discards the card, charges hazard limit', () => {
    const state = twoPlayerMHState();
    const combat = makeCancelWindowCombat(state, {
      creatureDefId: WOLVES,
      creatureRace: Race.Wolf,
      attackSourceType: 'creature',
      strikesTotal: 2,
      strikeProwess: 6,
    });
    const withMH = { ...combat, phaseState: makeMHState({ hazardsPlayedThisCompany: 0 }) };

    const actions = viableActions(withMH, PLAYER_2, 'modify-attack');
    const wrAction = actions.find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return withMH.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS);
    });
    expect(wrAction).toBeDefined();
    expect(wrAction!.viable).toBe(true);

    const after = dispatch(withMH, wrAction!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.strikesTotal).toBe(3);

    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === WOLF_RIDERS)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === WOLF_RIDERS)).toBe(true);

    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('short-event mode: NOT playable against a non-Wolf attack', () => {
    const state = twoPlayerMHState();
    const combat = makeCancelWindowCombat(state, {
      creatureDefId: ORC_LIEUTENANT,
      creatureRace: Race.Spider,
      attackSourceType: 'creature',
    });
    const withMH = { ...combat, phaseState: makeMHState({ hazardsPlayedThisCompany: 0 }) };

    const actions = viableActions(withMH, PLAYER_2, 'modify-attack');
    const wrAction = actions.find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return withMH.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS);
    });
    expect(wrAction).toBeUndefined();
  });

  test('short-event mode: playable even with no prior Orc attack faced (CRF ruling: paragraphs are independent)', () => {
    const state = twoPlayerMHState();
    const combat = makeCancelWindowCombat(state, {
      creatureDefId: WOLVES,
      creatureRace: Race.Wolf,
      attackSourceType: 'creature',
    });
    const withMH = { ...combat, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardsEncountered: [] }) };

    const actions = viableActions(withMH, PLAYER_2, 'modify-attack');
    const wrAction = actions.find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return withMH.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS);
    });
    expect(wrAction).toBeDefined();
    expect(wrAction!.viable).toBe(true);
  });

  test('short-event mode: NOT viable once the hazard limit is already reached', () => {
    const state = twoPlayerMHState();
    const combat = makeCancelWindowCombat(state, {
      creatureDefId: WOLVES,
      creatureRace: Race.Wolf,
      attackSourceType: 'creature',
    });
    const withMH = {
      ...combat,
      phaseState: makeMHState({ hazardsPlayedThisCompany: 5, hazardLimitAtReveal: 2 }),
    };

    const actions = computeLegalActions(withMH, PLAYER_2).filter(a => a.action.type === 'modify-attack');
    const wrAction = actions.find(a => {
      const inst = (a.action as ModifyAttackAction).cardInstanceId;
      return withMH.players[HAZARD_PLAYER].hand.some(c => c.instanceId === inst && c.definitionId === WOLF_RIDERS);
    });
    expect(wrAction).toBeDefined();
    expect(wrAction!.viable).toBe(false);
  });
});
