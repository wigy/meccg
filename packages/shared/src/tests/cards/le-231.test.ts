/**
 * @module le-231.test
 *
 * Card test: Sneakin' (le-231)
 * Type: minion-resource-event (short, scout-only)
 * Effects: 3
 *   1. play-window: organization (playable throughout the org phase; its
 *      hero twin Stealth tw-332 is tagged end-of-org but, per CoE 2.II.7,
 *      neither card locks the player out of further organization actions)
 *   2. play-target character, DSL filter (scout + untapped),
 *      maxCompanySize:2, cost { tap: character }
 *   3. on-event self-enters-play → add-constraint
 *      no-creature-hazards-on-company, scope:turn, target:scout-company
 *
 * Text:
 *   "Scout only. Playable during the organization phase on an untapped
 *    scout in a company with a company size less than 3. Tap the scout.
 *    No creature hazards may be played on his company this turn."
 *
 * Engine Support:
 * | # | Rule (card text sentence)                       | Status      | Mechanism                                   |
 * |---|-------------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Scout only / target an untapped scout           | IMPLEMENTED | play-target filter via condition-matcher    |
 * | 2 | Playable during the organization phase          | IMPLEMENTED | play-window phase:organization (no step)    |
 * | 3 | Company size less than 3                         | IMPLEMENTED | play-target maxCompanySize:2 (general path) |
 * | 4 | Tap the scout                                    | IMPLEMENTED | play-target cost { tap: character }         |
 * | 5 | No creature hazards on his company this turn     | IMPLEMENTED | on-event add-constraint (cross-player)      |
 * | 6 | "this turn" — constraint clears at turn-end      | IMPLEMENTED | scope:turn → sweepExpired turn-end          |
 *
 * Sneakin' is playable during the normal organization play-actions step
 * and does NOT lock the player out of further organization actions. Its
 * hero twin Stealth (tagged end-of-org) likewise no longer locks the
 * phase, per CoE 2.II.7.
 *
 * Playable: YES
 * Certified: 2026-06-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  makeMHState,
  viableActions, dispatch, getCharacter,
  handCardId, charIdAt, companyIdAt, findHandCardId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment, CardStatus, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, PlayShortEventAction, PlayHazardAction } from '../../index.js';
import { sweepExpired } from '../../engine/pending.js';

const SNEAKIN = 'le-231' as CardDefinitionId;
// Minion scouts.
const OSTISEN = 'le-36' as CardDefinitionId;   // scout, mind 2, man
const LUITPRAND = 'le-23' as CardDefinitionId; // scout, mind 1, man
// Minion non-scouts (to fill companies / negative cases).
const LAGDUF = 'le-18' as CardDefinitionId;    // warrior, mind 3, orc
const LAYOS = 'le-19' as CardDefinitionId;     // sage/diplomat, mind 5, man
// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // haven (site deck filler)
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs (non-haven)
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold (non-haven)

/** Build an organization-phase state with a Ringwraith active player. */
function orgState(p1Chars: CardDefinitionId[], hand: CardDefinitionId[] = [SNEAKIN], site = DOL_GULDUR) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: p1Chars }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [], siteDeck: [MINAS_MORGUL] },
    ],
  });
}

describe("Sneakin' (le-231)", () => {
  beforeEach(() => resetMint());

  test('playable during the organization phase on an untapped scout in a small company', () => {
    const base = orgState([OSTISEN]);
    const sneakinId = handCardId(base, RESOURCE_PLAYER);
    const ostisenId = charIdAt(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === sneakinId);

    // One play action targeting the untapped scout (tapper choice).
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(ostisenId);
  });

  test('not playable when the company size is 3 or more', () => {
    // Three full (non-hobbit) minion characters → company size 3, which is
    // not < 3, so Sneakin' must not be offered even though Ostisen is a scout.
    const base = orgState([OSTISEN, LAGDUF, LAYOS]);
    const sneakinId = handCardId(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === sneakinId);
    expect(plays).toHaveLength(0);
  });

  test('not playable when the company has no scout', () => {
    const base = orgState([LAGDUF, LAYOS]);
    const sneakinId = handCardId(base, RESOURCE_PLAYER);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === sneakinId);
    expect(plays).toHaveLength(0);
  });

  test('not playable on a tapped scout (untapped requirement)', () => {
    const base = orgState([OSTISEN]);
    // Tap the scout so the play-target untapped filter rejects it.
    const ostisenId = charIdAt(base, RESOURCE_PLAYER);
    const p0 = base.players[RESOURCE_PLAYER];
    const tapped = {
      ...base,
      players: [
        { ...p0, characters: { ...p0.characters, [ostisenId as string]: { ...p0.characters[ostisenId as string], status: CardStatus.Tapped } } },
        base.players[HAZARD_PLAYER],
      ] as const,
    };
    const sneakinId = handCardId(tapped, RESOURCE_PLAYER);

    const plays = viableActions(tapped, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === sneakinId);
    expect(plays).toHaveLength(0);
  });

  test('only the scout is a legal target when the company also holds a non-scout', () => {
    const base = orgState([OSTISEN, LAGDUF]); // size 2 — still < 3
    const sneakinId = handCardId(base, RESOURCE_PLAYER);
    const ostisenId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const plays = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === sneakinId);
    // Exactly one target: the scout (Lagduf is a warrior, not a scout).
    expect(plays).toHaveLength(1);
    expect(plays[0].targetScoutInstanceId).toBe(ostisenId);
  });

  test('playing it taps the scout, adds the no-creature-hazards constraint to its company, and stays in normal organization', () => {
    const base = orgState([OSTISEN], [SNEAKIN], ETTENMOORS);
    const sneakinId = handCardId(base, RESOURCE_PLAYER);
    const ostisenId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const next = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: sneakinId,
      targetScoutInstanceId: ostisenId,
    });

    // The scout is tapped as the cost.
    expect(getCharacter(next, RESOURCE_PLAYER, OSTISEN).status).toBe(CardStatus.Tapped);

    // The constraint is attached to the scout's company, turn-scoped.
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind.type).toBe('no-creature-hazards-on-company');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });

    // Sneakin' does NOT lock the org phase into an end-of-org sub-step —
    // the active player remains in normal organization (CoE 2.II.7).
    expect(next.phaseState.phase).toBe(Phase.Organization);
    expect((next.phaseState as { step?: string }).step).not.toBe('end-of-org');
  });

  test("the resulting constraint blocks the opponent's creature hazards against the protected company", () => {
    // Play Sneakin' on a minion company sitting at a non-haven site, then
    // carry the produced constraint into the opponent's hazard step and
    // verify no creature may be played against the protected company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: ETTENMOORS, characters: [OSTISEN] },   // protected
            { site: BARAD_DUR, characters: [LUITPRAND] },   // not protected
          ],
          hand: [SNEAKIN],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: [LAGDUF] }], hand: [CAVE_DRAKE], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const sneakinId = findHandCardId(base, RESOURCE_PLAYER, SNEAKIN);
    const ostisenId = charIdAt(base, RESOURCE_PLAYER, 0, 0);
    const protectedCompanyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: sneakinId,
      targetScoutInstanceId: ostisenId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    // Move the protected company through a Wilderness path to Ettenmoors in
    // the hazard player's play-hazards step; the constraint (top-level) is
    // preserved across the phaseState swap.
    const protectedMH = {
      ...afterPlay,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Ettenmoors',
      }),
    };
    const protectedPlays = viableActions(protectedMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === protectedCompanyId);
    expect(protectedPlays).toHaveLength(0);

    // The second, unprotected company can still be attacked by the creature.
    const otherMH = {
      ...afterPlay,
      phaseState: makeMHState({
        activeCompanyIndex: 1,
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Hithaeglir'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Barad-dûr',
      }),
    };
    const otherPlays = viableActions(otherMH, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === otherCompanyId);
    expect(otherPlays.length).toBeGreaterThan(0);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = orgState([OSTISEN], [SNEAKIN], ETTENMOORS);
    const sneakinId = handCardId(base, RESOURCE_PLAYER);
    const ostisenId = charIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: sneakinId,
      targetScoutInstanceId: ostisenId,
    });
    expect(afterPlay.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(afterPlay, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
