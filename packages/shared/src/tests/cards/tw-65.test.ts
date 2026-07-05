/**
 * @module tw-65.test
 *
 * Card test: Mouth of Sauron (tw-65)
 * Type: hazard-creature (men) — dual creature/short-event hazard
 *
 * Text:
 *   "Unique. Man. May be played as a hazard creature (with one strike) or as a
 *   short-event. If played as a short-event, bring any hazard card from your
 *   discard pile back into your hand."
 *
 * Base stats: strikes 1, prowess 13, body 8, kill MP 3. Keyed `{d}{D}` — a
 * dark-domain region [d] OR a dark-hold site [D] (the house convention encodes
 * both alternatives in a single `keyedTo` entry, matching Barrow-wight/Orc-guard
 * etc.).
 *
 * Effects:
 * | # | Rule                                        | Status          | Notes                                        |
 * |---|---------------------------------------------|-----------------|----------------------------------------------|
 * | 1 | Unique / Man / stats 13/8, 1 strike         | IMPLEMENTED     | base engine (combat)                         |
 * | 2 | Keyed to dark region / dark-hold ({d}{D})   | IMPLEMENTED     | `keyedTo` (region OR site alternative)       |
 * | 3 | Play as a hazard creature (1 strike)        | IMPLEMENTED     | standard keyed-creature combat               |
 * | 4 | Play as a short-event                       | NOT IMPLEMENTED | no engine path plays a creature as an event  |
 * | 5 | Event: return a hazard from discard to hand | NOT IMPLEMENTED | no effect / pending-resolution support       |
 *
 * Playable: PARTIALLY — the creature mode is fully playable; the entire
 * short-event mode (rules 4–5) is unimplemented. The `play-flag:
 * playable-as-event` present on the card is purely declarative (consumed only
 * by deck-validation for the ½-creature deck-construction weight); the engine
 * has no path to play a dual-mode creature as a short-event and no
 * "return-hazard-from-discard-to-hand" effect. This gap is shared by ~20
 * sibling cards (all Nazgûl, hunter manifestations, Wolf-riders, spiders), none
 * of which are certified. This test therefore exercises only the working
 * creature mode with real assertions; the card is NOT certified.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint, makeMHState,
  resolveChain,
  handCardId, companyIdAt, dispatch, viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType } from '../../index.js';
import { ARAGORN, LEGOLAS, GIMLI, RIVENDELL, MINAS_TIRITH, MORIA } from '../../card-ids.js';
import type { CardDefinitionId } from '../../index.js';

const MOUTH_OF_SAURON = 'tw-65' as CardDefinitionId;

// ─── Shared state builder ────────────────────────────────────────────────────

function baseState(hazardHand: CardDefinitionId[]) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, GIMLI] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [] }],
        hand: hazardHand,
        siteDeck: [MORIA],
      },
    ],
  });
}

function withDarkHoldDest(state: ReturnType<typeof baseState>) {
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Shadow],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    }),
  };
}

function withDarkRegionDest(state: ReturnType<typeof baseState>) {
  return {
    ...state,
    phaseState: makeMHState({
      // Dark-domain region in the path but a non-dark-hold destination — keying
      // must succeed on the region alternative alone.
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Nurn'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Dead Marshes',
    }),
  };
}

function withFreeHoldDest(state: ReturnType<typeof baseState>) {
  return {
    ...state,
    phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Gondor'],
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Pelargir',
    }),
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Mouth of Sauron (tw-65)', () => {
  beforeEach(() => resetMint());

  // ── Keying: {d}{D} = dark region OR dark-hold site ──────────────────────────

  test('playable as a creature at a dark-hold destination', () => {
    const state = withDarkHoldDest(baseState([MOUTH_OF_SAURON]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => a.action.type === 'play-hazard')).toBe(true);
  });

  test('playable as a creature via a dark-domain region in the path', () => {
    const state = withDarkRegionDest(baseState([MOUTH_OF_SAURON]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every(a => a.action.type === 'play-hazard')).toBe(true);
  });

  test('not playable at a free-hold destination with no dark region', () => {
    const state = withFreeHoldDest(baseState([MOUTH_OF_SAURON]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ── Creature combat: prowess 13, exactly one strike ─────────────────────────

  test('creature attack presents prowess 13 and a single strike', () => {
    const state = withDarkHoldDest(baseState([MOUTH_OF_SAURON]));
    const mouthId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: mouthId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'dark-hold' },
    });
    const afterChain = resolveChain(afterPlay);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikeProwess).toBe(13);
    expect(afterChain.combat!.strikesTotal).toBe(1);
  });
});
