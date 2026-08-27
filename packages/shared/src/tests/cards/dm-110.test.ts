/**
 * @module dm-110.test
 *
 * Card test: Spider of the Môrlat (dm-110)
 * Type: hazard-creature (dual creature / permanent-event), unique, 4 kill MP
 *
 * Card text:
 *   "Unique. Spider. Spawn. May be played as a hazard creature (with two
 *    strikes) or as a permanent-event. As a creature, she may be played at
 *    Dol Guldur and The Sulfur-deeps. ... If played as a permanent-event, all
 *    Spider attacks receive +1 strike. Additionally, any company moving in
 *    Southern Mirkwood, Heart of Mirkwood, Woodland Realm, Dagorlad, or Brown
 *    Lands faces a Spider attack of 2 strikes with 10 prowess (detainment
 *    against minion companies). You can return Spider of the Môrlat as a
 *    permanent-event to your hand—which counts as one against the hazard
 *    limit."
 *
 * Bug fixed: the card's `effects` array carried only `play-flag:
 * playable-as-event` (deck-construction weighting) with no
 * `creature-alt-event` effect, so the permanent-event mode was never offered
 * by `play-hazard` — the card was only ever playable as a creature. Reported
 * in game mt9t03f3-m5hc3u (turn 6, movement/hazard phase, seq 311).
 *
 * This test covers the permanent-event mode: being offered/entering play, the
 * region-wide auto-attack, and the +1 strike boost to all Spider attacks. The
 * creature mode's own keying (Dol Guldur / The Sulfur-deeps) is unrelated to
 * the reported bug and remains untouched (`keyedTo: []`).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState,
  buildAhuntOrderEffectsState,
  addCardInPlay,
  playCreatureHazardAndResolve,
  handCardId,
  viableActions, dispatch, resolveChain,
  companyIdAt,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, RegionType, CardStatus } from '../../index.js';
import type { CardDefinitionId, CombatState } from '../../index.js';

const SPIDER_OF_MORLAT = 'dm-110' as CardDefinitionId;
const SHELOB = 'tw-86' as CardDefinitionId; // another certified Spider creature

/** Two-company M/H setup with Spider of the Môrlat in the hazard player's hand. */
function setup() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SPIDER_OF_MORLAT], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Spider of the Môrlat (dm-110)', () => {
  beforeEach(() => resetMint());

  // ─── Permanent-event mode is offered (the reported bug) ────────────────────

  test('offered as a permanent-event and enters play untapped (no combat)', () => {
    const state = setup();
    const ready = { ...state, phaseState: makeMHState({ destinationSiteName: 'Barad-dûr' }) };
    const spiderId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, 0, 0);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spiderId
        && (a.action as { altEventMode?: string }).altEventMode === 'permanent-event' && a.viable);
    expect(offered).toBe(true);

    const afterChain = resolveChain(dispatch(ready, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: spiderId,
      targetCompanyId: companyId, altEventMode: 'permanent-event',
    }));
    expect(afterChain.combat).toBeNull();
    const inPlay = afterChain.players[1].cardsInPlay.find(c => c.instanceId === spiderId);
    expect(inPlay).toBeDefined();
    expect(inPlay!.status).toBe(CardStatus.Untapped);
  });

  test('NOT offered as a permanent-event once the hazard limit is already reached', () => {
    const state = setup();
    const ready = {
      ...state,
      phaseState: makeMHState({
        destinationSiteName: 'Barad-dûr',
        hazardLimitAtReveal: 2,
        hazardsPlayedThisCompany: 2,
      }),
    };
    const spiderId = handCardId(ready, HAZARD_PLAYER);

    const offered = viableActions(ready, PLAYER_2, 'play-hazard')
      .some(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === spiderId
        && (a.action as { altEventMode?: string }).altEventMode === 'permanent-event' && a.viable);
    expect(offered).toBe(false);
  });

  // ─── Region-wide auto-attack + Spider strike boost while in play ───────────

  test('a company moving through a named region faces a Spider attack of 3 strikes (2 base +1 boost) at 10 prowess', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Woodland Realm'],
      pathTypes: [RegionType.Wilderness],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);

    expect(next.combat).not.toBeNull();
    const combat = next.combat as CombatState;
    expect(combat.attackSource.type).toBe('ahunt');
    expect(combat.creatureRace).toBe('spider');
    expect(combat.strikeProwess).toBe(10);
    // 2 printed strikes + the card's own "+1 strike to all Spider attacks".
    expect(combat.strikesTotal).toBe(3);
  });

  test('a company moving elsewhere (not one of the named regions) faces no attack', () => {
    const state = buildAhuntOrderEffectsState({
      ahuntDefId: SPIDER_OF_MORLAT,
      pathNames: ['Rhudaur'],
      pathTypes: [RegionType.Wilderness],
    });
    const next = dispatch(state, viableActions(state, PLAYER_1, 'pass')[0].action);
    expect(next.combat).toBeNull();
  });

  test('the strike boost also reaches an unrelated Spider creature\'s attack while Spider of the Môrlat is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SHELOB], siteDeck: [RIVENDELL] },
      ],
    });
    const readyState = {
      ...addCardInPlay(base, HAZARD_PLAYER, SPIDER_OF_MORLAT),
      phaseState: makeMHState({
        resolvedSitePathNames: ['Gorgoroth'],
        destinationSiteName: 'Barad-dûr',
      }),
    };
    const shelobId = handCardId(readyState, HAZARD_PLAYER);
    const companyId = companyIdAt(readyState, 0, 0);

    const after = playCreatureHazardAndResolve(
      readyState, PLAYER_2, shelobId, companyId,
      { method: 'region-name', value: 'Gorgoroth' },
    );
    expect(after.combat).not.toBeNull();
    // Shelob's printed 1 strike + the Spider of the Môrlat's "+1 strike to all Spider attacks".
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.strikeProwess).toBe(18);
  });
});
