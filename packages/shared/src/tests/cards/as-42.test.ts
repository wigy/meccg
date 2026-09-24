/**
 * @module as-42.test
 *
 * Card test: Unhappy Blows (as-42)
 * Type: hazard-event (short), neutral, non-unique.
 *
 * Text:
 *   "Playable on a company containing both Dwarves and Elves, or both Orcs
 *    and Trolls. Make a roll and subtract five (seven for Orcs and Trolls).
 *    If available, your opponent must choose and return to his hand any
 *    number of Elves and Dwarves (or Orcs and Trolls) in the company whose
 *    total mind equals or exceeds this result. Items played with these
 *    characters are also returned to opponent's hand. Cannot be duplicated
 *    on a given turn."
 *
 * Card shape:
 *   - effects[0]: play-target (company; filter requires target.races to
 *     include both "dwarf" and "elf", or both "orc" and "troll")
 *   - effects[1]: on-event self-enters-play, target-company, apply
 *     roll-return-mind-threshold (raceGroups: dwarf/elf subtract 5,
 *     orc/troll subtract 7)
 *   - effects[2]: duplication-limit (scope "turn", max 1)
 *
 * Engine support exercised:
 *   - target.races company-filter aggregation (movement-hazard.ts)
 *   - applyRollReturnMindThreshold (chain-reducer.ts): rolls 2d6 on chain
 *     resolution, picks the matching race pair from the actual company
 *     composition, computes the mind threshold, and — only if some
 *     combination of that race pair's characters can reach it — enqueues a
 *     `return-to-hand-mind-threshold` pending resolution on the company's
 *     controller. Always leaves the turn-scoped duplication marker
 *     regardless of outcome.
 *   - return-to-hand-mind-threshold pending resolution: repeated
 *     `select-return-to-hand-character` actions accumulate a running mind
 *     total; `pass` is offered only once the total meets the threshold, and
 *     finalizes by returning every selected character (and, via
 *     `returnCharacterToHand`'s `itemsToHand` flag, their attached items) to
 *     the owner's hand.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  dispatch, resolveChain,
  findCharInstanceId, findHandCardId, findItemInstanceId,
  attachItemToChar, companyIdAt,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, Alignment } from '../../index.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, CompanyId,
  PlayHazardAction, SelectReturnToHandCharacterAction,
} from '../../index.js';

const UNHAPPY_BLOWS = 'as-42' as CardDefinitionId;

// Hero side: Dwarf + Elf pairing (subtract 5).
const GIMLI = 'tw-159' as CardDefinitionId;      // dwarf, mind 6
const LEGOLAS = 'tw-168' as CardDefinitionId;    // elf, mind 6
const BOMBUR = 'tw-133' as CardDefinitionId;     // dwarf, mind 1
const OROPHIN = 'tw-174' as CardDefinitionId;    // elf, mind 2
const STING = 'tw-333' as CardDefinitionId;      // hero-item, subtype minor

// Minion side: Orc + Troll pairing (subtract 7).
const MAUHUR = 'as-2' as CardDefinitionId;       // orc, mind 5
const WULUAG = 'as-6' as CardDefinitionId;       // troll, mind 4

const RIVENDELL = 'tw-421' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;

/** Hero company (PLAYER_1) at Rivendell, hazard hand held by PLAYER_2. */
function heroState(characters: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand, siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** Minion company (PLAYER_1) at Minas Morgul, hero hazard hand held by PLAYER_2. */
function minionState(characters: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters }], hand: [], siteDeck: [MINAS_MORGUL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [] }], hand, siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** Viable play-hazard actions for Unhappy Blows specifically. */
function unhappyBlowsActions(state: GameState): PlayHazardAction[] {
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard')
    .map(a => a.action as PlayHazardAction)
    .filter(a => {
      const card = state.players[HAZARD_PLAYER].hand.find(c => c.instanceId === a.cardInstanceId);
      return card?.definitionId === UNHAPPY_BLOWS;
    });
}

/** Play Unhappy Blows on `companyId`, forcing the 2d6 roll to `rollTotal`. */
function playUnhappyBlows(state: GameState, companyId: CompanyId, rollTotal: number): GameState {
  const cardId = findHandCardId(state, HAZARD_PLAYER, UNHAPPY_BLOWS);
  let s = dispatch(state, {
    type: 'play-hazard',
    player: PLAYER_2,
    cardInstanceId: cardId,
    targetCompanyId: companyId,
  });
  s = { ...s, cheatRollTotal: rollTotal };
  s = resolveChain(s);
  return s;
}

function selectActions(state: GameState): SelectReturnToHandCharacterAction[] {
  return computeLegalActions(state, PLAYER_1)
    .filter(a => a.viable && a.action.type === 'select-return-to-hand-character')
    .map(a => a.action as SelectReturnToHandCharacterAction);
}

function passIsLegal(state: GameState): boolean {
  return computeLegalActions(state, PLAYER_1).some(a => a.viable && a.action.type === 'pass');
}

describe('Unhappy Blows (as-42)', () => {
  beforeEach(() => resetMint());

  // ─── Playability gate ───────────────────────────────────────────────────

  test('playable on a company containing both Dwarves and Elves', () => {
    const s = heroState([GIMLI, LEGOLAS], [UNHAPPY_BLOWS]);
    const actions = unhappyBlowsActions(s);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCompanyId).toBe(companyIdAt(s, RESOURCE_PLAYER));
  });

  test('playable on a company containing both Orcs and Trolls', () => {
    const s = minionState([MAUHUR, WULUAG], [UNHAPPY_BLOWS]);
    expect(unhappyBlowsActions(s)).toHaveLength(1);
  });

  test('NOT playable with only a Dwarf (no Elf)', () => {
    const s = heroState([GIMLI], [UNHAPPY_BLOWS]);
    expect(unhappyBlowsActions(s)).toHaveLength(0);
  });

  test('NOT playable with only an Elf (no Dwarf)', () => {
    const s = heroState([LEGOLAS], [UNHAPPY_BLOWS]);
    expect(unhappyBlowsActions(s)).toHaveLength(0);
  });

  test('NOT playable with only an Orc (no Troll)', () => {
    const s = minionState([MAUHUR], [UNHAPPY_BLOWS]);
    expect(unhappyBlowsActions(s)).toHaveLength(0);
  });

  // ─── Roll and threshold ─────────────────────────────────────────────────

  test('Dwarf/Elf pairing subtracts 5 from the roll to form the threshold', () => {
    const s0 = heroState([GIMLI, LEGOLAS], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playUnhappyBlows(s0, companyId, 8);

    expect(s.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === UNHAPPY_BLOWS)).toBe(true);

    expect(s.pendingResolutions).toHaveLength(1);
    const top = s.pendingResolutions[0];
    expect(top.kind.type).toBe('return-to-hand-mind-threshold');
    expect(top.actor).toBe(PLAYER_1);
    if (top.kind.type === 'return-to-hand-mind-threshold') {
      expect(top.kind.threshold).toBe(3); // 8 - 5
      expect(top.kind.companyId).toBe(companyId);
      const gimliId = findCharInstanceId(s, RESOURCE_PLAYER, GIMLI);
      const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
      expect([...top.kind.candidateInstanceIds].sort()).toEqual([gimliId, legolasId].sort());
      expect(top.kind.selectedInstanceIds).toEqual([]);
    }
  });

  test('Orc/Troll pairing subtracts 7 from the roll to form the threshold', () => {
    const s0 = minionState([MAUHUR, WULUAG], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playUnhappyBlows(s0, companyId, 12);

    expect(s.pendingResolutions).toHaveLength(1);
    const top = s.pendingResolutions[0];
    if (top.kind.type === 'return-to-hand-mind-threshold') {
      expect(top.kind.threshold).toBe(5); // 12 - 7
    } else {
      throw new Error('expected return-to-hand-mind-threshold');
    }
  });

  // ─── "If available" — fizzle when no combination can reach the threshold ──

  test('fizzles (no forced choice) when even every qualifying character combined falls short', () => {
    // Bombur mind 1 + Orophin mind 2 = 3 available. Roll 12 → threshold 7 > 3.
    const s0 = heroState([BOMBUR, OROPHIN], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playUnhappyBlows(s0, companyId, 12);

    expect(s.pendingResolutions).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === UNHAPPY_BLOWS)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].companies[0].characters).toHaveLength(2);
  });

  // ─── The forced selection ───────────────────────────────────────────────

  test('exact-equality threshold requires both characters; pass is illegal until the total is reached', () => {
    // Bombur mind 1 + Orophin mind 2 = 3 available. Roll 8 → threshold 3.
    const s0 = heroState([BOMBUR, OROPHIN], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playUnhappyBlows(s0, companyId, 8);

    const bomburId = findCharInstanceId(s, RESOURCE_PLAYER, BOMBUR);
    const orophinId = findCharInstanceId(s, RESOURCE_PLAYER, OROPHIN);

    expect(passIsLegal(s)).toBe(false);
    expect(selectActions(s).map(a => a.characterInstanceId).sort()).toEqual([bomburId, orophinId].sort());

    s = dispatch(s, { type: 'select-return-to-hand-character', player: PLAYER_1, characterInstanceId: bomburId });
    expect(passIsLegal(s)).toBe(false); // mind 1 < 3

    s = dispatch(s, { type: 'select-return-to-hand-character', player: PLAYER_1, characterInstanceId: orophinId });
    expect(passIsLegal(s)).toBe(true); // mind 1 + 2 = 3 >= 3

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.pendingResolutions).toHaveLength(0);
    // Both characters left the company, which is now empty and swept away.
    expect(s.players[RESOURCE_PLAYER].companies.some(c => c.characters.length > 0)).toBe(false);
    expect(s.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === BOMBUR)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === OROPHIN)).toBe(true);
  });

  test('"any number" — a single sufficiently-minded character may be returned alone, leaving the other', () => {
    // Gimli mind 6 + Legolas mind 6. Roll 10 → threshold 5.
    const s0 = heroState([GIMLI, LEGOLAS], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playUnhappyBlows(s0, companyId, 10);
    const gimliId = findCharInstanceId(s, RESOURCE_PLAYER, GIMLI);
    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);

    s = dispatch(s, { type: 'select-return-to-hand-character', player: PLAYER_1, characterInstanceId: gimliId });
    expect(passIsLegal(s)).toBe(true); // mind 6 >= 5

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.players[RESOURCE_PLAYER].companies[0].characters).toEqual([legolasId]);
    expect(s.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === GIMLI)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].characters[legolasId]).toBeDefined();
  });

  test('items attached to a returned character return to hand, not the discard pile', () => {
    let s0 = heroState([GIMLI, LEGOLAS], [UNHAPPY_BLOWS]);
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, GIMLI, STING);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playUnhappyBlows(s0, companyId, 10); // threshold 5
    const gimliId = findCharInstanceId(s, RESOURCE_PLAYER, GIMLI);
    const stingId = findItemInstanceId(s, RESOURCE_PLAYER, STING);

    s = dispatch(s, { type: 'select-return-to-hand-character', player: PLAYER_1, characterInstanceId: gimliId });
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    expect(s.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === stingId)).toBe(true);
    expect(s.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === stingId)).toBe(false);
  });

  test('a threshold at or below zero is met trivially — pass is legal with nothing selected', () => {
    // Bombur mind 1 + Orophin mind 2 = 3 available. Roll 2 → threshold -3.
    const s0 = heroState([BOMBUR, OROPHIN], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    let s = playUnhappyBlows(s0, companyId, 2);

    const top = s.pendingResolutions[0];
    expect(top.kind.type === 'return-to-hand-mind-threshold' && top.kind.threshold).toBe(-3);
    expect(passIsLegal(s)).toBe(true);

    s = dispatch(s, { type: 'pass', player: PLAYER_1 });
    expect(s.pendingResolutions).toHaveLength(0);
    // Nobody was selected — nobody returns to hand.
    expect(s.players[RESOURCE_PLAYER].companies[0].characters).toHaveLength(2);
    expect(s.players[RESOURCE_PLAYER].hand).toHaveLength(0);
  });

  test('only the company controller is offered the selection, not the hazard player', () => {
    const s0 = heroState([GIMLI, LEGOLAS], [UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    const s = playUnhappyBlows(s0, companyId, 10);

    expect(computeLegalActions(s, PLAYER_2).some(a => a.viable && a.action.type === 'select-return-to-hand-character')).toBe(false);
  });

  // ─── Cannot be duplicated on a given turn ───────────────────────────────

  test('cannot be duplicated on a given turn', () => {
    const s0 = heroState([BOMBUR, OROPHIN], [UNHAPPY_BLOWS, UNHAPPY_BLOWS]);
    const companyId = companyIdAt(s0, RESOURCE_PLAYER);
    // Both copies are offered before either has been played.
    expect(unhappyBlowsActions(s0)).toHaveLength(2);

    // Play the first copy (fizzles — Bombur+Orophin can't reach threshold 7).
    const s = playUnhappyBlows(s0, companyId, 12);
    expect(s.players[HAZARD_PLAYER].hand).toHaveLength(1);

    const secondCopyActions = unhappyBlowsActions(s);
    expect(secondCopyActions).toHaveLength(0);

    const marker = s.activeConstraints.find(
      c => c.sourceDefinitionId === UNHAPPY_BLOWS && c.scope.kind === 'turn' && c.kind.type === 'attack-card-played',
    );
    expect(marker).toBeDefined();
  });
});
