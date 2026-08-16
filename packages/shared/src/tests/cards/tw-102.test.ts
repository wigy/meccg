/**
 * @module tw-102.test
 *
 * Card test: Thief (tw-102)
 * Type: hazard-creature
 * Race: Men. One strike at prowess 15. Body: none. Kill-MP 1.
 *
 * Card text:
 *   "Men. One strike. For each successful strike, an item held by the
 *    defending company must be discarded (defender's choice); the
 *    defending character is not harmed."
 *
 * Keying: {b}{B} — border-land region type OR border-hold site type.
 *
 * Engine support:
 * | # | Feature                                          | Status      | Notes                                    |
 * |---|---------------------------------------------------|-------------|-------------------------------------------|
 * | 1 | One strike, prowess 15                           | IMPLEMENTED | structural data                          |
 * | 2 | Keying: {b} border-land region                   | IMPLEMENTED | regionTypes: [border]                    |
 * | 3 | Keying: {B} border-hold site type                 | IMPLEMENTED | siteTypes: [border-hold]                 |
 * | 4 | Successful strike discards a company item instead | IMPLEMENTED | combat-strike-effect: discard-item       |
 * |   | of wounding the defending character               |             |                                           |
 *
 * A successful strike does not wound: `combat-strike-effect` threads
 * `strikeEffect: 'discard-item'` onto `CombatState` at combat initiation
 * (chain-reducer.ts) and the generic path in `combat-strike.ts` (shared with
 * the agent-attack precedent, Taladhan dm-25 / An Article Missing dm-43)
 * replaces the wound with the `discard-item-from-company` combat phase.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, DAGGER_OF_WESTERNESSE, GLAMDRING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, executeAction, dispatch,
  findCharInstanceId, handCardId, companyIdAt, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  attachItemToChar, expectCharItemCount,
  CardStatus,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const THIEF = 'tw-102' as CardDefinitionId;

const BORDER_HOLD_KEYING = { method: 'site-type' as const, value: 'border-hold' };
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };

function buildBorderHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Bree',
  });
}

function setupThiefCombat(characters: CardDefinitionId[] = [ARAGORN]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: BREE, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [THIEF], siteDeck: [RIVENDELL] },
    ],
  });
  const ready = { ...state, phaseState: buildBorderHoldMHState() };
  const thiefId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, thiefId, companyId, BORDER_HOLD_KEYING);
}

describe('Thief (tw-102)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ───────────────────────────────────────────────────────────────

  test('playable keyed to border-hold destination site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [THIEF], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: buildBorderHoldMHState() };
    const thiefId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === thiefId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(a => a.viable)).toBe(true);
  });

  test('playable keyed to border-land region in path and combat initiates', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [THIEF], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Enedhwaith'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const thiefId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, thiefId, companyId, BORDER_KEYING);
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(15);
  });

  test('NOT playable on wilderness-only path to non-border-hold destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [THIEF], siteDeck: [RIVENDELL] },
      ],
    });
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const thiefId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === thiefId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat initiates ─────────────────────────────────────────────────────

  test('combat initiates with 1 strike, prowess 15, and discard-item strike effect', () => {
    const afterChain = setupThiefCombat();
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(15);
    expect(afterChain.combat!.strikeEffect).toBe('discard-item');
  });

  // ─── Successful strike: item discard instead of wound ────────────────────

  test('successful strike enters discard-item-from-company phase with the item available', () => {
    // Aragorn: prowess 6. Strike roll 2: 2+6=8 < 15 → would be wounded, but
    // discard-item strike effect replaces the wound.
    const base = setupThiefCombat([ARAGORN]);
    const afterChain = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);

    expect(s.combat).not.toBeNull();
    expect(s.combat!.phase).toBe('discard-item-from-company');
    expect(s.combat!.discardItemOptions).toHaveLength(1);
  });

  test('the defending character is not harmed by the successful strike', () => {
    const base = setupThiefCombat([ARAGORN]);
    const afterChain = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);

    expect(s.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
  });

  test('the defender (not the attacker) chooses which item to discard, and it moves to the discard pile', () => {
    const base = setupThiefCombat([ARAGORN]);
    const afterChain = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);

    expect(viableActions(s, PLAYER_1, 'discard-item-from-company')).toHaveLength(1);
    expect(viableActions(s, PLAYER_2, 'discard-item-from-company')).toHaveLength(0);

    const discardAction = viableActions(s, PLAYER_1, 'discard-item-from-company')[0].action;
    const afterDiscard = dispatch(s, discardAction);

    expect(afterDiscard.combat).toBeNull();
    expectCharItemCount(afterDiscard, RESOURCE_PLAYER, ARAGORN, 0);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
  });

  test('an item held anywhere in the company (not just the struck character) may be discarded', () => {
    // Thief text says "an item held by the defending company", not just the
    // struck character — Legolas carries the item, Aragorn faces the strike.
    const base = setupThiefCombat([ARAGORN, LEGOLAS]);
    const afterChain = attachItemToChar(base, RESOURCE_PLAYER, LEGOLAS, GLAMDRING);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);

    const discardActions = viableActions(s, PLAYER_1, 'discard-item-from-company');
    expect(discardActions).toHaveLength(1);

    const afterDiscard = dispatch(s, discardActions[0].action);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GLAMDRING)).toBe(true);
  });

  test('when the company has no items, the discard phase is skipped and combat finalizes without a wound', () => {
    const afterChain = setupThiefCombat([ARAGORN]);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);

    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
  });

  test('when the defending character wins the strike, no item is discarded', () => {
    const base = setupThiefCombat([ARAGORN]);
    const afterChain = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const aragornId = findCharInstanceId(afterChain, RESOURCE_PLAYER, ARAGORN);

    let s = dispatch(afterChain, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12); // 12+6=18 > 15 → defeats the strike

    expect(s.combat).toBeNull();
    expectCharItemCount(s, RESOURCE_PLAYER, ARAGORN, 1);
    expect(s.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
  });
});
