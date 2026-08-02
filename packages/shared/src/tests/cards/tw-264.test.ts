/**
 * @module tw-264.test
 *
 * Card test: Lapse of Will (tw-264)
 * Type: hero-resource-event (long)
 * Effects: 2
 *   1. stat-modifier prowess -1 to every attack (target: all-attacks, id: base)
 *   2. stat-modifier prowess -3 to every Nazgûl (Ringwraith-race) attack,
 *      overriding #1 rather than stacking with it (target: all-attacks,
 *      overrides: base, when: enemy.race === "ringwraith")
 *
 * Card text:
 *   "The prowess of each attack is modified by -1. The prowess of each
 *    Nazgûl attack is modified by -3."
 *
 * The two clauses describe the *same* stat on overlapping attack sets (all
 * attacks vs. the Nazgûl subset), so the specific -3 replaces the general -1
 * for a Nazgûl attack rather than adding to it — the same `id`/`overrides`
 * pattern already used by Eye of Sauron (tw-32).
 *
 * | # | Effect                            | Status      | Notes                                |
 * |---|------------------------------------|-------------|----------------------------------------|
 * | 1 | stat-modifier prowess -1 (all)     | IMPLEMENTED | target: all-attacks, resolver.ts       |
 * | 2 | stat-modifier prowess -3 (Nazgûl)  | IMPLEMENTED | overrides #1, enemy.race: ringwraith   |
 *
 * Playable: YES
 * Certified: 2026-08-02
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState, makeMHState,
  addP1CardsInPlay, setupAutoAttackStep,
  playLongEventAndResolve, playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId } from '../../index.js';
import { ISENGARD, RegionType, SiteType } from '../../index.js';

const LAPSE_OF_WILL = 'tw-264' as CardDefinitionId;
// Adûnaphel (tw-2): Nazgûl hazard creature, keyed {d}{D}, one strike, prowess 15.
const ADUNAPHEL = 'tw-2' as CardDefinitionId;

describe('Lapse of Will (tw-264)', () => {
  beforeEach(() => resetMint());

  const lowInPlay: CardInPlay = {
    instanceId: 'low-1' as CardInstanceId,
    definitionId: LAPSE_OF_WILL,
    status: CardStatus.Untapped,
  };

  test('can be played as a hero long-event during the long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [LAPSE_OF_WILL], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const lowInstanceId = handCardId(state, RESOURCE_PLAYER);
    const s = playLongEventAndResolve(state, PLAYER_1, lowInstanceId);

    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].definitionId).toBe(LAPSE_OF_WILL);
    expect(s.players[0].hand).toHaveLength(0);
  });

  test('non-Nazgûl automatic-attack prowess reduced by -1', () => {
    // Isengard: Wolves automatic-attack — 3 strikes, 7 prowess. With Lapse of
    // Will: 7 - 1 = 6.
    const readyState = setupAutoAttackStep(
      addP1CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [lowInPlay]),
    );

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeDefined();
    expect(next.combat!.strikesTotal).toBe(3); // Strikes unchanged
    expect(next.combat!.strikeProwess).toBe(6); // 7 - 1
  });

  test('two Lapse of Will in play stack: prowess reduced by -2', () => {
    // Lapse of Will is non-unique, so two copies each independently
    // contribute their own -1 modifier — 7 - 1 - 1 = 5.
    const low2InPlay: CardInPlay = {
      instanceId: 'low-2' as CardInstanceId,
      definitionId: LAPSE_OF_WILL,
      status: CardStatus.Untapped,
    };

    const readyState = setupAutoAttackStep(
      addP1CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [lowInPlay, low2InPlay]),
    );

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeDefined();
    expect(next.combat!.strikeProwess).toBe(5); // 7 - 1 - 1
  });

  test('baseline: without Lapse of Will, a Nazgûl creature attack is unmodified', () => {
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Barad-dûr',
    }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, adunId, companyId, { method: 'site-type', value: 'dark-hold' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(15);
  });

  test('Nazgûl creature attack prowess reduced by -3 (not -4) when Lapse of Will is in play', () => {
    // Adûnaphel (Nazgûl, race ringwraith): base prowess 15. Lapse of Will's
    // general -1 clause is overridden by its Nazgûl-specific -3 clause, so
    // the result is 15 - 3 = 12, not 15 - 1 - 3 = 11.
    resetMint();
    const state = buildTestState({
      activePlayer: PLAYER_1, phase: Phase.MovementHazard, recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH], cardsInPlay: [lowInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ADUNAPHEL], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({
      resolvedSitePath: [RegionType.Dark], resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold, destinationSiteName: 'Barad-dûr',
    }) };
    const adunId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(ready, PLAYER_2, adunId, companyId, { method: 'site-type', value: 'dark-hold' });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(12);
  });
});
