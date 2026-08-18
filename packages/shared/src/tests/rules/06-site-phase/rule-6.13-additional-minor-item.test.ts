/**
 * @module rule-6.13-additional-minor-item
 *
 * CoE Rules — Section 6: Site Phase
 * Rule 6.13: Additional Minor Item
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Playing an Additional Minor Item - When a resource that taps the site is successfully played during a company's site phase and the site is tapped as a result, the resource player may attempt to play one additional minor item as that player's next declared action even if the site doesn't indicate that minor items are playable. The resource player must tap a character (as an active condition), and then upon resolution places the item under the character's control.
 * If a company is at an Under-deeps site, any one additional item that is playable at the site may be played instead of an additional minor item.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildSitePhaseState, resetMint, viableActions,
  PLAYER_1,
  ARAGORN, BILBO, GALADRIEL, CRAM,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  MORIA,
  companyIdAt, charIdAt, handCardId,
  dispatch, resolveChain, RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { CardDefinitionId, SitePhaseState } from '../../../index.js';

const AMON_HEN = 'tw-371' as CardDefinitionId; // ruins-and-lairs, Information playable
const DREAMS_OF_LORE = 'tw-210' as CardDefinitionId; // permanent-event resource, tap-site-on-play

describe('Rule 6.13 — Additional Minor Item', () => {
  beforeEach(() => resetMint());

  test('no minor-item bonus is available before a site-tapping resource has been played', () => {
    // Dagger of Westernesse (minor) in hand with two untapped characters at
    // untapped Moria. The site has not yet been tapped, so the legal plays
    // come from the baseline "untapped site" branch — not the bonus window.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN, BILBO],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    expect(state.phaseState.minorItemAvailable).toBe(false);

    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(2); // one per untapped carrier
  });

  test('playing a greater item opens the additional-minor-item window', () => {
    // The Mithril-coat (greater) goes on Aragorn, tapping him and Moria. The
    // phase state must then flip `minorItemAvailable: true` so a minor item
    // may be played as the resource player's next action even though the
    // site is now tapped.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN, BILBO],
      hand: [THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const mithrilCoatId = handCardId(state, RESOURCE_PLAYER);

    const after = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: mithrilCoatId,
      companyId,
      attachToCharacterId: aragornId,
    });

    const nextPhase = after.phaseState as SitePhaseState;
    expect(nextPhase.resourcePlayed).toBe(true);
    expect(nextPhase.minorItemAvailable).toBe(true);

    // And the legal-action layer now offers the minor item on the remaining
    // untapped carrier despite the site being tapped.
    const plays = viableActions(after, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(1);
  });

  test('playing the additional minor item consumes the bonus — no further item plays are legal', () => {
    // After the first resource play opens the window and the player spends
    // it on Dagger of Westernesse, `minorItemAvailable` must revert to false
    // so a third item cannot slip through the still-tapped site.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN, BILBO],
      hand: [THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const bilboId = charIdAt(state, RESOURCE_PLAYER, 0, 1);
    const mithrilCoatId = handCardId(state, RESOURCE_PLAYER);
    const firstDaggerId = handCardId(state, RESOURCE_PLAYER, 1);

    const afterMain = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: mithrilCoatId,
      companyId,
      attachToCharacterId: aragornId,
    });

    const afterBonus = dispatch(afterMain, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: firstDaggerId,
      companyId,
      attachToCharacterId: bilboId,
    });

    const nextPhase = afterBonus.phaseState as SitePhaseState;
    expect(nextPhase.minorItemAvailable).toBe(false);

    // The second dagger still in hand must not be offered as a viable play:
    // site is tapped and the bonus has been consumed.
    const plays = viableActions(afterBonus, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(0);
  });

  test('after playing a major item, a non-minor item in hand is still not playable (only minor items get the bonus)', () => {
    // Glamdring (major) is followed by The Mithril-coat (greater). The bonus
    // window is only for minor items — any non-minor item must remain gated
    // by the site-tapped check.
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN, BILBO],
      hand: [GLAMDRING, THE_MITHRIL_COAT],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const glamdringId = handCardId(state, RESOURCE_PLAYER);

    const after = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      companyId,
      attachToCharacterId: aragornId,
    });

    const nextPhase = after.phaseState as SitePhaseState;
    expect(nextPhase.minorItemAvailable).toBe(true);

    const plays = viableActions(after, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(0);
  });

  test('playing a permanent-event resource that taps the site (Dreams of Lore) opens the additional-minor-item window', () => {
    // Dreams of Lore (tw-210) is a permanent-event resource, not an item —
    // it resolves through the play-permanent-event chain, a different code
    // path than handleSitePlayHeroResource above. It still taps the site via
    // `tap-site-on-play`, so it must open the same rule 2.V.5 bonus window.
    const state = buildSitePhaseState({
      site: AMON_HEN,
      characters: [GALADRIEL, ARAGORN],
      hand: [DREAMS_OF_LORE, CRAM],
    });

    const action = viableActions(state, PLAYER_1, 'play-permanent-event')[0].action;
    const after = resolveChain(dispatch(state, action));

    const nextPhase = after.phaseState as SitePhaseState;
    expect(nextPhase.resourcePlayed).toBe(true);
    expect(nextPhase.minorItemAvailable).toBe(true);

    // Aragorn is still untapped and Cram (minor) is still in hand — the
    // bonus must offer it despite the site now being tapped.
    const plays = viableActions(after, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBe(1);
  });
});
