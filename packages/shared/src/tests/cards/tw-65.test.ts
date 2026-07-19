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
 * | # | Rule                                        | Status      | Notes                                        |
 * |---|---------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Unique / Man / stats 13/8, 1 strike         | IMPLEMENTED | base engine (combat)                         |
 * | 2 | Keyed to dark region / dark-hold ({d}{D})   | IMPLEMENTED | `keyedTo` (region OR site alternative)       |
 * | 3 | Play as a hazard creature (1 strike)        | IMPLEMENTED | standard keyed-creature combat               |
 * | 4 | Play as a short-event                       | IMPLEMENTED | `creature-alt-event` (mode short-event)      |
 * | 5 | Event: return a hazard from discard to hand | IMPLEMENTED | `move` discard→hand (fetch-to-hand sub-flow) |
 *
 * Playable: YES. The creature mode is standard keyed-creature combat. The
 * short-event mode is the generic dual-mode primitive: a `creature-alt-event`
 * effect (mode `short-event`) makes the hazard player able to play the card as
 * a short-event against the active company (counting against the hazard limit,
 * no keying), and its top-level `move` effect (from discard, to hand, filtered
 * to any hazard card) resolves through the ordinary hazard short-event chain
 * path — reusing the existing fetch-to-hand pending sub-flow, so nothing is
 * bespoke. The `play-flag: playable-as-event` is retained purely for the
 * deck-construction ½-creature weighting (`deck-validation.ts`).
 *
 * Tests below drive the engine for BOTH modes: creature keying/combat, and the
 * short-event being offered (even where creature keying fails) and actually
 * returning a chosen hazard from the hazard player's discard pile to hand.
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
// A hazard card to seed the hazard player's discard pile so the short-event
// mode has something to return to hand (Shelob is a hazard-creature — matches
// the "any hazard card" filter).
const A_DISCARDED_HAZARD = 'tw-86' as CardDefinitionId;

// ─── Shared state builder ────────────────────────────────────────────────────

function baseState(hazardHand: CardDefinitionId[], hazardDiscard: CardDefinitionId[] = []) {
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
        discardPile: hazardDiscard,
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

  test('not playable as a creature at a free-hold destination with no dark region', () => {
    const state = withFreeHoldDest(baseState([MOUTH_OF_SAURON]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    // No viable keyed-creature play (keying fails); the only play offered is the
    // keying-free short-event mode.
    const creaturePlays = plays.filter(a => 'keyedBy' in a.action && (a.action as { keyedBy?: unknown }).keyedBy);
    expect(creaturePlays).toHaveLength(0);
    expect(plays.every(a => (a.action as { altEventMode?: string }).altEventMode === 'short-event')).toBe(true);
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

  // ── Short-event mode ────────────────────────────────────────────────────────

  test('also offered as a short-event even where creature keying fails', () => {
    // Free-hold destination with no dark region: creature keying cannot succeed,
    // so no viable creature play — but the short-event mode needs no keying.
    const state = withFreeHoldDest(baseState([MOUTH_OF_SAURON], [A_DISCARDED_HAZARD]));
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const shortEvents = plays.filter(a => (a.action as { altEventMode?: string }).altEventMode === 'short-event');
    expect(shortEvents).toHaveLength(1);
    // And the only viable play here IS the short-event (creature is unkeyable).
    expect(plays).toHaveLength(1);
  });

  test('played as a short-event returns a chosen hazard from discard to hand', () => {
    const state = withFreeHoldDest(baseState([MOUTH_OF_SAURON], [A_DISCARDED_HAZARD]));
    const mouthId = state.players[1].hand[0].instanceId;
    const discardHazardId = state.players[1].discardPile[0].instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: mouthId,
      targetCompanyId: companyId,
      altEventMode: 'short-event',
    });
    // Chain resolves → the fetch is queued as a pending effect for the hazard player.
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.pendingEffects.length).toBeGreaterThan(0);

    // The hazard player picks the hazard from their discard to return to hand.
    const fetches = viableActions(afterChain, PLAYER_2, 'fetch-from-pile');
    const pickDiscardHazard = fetches.find(a => (a.action as { cardInstanceId: string }).cardInstanceId === (discardHazardId as unknown as string));
    expect(pickDiscardHazard).toBeDefined();
    const afterFetch = dispatch(afterChain, pickDiscardHazard!.action);

    const hazPlayer = afterFetch.players[1];
    // The fetched hazard is now in hand; the spent Mouth of Sauron is in discard.
    expect(hazPlayer.hand.some(c => c.instanceId === discardHazardId)).toBe(true);
    expect(hazPlayer.discardPile.some(c => c.instanceId === mouthId)).toBe(true);
    // No card disappeared: the fetched hazard left the discard pile exactly once.
    expect(hazPlayer.discardPile.some(c => c.instanceId === discardHazardId)).toBe(false);
    expect(hazPlayer.hand.some(c => c.instanceId === mouthId)).toBe(false);
  });
});
