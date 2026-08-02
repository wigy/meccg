/**
 * @module td-157.test
 *
 * Card test: Three Golden Hairs (td-157)
 * Type: hero-resource-event (permanent), alignment wizard, unique.
 * Printed: 2 corruption points (attributes.corruption), 0 misc MP.
 *
 * Effects:
 *   - play-target character: non-Wizard, non-Hobbit diplomat, not Galadriel,
 *                             at the same site as Galadriel
 *                             (`company.siteCharacterNames $includes "Galadriel"`)
 *   - on-event self-enters-play: discard-bearer-corruption
 *   - stat-modifier corruption-points +2 (the card's own printed CP)
 *   - check-modifier corruption +2 (bearer-scoped)
 *
 * Text:
 *   "Unique. Playable at any site on a non-Wizard, non-Hobbit diplomat
 *    character (other than Galadriel) at the same site as Galadriel. All
 *    corruption cards on the bearer are discarded when this card comes into
 *    play. +2 to all corruption checks by bearer."
 *
 * | # | Rule                                                             | Status |
 * |---|-------------------------------------------------------------------|--------|
 * | 1 | Playable during the site phase only                              | OK     |
 * | 2 | Target must be non-Wizard, non-Hobbit, diplomat                   | OK     |
 * | 3 | Target must not be Galadriel herself                              | OK     |
 * | 4 | Target's company must share a site with a Galadriel company      | OK     |
 * | 5 | Attaches to the bearer on play                                    | OK     |
 * | 6 | Discards corruption cards already on the bearer                  | OK     |
 * | 7 | Does not discard non-corruption hazards on the bearer             | OK     |
 * | 8 | Bearer's own corruption points increase by 2 (printed CP)        | OK     |
 * | 9 | +2 to all corruption checks by bearer                             | OK     |
 *
 * Playable: YES — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
  buildTestState, makePlayDeck,
  resetMint,
  viableActions,
  dispatch, resolveChain,
  findCharInstanceId,
  makeSitePhase,
  attachHazardToChar,
  enqueueCorruptionCheck,
  getHazardsOn, getItemsOn,
  GALADRIEL, LEGOLAS, GANDALF, FRODO, ARAGORN,
  FOOLISH_WORDS, LURE_OF_THE_SENSES,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import type { PlayPermanentEventAction } from '../../types/actions-organization.js';
import type { CorruptionCheckAction } from '../../types/actions-universal.js';

const THREE_GOLDEN_HAIRS = 'td-157' as CardDefinitionId;

// Two hero havens — Galadriel's company sits at Lórien in most scenarios;
// Weathertop is used as "a different site" to test the site-gate negatively.
const LORIEN = 'tw-408' as CardDefinitionId;
const WEATHERTOP = 'tw-436' as CardDefinitionId;

/**
 * Build a site-phase state with the active company (index 0, bearing
 * `bearerCharacters`) at `bearerSite`, plus a second company of the same
 * player (index 1, bearing `galadrielSite ? [Galadriel] : []`) at
 * `galadrielSite` — omit `galadrielSite` to leave Galadriel out of play
 * entirely.
 */
function buildState(opts: {
  bearerCharacters: CardDefinitionId[];
  bearerSite?: CardDefinitionId;
  galadrielSite?: CardDefinitionId;
  hand?: CardDefinitionId[];
}): GameState {
  const bearerSite = opts.bearerSite ?? LORIEN;
  const companies = [{ site: bearerSite, characters: opts.bearerCharacters }];
  if (opts.galadrielSite) {
    companies.push({ site: opts.galadrielSite, characters: [GALADRIEL] });
  }
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies,
        hand: opts.hand ?? [THREE_GOLDEN_HAIRS],
        siteDeck: [LORIEN],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: WEATHERTOP, characters: [] }],
        hand: [],
        siteDeck: [WEATHERTOP],
      },
    ],
  });
  return { ...state, phaseState: makeSitePhase({ activeCompanyIndex: 0 }) };
}

describe('Three Golden Hairs (td-157)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: site-phase only ────────────────────────────────────────────

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: LORIEN, characters: [LEGOLAS] },
            { site: LORIEN, characters: [GALADRIEL] },
          ],
          hand: [THREE_GOLDEN_HAIRS],
          siteDeck: [LORIEN],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: WEATHERTOP, characters: [] }], hand: [], siteDeck: [WEATHERTOP] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rules 2-4: play-target gate ─────────────────────────────────────────

  test('IS playable on an Elf diplomat (Legolas) when Galadriel is in another company at the same site', () => {
    const state = buildState({ bearerCharacters: [LEGOLAS], galadrielSite: LORIEN });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.some(a => (a.action as PlayPermanentEventAction).targetCharacterId === legolasId)).toBe(true);
  });

  test('NOT playable when Galadriel is at a different site', () => {
    const state = buildState({ bearerCharacters: [LEGOLAS], bearerSite: LORIEN, galadrielSite: WEATHERTOP });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when Galadriel is not in play at all', () => {
    const state = buildState({ bearerCharacters: [LEGOLAS] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on Galadriel herself, even in her own company', () => {
    const state = buildState({ bearerCharacters: [GALADRIEL], galadrielSite: undefined });
    // Galadriel is her own company here (bearerCharacters), so the site trivially
    // matches — the exclusion must come from the target.name gate.
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a Wizard diplomat (Gandalf), even at the same site as Galadriel', () => {
    const state = buildState({ bearerCharacters: [GANDALF], galadrielSite: LORIEN });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a Hobbit diplomat (Frodo), even at the same site as Galadriel', () => {
    const state = buildState({ bearerCharacters: [FRODO], galadrielSite: LORIEN });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on a non-diplomat (Aragorn), even at the same site as Galadriel', () => {
    const state = buildState({ bearerCharacters: [ARAGORN], galadrielSite: LORIEN });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 5: attaches to the bearer ──────────────────────────────────────

  test('playing it attaches Three Golden Hairs to the bearer', () => {
    const state = buildState({ bearerCharacters: [LEGOLAS], galadrielSite: LORIEN });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(a => (a.action as PlayPermanentEventAction).targetCharacterId === legolasId)!.action;
    const after = resolveChain(dispatch(state, action));
    expect(getItemsOn(after, RESOURCE_PLAYER, LEGOLAS).some(i => i.definitionId === THREE_GOLDEN_HAIRS)).toBe(true);
  });

  // ── Rule 6-7: discards corruption cards, but not other hazards ─────────

  test('discards a corruption card already on the bearer, but leaves a non-corruption hazard', () => {
    let state = buildState({ bearerCharacters: [LEGOLAS], galadrielSite: LORIEN });
    state = attachHazardToChar(state, RESOURCE_PLAYER, LEGOLAS, LURE_OF_THE_SENSES, HAZARD_PLAYER);
    state = attachHazardToChar(state, RESOURCE_PLAYER, LEGOLAS, FOOLISH_WORDS, HAZARD_PLAYER);
    expect(getHazardsOn(state, RESOURCE_PLAYER, LEGOLAS)).toHaveLength(2);

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const action = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(a => (a.action as PlayPermanentEventAction).targetCharacterId === legolasId)!.action;
    const after = resolveChain(dispatch(state, action));

    const remainingHazards = getHazardsOn(after, RESOURCE_PLAYER, LEGOLAS).map(h => h.definitionId);
    expect(remainingHazards).not.toContain(LURE_OF_THE_SENSES);
    expect(remainingHazards).toContain(FOOLISH_WORDS);

    // The discarded corruption card returns to its owner's (hazard player's) pile.
    const oppDiscard = after.players[HAZARD_PLAYER].discardPile.map(c => c.definitionId);
    expect(oppDiscard).toContain(LURE_OF_THE_SENSES);
  });

  // ── Rules 8-9: bearer's own CP and the +2 corruption-check bonus ────────

  test('the bearer\'s own corruption points increase by 2 and checks are modified by +2', () => {
    const state = buildState({ bearerCharacters: [LEGOLAS], galadrielSite: LORIEN });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const cpBefore = state.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.corruptionPoints;

    const action = viableActions(state, PLAYER_1, 'play-permanent-event')
      .find(a => (a.action as PlayPermanentEventAction).targetCharacterId === legolasId)!.action;
    let after = resolveChain(dispatch(state, action));

    const cpAfter = after.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.corruptionPoints;
    expect(cpAfter).toBe(cpBefore + 2);

    after = enqueueCorruptionCheck(after, PLAYER_1, legolasId);
    const roll = viableActions(after, PLAYER_1, 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction)
      .find(a => a.characterId === legolasId)!;
    expect(roll.corruptionModifier).toBe(2);
  });
});
