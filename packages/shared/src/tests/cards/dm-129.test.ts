/**
 * @module dm-129.test
 *
 * Card test: Fifteen Birds in Five Firtrees (dm-129)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one non-unique hazard-creature attack (a
 *      played creature, an on-guard reveal, or a played-auto-attack), gated
 *      on Gates of Morning being in play. No skill/tap cost required.
 *   2. duplication-limit (scope turn, max 1) — "Cannot be duplicated on a
 *      given turn."
 *
 * "Playable on a moving company facing a non-unique hazard creature if
 * Gates of Morning is in play. All attacks of the creature are cancelled
 * and all attacks of the next non-unique hazard creature the company faces
 * this turn are also canceled. An untapped character in the company must
 * tap to face any strike from a subsequent hazard creature attack for the
 * rest of the turn. The company can do nothing during its site phase
 * unless it contains a Wizard or you discard Eagle-mounts from your hand.
 * Cannot be duplicated on a given turn."
 *
 * Engine support:
 * | # | Feature                                                        | Status        | Notes                                    |
 * |---|-----------------------------------------------------------------|---------------|-------------------------------------------|
 * | 1 | cancel-attack against a non-unique creature, gated on GoM       | IMPLEMENTED   | `enemy.unique` + `defender.inPlay`         |
 * | 2 | cancel-attack NOT offered against a unique creature              | IMPLEMENTED   | `enemy.unique` resolved from CardDefinition|
 * | 3 | Cannot be duplicated on a given turn                             | IMPLEMENTED   | duplication-limit scope "turn"             |
 * | 4 | Also cancels the next non-unique hazard creature attack this turn| NOT IMPLEMENTED | follow-up — no engine support for a deferred "next creature" cancel |
 * | 5 | Untapped character must tap to face a later strike               | NOT IMPLEMENTED | follow-up |
 * | 6 | Company can do nothing at its site unless Wizard/discard Eagle-mounts | NOT IMPLEMENTED | follow-up |
 *
 * Playable: YES (core cancel-attack clause only — see rows 4-6 above)
 *
 * Bug report: KakitaBen reported the card did nothing against Stirring
 * Bones (dm-111) while Gates of Morning was in play — the card previously
 * carried an empty `effects: []` array.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  addP1CardsInPlay,
  CardStatus,
  findHandCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  playCreatureHazardAndResolve,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardInPlay, CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const FIFTEEN_BIRDS = 'dm-129' as CardDefinitionId;
const STIRRING_BONES = 'dm-111' as CardDefinitionId; // Undead, non-unique, 2 strikes; keyed incl. 2x wilderness -> ruins-and-lairs
const TOM_TUMA = 'tw-103' as CardDefinitionId; // Unique creature keyed to 2x wilderness, no site-type restriction

/** Builds the base M/H state: P1's company facing P2's creature hand card. */
function baseState(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [FIFTEEN_BIRDS], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [RIVENDELL] },
    ],
  });
}

/** Plays the given hazard creature against P1's company, keyed by 2x wilderness. */
function faceCreature(state: GameState, creatureDefId: CardDefinitionId): GameState {
  const mhState = {
    phase: Phase.MovementHazard as const,
    step: 'play-hazards' as const,
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    movementType: null,
    declaredRegionPath: [],
    maxRegionDistance: 4,
    hazardsPlayedThisCompany: 0,
    hazardLimitAtReveal: 4,
    preRevealHazardLimitConstraintIds: [],
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hithaeglir', 'Rhûn'],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
    resourceDrawMax: 0,
    hazardDrawMax: 0,
    resourceDrawCount: 0,
    hazardDrawCount: 0,
    resourcePlayerPassed: false,
    hazardPlayerPassed: false,
    onGuardPlacedThisCompany: false,
    siteRevealed: false,
    returnedToOrigin: false,
    hazardsEncountered: [],
    ahuntAttacksResolved: 0,
    corruptionCardsPlayedPerChar: {},
    nazgulSideboardDestination: null,
    nazgulSideboardFetched: 0,
  };
  const stateAtMH = { ...state, phaseState: mhState };
  const creatureId = findHandCardId(stateAtMH, HAZARD_PLAYER, creatureDefId);
  const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(
    stateAtMH, PLAYER_2, creatureId, targetCompanyId,
    { method: 'region-type', value: 'wilderness' },
  );
}

const gomInPlay = (): CardInPlay => ({
  instanceId: 'gom-1' as CardInstanceId,
  definitionId: GATES_OF_MORNING,
  status: CardStatus.Untapped,
});

describe('Fifteen Birds in Five Firtrees (dm-129)', () => {
  beforeEach(() => resetMint());

  test('cancel-attack NOT available against non-unique creature without Gates of Morning', () => {
    const state = faceCreature(baseState([STIRRING_BONES]), STIRRING_BONES);
    expect(state.combat).toBeDefined();
    expect(state.combat!.creatureRace).toBe('undead');

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('cancel-attack available against non-unique creature attack (Stirring Bones) when Gates of Morning is in play', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    expect(state.combat).toBeDefined();

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  test('cancel-attack NOT available against a unique creature (Tom Tûma) even with Gates of Morning', () => {
    const withGoM = addP1CardsInPlay(baseState([TOM_TUMA]), [gomInPlay()]);
    const state = faceCreature(withGoM, TOM_TUMA);
    expect(state.combat).toBeDefined();

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });

  test('executing cancel-attack against Stirring Bones cancels combat, discards the card, and adds a turn-scoped duplication marker', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);

    const declared = dispatch(state, cancelActions[0].action);
    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
    expectInDiscardPile(after, RESOURCE_PLAYER, FIFTEEN_BIRDS);

    const marker = after.activeConstraints.find(
      c => c.sourceDefinitionId === FIFTEEN_BIRDS && c.scope.kind === 'turn',
    );
    expect(marker).toBeDefined();
  });

  test('cancel-attack NOT available once the turn-scoped duplication marker is present ("cannot be duplicated on a given turn")', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES]), [gomInPlay()]);
    let state = faceCreature(withGoM, STIRRING_BONES);
    state = addConstraint(state, {
      source: 'prior-fifteen-birds' as CardInstanceId,
      sourceDefinitionId: FIFTEEN_BIRDS,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: { type: 'attack-card-played' },
    });

    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(0);
  });
});
