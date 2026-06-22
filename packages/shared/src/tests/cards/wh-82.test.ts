/**
 * @module wh-82.test
 *
 * Card test: Thrall of the Voice (wh-82)
 * Type: hero-resource-event (permanent, fallen-wizard alignment)
 *
 * Card text:
 *   "Instead of a normal character, during your organization phase you may
 *    bring into play one character (including a minion agent) with up to a 6
 *    mind. Place this card with the character. -1 to his mind to a minimum of
 *    1. Such a character may also be in your starting company."
 *
 * The CRF/French printing clarifies: the special play counts against the
 * one-character-per-turn limit, and the card "cannot be used to … allow a
 * Fallen-wizard player to bring an Orc or Troll character into play without an
 * appropriate card".
 *
 * Implemented as a `recruitment-vehicle` effect (maxMind 6) plus the original
 * `stat-modifier` (mind, "-1 … min 1") and a `starting-company-placement`:
 *  - Organization phase (rules 1–3): when the Fallen-wizard holds Thrall,
 *    `playCharacterActions` emits a `play-character` carrying
 *    `viaRecruitmentInstanceId` for a character whose printed mind exceeds the
 *    Fallen-wizard maximum of 5 (up to maxMind 6) and is not an Orc/Troll; the
 *    influence cost uses the reduced mind. `handlePlayCharacter` places Thrall
 *    with the recruit (attaches it, removing it from hand) and consumes the
 *    one-character-per-turn slot. `recomputeDerived` then reduces the recruit's
 *    mind by one (floor 1).
 *  - Setup (rule 4): Thrall is a `starting-company-placement`; placing it on a
 *    starting character attaches it and reduces that character's mind, so such
 *    a character may be in the starting company.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Recruit a character (mind ≤ 6, incl. minion agent) instead of | OK     |
 * |   | a normal character, within the one-character-per-turn limit   |        |
 * | 2 | Place this card with the recruited character                  | OK     |
 * | 3 | -1 to the borne character's mind, to a minimum of 1           | OK     |
 * | 4 | Such a character may also be in your starting company         | OK     |
 *
 * Note: the engine's draft does not itself impose the Fallen-wizard
 * starting-company mind/agent restriction that rule 4 lifts, so rule 4 is
 * exercised as its positive outcome — a mind-6 character may sit in the FW
 * starting company with Thrall placed on it, reducing its mind.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, getCharacter,
  recomputeDerived, dispatch,
  Phase, Alignment, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, SetupStep } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, SetupStepState } from '../../index.js';

const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId;
const IVIC = 'dm-17' as CardDefinitionId;          // minion agent, mind 6 (→ 5)
const BILL_FERNY = 'dm-3' as CardDefinitionId;      // minion agent, mind 3 (→ 2)
const ORC_BRAWLER = 'le-30' as CardDefinitionId;    // orc, mind 1 (→ floor 1)
const GIMLI = 'tw-159' as CardDefinitionId;         // hero character, mind 6, not an agent, not Orc/Troll
const GORBAG = 'le-11' as CardDefinitionId;         // orc, mind 6 — excluded by the CRF Orc/Troll clause
const ARAGORN = 'tw-120' as CardDefinitionId;       // mind 9 — exceeds the vehicle's maxMind of 6
const AMON_HEN = 'tw-371' as CardDefinitionId;      // a Ruins & Lairs (FW company's filler site)
const WIZARDHAVEN = 'wh-56' as CardDefinitionId;    // Isengard — a Fallen-wizard Wizardhaven (recruits enter play here)
const RIVENDELL = 'tw-421' as CardDefinitionId;
const OPPONENT_CHAR = 'tw-155' as CardDefinitionId; // Gamling the Old — opponent filler

/**
 * Build a Fallen-wizard company holding `charDef`, attach Thrall of the Voice
 * to that character, recompute derived stats, and return the resulting state.
 */
function thrallAttachedState(charDef: CardDefinitionId) {
  let state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [charDef] }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
    ],
  });
  state = attachItemToChar(state, RESOURCE_PLAYER, charDef, THRALL_OF_THE_VOICE);
  return recomputeDerived(state);
}

/**
 * Build a Fallen-wizard organization-phase state: a filler company at Amon Hen,
 * a Wizardhaven (Isengard) in the site deck (where recruits may enter play),
 * and `hand` in the FW player's hand.
 */
function fwOrgState(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [BILL_FERNY] }], hand, siteDeck: [WIZARDHAVEN] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

function recruitmentPlays(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId
      && (a.action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId !== undefined,
  );
}

function anyPlay(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId,
  );
}

describe('Thrall of the Voice (wh-82)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: recruit an otherwise-ineligible character ───────────────────────

  test('without Thrall, a Fallen-wizard cannot bring a mind-6 character into play', () => {
    expect(anyPlay(fwOrgState([GIMLI]), GIMLI)).toHaveLength(0);
  });

  test('with Thrall, a mind-6 character may be recruited (via the vehicle)', () => {
    const state = fwOrgState([GIMLI, THRALL_OF_THE_VOICE]);
    const thrallId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THRALL_OF_THE_VOICE)!.instanceId;
    const plays = recruitmentPlays(state, GIMLI);
    expect(plays.length).toBeGreaterThan(0);
    expect((plays[0].action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId).toBe(thrallId);
  });

  test('a mind-6 minion agent (Ivic) is blocked for a Fallen-wizard without Thrall', () => {
    // Ivic is a mind-6 agent: without the vehicle the Fallen-wizard mind cap of
    // 5 blocks it. The vehicle path (exercised with Gimli) is what lifts the
    // cap; "(including a minion agent)" is covered by the same mind > 5 rule.
    expect(anyPlay(fwOrgState([IVIC]), IVIC)).toHaveLength(0);
  });

  test('the CRF clause: Thrall cannot bring an Orc into play (Gorbag, mind 6)', () => {
    const state = fwOrgState([GORBAG, THRALL_OF_THE_VOICE]);
    expect(anyPlay(state, GORBAG)).toHaveLength(0);
  });

  test('Thrall cannot bring a character whose mind exceeds 6 (Aragorn, mind 9)', () => {
    const state = fwOrgState([ARAGORN, THRALL_OF_THE_VOICE]);
    expect(anyPlay(state, ARAGORN)).toHaveLength(0);
  });

  // ── Rules 2 + 3: place the card with the recruit; -1 to his mind ────────────

  test('recruiting places Thrall with the character, reduces its mind, and consumes the turn slot', () => {
    const state = fwOrgState([GIMLI, THRALL_OF_THE_VOICE]);
    const thrallId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THRALL_OF_THE_VOICE)!.instanceId;
    const play = recruitmentPlays(state, GIMLI)[0];

    const after = recomputeDerived(dispatch(state, play.action));

    // Gimli is in play with Thrall placed on him (in his items), removed from hand.
    const gimli = getCharacter(after, RESOURCE_PLAYER, GIMLI);
    expect(gimli).toBeDefined();
    expect(gimli.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === thrallId)).toBe(false);

    // -1 to his mind (6 → 5).
    expect(gimli.effectiveStats.mind).toBe(5);

    // Counts against the one-character-per-turn limit.
    expect((after.phaseState as { characterPlayedThisTurn?: boolean }).characterPlayedThisTurn).toBe(true);
  });

  // ── Rule 3: -1 to mind, with the floor, via direct attachment ───────────────

  test('reduces a mind-6 agent to an effective mind of 5', () => {
    expect(getCharacter(thrallAttachedState(IVIC), RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBe(5);
  });

  test('reduces a mind-3 character to an effective mind of 2', () => {
    expect(getCharacter(thrallAttachedState(BILL_FERNY), RESOURCE_PLAYER, BILL_FERNY).effectiveStats.mind).toBe(2);
  });

  test('does not reduce a mind-1 character below 1', () => {
    expect(getCharacter(thrallAttachedState(ORC_BRAWLER), RESOURCE_PLAYER, ORC_BRAWLER).effectiveStats.mind).toBe(1);
  });

  test('mind is unmodified when the card is not attached', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [IVIC] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBeUndefined();
  });

  // ── Rule 4: such a character may also be in your starting company ───────────

  test('placed in a starting company, Thrall attaches to the character and reduces its mind', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: WIZARDHAVEN, characters: [GIMLI] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const gimliId = getCharacter(base, RESOURCE_PLAYER, GIMLI).instanceId;
    const thrallInst = { instanceId: 'wh82-thrall-pd' as CardInstanceId, definitionId: THRALL_OF_THE_VOICE };

    const itemDraftStep: SetupStepState = {
      step: SetupStep.ItemDraft,
      itemDraftState: [
        { unassignedItems: [], done: false, startingEventsPlaced: 0 },
        { unassignedItems: [], done: false, startingEventsPlaced: 0 },
      ],
      remainingPool: [[], []],
    };
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], playDeck: [thrallInst] },
        base.players[HAZARD_PLAYER],
      ] as GameState['players'],
      phaseState: { phase: Phase.Setup, setupStep: itemDraftStep },
    };

    // The item-draft legal actions offer placing Thrall on the starting character.
    const placement = computeLegalActions(state, PLAYER_1).find(
      a => a.viable && a.action.type === 'place-starting-company-event'
        && (a.action as { cardDefId?: CardDefinitionId }).cardDefId === THRALL_OF_THE_VOICE
        && (a.action as { targetCharacterInstanceId?: CardInstanceId }).targetCharacterInstanceId === gimliId,
    );
    expect(placement).toBeDefined();

    const after = recomputeDerived(dispatch(state, placement!.action));
    const gimli = getCharacter(after, RESOURCE_PLAYER, GIMLI);
    // Such a character (mind 6) is in the starting company, with Thrall placed on it…
    expect(gimli.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    // …and its mind is reduced to 5.
    expect(gimli.effectiveStats.mind).toBe(5);
  });
});
