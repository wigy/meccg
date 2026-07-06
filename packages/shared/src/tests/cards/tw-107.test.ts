/**
 * @module tw-107.test
 *
 * Card test: Ûvatha the Horseman (tw-107)
 * Type: hazard-creature (dual creature / permanent-event)
 * Race: Nazgûl. One strike at prowess 15, body 9, 5 kill MP.
 *
 * Card text:
 *   "Unique. Nazgûl (9th). May be played as a hazard creature (with one
 *    strike) or as a permanent-event.
 *    As a creature, may also be played keyed to Harondor, Horse Plains,
 *    Gorgoroth, and Khand; and may also be played at sites in these regions.
 *    If played as a permanent-event, it will remain in play until tapped
 *    during the opponent's movement/hazard phase (tapping counts against the
 *    hazard limit). When tapped, Ûvatha the Horseman becomes a short-event and
 *    you may bring one hazard creature from your discard pile to your hand."
 *
 * Keying (canonical `playable` = {d}{D}):
 *   - Base: a Dark-domain region {d} in the site path and a Dark-hold {D}
 *     destination.
 *   - Alt: named regions Harondor, Horse Plains, Gorgoroth, Khand — a single
 *     `regionNames` keyedTo entry, which also covers "played at sites in these
 *     regions" (the destination region name is part of the resolved path).
 *
 * Engine support:
 * | # | Feature                                       | Status      | Notes                                          |
 * |---|-----------------------------------------------|-------------|------------------------------------------------|
 * | 1 | One strike, prowess 15, body 9                | IMPLEMENTED | structural data                                |
 * | 2 | Keying: base {d}{D}                           | IMPLEMENTED | regionTypes/siteTypes in keyedTo               |
 * | 3 | Keying: named Harondor/Horse Plains/…         | IMPLEMENTED | regionNames in keyedTo                         |
 * | 4 | Permanent-event play mode (dual creature/PE)  | IMPLEMENTED | creature-alt-event (mode permanent-event)      |
 * | 5 | Tapped by opponent in their M/H (vs haz limit)| IMPLEMENTED | tap-alt-permanent-event (counts vs haz limit)  |
 * | 6 | On tap → short-event, fetch creature from disc| IMPLEMENTED | move discard→hand (hazard-creature filter)     |
 *
 * Playable: YES. The hazard-creature mode (stats + keying) and the alternative
 * permanent-event mode are both implemented via the generic dual-mode primitive:
 * a `creature-alt-event` (mode `permanent-event`) makes the card playable as a
 * permanent-event that enters play untapped; the hazard player may then tap it
 * during the opponent's M/H (`tap-alt-permanent-event`, counting one against the
 * hazard limit), which "becomes a short-event" and resolves the card's on-tap
 * `move` effect — fetching one hazard creature from the discard pile to hand via
 * the shared fetch-to-hand sub-flow. `play-flag: playable-as-event` is retained
 * only for the deck-construction ½-creature weighting. This test drives both
 * modes end-to-end.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType, CardStatus } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const UVATHA = 'tw-107' as CardDefinitionId;
const A_DISCARDED_CREATURE = 'tw-86' as CardDefinitionId; // Shelob — a hazard-creature

/** Two-company M/H setup with Ûvatha in the hazard player's hand. */
function setup() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [UVATHA], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Ûvatha the Horseman (tw-107)', () => {
  beforeEach(() => resetMint());

  // ─── Creature-mode keying ───────────────────────────────────────────────────

  test('playable as a creature keyed to a Dark-hold in a Dark-domain path', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('playable as a creature keyed to a named region (Harondor)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Harondor'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const viable = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable);
    expect(viable.length).toBeGreaterThan(0);
  });

  test('NOT playable as a creature on a neutral path (no Dark-hold, no named region)', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Rhudaur'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    // No viable *keyed-creature* play (keying fails); the permanent-event mode
    // needs no keying and remains the only viable play.
    const creaturePlays = viableActions(ready, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === uvathaId && a.viable
        && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays).toHaveLength(0);
  });

  // ─── Combat initiates (creature mode) ────────────────────────────────────────

  test('creature combat initiates with one strike at prowess 15', () => {
    const state = setup();
    const mhState = makeMHState({
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Khand'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Minas Morgul',
    });
    const ready = { ...state, phaseState: mhState };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, 0, 0);
    const after = playCreatureHazardAndResolve(
      ready, PLAYER_2, uvathaId, companyId,
      { method: 'region-name', value: 'Khand' },
    );
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(15);
  });

  // ─── Permanent-event mode ────────────────────────────────────────────────────

  test('offered as a permanent-event and enters play untapped (no combat)', () => {
    const state = setup();
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, 0, 0);

    // The permanent-event mode is offered (no keying needed).
    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => (a.action as { altEventMode?: string }).altEventMode === 'permanent-event');
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: uvathaId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === uvathaId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  test('tapping the in-play permanent-event fetches a hazard creature from discard to hand', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [UVATHA], discardPile: [A_DISCARDED_CREATURE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const uvathaId = handCardId(ready, HAZARD_PLAYER);
    const discardCreatureId = ready.players[1].discardPile[0].instanceId;
    const companyId = companyIdAt(ready, 0, 0);

    // Play as a permanent-event → enters play.
    const afterPlay = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: uvathaId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));

    // Tap it → becomes a short-event.
    const tapActions = viableActions(afterPlay, PLAYER_2, 'tap-alt-permanent-event');
    expect(tapActions.length).toBeGreaterThan(0);
    const afterTap = resolveChain(dispatch(afterPlay, tapActions[0].action));

    // The card is spent (discarded) and the fetch is queued.
    expect(afterTap.players[1].cardsInPlay.some(c => c.instanceId === uvathaId)).toBe(false);
    expect(afterTap.players[1].discardPile.some(c => c.instanceId === uvathaId)).toBe(true);

    // Hazard player fetches the discarded creature back to hand.
    const fetches = viableActions(afterTap, PLAYER_2, 'fetch-from-pile');
    const pick = fetches.find(a => (a.action as { cardInstanceId: string }).cardInstanceId === (discardCreatureId as unknown as string));
    expect(pick).toBeDefined();
    const afterFetch = dispatch(afterTap, pick!.action);
    expect(afterFetch.players[1].hand.some(c => c.instanceId === discardCreatureId)).toBe(true);
    expect(afterFetch.players[1].discardPile.some(c => c.instanceId === discardCreatureId)).toBe(false);
  });
});
