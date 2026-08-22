/**
 * @module tw-324.test
 *
 * Card test: Secret Entrance (tw-324)
 * Type: hero-resource-event (short, sage-only)
 * Effects: 3
 *   1. play-window: organization / end-of-org
 *   2. play-target character, DSL filter { sage skill, untapped,
 *      company.destinationSiteRegionType != dark }, cost { tap: character },
 *      requiredSkill sage
 *   3. on-event self-enters-play → add-constraint no-creatures-keyed-to-site
 *      (no unlessSiteRegionType), scope:turn, target:target-company
 *
 * Text:
 *   "Sage only. Playable only at the end of the organization phase; may not
 *    be played on a company moving to a site in a Dark-domain [{d}]. Tap a
 *    sage in the company, and no hazard creatures keyed to the site may be
 *    played on the company."
 *
 * This is the hero counterpart of Crack in the Wall (le-177), but narrower in
 * one direction (no Free-domain exemption — the "keyed to the site"
 * restriction always applies once the card is played) and broader in another
 * (an outright play-restriction against Dark-domain destinations that le-177
 * has no equivalent of). `company.destinationSiteRegionType` is a new
 * play-target filter context field: the region type containing the target
 * company's *declared* destination site, resolved via the existing
 * `siteRegionTypeOf` off `destinationSite`'s definition — available during
 * the organization phase as soon as `plan-movement` sets a destination
 * (unlike the M/H-only, path-derived `destinationRegionTypes`).
 *
 * Engine Support:
 * | # | Rule (card text)                                        | Status      | Mechanism                                                     |
 * |---|----------------------------------------------------------|-------------|-----------------------------------------------------------------|
 * | 1 | Playable only at the end of the organization phase       | IMPLEMENTED | play-window phase:organization step:end-of-org                 |
 * | 2 | Sage only, tap a sage in the company                     | IMPLEMENTED | play-target filter sage/untapped, cost { tap: character }       |
 * | 3 | Not playable on a company moving to a Dark-domain site   | IMPLEMENTED | filter company.destinationSiteRegionType != dark                |
 * | 4 | No hazard creatures keyed to the site on the company     | IMPLEMENTED | no-creatures-keyed-to-site drops site-keyed plays                |
 * | 5 | (region-keyed creature plays are unaffected)             | IMPLEMENTED | keyedBy.method filter — region-type/name plays survive          |
 *
 * Playable: YES
 * Certified: 2026-08-15
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ELROND, LEGOLAS, CAVE_DRAKE,
  RIVENDELL, LORIEN, MINAS_TIRITH, MOUNT_DOOM,
  mint, makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction } from '../../index.js';
import { RegionType, SiteType, CardStatus } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const SECRET_ENTRANCE = 'tw-324' as CardDefinitionId;
// Destination site name below ("Barrow-downs", tw-375) is a hero Ruins &
// Lairs sitting in a Wilderness region (Cardolan), so Cave-drake's
// regionTypes {w}{w} AND siteTypes {R} keying can both match a two-wilderness
// path — mirrors the le-177 Ettenmoors precedent.
// Huorn (tw-45): region-keyed to a plain Wilderness among other entries, but
// not keyed to "Barrow-downs" specifically — the region-keyed control used by
// this file's "cancels Secret Entrance" test below.
const HUORN = 'tw-45' as CardDefinitionId;

describe('Secret Entrance (tw-324)', () => {
  beforeEach(() => resetMint());

  test('playable at end-of-org on the untapped sage of a company with no declared destination', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [SECRET_ENTRANCE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const sageId = charIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(sageId);
  });

  test('playable on a company moving to a non-Dark-domain destination', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ELROND], destinationSite: MINAS_TIRITH }], // Anórien: Free-domain
          hand: [SECRET_ENTRANCE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(1);
  });

  test('not playable on a company moving to a site in a Dark-domain', () => {
    // Mount Doom sits in Gorgoroth, a Dark-domain region.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ELROND], destinationSite: MOUNT_DOOM }],
          hand: [SECRET_ENTRANCE],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not playable when the sage is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [SECRET_ENTRANCE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const sageId = charIdAt(base, RESOURCE_PLAYER);
    const sage = base.players[0].characters[sageId];
    const tapped = {
      ...base,
      players: [
        { ...base.players[0], characters: { ...base.players[0].characters, [sageId]: { ...sage, status: CardStatus.Tapped } } },
        base.players[1],
      ] as typeof base.players,
    };

    const plays = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('not playable when the company has no sage', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [SECRET_ENTRANCE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it through the reducer taps the sage and adds no-creatures-keyed-to-site (turn scope)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [SECRET_ENTRANCE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const sageId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: sageId,
    });

    expect(next.players[0].characters[sageId].status).toBe(CardStatus.Tapped);
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'no-creatures-keyed-to-site' });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('site-keyed creature plays at the new site are blocked; region-keyed plays survive', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE, HUORN], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      resolvedSitePathNames: ['Cardolan', 'Cardolan'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Barrow-downs',
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };
    const drakeId = base.players[HAZARD_PLAYER].hand.find(c => c.definitionId === CAVE_DRAKE)!.instanceId;
    const huornId = base.players[HAZARD_PLAYER].hand.find(c => c.definitionId === HUORN)!.instanceId;

    // Baseline: Cave-drake is offered both site-keyed and region-keyed;
    // Huorn only region-keyed.
    const before = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const drakeMethodsBefore = new Set(before.filter(a => a.cardInstanceId === drakeId).map(a => a.keyedBy?.method));
    expect(drakeMethodsBefore.has('site-type')).toBe(true);
    expect(drakeMethodsBefore.has('region-type')).toBe(true);
    expect(before.some(a => a.cardInstanceId === huornId)).toBe(true);

    const constrained = addConstraint(stateAtPlayHazards, {
      source: mint(),
      sourceDefinitionId: SECRET_ENTRANCE,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId },
      kind: { type: 'no-creatures-keyed-to-site' },
    });
    const after = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === companyId);
    const drakeMethodsAfter = new Set(after.filter(a => a.cardInstanceId === drakeId).map(a => a.keyedBy?.method));
    expect(drakeMethodsAfter.has('site-type')).toBe(false);
    expect(drakeMethodsAfter.has('region-type')).toBe(true);
    expect(after.some(a => a.cardInstanceId === huornId)).toBe(true);
  });

  test('constraint clears at turn-end (scope: turn)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ELROND] }], hand: [SECRET_ENTRANCE], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const cardId = handCardId(base, RESOURCE_PLAYER);
    const sageId = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardId,
      targetScoutInstanceId: sageId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
