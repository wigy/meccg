/**
 * @module tw-94.test
 *
 * Card test: The Burden of Time (tw-94)
 * Type: hazard-event (permanent corruption)
 *
 * "Corruption. Playable on an Elf not in a Haven/Darkhaven [{H}]. Target
 *  Elf receives 2 corruption points and must make a corruption check
 *  during each of his untap phases if he is not in a Haven. Cannot be
 *  duplicated on a given Elf. During his organization phase, an Elf with
 *  this card may tap to attempt to remove it. Make a roll: if this
 *  result is greater than 7, discard this card."
 *
 * Engine Support:
 * | # | Rule                                        | Status      | Notes                                        |
 * |---|---------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Playable on an Elf only                     | IMPLEMENTED | play-target filter target.race "elf"         |
 * | 2 | ... not in a Haven/Darkhaven                | IMPLEMENTED | filter company.atHaven false (destination    |
 * |   |                                             |             | site governs for a moving company)           |
 * | 3 | +2 corruption points while attached         | IMPLEMENTED | stat-modifier corruption-points +2           |
 * | 4 | Corruption check each untap phase when not  | IMPLEMENTED | on-event untap-phase-end when                |
 * |   | in a Haven                                  |             | bearer.atHaven false → force-check           |
 * | 5 | Cannot be duplicated on a given Elf         | IMPLEMENTED | duplication-limit scope:character max:1      |
 * | 6 | Tap in organization phase to attempt        | IMPLEMENTED | grant-action remove-self-on-roll             |
 * |   | removal; roll > 7 discards                  |             | threshold 8 (removalNumber 7)                |
 * | 7 | Corruption keyword (rule 10.08 no-tap −3    | DATA        | keywords ["corruption"]                      |
 * |   | variant, CoE 7.2.1 one-per-turn)            |             |                                              |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ELROND, FRODO,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, viableFor, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  makeMHState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn, charIdAt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction,
  CardDefinitionId,
  PlayHazardAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const BURDEN_OF_TIME = 'tw-94' as CardDefinitionId;

describe('The Burden of Time (tw-94)', () => {
  beforeEach(() => resetMint());

  // ── Effect: +2 corruption points while attached ───────────────────────

  test('attached card adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, LEGOLAS).effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME));
    expect(getCharacter(withCard, RESOURCE_PLAYER, LEGOLAS).effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Effect: play-target filter (Elf only, not at a Haven) ─────────────

  test('targets only Elf characters in a company at a non-Haven site', () => {
    // Legolas and Elrond (elves) are eligible; Aragorn (dúnadan) and
    // Frodo (hobbit) are not. The company sits at Moria (non-Haven).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS, ELROND, ARAGORN, FRODO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    const targets = new Set(playActions.map(a => a.targetCharacterId));
    expect(targets).toEqual(new Set([
      findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS),
      findCharInstanceId(base, RESOURCE_PLAYER, ELROND),
    ]));
  });

  test('cannot be played on an Elf whose company is at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on an Elf whose company is moving to a Haven', () => {
    // A moving company is at its new site for hazard purposes: moving
    // from Moria to Rivendell counts as "in a Haven".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS], destinationSite: RIVENDELL }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('playable on an Elf whose company is moving from a Haven to a non-Haven', () => {
    // The destination governs: leaving Rivendell for Moria, the Elf is
    // no longer "in a Haven" and the card becomes playable.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);
    expect(playActions.map(a => a.targetCharacterId)).toEqual([
      findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS),
    ]);
  });

  // ── Effect: duplication-limit ─────────────────────────────────────────

  test('cannot be duplicated on the same Elf', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  // ── Effect: play resolution ───────────────────────────────────────────

  test('playing from hand attaches to the target Elf via chain resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [BURDEN_OF_TIME], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, HAZARD_PLAYER);
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardInstance,
      targetCompanyId,
      targetCharacterId: legolasId,
    });
    expect(afterPlay.chain).not.toBeNull();

    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    const legolasData = current.players[0].characters[legolasId];
    expect(legolasData.hazards).toHaveLength(1);
    expect(legolasData.hazards[0].definitionId).toBe(BURDEN_OF_TIME);
  });

  // ── Effect: corruption check each untap phase when not in a Haven ─────

  test('untap → org transition at a non-Haven site enqueues a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('The Burden of Time');
    expect(pending[0].kind.characterId).toBe(charIdAt(afterPass, RESOURCE_PLAYER));

    // The check must resolve before anything else in the Organization phase.
    const viable = viableFor(afterPass, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('corruption-check');
  });

  test('untap → org transition at a Haven enqueues no corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });

    expect(afterPass.phaseState.phase).toBe(Phase.Organization);
    const pending = afterPass.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  // ── Effect: tap bearer to attempt removal (roll > 7) ──────────────────

  test('untapped bearer in Organization gets both standard (tap) and no-tap (−3) removal variants at threshold 8', () => {
    // Rule 10.08: an untapped bearer of a Corruption card gets the
    // standard tap variant AND the no-tap −3 variant.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(2);

    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)?.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(8);
    expect(standardAction.characterId).toBe(charIdAt(withCard, RESOURCE_PLAYER));
  });

  test.each([
    { label: 'successful removal roll (>7) discards the card', roll: 8, expectedHazards: 0 },
    { label: 'failed removal roll (<=7) keeps the card attached', roll: 7, expectedHazards: 1 },
  ])('$label; bearer taps either way', ({ roll, expectedHazards }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const cheated = { ...withCard, cheatRollTotal: roll };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, LEGOLAS, CardStatus.Tapped);
    expect(getHazardsOn(next, RESOURCE_PLAYER, LEGOLAS)).toHaveLength(expectedHazards);
    if (expectedHazards === 0) {
      expectInDiscardPile(next, HAZARD_PLAYER, BURDEN_OF_TIME);
    } else {
      expect(getHazardsOn(next, RESOURCE_PLAYER, LEGOLAS)[0].definitionId).toBe(BURDEN_OF_TIME);
    }
  });

  test('tapped bearer can still attempt removal via no-tap variant (−3 to roll, rule 10.08)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, LEGOLAS, BURDEN_OF_TIME);
    const legolasId = findCharInstanceId(withCard, RESOURCE_PLAYER, LEGOLAS);
    const tapped: typeof withCard = {
      ...withCard,
      players: [
        {
          ...withCard.players[0],
          characters: {
            ...withCard.players[0].characters,
            [legolasId as string]: {
              ...withCard.players[0].characters[legolasId],
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
    expect(action.rollThreshold).toBe(8);
    expect(action.characterId).toBe(legolasId);
  });
});
