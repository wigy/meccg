/**
 * @module as-24.test
 *
 * Card test: Alone and Unadvised (as-24)
 * Type: hazard-corruption (character-targeting)
 * Effects: 6 (play-target character filter non-wizard/non-ringwraith maxCompanySize:3,
 *             duplication-limit scope:character max:1,
 *             on-event end-of-company-mh force-check corruption perRegion:true,
 *             check-modifier corruption value:company.characterCount,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:7,
 *             on-event company-composition-changed discard-self when company.characterCount >= 4)
 *
 * "Corruption. Playable on a non-Wizard, non-Ringwraith character in a
 *  company with 3 or fewer characters. Target character makes a corruption
 *  check at the end of his movement/hazard phase for each region he moved
 *  through. All of his corruption checks are modified by adding the number
 *  of characters in his company. During his organization phase, the
 *  character may tap to attempt to remove this card. Make a roll—if the
 *  result is greater than 6, discard this card. Discard this card if his
 *  company has 4 or more characters. Cannot be duplicated on a given
 *  character."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Play from hand targeting character        | IMPLEMENTED | play-hazard with targetCharacterId     |
 * | 2 | Filter: non-wizard, non-ringwraith        | IMPLEMENTED | play-target filter with $ne            |
 * | 3 | Max company size 3                        | IMPLEMENTED | play-target maxCompanySize             |
 * | 4 | +4 corruption points while attached       | IMPLEMENTED | corruptionPoints field on card def     |
 * | 5 | Corruption check per region at end of MH  | IMPLEMENTED | on-event end-of-company-mh per region  |
 * | 6 | Check modifier = company character count  | IMPLEMENTED | check-modifier with expression value   |
 * | 7 | Tap to attempt removal (roll>6)           | IMPLEMENTED | grant-action remove-self-on-roll       |
 * | 8 | Auto-discard if company >= 4 characters   | IMPLEMENTED | on-event company-composition-changed   |
 * | 9 | Cannot be duplicated on a character       | IMPLEMENTED | duplication-limit scope:character max:1|
 *
 * Playable: YES
 * Certified: 2026-04-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, ELROND,
  ALONE_AND_UNADVISED,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, charIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  makeMHState, handCardId, companyIdAt,
  attachHazardToChar,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CorruptionCheckAction, PlayHazardAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { RegionType } from '../../index.js';

describe('Alone and Unadvised (as-24)', () => {
  beforeEach(() => resetMint());


  test('attached card adds 4 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const aragornId = charIdAt(base, 0);
    expect(base.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED));
    expect(withCard.players[0].characters[aragornId as string].effectiveStats.corruptionPoints).toBe(4);
  });

  test('offered as a viable hazard play targeting each character in company during MH', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    expect(playActions).toHaveLength(2);
    const targetCharIds = playActions.map(a => a.targetCharacterId);
    const aragornId = charIdAt(base, 0, 0, 0);
    const legolasId = charIdAt(base, 0, 0, 1);
    expect(targetCharIds).toContain(aragornId);
    expect(targetCharIds).toContain(legolasId);
  });

  test('not playable if company has more than 3 characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI, ELROND] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...withOne, phaseState: mhState };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');

    expect(playActions).toHaveLength(0);
  });

  test('playing from hand attaches to target character via chain resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ALONE_AND_UNADVISED], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, 0);
    const cardInstance = handCardId(base, 1);
    const aragornId = charIdAt(base, 0);

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
    expect(aragornData.hazards[0].definitionId).toBe(ALONE_AND_UNADVISED);
  });

  test('end of company MH enqueues corruption checks per region moved', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const pending = afterBothPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(2);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.reason).toContain('Alone and Unadvised');
      expect(pending[0].kind.reason).toContain('region 1/2');
    }
    if (pending[1].kind.type === 'corruption-check') {
      expect(pending[1].kind.reason).toContain('region 2/2');
    }
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

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
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

  test('corruption check modifier includes company character count', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED));
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resourcePlayerPassed: true,
    });
    const stateAtPlayHazards = { ...withCard, phaseState: mhState };

    const afterBothPass = dispatch(stateAtPlayHazards, { type: 'pass', player: PLAYER_2 });

    const actions = computeLegalActions(afterBothPass, PLAYER_1);
    const ccAction = actions.find(a => a.viable && a.action.type === 'corruption-check');
    expect(ccAction).toBeDefined();

    const cc = ccAction!.action as CorruptionCheckAction;
    expect(cc.corruptionPoints).toBe(4);
    // Company has 2 characters → modifier includes +2 from company.characterCount
    // Aragorn's base corruptionModifier is 0, so total modifier = 0 + 2 = 2
    expect(cc.corruptionModifier).toBe(2);
  });

  test('untapped bearer in Organization can activate remove-self-on-roll (rollThreshold 7)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    // METD §7 step 10 added a no-tap variant alongside the standard
    // tap-and-roll for any corruption-card removal. Both are now offered.
    const standard = actions.filter(ea => (ea.action as ActivateGrantedAction).noTap !== true);
    expect(standard).toHaveLength(1);

    const action = standard[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(7);
  });

  test('successful removal roll (>6) discards card and taps bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const cheated = { ...withCard, cheatRollTotal: 7 };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, 0, ARAGORN, CardStatus.Tapped);
    const aragornId = charIdAt(next, 0);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(0);
    expectInDiscardPile(next, 1, ALONE_AND_UNADVISED);
  });

  test('failed removal roll (<=6) keeps card attached but still taps bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const cheated = { ...withCard, cheatRollTotal: 6 };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, 0, ARAGORN, CardStatus.Tapped);
    const aragornId = charIdAt(next, 0);
    expect(next.players[0].characters[aragornId as string].hazards).toHaveLength(1);
    expect(next.players[0].characters[aragornId as string].hazards[0].definitionId).toBe(ALONE_AND_UNADVISED);
  });

  test('auto-discards when company reaches 4+ characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }],
          hand: [ELROND],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, 0, ARAGORN, ALONE_AND_UNADVISED);
    const aragornId = charIdAt(withCard, 0, 0);
    expect(withCard.players[0].characters[aragornId as string].hazards).toHaveLength(1);

    const afterRecruit = dispatch(withCard, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: handCardId(withCard, 0),
      atSite: withCard.players[0].companies[0].currentSite!.instanceId,
      controlledBy: 'general',
    });

    expect(afterRecruit.players[0].companies[0].characters).toHaveLength(4);
    expect(afterRecruit.players[0].characters[aragornId as string].hazards).toHaveLength(0);
  });
});
