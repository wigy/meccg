/**
 * @module tw-341.test
 *
 * Card test: The Arkenstone (tw-341)
 * Type: hero-resource-item (greater, alignment wizard)
 *
 * Printed text:
 *   "Unique. +3 to bearer's direct influence against Dwarves and Dwarf
 *    factions. If held by a Dwarf, The Arkenstone gives 5 marshalling
 *    points and 4 corruption points. The Arkenstone may be tapped to
 *    untap a Dwarf character in the same company, but target Dwarf must
 *    make a corruption check modified by -2."
 *
 * Rule coverage:
 *
 * | # | Effect Type   | Status | Notes                                                       |
 * |---|---------------|--------|--------------------------------------------------------------|
 * | 1 | stat-modifier | OK     | +3 direct-influence, reason influence-check, target.race dwarf |
 * | 2 | stat-modifier | OK     | +3 direct-influence, reason faction-influence-check, faction.race dwarf |
 * | 3 | mp-modifier   | OK     | +3 MP if Dwarf bearer (base 2 -> total 5)                    |
 * | 4 | stat-modifier | OK     | +2 corruption-points if Dwarf bearer (base 2 -> total 4)     |
 * | 5 | grant-action  | OK     | tap Arkenstone -> untap a Dwarf company-mate, who then makes  |
 * |   |               |        | a corruption check modified -2 (new `company-characters`     |
 * |   |               |        | targets scope + `enqueue-corruption-check target-character`) |
 *
 * Playable: YES
 * Certified: 2026-07-31
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, BALIN, FARAMIR, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BLUE_MOUNTAIN_DWARF_HOLD,
  BLUE_MOUNTAIN_DWARVES,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, viablePlayCharacterActions,
  getCharacter, viableActions, dispatch,
  CardStatus, Phase,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, InfluenceAttemptAction, ActivateGrantedAction } from '../../index.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';

const ARKENSTONE = 'tw-341' as CardDefinitionId;

describe('The Arkenstone (tw-341)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: +3 DI vs Dwarf characters ─────────────────────────────────────

  test('without the Arkenstone, Aragorn (DI 3) cannot control Balin (dwarf, mind 5) as a follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [BALIN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.filter(a => a.controlledBy === aragornId)).toHaveLength(0);
  });

  test('with the Arkenstone, Aragorn (DI 3+3=6) can control Balin (dwarf, mind 5) as a follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ARKENSTONE] }] }], hand: [BALIN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.filter(a => a.controlledBy === aragornId).length).toBeGreaterThanOrEqual(1);
  });

  test('the +3 DI bonus does not apply against a non-dwarf follower (Faramir, mind 5)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [ARKENSTONE] }] }], hand: [FARAMIR], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.filter(a => a.controlledBy === aragornId)).toHaveLength(0);
  });

  // ─── Rule 2: +3 DI vs Dwarf factions ────────────────────────────────────────

  test('+3 DI bonus applies when influencing a dwarf faction (Blue Mountain Dwarves)', () => {
    // Aragorn base DI 3 + Arkenstone bonus 3 = 6 (Aragorn is not a dwarf, so
    // the faction's own +2-for-dwarf-bearer standard modification does not
    // apply). Blue Mountain Dwarves influenceNumber 10 -> need = 10 - 6 = 4.
    const state = buildSitePhaseState({
      characters: [{ defId: ARAGORN, items: [ARKENSTONE] }],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('without the Arkenstone, need is higher (no dwarf-faction DI bonus)', () => {
    // Aragorn base DI 3 only -> need = 10 - 3 = 7.
    const state = buildSitePhaseState({
      characters: [ARAGORN],
      site: BLUE_MOUNTAIN_DWARF_HOLD,
      hand: [BLUE_MOUNTAIN_DWARVES],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const actions = computeLegalActions(state, PLAYER_1);
    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const attempt = influenceActions.find(a => a.influencingCharacterId === aragornId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  // ─── Rules 3 & 4: conditional marshalling / corruption points ──────────────

  test('dwarf bearer: item counts for 5 marshalling points and 4 corruption points', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: GIMLI, items: [ARKENSTONE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(state.players[0].marshallingPoints.item).toBe(5);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(4);
  });

  test('non-dwarf bearer: item counts for 2 marshalling points and the base 2 corruption points (no dwarf bonus)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [ARKENSTONE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(state.players[0].marshallingPoints.item).toBe(2);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(2);
  });

  // ─── Rule 5: tap Arkenstone to untap a Dwarf company-mate ──────────────────

  function buildCompanyState(companionSpec: { defId: CardDefinitionId; status?: CardStatus }) {
    return buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [
            { defId: ARAGORN, items: [ARKENSTONE] },
            companionSpec,
          ] }],
          hand: [], siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('untap-company-dwarf is offered when a tapped Dwarf is in the bearer\'s company', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped });
    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-company-dwarf');
    expect(grants.length).toBe(1);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    expect(grants[0].targetCardId).toBe(gimliId);
  });

  test('untap-company-dwarf is NOT offered when the Dwarf is already untapped', () => {
    const state = buildCompanyState({ defId: GIMLI });
    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-company-dwarf');
    expect(grants.length).toBe(0);
  });

  test('untap-company-dwarf is NOT offered for a tapped non-dwarf company-mate (Legolas)', () => {
    const state = buildCompanyState({ defId: LEGOLAS, status: CardStatus.Tapped });
    const grants = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === 'untap-company-dwarf');
    expect(grants.length).toBe(0);
  });

  test('activating untaps the Dwarf, taps the Arkenstone, and enqueues a corruption check on the Dwarf modified -2', () => {
    const state = buildCompanyState({ defId: GIMLI, status: CardStatus.Tapped });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const grant = viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .find(a => a.actionId === 'untap-company-dwarf')!;
    const after = dispatch(state, grant);

    // Gimli untapped
    expect(after.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Untapped);
    // The Arkenstone (attached to Aragorn) is now tapped
    const arkenstoneItem = after.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === ARKENSTONE)!;
    expect(arkenstoneItem.status).toBe(CardStatus.Tapped);
    // Gimli has a corruption check enqueued with a -2 modifier
    expect(after.pendingResolutions.some(r =>
      r.kind.type === 'corruption-check' && r.kind.characterId === gimliId && r.kind.modifier === -2)).toBe(true);

    // The re-emitted roll action for Gimli carries the -2 modifier
    const roll = viableActions(after, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === gimliId)!;
    expect(roll.corruptionModifier).toBe(-2);
  });

  // ─── Playability ───────────────────────────────────────────────────────────

  test('playable at a greater-item site (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [ARKENSTONE],
    });

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });
});
