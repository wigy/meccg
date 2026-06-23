/**
 * @module le-192.test
 *
 * Card test: Hide in Dark Places (le-192)
 * Type: minion-resource-event (short, scout-only)
 * Effects: 4
 *   - play-window organization / end-of-org
 *   - play-target character (DSL filter: scout + company.moving === false)
 *   - on-event self-enters-play → add-constraint no-creature-hazards-on-company (scope turn)
 *   - on-event self-enters-play → add-constraint company-cannot-move (scope turn)
 *
 * "Scout only. Playable during the organization phase on a scout whose company
 *  is not moving. All hazard creature attacks against the scout's company this
 *  turn are canceled."
 *
 * The card is the minion analog of Stealth (tw-332). Two card-specific points
 * are exercised here beyond the shared no-creature-hazards-on-company machinery:
 *
 *  1. The "company is not moving" gate is read during the organization phase
 *     from the company's planned destination (`company.moving` is `true` once
 *     `plan-movement` has set a destinationSite). A scout whose company has
 *     already declared movement is not a legal target.
 *  2. Playing the card locks its company stationary for the turn via a
 *     `company-cannot-move` constraint, so the hazard-creature immunity cannot
 *     be carried onto a company that subsequently moves (the printed precondition
 *     "not moving" would otherwise be a play-time snapshot that the reversible
 *     org-phase movement planning could defeat).
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                       |
 * |---|-----------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Target = scout (DSL filter)                   | IMPLEMENTED | play-target filter via condition-matcher    |
 * | 2 | "company not moving" gate (org phase)         | IMPLEMENTED | company.moving from destinationSite          |
 * | 3 | Play window = organization                    | IMPLEMENTED | offered during organization play-actions    |
 * | 4 | Adds no-creature-hazards-on-company           | IMPLEMENTED | on-event self-enters-play apply             |
 * | 5 | Adds company-cannot-move                      | IMPLEMENTED | on-event self-enters-play apply             |
 * | 6 | Constraint blocks opponent creature plays     | IMPLEMENTED | constraint filter (cross-player)            |
 * | 7 | company-cannot-move blocks movement           | IMPLEMENTED | planMovementActions + handlePlanMovement    |
 * | 8 | Both constraints clear at turn-end            | IMPLEMENTED | sweepExpired turn-end                       |
 *
 * Certified: 2026-06-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  PLAYER_1, PLAYER_2,
  ARAGORN, CAVE_DRAKE,
  RIVENDELL, MORIA,
  reduce,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayHazardAction, CardDefinitionId } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import { sweepExpired } from '../../engine/pending.js';

const HIDE_IN_DARK_PLACES = 'le-192' as CardDefinitionId;
const LUITPRAND = 'le-23' as CardDefinitionId;       // minion scout
const SHAGRAT = 'le-39' as CardDefinitionId;         // minion non-scout (warrior/ranger)
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;     // minion non-scout (warrior)
const CARN_DUM = 'le-359' as CardDefinitionId;       // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven
const ZARAK_DUM = 'le-417' as CardDefinitionId;      // minion ruins-and-lairs (nearestHaven Carn Dûm)
const BANDIT_LAIR_LE = 'le-351' as CardDefinitionId; // minion ruins-and-lairs (nearestHaven Dol Guldur)

describe('Hide in Dark Places (le-192)', () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on a scout whose company is not moving', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LUITPRAND] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string; targetScoutInstanceId?: string });
    const hide = playActions.find(a => a.cardInstanceId === cardInstance);
    expect(hide).toBeDefined();
    // The emitted action carries the chosen scout so the constraint can resolve
    // the scout's company.
    expect(hide?.targetScoutInstanceId).toBe(scoutInstance);
  });

  test('not playable on a scout whose company has already declared movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LUITPRAND] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    // Sanity: playable before movement is declared.
    expect(
      viableActions(base, PLAYER_1, 'play-short-event')
        .map(ea => ea.action as { cardInstanceId: string })
        .some(a => a.cardInstanceId === cardInstance),
    ).toBe(true);

    // Declare movement for the company (Carn Dûm → Zarak Dûm via starter movement).
    const move = viableActions(base, PLAYER_1, 'plan-movement')[0];
    expect(move).toBeDefined();
    const afterMove = dispatch(base, move.action);

    // Now the company is "moving" — Hide in Dark Places is no longer a legal play.
    const playActions = viableActions(afterMove, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('not playable when the company has no scout', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [ORC_CAPTAIN] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.some(a => a.cardInstanceId === cardInstance)).toBe(false);
  });

  test('playing the card adds both no-creature-hazards-on-company and company-cannot-move constraints to the scout company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LUITPRAND] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    expect(afterPlay.activeConstraints).toHaveLength(2);
    const kinds = afterPlay.activeConstraints.map(c => c.kind.type).sort();
    expect(kinds).toEqual(['company-cannot-move', 'no-creature-hazards-on-company']);
    for (const c of afterPlay.activeConstraints) {
      expect(c.scope.kind).toBe('turn');
      expect(c.target).toEqual({ kind: 'company', companyId });
    }
  });

  test('company-cannot-move blocks the protected company from declaring movement while another company can still move', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: CARN_DUM, characters: [LUITPRAND] },   // plays Hide in Dark Places
            { site: DOL_GULDUR, characters: [SHAGRAT] },    // unrelated company, can still move
          ],
          hand: [HIDE_IN_DARK_PLACES],
          siteDeck: [ZARAK_DUM, BANDIT_LAIR_LE],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER, 0);
    const protectedCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    // Sanity: before playing, the protected company can declare movement.
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
    // The protected company is locked stationary; the other company may still move.
    expect(movements.some(a => a.companyId === protectedCompanyId)).toBe(false);
    expect(movements.some(a => a.companyId === otherCompanyId)).toBe(true);

    // The reducer also rejects a directly-submitted plan-movement for the
    // locked company.
    const dest = afterPlay.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === ZARAK_DUM)!;
    const rejected = reduce(afterPlay, {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: protectedCompanyId,
      destinationSite: dest.instanceId,
    });
    expect(rejected.error).toBeDefined();
  });

  test('no-creature-hazards-on-company blocks opponent creature plays against the protected company', () => {
    // Built in the organization phase (where Hide in Dark Places is played);
    // the play-hazards window is then exercised by swapping in an M/H phase
    // state for the now-stationary company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: ZARAK_DUM, characters: [LUITPRAND] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [BANDIT_LAIR_LE] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER);
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);

    // Stationary company at a Ruins & Lairs site — Cave-drake keys to
    // ruins-and-lairs, so it is a viable hazard against the company.
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Zarak Dûm',
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    // Sanity: without the constraint the cave-drake may be played on the company.
    const before = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(before.length).toBeGreaterThan(0);

    // Play Hide in Dark Places (in the organization phase) to install the
    // constraint, then re-evaluate the same play-hazards window.
    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });
    const protectedAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const after = viableActions(protectedAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(after.length).toBe(0);
  });

  test('the constraint scoped to the protected company does not block creatures against another company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: ZARAK_DUM, characters: [LUITPRAND] },
            { site: BANDIT_LAIR_LE, characters: [SHAGRAT] },
          ],
          hand: [HIDE_IN_DARK_PLACES],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [CAVE_DRAKE], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });

    // The second company (index 1) is active in M/H and unprotected — Cave-drake
    // may still be played against it.
    const mhState = makeMHState({
      activeCompanyIndex: 1,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Bandit Lair',
    });
    const stateAtPlayHazards = { ...afterPlay, phaseState: mhState };

    const actions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === otherCompanyId);
    expect(actions.length).toBeGreaterThan(0);
  });

  test('both constraints clear at turn-end via sweepExpired', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [LUITPRAND] }], hand: [HIDE_IN_DARK_PLACES], siteDeck: [ZARAK_DUM] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const cardInstance = handCardId(base, RESOURCE_PLAYER);
    const scoutInstance = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetScoutInstanceId: scoutInstance,
    });
    expect(afterPlay.activeConstraints).toHaveLength(2);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
