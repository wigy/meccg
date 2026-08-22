/**
 * @module tw-79.test
 *
 * Card test: Pick-pocket (tw-79)
 * Type: hazard-creature
 * Race: Men. One strike at prowess 11. Body: none. Kill-MP 1.
 *
 * Card text:
 *   "Men. One strike. Attacker chooses defending characters. For each
 *    successful strike, an item the defending character bears must be
 *    discarded (defender's choice); he is not harmed."
 *
 * Keying (from playable = {F}{B}): a single `siteTypes` entry allowing
 * either a free-hold or a border-hold destination.
 *
 * Engine support:
 * | # | Feature                                                | Status      | Notes                                          |
 * |---|---------------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | One strike, prowess 11                                 | IMPLEMENTED | structural data                                |
 * | 2 | Keying: {F} free-hold site type                        | IMPLEMENTED | siteTypes: [free-hold, border-hold]            |
 * | 3 | Keying: {B} border-hold site type                      | IMPLEMENTED | siteTypes: [free-hold, border-hold]            |
 * | 4 | Attacker chooses defending characters                  | IMPLEMENTED | combat-attacker-chooses-defenders              |
 * | 5 | Successful strike discards an item the struck           | IMPLEMENTED | combat-strike-effect: discard-item-character   |
 * |   | character bears (not the whole company) instead of      |             |                                                 |
 * |   | wounding him                                             |             |                                                 |
 *
 * A successful strike does not wound: `combat-strike-effect` threads
 * `strikeEffect: 'discard-item-character'` onto `CombatState` at combat
 * initiation (chain-reducer.ts) and the generic path in `combat-strike.ts`
 * (shared with Thief tw-102's company-wide `'discard-item'` variant and the
 * agent-attack precedent, Taladhan dm-25 / An Article Missing dm-43)
 * replaces the wound with the `discard-item-from-company` combat phase — but
 * scopes the offered items to the struck character's own items only, unlike
 * Thief's company-wide pool.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, DAGGER_OF_WESTERNESSE, GLAMDRING,
  MORIA, MINAS_TIRITH, LORIEN, RIVENDELL,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve, executeAction, dispatch,
  findCharInstanceId, handCardId, companyIdAt, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  attachItemToChar, expectCharItemCount,
  CardStatus,
} from '../test-helpers.js';
import { Phase, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const PICK_POCKET = 'tw-79' as CardDefinitionId;

const FREE_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.FreeHold };
const BORDER_HOLD_KEYING = { method: 'site-type' as const, value: SiteType.BorderHold };

function buildFreeHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.FreeHold,
    destinationSiteName: 'Pelargir',
  });
}

function buildBorderHoldMHState() {
  return makeMHState({
    resolvedSitePath: [],
    resolvedSitePathNames: [],
    destinationSiteType: SiteType.BorderHold,
    destinationSiteName: 'Bree',
  });
}

/** Play Pick-pocket keyed to a free-hold and resolve the chain (combat active, cancel-window). */
function setupPickpocketCombat(characters: CardDefinitionId[] = [ARAGORN]) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PICK_POCKET], siteDeck: [RIVENDELL] },
    ],
  });
  const ready = { ...state, phaseState: buildFreeHoldMHState() };
  const cardId = handCardId(ready, HAZARD_PLAYER);
  const companyId = companyIdAt(ready, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(ready, PLAYER_2, cardId, companyId, FREE_HOLD_KEYING);
}

/**
 * Advance from the cancel-window to the hazard player (attacker) assigning
 * the single strike to `characterDefId`, then resolve the strike with the
 * given cheat roll. Returns the state after resolution.
 */
function passAndAssignStrike(afterChain: ReturnType<typeof setupPickpocketCombat>, characterDefId: CardDefinitionId, roll: number) {
  const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
  const charId = findCharInstanceId(afterPass, RESOURCE_PLAYER, characterDefId);
  let s = dispatch(afterPass, { type: 'assign-strike', player: PLAYER_2, characterId: charId });
  s = executeAction(s, PLAYER_1, 'resolve-strike', roll);
  return { state: s, charId };
}

describe('Pick-pocket (tw-79)', () => {
  beforeEach(() => resetMint());

  // ─── Keying ───────────────────────────────────────────────────────────────

  test('playable keyed to free-hold destination site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PICK_POCKET], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: buildFreeHoldMHState() };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === cardId);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.some(a => {
      const keyedBy = (a.action as { keyedBy?: { method: string; value: string } }).keyedBy;
      return a.viable && keyedBy?.method === FREE_HOLD_KEYING.method && keyedBy?.value === FREE_HOLD_KEYING.value;
    })).toBe(true);
  });

  test('playable keyed to border-hold destination site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PICK_POCKET], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: buildBorderHoldMHState() };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const actions = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === cardId);
    expect(actions.some(a => {
      const keyedBy = (a.action as { keyedBy?: { method: string; value: string } }).keyedBy;
      return a.viable && keyedBy?.method === BORDER_HOLD_KEYING.method && keyedBy?.value === BORDER_HOLD_KEYING.value;
    })).toBe(true);
  });

  test('NOT playable against a shadow-hold destination', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [PICK_POCKET], siteDeck: [RIVENDELL] },
      ],
    });
    const shadowHoldMH = makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.ShadowHold,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: shadowHoldMH };
    const cardId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === cardId && a.viable);
    expect(viable).toHaveLength(0);
  });

  // ─── Combat initiates: attacker chooses defenders ─────────────────────────

  test('combat initiates with 1 strike, prowess 11, and discard-item-character strike effect', () => {
    const afterChain = setupPickpocketCombat();
    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(11);
    expect(afterChain.combat!.strikeEffect).toBe('discard-item-character');
    expect(afterChain.combat!.phase).toBe('assign-strikes');
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
  });

  test('attacker chooses defenders — hazard player assigns the strike, not the defender', () => {
    const afterChain = setupPickpocketCombat([ARAGORN, LEGOLAS]);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const attackerActions = viableActions(afterPass, PLAYER_2, 'assign-strike');
    expect(attackerActions.length).toBeGreaterThan(0);

    const defenderActions = viableActions(afterPass, PLAYER_1, 'assign-strike');
    expect(defenderActions).toHaveLength(0);
  });

  // ─── Successful strike: item discard scoped to the struck character ──────

  test('successful strike enters discard-item-from-company phase with only the struck character\'s own item', () => {
    const base = setupPickpocketCombat([ARAGORN]);
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const { state } = passAndAssignStrike(withItem, ARAGORN, 2); // 2+6=8 < 11 → would wound, replaced by discard

    expect(state.combat).not.toBeNull();
    expect(state.combat!.phase).toBe('discard-item-from-company');
    expect(state.combat!.discardItemOptions).toHaveLength(1);
  });

  test('the defending character is not harmed by the successful strike', () => {
    const base = setupPickpocketCombat([ARAGORN]);
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const { state, charId } = passAndAssignStrike(withItem, ARAGORN, 2);

    expect(state.players[RESOURCE_PLAYER].characters[charId].status).not.toBe(CardStatus.Inverted);
  });

  test('the defender (not the attacker) chooses which item to discard, and it moves to the discard pile', () => {
    const base = setupPickpocketCombat([ARAGORN]);
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const { state, charId } = passAndAssignStrike(withItem, ARAGORN, 2);

    expect(viableActions(state, PLAYER_1, 'discard-item-from-company')).toHaveLength(1);
    expect(viableActions(state, PLAYER_2, 'discard-item-from-company')).toHaveLength(0);

    const discardAction = viableActions(state, PLAYER_1, 'discard-item-from-company')[0].action;
    const afterDiscard = dispatch(state, discardAction);

    expect(afterDiscard.combat).toBeNull();
    expectCharItemCount(afterDiscard, RESOURCE_PLAYER, ARAGORN, 0);
    expect(afterDiscard.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(afterDiscard.players[RESOURCE_PLAYER].characters[charId].status).not.toBe(CardStatus.Inverted);
  });

  test('an item held by another company member is NOT offered — only the struck character\'s own items count', () => {
    // Unlike Thief (tw-102, company-wide discard), Pick-pocket's text scopes
    // the discard to the character struck: Legolas carries the item, Aragorn
    // faces the strike and has no items of his own — the discard phase must
    // be skipped entirely (no eligible item), and Legolas keeps his item.
    const base = setupPickpocketCombat([ARAGORN, LEGOLAS]);
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, LEGOLAS, GLAMDRING);
    const { state, charId } = passAndAssignStrike(withItem, ARAGORN, 2);

    expect(state.combat).toBeNull();
    expect(state.players[RESOURCE_PLAYER].characters[charId].status).not.toBe(CardStatus.Inverted);
    expectCharItemCount(state, RESOURCE_PLAYER, LEGOLAS, 1);
  });

  test('when the struck character has no items, the discard phase is skipped and combat finalizes without a wound', () => {
    const afterChain = setupPickpocketCombat([ARAGORN]);
    const { state, charId } = passAndAssignStrike(afterChain, ARAGORN, 2);

    expect(state.combat).toBeNull();
    expect(state.players[RESOURCE_PLAYER].characters[charId].status).not.toBe(CardStatus.Inverted);
  });

  test('when the defending character wins the strike, no item is discarded', () => {
    const base = setupPickpocketCombat([ARAGORN]);
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    const { state, charId } = passAndAssignStrike(withItem, ARAGORN, 12); // 12+6=18 > 11 → defeats the strike

    expect(state.combat).toBeNull();
    expectCharItemCount(state, RESOURCE_PLAYER, ARAGORN, 1);
    expect(state.players[RESOURCE_PLAYER].characters[charId].status).not.toBe(CardStatus.Inverted);
  });
});
