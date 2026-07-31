/**
 * @module dm-129.test
 *
 * Card test: Fifteen Birds in Five Firtrees (dm-129)
 * Type: hero-resource-event (short)
 * Effects:
 *   1. cancel-attack — cancel one non-unique hazard-creature attack (a
 *      played creature, an on-guard reveal, or a played-auto-attack), gated
 *      on Gates of Morning being in play. No skill/tap cost required.
 *      `alsoCancelLaterAttack` (+ `alsoCancelLaterAttackSameCompanyOnly`,
 *      `alsoCancelLaterAttackRequireNonUnique`) additionally installs a
 *      turn-scoped `free-attack-cancel` grant restricted to the same
 *      company and non-unique creatures. `installsTapOnStrikeAssignment`
 *      installs a turn-scoped `tap-on-strike-assignment` constraint on the
 *      company.
 *   2. company-site-phase-do-nothing — "the company can do nothing during
 *      its site phase", `unless: company.containsWizard`, with an `escape`
 *      grant to discard Eagle-mounts (tw-220) from hand instead.
 *   3. duplication-limit (scope turn, max 1) — "Cannot be duplicated on a
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
 * | 4 | Also cancels the next non-unique hazard creature attack this turn| IMPLEMENTED   | `free-attack-cancel` constraint, company + non-unique restricted |
 * | 5 | Untapped character must tap to face a later strike               | IMPLEMENTED   | `tap-on-strike-assignment` constraint, applied in `assign-strike` |
 * | 6 | Company can do nothing at its site unless Wizard/discard Eagle-mounts | IMPLEMENTED | `company-site-phase-do-nothing` with `unless`/`escape` |
 *
 * Playable: YES
 *
 * Certified: 2026-07-31
 *
 * Bug report: KakitaBen reported the card did nothing against Stirring
 * Bones (dm-111) while Gates of Morning was in play — the card previously
 * carried an empty `effects: []` array.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, SARUMAN,
  GATES_OF_MORNING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, ISENGARD,
  viableActions,
  addP1CardsInPlay,
  CardStatus,
  findHandCardId, findCharInstanceId, companyIdAt, dispatch, expectInDiscardPile,
  expectCharStatus,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER,
  playCreatureHazardAndResolve,
} from '../test-helpers.js';
import type { CancelAttackAction, ActivateGrantedAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardInPlay, CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const FIFTEEN_BIRDS = 'dm-129' as CardDefinitionId;
const STIRRING_BONES = 'dm-111' as CardDefinitionId; // Undead, non-unique, 2 strikes; keyed incl. 2x wilderness -> ruins-and-lairs
const TOM_TUMA = 'tw-103' as CardDefinitionId; // Unique creature keyed to 2x wilderness, no site-type restriction
const EAGLE_MOUNTS = 'tw-220' as CardDefinitionId;

/** Builds the base M/H state: P1's company facing P2's creature hand card. */
function baseState(hand: CardDefinitionId[], p1Hand: CardDefinitionId[] = [FIFTEEN_BIRDS]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: p1Hand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand, siteDeck: [RIVENDELL] },
    ],
  });
}

/** Same as {@link baseState}, but P1's company also contains Saruman (a Wizard avatar). */
function baseStateWithWizard(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, SARUMAN] }], hand: [FIFTEEN_BIRDS], siteDeck: [ISENGARD] },
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

describe('alsoCancelLaterAttack: also cancels the next non-unique hazard creature attack this turn', () => {
  beforeEach(() => resetMint());

  test('canceling the first attack installs a company-scoped, non-unique-only free-attack-cancel grant', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES, STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')[0].action;
    const after = resolveChain(dispatch(state, cancelAction));

    const grant = after.activeConstraints.find(c => c.kind.type === 'free-attack-cancel');
    expect(grant).toBeDefined();
    if (grant?.kind.type === 'free-attack-cancel') {
      expect(grant.kind.restrictToCompanyId).toBe(companyIdAt(after, RESOURCE_PLAYER));
      expect(grant.kind.requireNonUniqueCreature).toBe(true);
      expect(grant.kind.restrictToBalrogCompany).toBe(false);
    }
  });

  test('the free grant cancels a second non-unique creature attack against the same company at no further cost', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES, STIRRING_BONES]), [gomInPlay()]);
    const firstAttack = faceCreature(withGoM, STIRRING_BONES);
    const firstCancel = viableActions(firstAttack, PLAYER_1, 'cancel-attack')[0].action;
    const afterFirst = resolveChain(dispatch(firstAttack, firstCancel));
    expect(afterFirst.combat).toBeNull();

    const secondAttack = faceCreature(afterFirst, STIRRING_BONES);
    expect(secondAttack.combat).toBeDefined();

    const freeCancel = viableActions(secondAttack, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => a.mode === 'free-later-cancel');
    expect(freeCancel).toBeDefined();

    const afterSecond = resolveChain(dispatch(secondAttack, freeCancel!));
    expect(afterSecond.combat).toBeNull();
    // The one-shot grant is consumed — no free-attack-cancel constraint remains.
    expect(afterSecond.activeConstraints.some(c => c.kind.type === 'free-attack-cancel')).toBe(false);
  });

  test('the free grant is NOT offered against a unique creature (Tom Tûma)', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES, TOM_TUMA]), [gomInPlay()]);
    const firstAttack = faceCreature(withGoM, STIRRING_BONES);
    const firstCancel = viableActions(firstAttack, PLAYER_1, 'cancel-attack')[0].action;
    const afterFirst = resolveChain(dispatch(firstAttack, firstCancel));

    const secondAttack = faceCreature(afterFirst, TOM_TUMA);
    const freeCancel = viableActions(secondAttack, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => a.mode === 'free-later-cancel');
    expect(freeCancel).toBeUndefined();
  });
});

describe('installsTapOnStrikeAssignment: an untapped character must tap to face a later strike', () => {
  beforeEach(() => resetMint());

  test('after canceling an attack, a strike assigned in a later hazard-creature combat taps the untapped defender', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES, STIRRING_BONES]), [gomInPlay()]);
    const firstAttack = faceCreature(withGoM, STIRRING_BONES);
    const firstCancel = viableActions(firstAttack, PLAYER_1, 'cancel-attack')[0].action;
    const afterFirst = resolveChain(dispatch(firstAttack, firstCancel));

    const tapConstraint = afterFirst.activeConstraints.find(c => c.kind.type === 'tap-on-strike-assignment');
    expect(tapConstraint).toBeDefined();
    expect(tapConstraint?.target).toEqual({ kind: 'company', companyId: companyIdAt(afterFirst, RESOURCE_PLAYER) });
    expect(tapConstraint?.scope.kind).toBe('turn');

    expectCharStatus(afterFirst, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    const secondAttack = faceCreature(afterFirst, STIRRING_BONES);
    expect(secondAttack.combat?.phase).toBe('assign-strikes');
    const aragornId = findCharInstanceId(secondAttack, RESOURCE_PLAYER, ARAGORN);

    const assigned = dispatch(secondAttack, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expectCharStatus(assigned, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
  });

  test('without the constraint, assigning a strike does NOT tap the defender', () => {
    const state = faceCreature(baseState([STIRRING_BONES]), STIRRING_BONES);
    expect(state.combat?.phase).toBe('assign-strikes');
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    const assigned = dispatch(state, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    expectCharStatus(assigned, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });
});

describe('company-site-phase-do-nothing: unless it contains a Wizard, or you discard Eagle-mounts', () => {
  beforeEach(() => resetMint());

  test('canceling an attack installs site-phase-do-nothing + a discard-Eagle-mounts escape when the company has no Wizard', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')[0].action;
    const after = resolveChain(dispatch(state, cancelAction));

    const companyId = companyIdAt(after, RESOURCE_PLAYER);
    const sourced = after.activeConstraints.filter(c => c.sourceDefinitionId === FIFTEEN_BIRDS && c.scope.kind === 'company-site-phase');
    const kinds = sourced.map(c => c.kind.type).sort();
    expect(kinds).toEqual(['granted-action', 'site-phase-do-nothing']);
    for (const c of sourced) {
      expect(c.target).toEqual({ kind: 'company', companyId });
    }
    const grant = sourced.find(c => c.kind.type === 'granted-action');
    if (grant?.kind.type === 'granted-action') {
      expect(grant.kind.action).toBe('discard-eagle-mounts-for-site-phase');
      expect(grant.kind.cost).toEqual({ discard: 'named-card', discardCardName: 'Eagle-mounts' });
    }
  });

  test('with a Wizard (Saruman) in the company, no site-phase-do-nothing constraint is installed', () => {
    const withGoM = addP1CardsInPlay(baseStateWithWizard([STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')[0].action;
    const after = resolveChain(dispatch(state, cancelAction));

    const sourced = after.activeConstraints.filter(c => c.sourceDefinitionId === FIFTEEN_BIRDS && c.scope.kind === 'company-site-phase');
    expect(sourced).toHaveLength(0);
  });

  test('discarding Eagle-mounts from hand is offered and clears both constraints', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES], [FIFTEEN_BIRDS, EAGLE_MOUNTS]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')[0].action;
    const after = resolveChain(dispatch(state, cancelAction));

    const escapeActions = viableActions(after, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'discard-eagle-mounts-for-site-phase');
    expect(escapeActions).toHaveLength(1);

    const escaped = dispatch(after, escapeActions[0].action);
    expectInDiscardPile(escaped, RESOURCE_PLAYER, EAGLE_MOUNTS);
    const stillSourced = escaped.activeConstraints.filter(c => c.sourceDefinitionId === FIFTEEN_BIRDS && c.scope.kind === 'company-site-phase');
    expect(stillSourced).toHaveLength(0);
  });

  test('the discard-Eagle-mounts escape is NOT offered without Eagle-mounts in hand', () => {
    const withGoM = addP1CardsInPlay(baseState([STIRRING_BONES]), [gomInPlay()]);
    const state = faceCreature(withGoM, STIRRING_BONES);
    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')[0].action;
    const after = resolveChain(dispatch(state, cancelAction));

    const escapeActions = viableActions(after, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'discard-eagle-mounts-for-site-phase');
    expect(escapeActions).toHaveLength(0);
  });
});
