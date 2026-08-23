/**
 * @module tw-56.test
 *
 * Card test: Lure of Creation (tw-56)
 * Type: hazard-event (permanent, Wizard-targeting corruption hazard)
 * Effects: 5 (play-target character filter race:wizard,
 *             duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event company-mh-end-at-site when bearer.atHaven force-check corruption,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:7)
 *
 * "Corruption. A revealed Wizard receives 2 corruption points and makes a
 *  corruption check at the end of any movement/hazard phase in a turn
 *  during which his company moved to a Haven [{H}]. Cannot be duplicated on
 *  a given Wizard. During his organization phase, a Wizard with this card
 *  may tap to attempt to remove it. Make a roll: if this result is greater
 *  than 6, discard this card."
 *
 * Unlike Lure of the Senses (tw-60, `on-event: untap-phase-end` gated by
 * `bearer.atHaven`, which checks the bearer's position at the *start* of
 * the following untap phase), Lure of Creation checks whether the bearer's
 * company *arrived at* a Haven during the movement/hazard phase that just
 * ended. This is modelled with `on-event: company-mh-end-at-site` — the
 * same event Hall of Fire (dm-134) uses for its site-attached restore
 * offer, extended here to also scan **character-attached** hazards
 * (`fireCharacterCorruptionAtSiteTriggers`, `mh-hazard-play.ts`), gated by
 * the same `{ bearer: { atHaven } }` context shape `untap-phase-end` uses.
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                        |
 * |---|--------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Play targeting a Wizard only               | IMPLEMENTED | play-hazard with targetCharacterId filter     |
 * | 2 | +2 corruption points while attached        | IMPLEMENTED | stat-modifier corruption-points +2            |
 * | 3 | Check when company ends M/H at a Haven     | IMPLEMENTED | on-event company-mh-end-at-site (character-   |
 * |   |                                             |             | attached form) gated by bearer.atHaven         |
 * | 4 | No check when M/H ends off a Haven         | IMPLEMENTED | same gate, when condition unmet                |
 * | 5 | Tap to attempt removal (roll > 6)          | IMPLEMENTED | grant-action remove-self-on-roll               |
 * | 6 | Cannot be duplicated on a given Wizard     | IMPLEMENTED | duplication-limit scope:character max:1        |
 *
 * Playable: YES
 * Certified: 2026-08-23
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
import { computeLegalActions } from '../../index.js';
import type { ActivateGrantedAction, CardDefinitionId, PlayHazardAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const LURE_OF_CREATION = 'tw-56' as CardDefinitionId;

describe('Lure of Creation (tw-56)', () => {
  beforeEach(() => resetMint());

  test('offered as a viable hazard play only on a Wizard, not on other characters', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_CREATION], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    // Gandalf (a Wizard) is the only valid target; Aragorn is race-filtered out.
    expect(viableTargets).toEqual([findCharInstanceId(base, RESOURCE_PLAYER, GANDALF)]);
  });

  test('cannot be duplicated on a given Wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_CREATION], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION);
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

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION));
    expect(withCard.players[0].characters[gandalfId].effectiveStats.corruptionPoints).toBe(2);
  });

  test('company ending its M/H phase at a Haven enqueues a corruption check', () => {
    // Gandalf's company is already at Rivendell (a Haven) with no
    // destination — "ending the M/H phase at a Haven" covers both moving
    // there and simply staying, since either way the company's M/H phase
    // ends with the company at the Haven.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION);
    const stateAtEnd = {
      ...withCard,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }),
    };

    // Hazard player passes too — both have passed, ending this company's M/H phase.
    const afterPass = dispatch(stateAtEnd, { type: 'pass', player: PLAYER_2 });

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.reason).toBe('Lure of Creation');
    expect(pending[0].kind.characterId).toBe(charIdAt(afterPass, RESOURCE_PLAYER));
  });

  test('company ending its M/H phase away from a Haven does NOT enqueue a corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION);
    const stateAtEnd = {
      ...withCard,
      phaseState: makeMHState({ activeCompanyIndex: 0, resourcePlayerPassed: true }),
    };

    const afterPass = dispatch(stateAtEnd, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('successful removal roll (>6) discards Lure of Creation and taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION);
    // Roll 7 succeeds (need > 6).
    const cheated = { ...withCard, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action as ActivateGrantedAction;
    expect(standardAction.actionId).toBe('remove-self-on-roll');
    expect(standardAction.rollThreshold).toBe(7);

    const next = dispatch(cheated, standardAction);
    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(0);
    // Lure of Creation is owned by P2 and returns to P2's discard pile.
    expectInDiscardPile(next, HAZARD_PLAYER, LURE_OF_CREATION);
  });

  test('failed removal roll (<=6) keeps Lure of Creation attached but still taps the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF, LURE_OF_CREATION);
    const cheated = { ...withCard, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standardAction = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standardAction);

    expectCharStatus(next, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    const gandalfId = charIdAt(next, RESOURCE_PLAYER);
    expect(next.players[0].characters[gandalfId].hazards).toHaveLength(1);
    expect(next.players[0].characters[gandalfId].hazards[0].definitionId).toBe(LURE_OF_CREATION);
  });
});
