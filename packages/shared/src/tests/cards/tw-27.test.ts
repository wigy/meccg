/**
 * @module tw-27.test
 *
 * Card test: Despair of the Heart (tw-27)
 * Type: hazard-event (permanent corruption)
 *
 * "Corruption. Playable on a non-Hobbit, non-Wizard, non-Ringwraith character.
 *  Target character receives 2 corruption points and makes a corruption check
 *  each time a character in his company becomes wounded. During his organization
 *  phase, the character may tap to attempt to remove this card. Make a roll—
 *  if the result is greater than 4, discard this card. Cannot be duplicated on
 *  a given character."
 *
 * Effects:
 *   1. play-target — character; filter excludes hobbit, wizard, ringwraith
 *   2. duplication-limit — scope "character", max 1
 *   3. stat-modifier — +2 corruption-points on bearer
 *   4. on-event — company-member-wounded → force-check corruption on bearer
 *   5. grant-action — remove-self-on-roll, cost tap-bearer, threshold 5 (> 4)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GANDALF, GIMLI, BEREGOND,
  ORC_LIEUTENANT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, attachHazardToChar, recomputeDerived,
  makeWildernessMHState, playCreatureHazardAndResolve, runCreatureCombat,
  findCharInstanceId, companyIdAt, handCardId,
  viableActions, grantedActionsFor,
  dispatch,
  getHazardsOn,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, computeLegalActions } from '../../index.js';

const DESPAIR_OF_THE_HEART = 'tw-27' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };

describe('Despair of the Heart (tw-27)', () => {
  beforeEach(() => resetMint());

  // ── play-target: restricted to non-Hobbit, non-Wizard, non-Ringwraith ───────

  test('is not playable on a Hobbit', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DESPAIR_OF_THE_HEART], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...base, phaseState: makeWildernessMHState() };
    const bilboId = findCharInstanceId(ready, RESOURCE_PLAYER, BILBO);

    const allActions = computeLegalActions(ready, PLAYER_2).filter(a => a.action.type === 'play-hazard');
    const bilboTargetAction = allActions.find(a => {
      const act = a.action as { targetCharacterId?: unknown };
      return act.targetCharacterId === bilboId;
    });
    expect(bilboTargetAction?.viable).toBe(false);
  });

  test('is not playable on a Wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DESPAIR_OF_THE_HEART], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...base, phaseState: makeWildernessMHState() };
    const gandalfId = findCharInstanceId(ready, RESOURCE_PLAYER, GANDALF);

    const allActions = computeLegalActions(ready, PLAYER_2).filter(a => a.action.type === 'play-hazard');
    const gandalfTargetAction = allActions.find(a => {
      const act = a.action as { targetCharacterId?: unknown };
      return act.targetCharacterId === gandalfId;
    });
    expect(gandalfTargetAction?.viable).toBe(false);
  });

  test('is playable on a non-Hobbit, non-Wizard character (Dunadan)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DESPAIR_OF_THE_HEART], siteDeck: [MORIA] },
      ],
    });
    const ready = { ...base, phaseState: makeWildernessMHState() };
    const aragornId = findCharInstanceId(ready, RESOURCE_PLAYER, ARAGORN);

    const actions = viableActions(ready, PLAYER_2, 'play-hazard');
    const aragornTargetAction = actions.find(a => {
      const act = a.action as { targetCharacterId?: unknown };
      return act.targetCharacterId === aragornId;
    });
    expect(aragornTargetAction?.viable).toBe(true);
  });

  // ── duplication-limit: cannot attach a second copy to the same character ────

  test('cannot attach a second copy to the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DESPAIR_OF_THE_HEART], siteDeck: [MORIA] },
      ],
    });
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART);
    const ready = { ...withOne, phaseState: makeWildernessMHState() };
    const aragornId = findCharInstanceId(ready, RESOURCE_PLAYER, ARAGORN);

    const allActions = computeLegalActions(ready, PLAYER_2).filter(a => a.action.type === 'play-hazard');
    const aragornTargetAction = allActions.find(a => {
      const act = a.action as { targetCharacterId?: unknown };
      return act.targetCharacterId === aragornId;
    });
    expect(aragornTargetAction?.viable).toBe(false);
  });

  // ── stat-modifier: bearer gains +2 corruption points ─────────────────────

  test('bearer has 2 extra corruption points from the attached card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART));
    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    const aragorn = withCard.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragorn.effectiveStats.corruptionPoints).toBe(2);
  });

  // ── on-event: company-member-wounded ─────────────────────────────────────

  test('bearer gets a corruption check when another company member is wounded in combat', () => {
    // Orc-lieutenant (prowess 7, 1 strike, wilderness-keyed) wounds Beregond
    // (prowess 4, roll 2 → 4+2=6 < 7 → wound). Aragorn bears Despair and must
    // make a corruption check.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BEREGOND] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_LIEUTENANT], siteDeck: [RIVENDELL] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART, HAZARD_PLAYER);
    const ready = { ...withCard, phaseState: makeWildernessMHState() };

    const orcId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, orcId, companyId, WILDERNESS_KEYING);

    // Beregond defends — roll 2 → 4+2=6 < 7 → wound; body 8, roll 2 → 2 ≤ 8 → survives wounded
    const afterCombat = runCreatureCombat(afterChain, BEREGOND, 2, 2);

    const aragornId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, ARAGORN);
    const pending = afterCombat.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);
  });

  test('bearer still gets a corruption check when the wounded company member is eliminated by the body check', () => {
    // CRF 22: "The corruption check occurs before the body check." The wound
    // triggers Despair regardless of whether the wounded character survives the
    // body check that follows it.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BEREGOND] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_LIEUTENANT], siteDeck: [RIVENDELL] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART, HAZARD_PLAYER);
    const ready = { ...withCard, phaseState: makeWildernessMHState() };

    const orcId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, orcId, companyId, WILDERNESS_KEYING);

    // Beregond defends — roll 2 → 4+2=6 < 7 → wound; body 8, roll 12 → 12 > 8 → eliminated
    const afterCombat = runCreatureCombat(afterChain, BEREGOND, 2, 12);

    // Beregond is gone, but Aragorn still owes the corruption check for the wound.
    const company = afterCombat.players[RESOURCE_PLAYER].companies[0];
    expect(company.characters).toHaveLength(1);

    const aragornId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, ARAGORN);
    const pending = afterCombat.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);
  });

  test('no corruption check fires when no company member is wounded (strike succeeded)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN, BEREGOND] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [ORC_LIEUTENANT], siteDeck: [RIVENDELL] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART, HAZARD_PLAYER);
    const ready = { ...withCard, phaseState: makeWildernessMHState() };

    const orcId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, orcId, companyId, WILDERNESS_KEYING);

    // Beregond defends — roll 12 → 4+12=16 > 7 → success, no wound
    const afterCombat = runCreatureCombat(afterChain, BEREGOND, 12, null);

    const pending = afterCombat.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  // ── grant-action: remove-self-on-roll (threshold 5, i.e. roll > 4) ─────────

  test('bearer may tap during Organization to attempt removal (threshold 5)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART);
    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);

    const grants = grantedActionsFor(withCard, aragornId, 'remove-self-on-roll', PLAYER_1);
    expect(grants.length).toBeGreaterThan(0);
    expect(grants[0].rollThreshold).toBe(5);
  });

  test.each([
    { label: 'roll 5 (> 4) discards the card', roll: 5, expectedHazards: 0 },
    { label: 'roll 4 (<= 4) keeps the card attached', roll: 4, expectedHazards: 1 },
  ])('$label', ({ roll, expectedHazards }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, DESPAIR_OF_THE_HEART);
    const cheated = { ...withCard, cheatRollTotal: roll };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const next = dispatch(cheated, actions[0].action);

    expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)).toHaveLength(expectedHazards);
  });
});
