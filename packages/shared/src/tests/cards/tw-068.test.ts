/**
 * @module tw-068.test
 *
 * Card test: New Moon (tw-68)
 * Type: hazard-event (short, environment)
 *
 * "Environment. Tap one Elf character. Alternatively, if Doors of Night is in
 *  play, treat one Free-domain [{f}] as a Border-land [{b}] or one Free-hold
 *  [{F}] as a Border-hold [{B}] until the end of the turn. Cannot be
 *  duplicated."
 *
 * The two modes are mutually exclusive ("Alternatively"):
 * - Mode A (`tap-character`, filter Elf): the play action carries a
 *   `targetCharacterId`; `applyTapCharacter` taps the chosen Elf on chain
 *   resolution. Offered per eligible untapped Elf in the resource player's
 *   companies.
 * - Mode B (`on-event company-arrives-at-site` → `site-type-override` /
 *   `region-type-override`): with Doors of Night in play, a single untargeted
 *   action reinterprets a Free-hold as a Border-hold, or the destination
 *   Free-domain as a Border-land, for the turn. The arrival-override modes are
 *   suppressed whenever a character was tapped (Mode A chosen).
 * - `duplication-limit` scope:turn max:1 — "Cannot be duplicated".
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain, viableActions,
  makeMHState, handCardId, findCharInstanceId, playHazardAndResolve,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, P1_COMPANY,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus } from '../../index.js';
import type { GameState, MovementHazardPhaseState, CardInstanceId, CardDefinitionId } from '../../index.js';

const NEW_MOON = 'tw-68' as CardDefinitionId;
const LEGOLAS = 'tw-168' as CardDefinitionId;   // Elf
const ARAGORN = 'tw-120' as CardDefinitionId;   // Dúnadan (non-Elf)
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const RIVENDELL = 'tw-421' as CardDefinitionId;  // haven (origin)
const MINAS_TIRITH = 'tw-412' as CardDefinitionId; // free-hold
const BREE = 'tw-378' as CardDefinitionId;       // border-hold
const MORIA = 'tw-413' as CardDefinitionId;

/** Doors-of-Night in the hazard player's cardsInPlay. */
const donInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

/** targetCharacterId of a play-hazard evaluated action (undefined = Mode B). */
function targetOf(a: { action: unknown }): CardInstanceId | undefined {
  return (a.action as { targetCharacterId?: CardInstanceId }).targetCharacterId;
}

describe('New Moon (tw-68)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: tap one Elf character ────────────────────────────────────────

  test('Mode A — offers tapping the Elf, not the non-Elf company-mate', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA] },
      ],
    });
    // Non-moving company, no Doors of Night → only Mode A is available.
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteType: SiteType.BorderHold, resolvedSitePath: [RegionType.Border] }),
    };

    const legolasId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, LEGOLAS);
    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');

    // Exactly one viable play — tapping the Elf.
    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBe(legolasId);
    expect(actions.some(a => targetOf(a) === aragornId)).toBe(false);
  });

  test('Mode A — taps the chosen Elf on resolution and goes to discard', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteType: SiteType.BorderHold, resolvedSitePath: [RegionType.Border] }),
    };

    const legolasId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, LEGOLAS);
    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const nmId = handCardId(mhGameState, HAZARD_PLAYER);

    const afterPlay = dispatch(mhGameState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: nmId,
      targetCompanyId: P1_COMPANY, targetCharacterId: legolasId,
    });
    const resolved = resolveChain(afterPlay);

    // Legolas tapped; Aragorn untouched.
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Untapped);
    // Short event went to the hazard player's discard pile.
    expect(resolved.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(resolved.players[HAZARD_PLAYER].cardsInPlay).toHaveLength(0);
    expect(resolved.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(nmId);
  });

  test('not playable with no Elf to tap, no Doors of Night, and a non-Free destination', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Eriador'],
      }),
    };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── Mode B: Doors-of-Night region/site type overrides ────────────────────

  test('Mode B — Doors of Night + Free-hold destination: site-type-override to Border-hold, no tap', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        // No Elf in the company → isolates Mode B.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Anórien'],
      }),
    };

    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    // Only the untargeted (Mode B) action is offered.
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBeUndefined();

    const nmId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, nmId, P1_COMPANY);

    const siteOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteOverride).toBeDefined();
    if (siteOverride!.kind.type === 'attribute-modifier') {
      expect(siteOverride!.kind.op).toBe('override');
      expect(siteOverride!.kind.value).toBe(SiteType.BorderHold);
    }
    // No region override, and no character was tapped.
    expect(afterPlay.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type')).toBe(false);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Untapped);
  });

  test('Mode B — Doors of Night + Free destination region: region-type-override to Border', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        // Border-hold destination so the site-override mode does NOT match;
        // the destination region is Free so the region-override mode does.
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Eriador'],
      }),
    };

    const nmId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, nmId, P1_COMPANY);

    const regionOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    );
    expect(regionOverride).toBeDefined();
    if (regionOverride!.kind.type === 'attribute-modifier') {
      expect(regionOverride!.kind.op).toBe('override');
      expect(regionOverride!.kind.value).toBe(RegionType.Border);
      expect(regionOverride!.kind.filter).toEqual({ 'region.name': 'Eriador' });
    }
    // Site-override mode did not fire (destination is not a Free-hold).
    expect(afterPlay.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type')).toBe(false);
  });

  // ─── "Alternatively" — modes are mutually exclusive ───────────────────────

  test('choosing the tap mode suppresses the arrival-override even when both would apply', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
        resolvedSitePath: [RegionType.Free],
        resolvedSitePathNames: ['Anórien'],
      }),
    };

    const legolasId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, LEGOLAS);
    // Both a Mode A (tap Legolas) and a Mode B (override) action are offered.
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions.some(a => targetOf(a) === legolasId)).toBe(true);
    expect(actions.some(a => targetOf(a) === undefined)).toBe(true);

    const nmId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = dispatch(mhGameState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: nmId,
      targetCompanyId: P1_COMPANY, targetCharacterId: legolasId,
    });
    const resolved = resolveChain(afterPlay);

    // Legolas tapped, and NO region/site override was installed.
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].status).toBe(CardStatus.Tapped);
    expect(resolved.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier'
      && (c.kind.attribute === 'site.type' || c.kind.attribute === 'region.type'))).toBe(false);
  });

  // ─── Cannot be duplicated ─────────────────────────────────────────────────

  test('cannot be duplicated — second copy rejected while the first is on the chain', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON, NEW_MOON], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Anórien'],
      }),
    };

    const firstId = handCardId(mhGameState, HAZARD_PLAYER, 0);
    const afterFirst = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: firstId, targetCompanyId: P1_COMPANY });
    expect(afterFirst.chain).not.toBeNull();

    const actions = viableActions(afterFirst, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated — second copy still rejected after the first resolves (turn constraint persists)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [NEW_MOON, NEW_MOON], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.FreeHold,
      destinationSiteName: 'Minas Tirith',
      resolvedSitePath: [RegionType.Border],
      resolvedSitePathNames: ['Anórien'],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const firstId = handCardId(mhGameState, HAZARD_PLAYER, 0);
    const afterResolve = playHazardAndResolve(mhGameState, PLAYER_2, firstId, P1_COMPANY);
    expect(afterResolve.chain).toBeNull();
    // The Mode B override left a turn-scoped constraint from this card.
    expect(afterResolve.activeConstraints.some(c => c.sourceDefinitionId === NEW_MOON)).toBe(true);

    const actions = viableActions(afterResolve, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
