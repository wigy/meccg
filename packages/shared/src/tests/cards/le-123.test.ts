/**
 * @module le-123.test
 *
 * Card test: Lure of Nature (le-123)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 5 (play-target character filter non-hobbit/non-dwarf/non-orc/non-ringwraith,
 *             duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event end-of-company-mh force-check corruption regionTypeFilter:[wilderness],
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:5)
 *
 * "Corruption. Playable on a non-Hobbit, non-Dwarf, non-Orc, non-Ringwraith
 *  character. Target character receives 2 corruption points and makes a
 *  corruption check at the end of his movement/hazard phase for each
 *  Wilderness [{w}] in his company's site path. During his organization
 *  phase, the character may tap to attempt to remove this card. Make a
 *  roll—if the result is greater than 4, discard this card. Cannot be
 *  duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                         |
 * |---|------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Play from hand targeting character        | IMPLEMENTED | play-hazard with targetCharacterId            |
 * | 2 | Filter: non-hobbit/dwarf/orc/ringwraith   | IMPLEMENTED | play-target filter with $ne per race          |
 * | 3 | +2 corruption points while attached       | IMPLEMENTED | stat-modifier corruption-points +2            |
 * | 4 | Corruption check per Wilderness at end MH | IMPLEMENTED | on-event end-of-company-mh regionTypeFilter   |
 * | 5 | Tap to attempt removal (roll>4)           | IMPLEMENTED | grant-action remove-self-on-roll threshold 5  |
 * | 6 | Cannot be duplicated on a character       | IMPLEMENTED | duplication-limit scope:character max:1       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO, FRODO, ELROND,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  makeMHState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn,
  charIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction,
  CardDefinitionId,
  PlayHazardAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { RegionType } from '../../index.js';

const LURE_OF_NATURE = 'le-123' as CardDefinitionId;

// Minion fixtures used only to exercise the non-Orc / non-Ringwraith race
// filter — declared locally per the card-ids.ts constants policy.
const GORBAG = 'le-11' as CardDefinitionId;          // minion-character, orc
const ADUNAPHEL = 'le-50' as CardDefinitionId;       // minion-character, ringwraith
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion-site, haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion-site, haven
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId; // minion-site, ruins-and-lairs

describe('Lure of Nature (le-123)', () => {
  beforeEach(() => resetMint());

  // ── Effect: +2 corruption points while attached ───────────────────────

  test('attached card adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE));
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Effect: play-target filter ────────────────────────────────────────

  test('targets non-hobbit, non-dwarf hero characters', () => {
    // Aragorn (man), Legolas (elf) are eligible.
    // Bilbo (hobbit), Gimli (dwarf) are excluded.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, BILBO, GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [LURE_OF_NATURE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    const targets = new Set(playActions.map(a => a.targetCharacterId));
    expect(targets).toEqual(new Set([
      findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN),
      findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS),
    ]));
  });

  test('cannot be played on a hobbit (Frodo)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_NATURE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on a dwarf (Gimli)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GIMLI] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_NATURE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on an orc (Gorbag)', () => {
    // Minion fixtures: the resource player's company is made of orcs, so
    // the hazard player (here PLAYER_2) attempting to attach Lure of
    // Nature to Gorbag must be refused by the race filter.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL] }], hand: [LURE_OF_NATURE], siteDeck: [ETTENMOORS_MINION] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on a ringwraith (Adûnaphel)', () => {
    // Swap roles — PLAYER_2 is the active resource player (ringwraiths);
    // PLAYER_1 is the hazard player trying to play Lure of Nature. The
    // filter must still reject Adûnaphel because her race is ringwraith.
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [LURE_OF_NATURE], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  // ── Effect: duplication-limit ─────────────────────────────────────────

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_NATURE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withOne, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  // ── Effect: play resolution ───────────────────────────────────────────

  test('playing from hand attaches to target character via chain resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_NATURE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, HAZARD_PLAYER);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardInstance,
      targetCompanyId,
      targetCharacterId: aragornId,
    });
    expect(afterPlay.chain).not.toBeNull();

    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    const aragornData = current.players[0].characters[aragornId as string];
    expect(aragornData.hazards).toHaveLength(1);
    expect(aragornData.hazards[0].definitionId).toBe(LURE_OF_NATURE);
  });

  // ── Effect: corruption check per Wilderness at end of company MH ──────

  test('end of company MH enqueues one corruption check per Wilderness in site path', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [
        RegionType.Wilderness,
        RegionType.Shadow,
        RegionType.Wilderness,
      ],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(2);
    for (const p of pending) {
      if (p.kind.type === 'corruption-check') {
        expect(p.kind.reason).toContain('Lure of Nature');
      }
    }
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.reason).toContain('region 1/2');
    }
    if (pending[1].kind.type === 'corruption-check') {
      expect(pending[1].kind.reason).toContain('region 2/2');
    }
  });

  test('end of company MH enqueues no corruption checks when site path has no Wilderness', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Shadow, RegionType.Border],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  test('no corruption checks enqueued when company did not move', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  // ── Effect: tap bearer to attempt removal (roll > 4) ──────────────────

  test('untapped bearer in Organization gets both standard (tap) and no-tap (−3) removal variants', () => {
    // Rule 10.08: untapped bearer gets the standard tap variant AND the no-tap -3 variant.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)?.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(5);
    expect(standardAction.characterId).toBe(charIdAt(withCard, RESOURCE_PLAYER));
  });

  test.each([
    { label: 'successful removal roll (>4) discards the card', roll: 5, expectedHazards: 0 },
    { label: 'failed removal roll (<=4) keeps the card attached', roll: 4, expectedHazards: 1 },
  ])('$label; bearer taps either way', ({ roll, expectedHazards }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const cheated = { ...withCard, cheatRollTotal: roll };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)).toHaveLength(expectedHazards);
    if (expectedHazards === 0) {
      expectInDiscardPile(next, HAZARD_PLAYER, LURE_OF_NATURE);
    } else {
      expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)[0].definitionId).toBe(LURE_OF_NATURE);
    }
  });

  test('tapped bearer can still activate remove-self-on-roll via no-tap variant (−3 to roll, rule 10.08)', () => {
    // Rule 10.08: a tapped character may still attempt to remove a corruption
    // card by taking −3 to the roll instead of tapping.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_NATURE);
    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    const tapped: typeof withCard = {
      ...withCard,
      players: [
        {
          ...withCard.players[0],
          characters: {
            ...withCard.players[0].characters,
            [aragornId as string]: {
              ...withCard.players[0].characters[aragornId as string],
              status: CardStatus.Tapped,
            },
          },
        },
        withCard.players[1],
      ] as typeof withCard.players,
    };

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as ActivateGrantedAction;
    expect(action.noTap).toBe(true);
    expect(action.rollThreshold).toBe(5);
    expect(action.characterId).toBe(aragornId);
  });
});
