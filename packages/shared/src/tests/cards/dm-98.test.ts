/**
 * @module dm-98.test
 *
 * Card test: The Way is Shut (dm-98)
 * Type: hazard-event (Long-event / Environment)
 * Unique: no
 *
 * Card text:
 *   "A company moving to or from an Under-deeps site must return to its site of
 *    origin. Additionally, cancels the effects of Secret Passage and Secret
 *    Entrance. Cannot be duplicated."
 *
 * Effects (data):
 *   - force-return-to-origin, condition { underDeepsMove: true }
 *   - cancel-card-effects, cardNames ["Secret Passage", "Secret Entrance"]
 *   - duplication-limit, scope game, max 1
 *
 * Engine Support:
 * | # | Rule                                                       | Status      | Notes                                                                 |
 * |---|------------------------------------------------------------|-------------|-----------------------------------------------------------------------|
 * | 1 | Company moving to/from an Under-deeps site returns to origin | IMPLEMENTED | `underDeepsMove` context flag in findForcingEnvironment (rule 5.31)   |
 * | 2 | Cancels the effects of Secret Passage & Secret Entrance     | IMPLEMENTED | `cancel-card-effects` suppresses those cards' in-play constraints      |
 * | 3 | Cannot be duplicated                                        | IMPLEMENTED | duplication-limit scope game, max 1                                    |
 *
 * Playable: FULLY — CERTIFIED (2026-07-06).
 *
 * The Under-deeps return-to-origin rides the existing rule-5.31
 * force-return-to-origin enforcement (endCompanyMH / findForcingEnvironment);
 * the only new piece is the `underDeepsMove` condition, true when the moving
 * company's origin or destination site carries the `under-deeps` keyword. The
 * cancellation is the generic `cancel-card-effects` primitive: while The Way is
 * Shut is in play, any active constraint whose source card is named "Secret
 * Passage" or "Secret Entrance" is suppressed — Secret Entrance's
 * `no-creature-hazards-on-company` and Secret Passage's
 * `only-creatures-keyed-to-site` restrictions are lifted, while an unrelated
 * card sharing a constraint kind (Stealth) is untouched.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState,
  resetMint,
  dispatch,
  Phase,
  makeMHState,
  addCardInPlay,
  companyIdAt,
  viableActions,
  viableActionsForHandCard,
  mint,
  PLAYER_1,
  PLAYER_2,
  ARAGORN,
  LEGOLAS,
  CAVE_DRAKE,
  MORIA,
  MINAS_TIRITH,
  RIVENDELL,
  LORIEN,
  STEALTH,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';
import { findForcingEnvironment } from '../../engine/mh-hazard-play.js';
import { addConstraint } from '../../engine/pending.js';

const WAY_IS_SHUT = 'dm-98' as CardDefinitionId;
const SECRET_ENTRANCE = 'tw-324' as CardDefinitionId;
const SECRET_PASSAGE = 'tw-325' as CardDefinitionId;
const UNDER_GATES = 'dm-38' as CardDefinitionId; // The Under-gates (Under-deeps, adjacent to Moria)
const HUORN = 'tw-45' as CardDefinitionId; // hazard creature keyed to a single Wilderness (no site keying)

describe('The Way is Shut (dm-98)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: moving TO or FROM an Under-deeps site returns the company ────

  test('forces a company moving TO an Under-deeps site back to its origin', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [UNDER_GATES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // The company has declared movement into the Under-deeps site.
    const dest = { instanceId: mint(), definitionId: UNDER_GATES, status: CardStatus.Untapped };
    const movingCompany = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: dest,
    };
    const withDest = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [movingCompany] },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };
    const state = addCardInPlay(withDest, HAZARD_PLAYER, WAY_IS_SHUT);

    const forcing = findForcingEnvironment(
      state,
      state.players[RESOURCE_PLAYER].companies[0],
      makeMHState({ resolvedSitePath: [] }),
      state.players[RESOURCE_PLAYER],
    );
    expect(forcing?.definitionId).toBe(WAY_IS_SHUT);
  });

  test('forces a company moving FROM an Under-deeps site back to its origin', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: UNDER_GATES, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const dest = { instanceId: mint(), definitionId: MORIA, status: CardStatus.Untapped };
    const movingCompany = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: dest,
    };
    const withDest = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [movingCompany] },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };
    const state = addCardInPlay(withDest, HAZARD_PLAYER, WAY_IS_SHUT);

    const forcing = findForcingEnvironment(
      state,
      state.players[RESOURCE_PLAYER].companies[0],
      makeMHState({ resolvedSitePath: [] }),
      state.players[RESOURCE_PLAYER],
    );
    expect(forcing?.definitionId).toBe(WAY_IS_SHUT);
  });

  test('does NOT force a company whose movement never touches an Under-deeps site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const dest = { instanceId: mint(), definitionId: MINAS_TIRITH, status: CardStatus.Untapped };
    const movingCompany = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: dest,
    };
    const withDest = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], companies: [movingCompany] },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };
    const state = addCardInPlay(withDest, HAZARD_PLAYER, WAY_IS_SHUT);

    const forcing = findForcingEnvironment(
      state,
      state.players[RESOURCE_PLAYER].companies[0],
      makeMHState({ resolvedSitePath: [RegionType.Wilderness] }),
      state.players[RESOURCE_PLAYER],
    );
    expect(forcing).toBeNull();
  });

  test('full flow: a company moving into the Under-deeps stays at its site of origin', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [UNDER_GATES] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const company = base.players[RESOURCE_PLAYER].companies[0];
    const originInstanceId = company.currentSite!.instanceId;
    const dest = base.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === UNDER_GATES)!;

    const withMovement = {
      ...base,
      phaseState: makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [] }),
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[HAZARD_PLAYER],
      ] as unknown as typeof base.players,
    };
    const state = addCardInPlay(withMovement, HAZARD_PLAYER, WAY_IS_SHUT);

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    const resultCompany = after.players[RESOURCE_PLAYER].companies[0];
    expect(resultCompany.currentSite?.instanceId).toBe(originInstanceId);
    expect(resultCompany.currentSite?.definitionId).toBe(MORIA);
    expect(resultCompany.moved).toBe(false);
  });

  // ─── Rule 2: cancels the effects of Secret Passage and Secret Entrance ────

  test('cancels Secret Entrance: its no-creature-hazards restriction is lifted while in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });

    // Secret Entrance's restriction blocks the opponent's Cave-drake.
    const constrained = addConstraint({ ...base, phaseState: mhState }, {
      source: mint(),
      sourceDefinitionId: SECRET_ENTRANCE,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    const blocked = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(blocked.length).toBe(0);

    // With The Way is Shut in play, Secret Entrance's restriction is canceled.
    const withWayShut = addCardInPlay(constrained, HAZARD_PLAYER, WAY_IS_SHUT);
    const allowed = viableActions(withWayShut, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(allowed.length).toBeGreaterThan(0);
  });

  test('does NOT cancel Stealth — an unrelated card sharing the same constraint kind', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const constrained = addConstraint({ ...base, phaseState: mhState }, {
      source: mint(),
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    // The Way is Shut lists only Secret Passage / Secret Entrance — Stealth's
    // identical constraint is untouched, so Cave-drake remains blocked.
    const withWayShut = addCardInPlay(constrained, HAZARD_PLAYER, WAY_IS_SHUT);
    const stillBlocked = viableActions(withWayShut, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(stillBlocked.length).toBe(0);
  });

  test('cancels Secret Passage: its site-keyed-only restriction is lifted while in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [HUORN], siteDeck: [RIVENDELL] },
      ],
    });
    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    // Destination is a Free-hold (not the site Huorn keys to) reached through a
    // Wilderness, so Huorn keys via terrain but is NOT keyed to the site.
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Rivendell',
    });
    const stateAtHazards = { ...base, phaseState: mhState };

    // Sanity: Huorn is playable via region keying before any restriction.
    const before = viableActions(stateAtHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(before.length).toBeGreaterThan(0);

    // Secret Passage restricts the opponent to site-keyed creatures only —
    // Huorn (region-keyed) is dropped.
    const constrained = addConstraint(stateAtHazards, {
      source: mint(),
      sourceDefinitionId: SECRET_PASSAGE,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'only-creatures-keyed-to-site' },
    });
    const blocked = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(blocked.length).toBe(0);

    // With The Way is Shut in play, Secret Passage's restriction is canceled.
    const withWayShut = addCardInPlay(constrained, HAZARD_PLAYER, WAY_IS_SHUT);
    const allowed = viableActions(withWayShut, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(allowed.length).toBeGreaterThan(0);
  });

  // ─── Rule 3: cannot be duplicated ────────────────────────────────────────

  test('a second The Way is Shut cannot be played while one is in play', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WAY_IS_SHUT], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const base = { ...built, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };

    // Without a copy in play, The Way is Shut is playable.
    expect(viableActionsForHandCard(base, PLAYER_2, 'play-hazard', HAZARD_PLAYER, WAY_IS_SHUT).length).toBeGreaterThan(0);

    // A copy already in play blocks the second via the game-scope duplication
    // limit: the play-hazard for the in-hand copy is no longer offered.
    const withCopy = addCardInPlay(base, HAZARD_PLAYER, WAY_IS_SHUT);
    expect(viableActionsForHandCard(withCopy, PLAYER_2, 'play-hazard', HAZARD_PLAYER, WAY_IS_SHUT).length).toBe(0);
  });
});
