/**
 * @module le-131.test
 *
 * Card test: Rats! (le-131)
 * Type: hazard-event (short, company-targeting)
 * Text:
 *   "Playable on a company containing at least one minor item that is at or
 *    moving to a Ruins & Lairs [{R}], Shadow-hold [{S}], or Dark-hold [{D}].
 *    Company discards one minor item of its choice or chooses one of its
 *    unwounded characters to become wounded (no body check required)."
 *
 * Card shape:
 *   - effects[0]: play-target (company; filter requires at least one "minor"
 *                 item among the company's items via `target.itemSubtypes`,
 *                 AND the company's current-or-destination site type is one
 *                 of ruins-and-lairs/shadow-hold/dark-hold)
 *   - effects[1]: discard-item-or-wound-character (itemFilter: subtype minor)
 *
 * Engine support exercised:
 *   - play-target company filter: `target.itemSubtypes` aggregation across
 *     every character's items in the company (movement-hazard.ts) combined
 *     with the existing `target.siteType` company filter
 *   - discard-item-or-wound-character resolution: on chain resolution,
 *     enqueues an `item-or-wound-choice` pending resolution for the
 *     company's controller, offering one `choose-item-or-wound` action per
 *     eligible minor item and per eligible unwounded character
 *   - discard-item choice: removes the chosen item from its bearer and moves
 *     it to the defending player's discard pile
 *   - wound-character choice: sets the chosen unwounded character's status
 *     to inverted (wounded), no body check
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  P1_COMPANY,
  ARAGORN, LEGOLAS, RIVENDELL, MORIA, BREE,
  buildTestState, resetMint, makeMHState,
  dispatch, resolveChain,
  findHandCardId, findItemInstanceId, findCharInstanceId,
  attachItemToChar, setCharStatus,
  expectCharStatus, getCharacter,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, CardStatus } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, ChooseItemOrWoundAction } from '../../index.js';

const RATS = 'le-131' as CardDefinitionId;
const STING = 'tw-333' as CardDefinitionId;       // hero-item, subtype "minor"
const GLAMDRING = 'tw-244' as CardDefinitionId;    // hero-item, subtype "major"
const ETTENMOORS = 'tw-395' as CardDefinitionId;   // hero-site, ruins-and-lairs
const CARN_DUM = 'tw-380' as CardDefinitionId;     // hero-site, dark-hold
// MORIA (tw-413, imported) is a hero-site, shadow-hold.
// RIVENDELL (imported) is a haven — does not qualify.
// BREE (imported) is a border-hold — does not qualify.

/** Viable play-hazard actions for Rats! specifically. */
function ratsActions(state: GameState): PlayHazardAction[] {
  const ratsId = findHandCardId(state, HAZARD_PLAYER, RATS);
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === ratsId)
    .map(a => a.action as PlayHazardAction);
}

/**
 * Build an M/H state with PLAYER_1's company (given characters) stationed at
 * `site`, and the hazard player (PLAYER_2) holding Rats!.
 */
function stateAt(site: CardDefinitionId, characters: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [RATS], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/**
 * Build an M/H state with PLAYER_1's company moving from Rivendell to
 * `destination`, and the hazard player (PLAYER_2) holding Rats!.
 */
function movingState(destination: CardDefinitionId, characters: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, destinationSite: destination, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [RATS], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

describe('Rats! (le-131)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: needs a minor item AND a qualifying site ────────────

  test('playable on a company with a minor item at a Ruins & Lairs site', () => {
    let s = stateAt(ETTENMOORS, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    const actions = ratsActions(s);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCompanyId).toBe(P1_COMPANY);
    expect(actions[0].targetCharacterId).toBeUndefined();
  });

  test('playable on a company with a minor item at a Shadow-hold site', () => {
    let s = stateAt(MORIA, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    expect(ratsActions(s)).toHaveLength(1);
  });

  test('playable on a company with a minor item at a Dark-hold site', () => {
    let s = stateAt(CARN_DUM, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    expect(ratsActions(s)).toHaveLength(1);
  });

  test('NOT playable without any minor item in the company', () => {
    const s = stateAt(ETTENMOORS, [ARAGORN]);
    expect(ratsActions(s)).toHaveLength(0);
  });

  test('NOT playable when the company only bears a major item', () => {
    let s = stateAt(ETTENMOORS, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    expect(ratsActions(s)).toHaveLength(0);
  });

  test('NOT playable at a non-qualifying site (a Haven), even with a minor item', () => {
    let s = stateAt(RIVENDELL, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    expect(ratsActions(s)).toHaveLength(0);
  });

  test('playable on a company with a minor item moving to a Shadow-hold', () => {
    let s = movingState(MORIA, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    const actions = ratsActions(s);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCompanyId).toBe(P1_COMPANY);
  });

  test('NOT playable on a company with a minor item moving to a Border-hold', () => {
    // Regression (game mu70l0qs-8p1015, turn 5): before le-131 was certified
    // its empty effects array let the company-targeting short-event fallback
    // offer it unconditionally, including against a company moving to Bree.
    let s = movingState(BREE, [ARAGORN]);
    s = attachItemToChar(s, RESOURCE_PLAYER, ARAGORN, STING);
    expect(ratsActions(s)).toHaveLength(0);
  });

  // ── The forced choice: discard the minor item, or wound a character ───────

  function playRats(state: GameState): GameState {
    const ratsId = findHandCardId(state, HAZARD_PLAYER, RATS);
    let s = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ratsId,
      targetCompanyId: P1_COMPANY,
    });
    s = resolveChain(s);
    return s;
  }

  test('playing Rats! discards the event and enqueues an item-or-wound-choice for the defender', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    const ratsId = findHandCardId(s0, HAZARD_PLAYER, RATS);

    const s = playRats(s0);

    // The spent event card leaves the hazard player's hand for their discard
    // pile at play time (CoE 9.4/9.5 short-event convention).
    expect(s.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).not.toContain(ratsId);
    expect(s.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(ratsId);

    expect(s.pendingResolutions).toHaveLength(1);
    const top = s.pendingResolutions[0];
    expect(top.kind.type).toBe('item-or-wound-choice');
    expect(top.actor).toBe(PLAYER_1);
    if (top.kind.type === 'item-or-wound-choice') {
      expect(top.kind.companyId).toBe(P1_COMPANY);
    }
  });

  test('offers one discard-item choice (the minor item) and one wound-character choice per unwounded character', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN, LEGOLAS]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    const s = playRats(s0);

    const stingId = findItemInstanceId(s, RESOURCE_PLAYER, STING);
    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    const choices = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'choose-item-or-wound')
      .map(a => a.action as ChooseItemOrWoundAction);

    const discardChoices = choices.filter(c => c.choice === 'discard-item');
    expect(discardChoices).toHaveLength(1);
    expect(discardChoices[0].itemInstanceId).toBe(stingId);

    const woundChoices = choices.filter(c => c.choice === 'wound-character');
    expect(woundChoices.map(c => c.characterInstanceId).sort()).toEqual([aragornId, legolasId].sort());
  });

  test('a major item is never offered as a discard-item choice', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    const s = playRats(s0);

    const stingId = findItemInstanceId(s, RESOURCE_PLAYER, STING);
    const discardChoices = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'choose-item-or-wound' && a.action.choice === 'discard-item')
      .map(a => a.action as ChooseItemOrWoundAction);

    expect(discardChoices).toHaveLength(1);
    expect(discardChoices[0].itemInstanceId).toBe(stingId);
  });

  test('an already-wounded character is not offered as a wound-character choice', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN, LEGOLAS]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    s0 = setCharStatus(s0, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);
    const s = playRats(s0);

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const woundChoices = computeLegalActions(s, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'choose-item-or-wound' && a.action.choice === 'wound-character')
      .map(a => a.action as ChooseItemOrWoundAction);

    expect(woundChoices).toHaveLength(1);
    expect(woundChoices[0].characterInstanceId).toBe(aragornId);
  });

  test('choosing discard-item removes the item from its bearer and discards it, clearing the resolution', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    const s1 = playRats(s0);
    const stingId = findItemInstanceId(s1, RESOURCE_PLAYER, STING);

    const action: ChooseItemOrWoundAction = {
      type: 'choose-item-or-wound', player: PLAYER_1, choice: 'discard-item', itemInstanceId: stingId,
    };
    const s = dispatch(s1, action);

    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).items).toHaveLength(0);
    expect(s.players[RESOURCE_PLAYER].discardPile.map(c => c.instanceId)).toContain(stingId);
    expect(s.pendingResolutions).toHaveLength(0);
    expect(s.chain).toBeNull();
  });

  test('choosing wound-character wounds the chosen character with no body check, and the item stays', () => {
    let s0 = stateAt(ETTENMOORS, [ARAGORN]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, STING);
    const s1 = playRats(s0);
    const aragornId = findCharInstanceId(s1, RESOURCE_PLAYER, ARAGORN);

    const action: ChooseItemOrWoundAction = {
      type: 'choose-item-or-wound', player: PLAYER_1, choice: 'wound-character', characterInstanceId: aragornId,
    };
    const s = dispatch(s1, action);

    expectCharStatus(s, RESOURCE_PLAYER, ARAGORN, CardStatus.Inverted);
    expect(getCharacter(s, RESOURCE_PLAYER, ARAGORN).items).toHaveLength(1);
    expect(s.pendingResolutions).toHaveLength(0);
    expect(s.chain).toBeNull();
  });
});
