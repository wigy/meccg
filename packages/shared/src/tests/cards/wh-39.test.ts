/**
 * @module wh-39.test
 *
 * Card test: Wild Horses (wh-39)
 * Type: hero-resource-faction (wizard, non-unique, 1 MP, influence # 12, Animal)
 *
 * Card text: "Playable at any tapped or untapped non-Haven site in Rohan,
 * Khand, Dorwinion, Horse Plains, Southern Rhovanion, or Harondor if the
 * influence check is greater than 11. Standard Modifications: Men with home
 * sites in the regions listed above (+3). Tap this faction to allow any
 * company with one of the regions listed above in its site path to move up
 * to 1 additional region."
 *
 * Bug report (game mshubgh3-safuck, stateSeq 158): Wild Horses was not
 * offered as playable at a tapped Dunharrow (Rohan) with two untapped
 * characters in the company. Root cause: the card's `playableAt` entry was
 * `{ "site": "any" }` (a `PlayableAtSite` literal-name match against the
 * string "any", which never matches a real site name) instead of
 * `PlayableAtRegion` entries for the six named regions, and the card carried
 * no `playable-at-tapped-site` play-flag. Together these meant the faction
 * was never offered at any site, tapped or untapped.
 *
 * This test only covers rule 1 (playability, including at a tapped site);
 * the Standard Modification and the tap-for-extra-movement ability are not
 * yet certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  makeSitePhase, setCompanySiteStatus,
  firstFactionInfluenceAttempt, findHandCardId,
} from '../test-helpers.js';
import {
  RIVENDELL, LORIEN, MORIA, MOUNT_DOOM, EDORAS, ARAGORN, LEGOLAS,
} from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const WILD_HORSES = 'wh-39' as CardDefinitionId;
const DUNHARROW = 'tw-389' as CardDefinitionId; // border-hold, Rohan

/** Hero player holding Wild Horses in hand at `site`, with two untapped characters, in the site phase. */
function handState(site: CardDefinitionId): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: [ARAGORN, LEGOLAS] }], hand: [WILD_HORSES], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MOUNT_DOOM] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('Wild Horses (wh-39)', () => {
  beforeEach(() => resetMint());

  test('playable at an untapped site in Rohan (Edoras)', () => {
    const state = handState(EDORAS);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, WILD_HORSES);
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  test('regression: playable at a TAPPED site in Rohan with two untapped characters (Dunharrow, playable-at-tapped-site)', () => {
    const base = handState(DUNHARROW);
    const state = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, WILD_HORSES);
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  test('NOT playable at Moria (not one of the six named regions)', () => {
    const state = handState(MORIA);
    const factionId = findHandCardId(state, RESOURCE_PLAYER, WILD_HORSES);
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });
});
