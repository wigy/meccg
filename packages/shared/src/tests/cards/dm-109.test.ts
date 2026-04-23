/**
 * @module dm-109.test
 *
 * Card test: Nameless Thing (dm-109)
 * Type: hazard-creature (drake)
 *
 * Text:
 *   "Drake. 3 attacks of 2 strikes each. A character can tap to cancel one
 *    of these attacks. Playable at any Under-deeps site. If Doors of Night
 *    is in play, also playable at an adjacent site of any Under-deeps site
 *    or keyed to a Coastal Sea [{c}]."
 *
 * Base stats: strikes 2, prowess 10, body 4, kill MP 3.
 *
 * Engine Support:
 * | # | Rule                                                     | Status           | Notes                                       |
 * |---|----------------------------------------------------------|------------------|---------------------------------------------|
 * | 1 | Drake (race)                                             | IMPLEMENTED      | race field; used by race-gated interactions |
 * | 2 | 3 attacks of 2 strikes each                              | IMPLEMENTED      | combat-multi-attack count:3 × strikes:2     |
 * | 3 | A character can tap to cancel one of these attacks       | IMPLEMENTED      | combat-cancel-attack-by-tap maxCancels:1    |
 * | 4 | Playable at any Under-deeps site (base keying)           | NOT IMPLEMENTED  | no under-deeps site match in keyedTo;       |
 * |   |                                                          |                  | underDeeps flag exists only on balrog-sites |
 * | 5 | (with DoN) playable at adjacent site of Under-deeps site | NOT IMPLEMENTED  | no adjacency concept in creature keying     |
 * | 6 | (with DoN) playable keyed to a Coastal Sea [{c}]         | NOT ENCODED      | could be { regionTypes: ["coastal"], when:  |
 * |   |                                                          |                  | inPlay DoN } but left out to avoid shipping |
 * |   |                                                          |                  | a half-encoded creature — base Under-deeps  |
 * |   |                                                          |                  | path would stay unplayable and the card     |
 * |   |                                                          |                  | would look playable only with DoN+coastal   |
 *
 * Playable: PARTIALLY — multi-attack and cancel-by-tap effects are encoded
 * and will resolve correctly once the creature enters combat, but every
 * playability path (base and both Doors-of-Night alternates) involves
 * Under-deeps sites, and the engine has no way to identify an Under-deeps
 * site during creature keying (the `underDeeps` field lives only on
 * balrog-sites, the DM-set Under-deeps sites are not in the data yet,
 * and "adjacent site of any Under-deeps site" has no representation at
 * all). The card therefore cannot be played today. NOT CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  makeMHState,
  viableActions,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const NAMELESS_THING = 'dm-109' as CardDefinitionId;

function baseStateWithHazardInHand(
  cardsInPlay?: Array<{ instanceId: CardInstanceId; definitionId: CardDefinitionId; status: CardStatus }>,
) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [NAMELESS_THING],
        siteDeck: [RIVENDELL],
        cardsInPlay: cardsInPlay ?? [],
      },
    ],
  });
}

function donInPlay() {
  return {
    instanceId: 'don-1' as CardInstanceId,
    definitionId: DOORS_OF_NIGHT,
    status: CardStatus.Untapped,
  };
}

describe('Nameless Thing (dm-109)', () => {
  beforeEach(() => resetMint());

  // ─── Keying: nothing works today (Under-deeps not representable) ──────────
  //
  // The card's three playability clauses — base "any Under-deeps site",
  // DoN "adjacent site of any Under-deeps site", and DoN "Coastal Sea" —
  // all hinge on Under-deeps site identity, which isn't readable from the
  // generic site-keying machinery. Until that exists, a held copy must
  // never appear as a viable play-hazard, no matter the path or DoN state.

  test('NOT playable on a wilderness path (base Under-deeps keying not implemented)', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
        resolvedSitePathNames: ['Rhudaur', 'Arthedain'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Moria',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(ready, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.every(ea => !ea.viable)).toBe(true);
  });

  test('NOT playable on a coastal path without Doors of Night', () => {
    const state = baseStateWithHazardInHand();
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
        resolvedSitePathNames: ['Andrast', 'Anfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Dol Amroth',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable on a coastal path even with Doors of Night (Coastal alt not encoded)', () => {
    // Once the base Under-deeps rule is in, the DoN-coastal alt can ride
    // alongside it. Today, encoding only the alt would ship a creature
    // whose base path (Under-deeps) stays broken while a secondary path
    // works — so the alt is left out on purpose, and DoN+coastal stays
    // unplayable. This test pins that choice.
    const state = baseStateWithHazardInHand([donInPlay()]);
    const ready: GameState = {
      ...state,
      phaseState: makeMHState({
        resolvedSitePath: [RegionType.Coastal, RegionType.Coastal],
        resolvedSitePathNames: ['Andrast', 'Anfalas'],
        destinationSiteType: SiteType.RuinsAndLairs,
        destinationSiteName: 'Dol Amroth',
      }),
    };

    const plays = viableActions(ready, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ─── NOT IMPLEMENTED — Under-deeps keying (base + DoN alternates) ─────────
  //
  // Filling these requires:
  // 1. An `underDeeps: boolean` on every site card type (today only
  //    `BalrogSiteCard`), with DM-set Under-deeps sites added to
  //    dm-sites.json.
  // 2. A way to express "any Under-deeps site" in `CreatureKeyRestriction`
  //    — either a new `underDeeps?: boolean` field checked in
  //    `findCreatureKeyingMatches` (movement-hazard.ts), or an
  //    `under-deeps` site-type enum value.
  // 3. Site-to-site adjacency data (each Under-deeps site lists surface
  //    sites adjacent to it, and vice versa) plus matching in the
  //    creature-keying pass, so "adjacent site of any Under-deeps site"
  //    can resolve against the company's destination.
  //
  // Once (1)+(2) land, the base keying entry and the DoN-gated coastal
  // alt can be added to `keyedTo` and tested here. (3) is needed for the
  // "adjacent site of any Under-deeps site" branch.

  test.todo('playable at an Under-deeps destination site (base keying)');

  test.todo('NOT playable at a non-Under-deeps site without Doors of Night');

  test.todo('with Doors of Night, playable at a surface site adjacent to any Under-deeps site');

  test.todo('without Doors of Night, NOT playable at a surface site merely adjacent to an Under-deeps site');

  test.todo('with Doors of Night, playable via a Coastal Sea [{c}] path');

  test.todo('without Doors of Night, NOT playable via a Coastal Sea path');

  // ─── NOT IMPLEMENTED — combat resolution depends on keying first ──────────
  //
  // combat-multi-attack (count:3) and combat-cancel-attack-by-tap
  // (maxCancels:1) are implemented in the engine and wired into the
  // card's `effects` array. Exercising them end-to-end requires the
  // creature to actually enter combat, which requires a successful
  // play-hazard, which requires a matching keyedTo entry — so these
  // tests stay as todos alongside the keying work.

  test.todo('combat initiates with strikesTotal = 6 (3 attacks × 2 strikes) once playable');

  test.todo('strikeProwess is 10 once combat initiates');

  test.todo('defender may tap one non-target character to cancel one of the three attacks');

  test.todo('only one attack may be canceled by tap (maxCancels: 1) even with multiple untapped non-targets');

  test.todo('defeating Nameless Thing awards 3 kill MP and body-check uses body 4');
});
