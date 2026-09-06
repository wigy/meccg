/**
 * @module td-52.test
 *
 * Card test: Parsimony of Seclusion (td-52)
 * Type: hazard-event (short) — two mutually-exclusive untargeted modes
 *
 * Text: "Return any unique Dragon manifestation to your hand from your discard
 * pile. Alternatively, return any manifestation of Agburanar to your hand from
 * your discard pile and increase the hazard limit by two."
 *
 * Per glossary rule g.man.3, a Dragon's manifestations are its creature form,
 * its "Ahunt"/"At Home" permanent-events, and its "Roused" faction — not just
 * cards carrying the `dragon-manifestation` keyword.
 *
 * Card shape (effects):
 *   - play-option `return-dragon-manifestation` (untargeted, candidates
 *     `own-discard`): `move` select target, discard → hand, filtered to
 *     `{ race: dragon, unique: true }` OR `{ keywords: [dragon-manifestation] }`
 *     — covers every Dragon's creature form, Roused faction, and Ahunt/At Home
 *     events.
 *   - play-option `return-agburanar-and-boost-limit` (untargeted, candidates
 *     `own-discard`): a `sequence` of a `move` (discard → hand, filtered to
 *     `manifestId: "tw-3"`, Agburanar's own chain id) and an `add-constraint`
 *     (`hazard-limit-modifier`, value 2, scope `company-mh-phase`) against the
 *     hazarded company.
 *
 * Agburanar Roused (le-259) is tagged `manifestId: "tw-3"` alongside this
 * card's certification (previously missing, unlike its Scorba/Smaug Roused
 * siblings) so it is recognized as one of Agburanar's manifestations.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, RIVENDELL, LORIEN,
  buildTestState, resetMint, makeMHState,
  companyIdAt,
  mint, viableActions, dispatch, resolveChain, recomputeDerived,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, CardInstance, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';

const PARSIMONY_OF_SECLUSION = 'td-52' as CardDefinitionId;
const AGBURANAR = 'tw-3' as CardDefinitionId;               // hazard-creature, race dragon, unique, manifestId tw-3
const AGBURANAR_AHUNT = 'td-1' as CardDefinitionId;         // hazard-event, keywords: [dragon-manifestation], manifestId tw-3
const AGBURANAR_ROUSED = 'le-259' as CardDefinitionId;      // minion-resource-faction, race dragon, unique, manifestId tw-3
const SMAUG = 'tw-90' as CardDefinitionId;                  // hazard-creature, race dragon, unique, manifestId tw-90 (a different Dragon)
const CAVE_DRAKE = 'tw-020' as CardDefinitionId;            // hazard-creature, race dragon, non-unique — not a "unique Dragon manifestation"
const ORC_PATROL = 'tw-074' as CardDefinitionId;            // hazard-creature, race orc — not a Dragon at all

const MODE_ANY_DRAGON = 'return-dragon-manifestation';
const MODE_AGBURANAR = 'return-agburanar-and-boost-limit';

describe('Parsimony of Seclusion (td-52)', () => {
  beforeEach(() => resetMint());

  /**
   * PLAYER_1 (active/resource) is being hazarded; PLAYER_2 (hazard) holds
   * td-52. `hazardDiscard` seeds PLAYER_2's discard pile; the M/H play-hazards
   * step is processing PLAYER_1's company.
   */
  function baseState(hazardDiscard: CardDefinitionId[] = []): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [PARSIMONY_OF_SECLUSION],
          discardPile: hazardDiscard,
          siteDeck: [LORIEN],
        },
      ],
    });
    return recomputeDerived({ ...state, phaseState: makeMHState() });
  }

  /** The viable td-52 plays for a given mode. */
  function modePlays(state: GameState, optionId: string): PlayHazardAction[] {
    return viableActions(state, PLAYER_2, 'play-hazard')
      .map(a => a.action as PlayHazardAction)
      .filter(a => a.optionId === optionId);
  }

  // ── Mode 1: return any unique Dragon manifestation ──────────────────────────

  test('mode 1 is offered once per unique Dragon manifestation in the hazard player own discard pile', () => {
    const state = baseState([AGBURANAR, AGBURANAR_AHUNT, AGBURANAR_ROUSED, SMAUG, CAVE_DRAKE, ORC_PATROL]);
    const discard = state.players[HAZARD_PLAYER].discardPile;
    const plays = modePlays(state, MODE_ANY_DRAGON);

    const offered = new Set(plays.map(a => a.optionTargetInstanceId as string));
    for (const defId of [AGBURANAR, AGBURANAR_AHUNT, AGBURANAR_ROUSED, SMAUG]) {
      const inst = discard.find(c => c.definitionId === defId)!;
      expect(offered.has(inst.instanceId as string)).toBe(true);
    }
    // Non-unique Cave-drake and the Orc creature do not qualify.
    const caveDrake = discard.find(c => c.definitionId === CAVE_DRAKE)!;
    const orc = discard.find(c => c.definitionId === ORC_PATROL)!;
    expect(offered.has(caveDrake.instanceId as string)).toBe(false);
    expect(offered.has(orc.instanceId as string)).toBe(false);
    expect(plays).toHaveLength(4);
  });

  test('mode 1 does not reach into the opponent discard pile', () => {
    let state = baseState();
    const foreign: CardInstance = { instanceId: mint(), definitionId: AGBURANAR };
    state = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], discardPile: [foreign] },
        state.players[HAZARD_PLAYER],
      ] as unknown as GameState['players'],
    };
    expect(modePlays(state, MODE_ANY_DRAGON)).toHaveLength(0);
  });

  test('mode 1 brings the chosen manifestation from discard to the hazard player hand', () => {
    const state = baseState([AGBURANAR, ORC_PATROL]);
    const agburanar = state.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === AGBURANAR)!;
    const play = modePlays(state, MODE_ANY_DRAGON)
      .find(a => a.optionTargetInstanceId === agburanar.instanceId)!;

    const after = resolveChain(dispatch(state, play));
    const hazard = after.players[HAZARD_PLAYER];

    expect(after.chain).toBeNull();
    expect(hazard.hand.some(c => c.instanceId === agburanar.instanceId)).toBe(true);
    expect(hazard.discardPile.some(c => c.instanceId === agburanar.instanceId)).toBe(false);
    expect(hazard.discardPile.some(c => c.definitionId === ORC_PATROL)).toBe(true);
    expect(hazard.discardPile.some(c => c.definitionId === PARSIMONY_OF_SECLUSION)).toBe(true);
    // No hazard-limit change on this mode.
    expect(after.activeConstraints.filter(c => c.kind.type === 'hazard-limit-modifier')).toHaveLength(0);
  });

  test('mode 1 counts one against the hazard limit', () => {
    const state = baseState([AGBURANAR]);
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = dispatch(state, modePlays(state, MODE_ANY_DRAGON)[0]);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  // ── Mode 2: return a manifestation of Agburanar and boost the hazard limit ──

  test('mode 2 is offered only for manifestations of Agburanar, not other Dragons', () => {
    const state = baseState([AGBURANAR, AGBURANAR_AHUNT, AGBURANAR_ROUSED, SMAUG]);
    const discard = state.players[HAZARD_PLAYER].discardPile;
    const plays = modePlays(state, MODE_AGBURANAR);

    const offered = new Set(plays.map(a => a.optionTargetInstanceId as string));
    for (const defId of [AGBURANAR, AGBURANAR_AHUNT, AGBURANAR_ROUSED]) {
      const inst = discard.find(c => c.definitionId === defId)!;
      expect(offered.has(inst.instanceId as string)).toBe(true);
    }
    const smaug = discard.find(c => c.definitionId === SMAUG)!;
    expect(offered.has(smaug.instanceId as string)).toBe(false);
    expect(plays).toHaveLength(3);
  });

  test('mode 2 is not offered when the discard pile has no Agburanar manifestation', () => {
    const state = baseState([SMAUG, ORC_PATROL]);
    expect(modePlays(state, MODE_AGBURANAR)).toHaveLength(0);
  });

  test('mode 2 returns Agburanar Roused to hand and increases the hazard limit by two against the company', () => {
    const state = baseState([AGBURANAR_ROUSED]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const roused = state.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === AGBURANAR_ROUSED)!;
    const play = modePlays(state, MODE_AGBURANAR)[0];
    expect(play.optionTargetInstanceId).toBe(roused.instanceId);

    const after = resolveChain(dispatch(state, play));
    const hazard = after.players[HAZARD_PLAYER];

    expect(after.chain).toBeNull();
    expect(hazard.hand.some(c => c.instanceId === roused.instanceId)).toBe(true);
    expect(hazard.discardPile.some(c => c.instanceId === roused.instanceId)).toBe(false);
    expect(hazard.discardPile.some(c => c.definitionId === PARSIMONY_OF_SECLUSION)).toBe(true);

    const hazardLimitConstraints = after.activeConstraints.filter(c => c.kind.type === 'hazard-limit-modifier');
    expect(hazardLimitConstraints).toHaveLength(1);
    const constraint = hazardLimitConstraints[0];
    if (constraint.kind.type === 'hazard-limit-modifier') {
      expect(constraint.kind.value).toBe(2);
    }
    expect(constraint.target.kind).toBe('company');
    if (constraint.target.kind === 'company') {
      expect(constraint.target.companyId).toBe(companyId);
    }
    expect(constraint.scope.kind).toBe('company-mh-phase');
  });

  test('mode 2 counts one against the hazard limit', () => {
    const state = baseState([AGBURANAR]);
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = dispatch(state, modePlays(state, MODE_AGBURANAR)[0]);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  // ── Both modes together / no candidate at all ───────────────────────────────

  test('both modes are offered together when the discard pile has an Agburanar manifestation', () => {
    const state = baseState([AGBURANAR]);
    expect(modePlays(state, MODE_ANY_DRAGON)).toHaveLength(1);
    expect(modePlays(state, MODE_AGBURANAR)).toHaveLength(1);
  });

  test('only mode 1 is offered for a non-Agburanar Dragon manifestation', () => {
    const state = baseState([SMAUG]);
    expect(modePlays(state, MODE_ANY_DRAGON)).toHaveLength(1);
    expect(modePlays(state, MODE_AGBURANAR)).toHaveLength(0);
  });

  test('not playable at all when the discard pile has no Dragon manifestation', () => {
    const state = baseState([ORC_PATROL, CAVE_DRAKE]);
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });
});
