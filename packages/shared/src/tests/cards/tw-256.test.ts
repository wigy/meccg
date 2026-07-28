/**
 * @module tw-256.test
 *
 * Card test: Hiding (tw-256)
 * Type: hero-resource-event (short, scout-only)
 * Effects: 4
 *   - play-window organization / end-of-org
 *   - play-target character (DSL filter: scout), requiredSkill scout
 *   - on-event self-enters-play → add-constraint company-cannot-move (scope turn)
 *   - on-event self-enters-play → add-constraint no-creature-hazards-on-company (scope turn)
 *
 * "Scout only. Playable at the end of the organization phase. Scout's company
 *  may not move to another site this turn. Cancels all hazard creature attacks
 *  against the scout's company this turn."
 *
 * Hiding is the hero counterpart of Hide in Dark Places (le-192), with one
 * material difference: le-192 may only be played on a company that is *not*
 * moving, whereas Hiding carries no such precondition — instead its own text
 * grounds the company ("may not move to another site this turn"). Because
 * end-of-org cards are played alongside the rest of the organization phase's
 * actions, the targeted company may already have declared a destination when
 * Hiding resolves; installing the `company-cannot-move` constraint therefore
 * also strips that declaration and returns the site card to the location deck
 * (the same treatment Siege tw-87 gives a failed movement roll).
 *
 * The attack-cancellation clause reuses the `no-creature-hazards-on-company`
 * constraint (Stealth tw-332 / le-192): the opponent's hazard-creature plays
 * against the protected company are removed from the legal-action menu for the
 * rest of the turn.
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | "Scout only" (DSL filter on target.skills)     | IMPLEMENTED | play-target filter via condition-matcher     |
 * | 2 | Play window = end of organization phase        | IMPLEMENTED | play-window organization/end-of-org          |
 * | 3 | Adds company-cannot-move                       | IMPLEMENTED | on-event self-enters-play apply              |
 * | 4 | Declared destination dropped on install        | IMPLEMENTED | clearPlannedMovement in reducer-events.ts    |
 * | 5 | company-cannot-move blocks movement            | IMPLEMENTED | planMovementActions + handlePlanMovement     |
 * | 6 | Adds no-creature-hazards-on-company            | IMPLEMENTED | on-event self-enters-play apply              |
 * | 7 | Constraint blocks opponent creature plays      | IMPLEMENTED | constraint filter (cross-player)             |
 * | 8 | Both constraints clear at turn-end             | IMPLEMENTED | sweepExpired turn-end                        |
 *
 * Playable: YES
 * Certified: 2026-07-28
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, THEODEN, CAVE_DRAKE,
  RIVENDELL, MORIA, BREE,
  reduce,
  makeMHState,
  findHandCardId, findCharInstanceId, companyIdAt, charIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, OLD_FOREST, ETTENMOORS_HERO, BARROW_DOWNS } from '../../index.js';
import type { PlayHazardAction, CardDefinitionId } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import { sweepExpired } from '../../engine/pending.js';

const HIDING = 'tw-256' as CardDefinitionId;

describe('Hiding (tw-256)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on a scout, carrying the chosen scout as the target', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [ETTENMOORS_HERO] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const play = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string })
      .find(a => a.cardInstanceId === cardInstance);
    expect(play).toBeDefined();
    expect(play?.targetScoutInstanceId).toBe(scoutInstance);
  });

  test('"Scout only" — not playable when the company has no scout', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THEODEN] }], hand: [HIDING], siteDeck: [ETTENMOORS_HERO] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);

    expect(
      viableActions(base, PLAYER_1, 'play-short-event')
        .map(ea => ea.action as { cardInstanceId: string })
        .some(a => a.cardInstanceId === cardInstance),
    ).toBe(false);
  });

  test('"Playable at the end of the organization phase" — not offered during the long-event phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [ETTENMOORS_HERO] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);

    const entries = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.action.type === 'play-short-event'
        && (ea.action as { cardInstanceId: string }).cardInstanceId === cardInstance);
    // The play-window keeps the card out of the long-event menu entirely.
    expect(entries).toHaveLength(0);
  });

  test('playing the card installs both turn-scoped constraints on the scout’s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [ETTENMOORS_HERO] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    expect(afterPlay.activeConstraints).toHaveLength(2);
    expect(afterPlay.activeConstraints.map(c => c.kind.type).sort())
      .toEqual(['company-cannot-move', 'no-creature-hazards-on-company']);
    for (const c of afterPlay.activeConstraints) {
      expect(c.scope.kind).toBe('turn');
      expect(c.target).toEqual({ kind: 'company', companyId });
    }
  });

  test('"may not move to another site" — a destination declared earlier in the phase is dropped and its site card returned to the location deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [BREE] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    // Declare movement first (Rivendell → Bree, starter movement).
    const move = viableActions(base, PLAYER_1, 'plan-movement')[0];
    expect(move).toBeDefined();
    const moving = dispatch(base, move.action);
    expect(moving.players[RESOURCE_PLAYER].companies[0].destinationSite).not.toBeNull();
    expect(moving.players[RESOURCE_PLAYER].siteDeck.some(c => c.definitionId === BREE)).toBe(false);

    // Unlike le-192, Hiding may still be played on a moving company...
    const play = viableActions(moving, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string })
      .find(a => a.cardInstanceId === cardInstance);
    expect(play).toBeDefined();

    const afterPlay = dispatch(moving, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    // ...and grounds it: the declared destination is cancelled and the site
    // card goes back to the location deck.
    const company = afterPlay.players[RESOURCE_PLAYER].companies[0];
    expect(company.destinationSite).toBeNull();
    expect(company.movementPath).toEqual([]);
    expect(afterPlay.players[RESOURCE_PLAYER].siteDeck.some(c => c.definitionId === BREE)).toBe(true);
  });

  test('"may not move to another site" — the protected company cannot declare movement afterwards while a sibling company still can', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },  // plays Hiding
            { site: RIVENDELL, characters: [THEODEN] },  // unrelated company
          ],
          hand: [HIDING],
          siteDeck: [BREE, OLD_FOREST],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER, 0);
    const protectedCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    // Sanity: before playing, the scout's company may declare movement.
    expect(
      viableActions(base, PLAYER_1, 'plan-movement')
        .map(ea => ea.action as { companyId: string })
        .some(a => a.companyId === protectedCompanyId),
    ).toBe(true);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    const movements = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as { companyId: string });
    expect(movements.some(a => a.companyId === protectedCompanyId)).toBe(false);
    expect(movements.some(a => a.companyId === otherCompanyId)).toBe(true);

    // A directly-submitted plan-movement for the grounded company is rejected.
    const dest = afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === BREE)!;
    const rejected = reduce(afterPlay, {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: protectedCompanyId,
      destinationSite: dest.instanceId,
    });
    expect(rejected.error).toBeDefined();
  });

  test('"cancels all hazard creature attacks" — opponent creature plays against the protected company are removed', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS_HERO, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [BARROW_DOWNS] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);

    // Stationary company at a Ruins & Lairs site — Cave-drake keys to
    // ruins-and-lairs, so it is otherwise a legal hazard against it.
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Ettenmoors',
    });

    // Sanity: without the constraint the Cave-drake may be played.
    const before = viableActions({ ...base, phaseState: mhState }, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(before.length).toBeGreaterThan(0);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    const after = viableActions({ ...afterPlay, phaseState: mhState }, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(after.length).toBe(0);
  });

  test('the immunity is scoped to the scout’s company — another company still faces creatures', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: ETTENMOORS_HERO, characters: [ARAGORN] },
            { site: BARROW_DOWNS, characters: [THEODEN] },
          ],
          hand: [HIDING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    const mhState = makeMHState({
      activeCompanyIndex: 1,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Barrow-downs',
    });

    const actions = viableActions({ ...afterPlay, phaseState: mhState }, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === otherCompanyId);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('"this turn" — both constraints clear at turn-end', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [HIDING], siteDeck: [ETTENMOORS_HERO] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [THEODEN] }], hand: [], siteDeck: [BARROW_DOWNS] },
      ],
    });
    const cardInstance = findHandCardId(base, RESOURCE_PLAYER, HIDING);
    const scoutInstance = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });
    expect(afterPlay.activeConstraints).toHaveLength(2);

    expect(sweepExpired(afterPlay, { kind: 'turn-end' }).activeConstraints).toHaveLength(0);
  });
});
