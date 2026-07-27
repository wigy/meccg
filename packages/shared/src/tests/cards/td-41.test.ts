/**
 * @module td-41.test
 *
 * Card test: Left Behind (td-41)
 * Type: hazard-event (short), neutral, non-unique.
 *
 * Text:
 *   "Playable on a non-Wizard character whose company is facing an attack of
 *    five strikes or more. Following the attack, character splits off into a
 *    different company with the same site path as the company in which he was.
 *    He faces a separate movement/hazard phase this turn with a hazard limit of
 *    one. He may rejoin his original company following all movement/hazard
 *    phases."
 *
 * Card shape:
 *   - effects[0]: play-target (character, non-wizard)
 *   - effects[1]: left-behind-split (minStrikes 5)
 *
 * Engine support:
 *   - `leftBehindActions` (legal-actions/combat.ts) offers the attacking
 *     (hazard) player one `play-hazard` per non-Wizard character in the
 *     defending company, during the attacker's resolve-strike Step-1 window,
 *     only while the attack has ≥ 5 strikes (`strikesTotal`/`strikesPerAttack`).
 *   - `handleLeftBehindPlay` (combat-hazard-play.ts) discards the card, counts
 *     it against the hazard limit, and schedules a `PostAttackEffect`
 *     (`leftBehindSplit`).
 *   - `applyLeftBehindSplit` (combat-finalize.ts) peels the character into a new
 *     `leftBehind` company sharing the same currentSite/destinationSite/movementPath
 *     ("same site path"); a lone character instead flags his own company for one
 *     extra phase (`leftBehindExtraPhasePending`).
 *   - `enterSetHazardLimitAndAutoAdvance` (mh-steps.ts) forces a `leftBehind`
 *     company's hazard-limit snapshot to 1.
 *   - `advanceAfterCompanyMH` re-runs the lone-character company once (its
 *     separate limit-1 phase); `enqueueLeftBehindRejoins`/`finalizeCompanyMH`
 *     offer the optional `left-behind-rejoin` at the M/H→Site transition, and
 *     `autoMergeNonHavenCompanies` skips `leftBehind` companies to preserve
 *     the optionality of the rejoin.
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Offered on non-Wizard chars vs an attack of ≥5 strikes            | IMPLEMENTED |
 * | 2 | NOT offered when the attack has fewer than 5 strikes              | IMPLEMENTED |
 * | 3 | NOT offered on a Wizard character                                 | IMPLEMENTED |
 * | 4 | NOT offered to the defending (resource) player                   | IMPLEMENTED |
 * | 5 | Playing schedules the post-attack split; card discarded          | IMPLEMENTED |
 * | 6 | Following the attack the char splits into a new company (path)   | IMPLEMENTED |
 * | 7 | The separate company's hazard limit is forced to one             | IMPLEMENTED |
 * | 8 | A lone character's company gets a separate extra M/H phase        | IMPLEMENTED |
 * | 9 | After all M/H phases the char may rejoin (merge) his company      | IMPLEMENTED |
 * | 10| Declining the rejoin keeps the company separate (flags cleared)  | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GANDALF,
  RIVENDELL, MORIA, LORIEN, MINAS_TIRITH,
  buildTestState, buildTwoCompaniesAt, makeMHState, resetMint,
  viableActions, dispatch, executeAction,
  findCharInstanceId, companyIdAt, handCardId,
} from '../test-helpers.js';
import { Phase, Alignment, Race } from '../../index.js';
import type {
  GameState, CombatState, CardDefinitionId, CardInstanceId,
  MovementHazardPhaseState, PlayHazardAction, PendingResolution,
} from '../../index.js';
import type { ResolutionId } from '../../types/pending.js';

const LEFT_BEHIND = 'td-41' as CardDefinitionId;

/**
 * Build a resolve-strike combat where PLAYER_1's company faces an attack from
 * PLAYER_2 (the hazard/attacking player), who holds Left Behind. The single
 * unresolved strike targets `struckDef` (default: the first company's first
 * character), leaving the rest of `strikesTotal` as (lost) excess strikes.
 */
function combatState(state: GameState, struckId: CardInstanceId, strikesTotal: number): CombatState {
  return {
    attackSource: { type: 'creature', instanceId: 'fake-orc-attacker' as CardInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal,
    strikeProwess: 4,
    creatureBody: null,
    creatureRace: Race.Orc,
    strikeAssignments: [{ characterId: struckId, excessStrikes: 0, resolved: false }],
    currentStrikeIndex: 0,
    phase: 'resolve-strike',
    assignmentPhase: 'done',
    bodyCheckTarget: null,
    detainment: false,
  };
}

describe('Left Behind (td-41)', () => {
  beforeEach(() => resetMint());

  test('offered on each non-Wizard character vs an attack of 5+ strikes', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 5) };

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    // One per non-Wizard company member (Aragorn + Legolas).
    expect(actions).toHaveLength(2);
    const targets = actions.map(a => (a.action as PlayHazardAction).targetCharacterId);
    expect(targets).toContain(findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN));
    expect(targets).toContain(findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS));
  });

  test('NOT offered when the attack has fewer than five strikes', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 4) };
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT offered on a Wizard character (Gandalf excluded)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 5) };

    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as PlayHazardAction).targetCharacterId).toBe(findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN));
  });

  test('NOT offered to the defending (resource) player', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [LEFT_BEHIND], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 5) };
    expect(viableActions(state, PLAYER_1, 'play-hazard')).toHaveLength(0);
  });

  test('playing schedules the post-attack split and discards the card', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 5) };
    const cardId = handCardId(state, HAZARD_PLAYER);

    const s = dispatch(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyIdAt(state, RESOURCE_PLAYER), targetCharacterId: legolasId });

    // A post-attack split is scheduled on Legolas.
    const scheduled = (s.combat!.postAttackEffects ?? []).find(e => e.leftBehindSplit && e.targetCharacterId === legolasId);
    expect(scheduled).toBeDefined();
    // The card is spent (out of hand, in the hazard player's discard).
    expect(s.players[HAZARD_PLAYER].hand.some(c => c.instanceId === cardId)).toBe(false);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === cardId)).toBe(true);
    // It counted against the hazard limit.
    expect((s.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(1);
  });

  test('following the attack the character splits into a new company with the same site path', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const struck = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS);
    const originCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const originCompany = base.players[RESOURCE_PLAYER].companies[0];
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, struck, 5) };
    const cardId = handCardId(state, HAZARD_PLAYER);

    let s = dispatch(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: originCompanyId, targetCharacterId: legolasId });
    // Attacker passes its Step-1 window if it is still open, then the strike resolves.
    if (viableActions(s, PLAYER_2, 'pass').length > 0) s = dispatch(s, { type: 'pass', player: PLAYER_2 });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 11);

    // Combat is over and Legolas has been peeled into a separate company.
    expect(s.combat ?? null).toBeNull();
    const companies = s.players[RESOURCE_PLAYER].companies;
    expect(companies).toHaveLength(2);

    const origin = companies.find(c => c.id === originCompanyId)!;
    const split = companies.find(c => c.id !== originCompanyId)!;
    expect(origin.characters).toContain(struck);
    expect(origin.characters).not.toContain(legolasId);
    expect(split.characters).toEqual([legolasId]);

    // The split company is flagged and shares the same site path.
    expect(split.leftBehind).toBe(true);
    expect(split.leftBehindOriginCompanyId).toBe(originCompanyId);
    expect(split.currentSite?.instanceId).toBe(originCompany.currentSite?.instanceId);
    expect(split.destinationSite?.instanceId).toBe(originCompany.destinationSite?.instanceId);
    // No instance lost: Legolas is still in play.
    expect(s.players[RESOURCE_PLAYER].characters[legolasId]).toBeDefined();
  });

  test('the separate company faces its own M/H phase with a hazard limit of one', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    // Control: a normal 2-character company snapshots a hazard limit of 2.
    const normal: GameState = { ...base, phaseState: makeMHState({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }) };
    let sn = dispatch(normal, { type: 'select-company', player: PLAYER_1, companyId });
    sn = dispatch(sn, { type: 'pass', player: PLAYER_1 });
    expect((sn.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(2);

    // Left-behind company: the same company, flagged, snapshots a limit of 1.
    const flagged: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: base.players[0].companies.map(c => ({ ...c, leftBehind: true })) },
        base.players[1],
      ] as GameState['players'],
      phaseState: makeMHState({ step: 'select-company', activeCompanyIndex: 0, handledCompanyIds: [] }),
    };
    let sf = dispatch(flagged, { type: 'select-company', player: PLAYER_1, companyId });
    sf = dispatch(sf, { type: 'pass', player: PLAYER_1 });
    expect((sf.phaseState as MovementHazardPhaseState).hazardLimitAtReveal).toBe(1);
  });

  test('a lone character\'s company is flagged for a separate extra M/H phase', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MORIA }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [LEFT_BEHIND], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const state: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }), combat: combatState(base, aragornId, 5) };
    const cardId = handCardId(state, HAZARD_PLAYER);

    let s = dispatch(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyId, targetCharacterId: aragornId });
    if (viableActions(s, PLAYER_2, 'pass').length > 0) s = dispatch(s, { type: 'pass', player: PLAYER_2 });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 11);

    // No new company (he was alone) — his own company is flagged for one extra phase.
    const companies = s.players[RESOURCE_PLAYER].companies;
    expect(companies).toHaveLength(1);
    expect(companies[0].characters).toEqual([aragornId]);
    expect(companies[0].leftBehind).toBe(true);
    expect(companies[0].leftBehindExtraPhasePending).toBe(true);
  });

  test('after all movement/hazard phases the character may rejoin his original company', () => {
    const built = buildTwoCompaniesAt(RIVENDELL, [ARAGORN], [LEGOLAS]);
    const aId = built.players[0].companies[0].id;
    const bId = built.players[0].companies[1].id;
    const aragornId = findCharInstanceId(built, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(built, RESOURCE_PLAYER, LEGOLAS);

    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, leftBehind: true, leftBehindOriginCompanyId: aId, siteCardOwned: false } : c),
        },
        built.players[1],
      ] as GameState['players'],
      pendingResolutions: [{
        id: 'rejoin-1' as ResolutionId,
        source: null,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: { type: 'left-behind-rejoin', companyId: bId, originCompanyId: aId },
      } as PendingResolution],
    };

    // Both the rejoin and a decline (pass) are offered.
    expect(viableActions(state, PLAYER_1, 'left-behind-rejoin')).toHaveLength(1);
    expect(viableActions(state, PLAYER_1, 'pass')).toHaveLength(1);

    const s = dispatch(state, { type: 'left-behind-rejoin', player: PLAYER_1, companyId: bId });
    // The two companies are merged back into one.
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(1);
    const merged = s.players[RESOURCE_PLAYER].companies[0];
    expect(merged.id).toBe(aId);
    expect(merged.characters).toContain(aragornId);
    expect(merged.characters).toContain(legolasId);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('declining the rejoin keeps the company separate and clears its flags', () => {
    const built = buildTwoCompaniesAt(RIVENDELL, [ARAGORN], [LEGOLAS]);
    const aId = built.players[0].companies[0].id;
    const bId = built.players[0].companies[1].id;
    const legolasId = findCharInstanceId(built, RESOURCE_PLAYER, LEGOLAS);

    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, leftBehind: true, leftBehindOriginCompanyId: aId, siteCardOwned: false } : c),
        },
        built.players[1],
      ] as GameState['players'],
      pendingResolutions: [{
        id: 'rejoin-2' as ResolutionId,
        source: null,
        actor: PLAYER_1,
        scope: { kind: 'phase', phase: Phase.Site },
        kind: { type: 'left-behind-rejoin', companyId: bId, originCompanyId: aId },
      } as PendingResolution],
    };

    const s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // Company stays separate; its left-behind flags are cleared.
    expect(s.players[RESOURCE_PLAYER].companies).toHaveLength(2);
    const separate = s.players[RESOURCE_PLAYER].companies.find(c => c.id === bId)!;
    expect(separate.characters).toEqual([legolasId]);
    expect(separate.leftBehind).toBeUndefined();
    expect(separate.leftBehindOriginCompanyId).toBeUndefined();
    expect(s.pendingResolutions).toHaveLength(0);
  });
});
