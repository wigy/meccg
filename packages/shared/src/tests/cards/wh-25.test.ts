/**
 * @module wh-25.test
 *
 * Card test: Longing for the West (wh-25)
 * Type: hazard-event (permanent, character-targeting corruption hazard)
 * Effects: 5 (play-target character filter race in {wizard, fallen-wizard},
 *             duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event untap-phase-end when bearer.atHaven=false force-check corruption,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:7)
 *
 * "Corruption. Playable on a Wizard or a Fallen-wizard. He receives 2
 *  corruption points and makes a corruption check at the end of his untap
 *  phase if not at a Haven [{H}] (or Wizardhaven). Cannot be duplicated on
 *  a given character. During his organization phase, target may tap to
 *  attempt to remove this card. Make a roll—if this result is greater
 *  than 6, discard this card."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                     |
 * |---|-------------------------------------------|-------------|-------------------------------------------|
 * | 1 | Play targeting a Wizard/Fallen-wizard     | IMPLEMENTED | play-hazard with targetCharacterId filter |
 * | 2 | +2 corruption points while attached       | IMPLEMENTED | stat-modifier corruption-points +2        |
 * | 3 | Untap-end check away from Haven           | IMPLEMENTED | on-event untap-phase-end gated by         |
 * |   |                                           |             | when bearer.atHaven=false; atHaven uses   |
 * |   |                                           |             | isHavenForPlayer so an FW bearer counts   |
 * |   |                                           |             | Wizardhavens (incl. conversions) as {H}   |
 * | 4 | Tap to attempt removal (roll > 6)         | IMPLEMENTED | grant-action remove-self-on-roll          |
 * | 5 | Cannot be duplicated on a character       | IMPLEMENTED | duplication-limit scope:character max:1   |
 *
 * Playable: YES
 * Certified: 2026-07-26
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, findCharInstanceId, charIdAt,
  viableActions, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, computeLegalActions } from '../../index.js';
import type {
  ActivateGrantedAction, ActiveConstraint, CardDefinitionId, CardInstanceId,
  ConstraintId, PlayHazardAction,
} from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const LONGING_FOR_THE_WEST = 'wh-25' as CardDefinitionId;
/** Gandalf the Fallen-wizard (race fallen-wizard). */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven (siteType haven, alignment fallen-wizard). */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;
/** Hidden Haven — the Stage resource whose `wizardhaven-conversion` flag the test injects. */
const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;

describe('Longing for the West (wh-25)', () => {
  beforeEach(() => resetMint());

  test('offered as a viable hazard play only on a Wizard, not on other characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONGING_FOR_THE_WEST], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    // Gandalf (a Wizard) is the only valid target; Aragorn (Dúnadan) is filtered.
    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF)]);
  });

  test('offered on a Fallen-wizard bearer too', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW, ARAGORN] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONGING_FOR_THE_WEST], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  test('cannot be duplicated on a given character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LONGING_FOR_THE_WEST], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // One copy already on Gandalf blocks a second copy on him; Aragorn is
    // race-filtered, so no viable play remains at all.
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const viablePlays = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(viablePlays).toHaveLength(0);
  });

  test('attached card adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const gandalfId = charIdAt(base, RESOURCE_PLAYER);
    expect(base.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST));
    expect(withCard.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(2);
  });

  test('untap → org away from a Haven enqueues a corruption check', () => {
    // Gandalf at Moria (ruins-and-lairs) — not a Haven, so the check fires.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Longing for the West');
    expect(pending[0].kind.characterId).toBe(charIdAt(afterPass, RESOURCE_PLAYER));
  });

  test('untap → org at a Haven does NOT enqueue a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('Fallen-wizard bearer at his Wizardhaven does NOT make the check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: ISENGARD_WH, characters: [GANDALF_FW] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, LONGING_FOR_THE_WEST);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('Fallen-wizard bearer away from a Wizardhaven makes the check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, LONGING_FOR_THE_WEST);
    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  test('Fallen-wizard bearer at a CONVERTED Wizardhaven does NOT make the check', () => {
    // Moria carries a `wizardhaven-conversion` site-flag for P1 (Hidden Haven
    // wh-75 shape) — the site counts as a Wizardhaven for him, so the
    // "not at a Haven (or Wizardhaven)" gate is unsatisfied.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: MORIA, characters: [GANDALF_FW] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const conversion: ActiveConstraint = {
      id: 'c-wh25-conversion' as ConstraintId,
      source: 'p1-hidden-haven' as CardInstanceId,
      sourceDefinitionId: HIDDEN_HAVEN,
      scope: { kind: 'until-cleared' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'site-flag', flag: 'wizardhaven-conversion', siteDefinitionId: MORIA },
    };
    const withCard = {
      ...attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, LONGING_FOR_THE_WEST),
      activeConstraints: [conversion],
    };

    const afterUntap = dispatch(withCard, { type: 'untap', player: PLAYER_1 });
    const afterPass = dispatch(afterUntap, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.phaseState.phase).toBe(Phase.Organization);

    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('successful removal roll (>6) discards the card and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST);
    const cheated = { ...withCard, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(7);

    const next = dispatch(cheated, standardAction);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, LONGING_FOR_THE_WEST);
  });

  test('failed removal roll (<=6) keeps the card attached but still taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LONGING_FOR_THE_WEST);
    const cheated = { ...withCard, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(1);
    expect(next.players[0].characters[gandalfId].hazards[0].definitionId).toBe(LONGING_FOR_THE_WEST);
  });
});
