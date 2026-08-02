/**
 * @module dm-107.test
 *
 * Card test: Durin's Bane (dm-107)
 * Type: hazard-creature (Balrog, Spawn), unique. Strikes 2, prowess 18,
 * body 9, kill MP 5.
 *
 * Card text:
 *   "Unique. Manifestation of Balrog of Moria. Balrog. Two strikes—all body
 *    checks resulting from a successful strike are modified by +1. May be
 *    played at The Under-gates and at all of its adjacent sites. If Doors of
 *    Night is in play, Durin's Bane may be played at any Under-deeps site.
 *    Cannot be included in a Balrog's deck and cannot be played if your
 *    opponent is a Balrog player."
 *
 * Engine Support:
 * | # | Rule                                                     | Encoding                                                    |
 * |---|-----------------------------------------------------------|-------------------------------------------------------------|
 * | 1 | "All body checks ... modified by +1"                      | combat-body-check-modifier { value: 1 }                      |
 * | 2 | "May be played at The Under-gates"                         | keyedTo siteNames: ["The Under-gates"]                       |
 * | 3 | "...and at all of its adjacent sites"                      | keyedTo adjacentToSiteNames: ["The Under-gates"] (new field) |
 * | 4 | "If Doors of Night is in play, ... any Under-deeps site"   | keyedTo siteKeywords: ["under-deeps"], when inPlay DoN       |
 * | 5 | "Cannot be included in a Balrog's deck"                    | deck-restriction excluded-from-deck (rule 1.23)              |
 * | 6 | "cannot be played if your opponent is a Balrog player"     | play-restriction unplayable-when (MEBA)                      |
 *
 * `adjacentToSiteNames` is a new `CreatureKeyRestriction` field (the named-site
 * sibling of `adjacentToSiteKeywords`), added for this card and shared with any
 * future creature keyed to "site X and all of its adjacent sites" (e.g. Spider
 * of the Môrlat dm-110's Sulfur-deeps clause).
 *
 * Playable: YES
 * Certified: 2026-08-02
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, resetMint, makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, findCharInstanceId,
  viableActions, addCardInPlay, dispatch, executeAction,
  pool, HAZARD_CREATURES_12, MINION_RESOURCES_30,
  RIVENDELL, LORIEN, MINAS_TIRITH, ARAGORN,
} from '../test-helpers.js';
import { Phase, Alignment, SiteType, computeLegalActions, validateDeck } from '../../index.js';
import type {
  CardDefinitionId, GameState, DeckList, PlayHazardAction,
} from '../../index.js';

const DURINS_BANE = 'dm-107' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const BOROMIR = 'tw-134' as CardDefinitionId; // hero warrior, prowess 6, body 7
const AZOG = 'ba-2' as CardDefinitionId; // Balrog-specific character

const BASE_SITE_KEYING = { method: 'site-name' as const, value: 'The Under-gates' };
const ADJACENT_SITE_KEYING = { method: 'adjacent-to-site-name' as const, value: 'The Under-gates' };
const UNDER_DEEPS_KEYING = { method: 'site-keyword' as const, value: 'under-deeps' };

/** Build a Movement/Hazard state: P1 (hero, moving) vs P2 (hazard, holding Durin's Bane). */
function setup(opts: {
  destinationSiteName: string;
  destinationSiteType: SiteType;
  characters?: CardDefinitionId[];
  doorsOfNight?: boolean;
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: opts.characters ?? [BOROMIR] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [DURINS_BANE], siteDeck: [] },
    ],
  });
  const withDon = opts.doorsOfNight ? addCardInPlay(base, HAZARD_PLAYER, DOORS_OF_NIGHT) : base;
  return {
    ...withDon,
    phaseState: makeMHState({
      resolvedSitePath: [],
      resolvedSitePathNames: [],
      destinationSiteType: opts.destinationSiteType,
      destinationSiteName: opts.destinationSiteName,
    }),
  };
}

describe("Durin's Bane (dm-107)", () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: keyed to The Under-gates itself ───────────────────────────────

  test('playable at The Under-gates itself', () => {
    const state = setup({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, BASE_SITE_KEYING);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('balrog');
  });

  // ─── Rule 3: keyed to a site adjacent to The Under-gates ───────────────────

  test('playable at Moria — an adjacent site of The Under-gates — without Doors of Night', () => {
    const state = setup({ destinationSiteName: 'Moria', destinationSiteType: SiteType.ShadowHold });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, ADJACENT_SITE_KEYING);
    expect(after.combat).not.toBeNull();
  });

  test('NOT playable at The Under-vaults (not adjacent to The Under-gates) without Doors of Night', () => {
    const state = setup({ destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    const all = computeLegalActions(state, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
  });

  // ─── Rule 4: Doors of Night — playable at any Under-deeps site ─────────────

  test('with Doors of Night in play, playable at The Under-vaults (any Under-deeps site)', () => {
    const state = setup({
      destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs, doorsOfNight: true,
    });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays.length).toBeGreaterThan(0);

    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, UNDER_DEEPS_KEYING);
    expect(after.combat).not.toBeNull();
  });

  test('without Doors of Night, The Under-vaults stays unkeyable', () => {
    const state = setup({
      destinationSiteName: 'The Under-vaults', destinationSiteType: SiteType.RuinsAndLairs, doorsOfNight: false,
    });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Rule 1: +1 to body checks resulting from successful strikes ──────────

  test('combat carries a +1 body-check modifier', () => {
    const state = setup({ destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, BASE_SITE_KEYING);
    expect(after.combat!.bodyCheckModifier).toBe(1);
  });

  test('the +1 modifier turns a survived body check into an elimination', () => {
    // BOROMIR (tw-134): prowess 6, body 7, starts untapped/unwounded. A second
    // character (ARAGORN) fills Durin's Bane's other strike so each of the 2
    // strikes goes to a distinct character (no excess-strike assignment needed).
    const state = setup({
      destinationSiteName: 'The Under-gates', destinationSiteType: SiteType.ShadowHold,
      characters: [ARAGORN, BOROMIR],
    });
    const creatureId = handCardId(state, HAZARD_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const afterPlay = playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, BASE_SITE_KEYING);

    const aragornId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, ARAGORN);
    const boromirId = findCharInstanceId(afterPlay, RESOURCE_PLAYER, BOROMIR);
    const assigned1 = dispatch(afterPlay, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    const assigned2 = dispatch(assigned1, { type: 'assign-strike', player: PLAYER_1, characterId: boromirId });
    expect(assigned2.combat!.phase).toBe('choose-strike-order');

    const boromirStrikeIndex = assigned2.combat!.strikeAssignments.findIndex(a => a.characterId === boromirId);
    const ordered = dispatch(assigned2, { type: 'choose-strike-order', player: PLAYER_1, strikeIndex: boromirStrikeIndex });

    // Strike roll 2: characterTotal = 6 (prowess) + 2 (roll) = 8, well under
    // Durin's Bane's prowess 18 — the strike succeeds, Boromir is wounded and
    // faces a body check (first wound this combat, so no pre-existing +1).
    const afterStrike = executeAction(ordered, PLAYER_1, 'resolve-strike', 2);
    expect(afterStrike.combat!.phase).toBe('body-check');
    const done = executeAction(afterStrike, PLAYER_2, 'body-check-roll', 7);

    // Body-check roll total 7: without the card's modifier, 7 is not > body 7
    // (survives). With Durin's Bane's +1, 7 + 1 = 8 > 7 — eliminated.
    expect(done.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === boromirId)).toBe(true);
  });

  // ─── Rule 5: cannot be included in a Balrog's deck ─────────────────────────

  test('a Balrog deck containing Durin\'s Bane is rejected by deck validation', () => {
    const deck: DeckList = {
      id: 'test-balrog-durins-bane',
      name: 'Balrog Durin\'s Bane',
      alignment: 'balrog',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Ettenmoors', card: 'le-373' as CardDefinitionId, qty: 1 }],
      deck: {
        characters: [{ name: 'Azog', card: AZOG, qty: 1 }],
        hazards: [...HAZARD_CREATURES_12, { name: "Durin's Bane", card: DURINS_BANE, qty: 1 }],
        resources: [...MINION_RESOURCES_30],
      },
    };
    const errors = validateDeck(deck, pool);
    expect(errors.some(e => e.card === DURINS_BANE)).toBe(true);
  });

  test('is not excluded from a hero deck', () => {
    const deck: DeckList = {
      id: 'test-hero-durins-bane',
      name: "Hero Durin's Bane",
      alignment: 'hero',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Rivendell', card: RIVENDELL, qty: 1 }],
      deck: {
        characters: [],
        hazards: [...HAZARD_CREATURES_12, { name: "Durin's Bane", card: DURINS_BANE, qty: 1 }],
        resources: [...MINION_RESOURCES_30],
      },
    };
    const bannedErrors = validateDeck(deck, pool)
      .filter(e => e.card === DURINS_BANE && e.message.includes('not allowed'));
    expect(bannedErrors).toHaveLength(0);
  });

  // ─── Rule 6: cannot be played if your opponent is a Balrog player (MEBA) ──

  test('unplayable when the opponent (moving player) is a Balrog player', () => {
    // The Under-vaults (ba-103), not one of the Balrog's cancel-attacks
    // Darkhavens, so keying succeeds and the only reason left to fail is the
    // MEBA opponent-alignment restriction itself.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: RIVENDELL, characters: [AZOG] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [DURINS_BANE], siteDeck: [] },
      ],
    });
    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const ready: GameState = {
      ...withDon,
      phaseState: makeMHState({
        resolvedSitePath: [], resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'The Under-vaults',
      }),
    };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);
    // applyDeclaredPlayRestrictions rewrites the blocked play into a generic
    // `not-playable` entry (action-builders.ts `notPlayable`), not a
    // non-viable `play-hazard` — find it by the card's own instance id.
    const durinsBaneId = handCardId(ready, HAZARD_PLAYER);
    const blocked = computeLegalActions(ready, PLAYER_2)
      .find(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === durinsBaneId);
    expect(blocked?.reason ?? '').toMatch(/Balrog/i);
  });

  test('mirror-match exemption: playable when both players are Balrog', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: RIVENDELL, characters: [AZOG] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Balrog, companies: [{ site: RIVENDELL, characters: [] }], hand: [DURINS_BANE], siteDeck: [] },
      ],
    });
    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    const ready: GameState = {
      ...withDon,
      phaseState: makeMHState({
        resolvedSitePath: [], resolvedSitePathNames: [],
        destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'The Under-vaults',
      }),
    };

    const plays = computeLegalActions(ready, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard')
      .map(ea => ea as { viable: boolean; action: PlayHazardAction });
    expect(plays.length).toBeGreaterThan(0);
    // Not blocked by the opponent-Balrog restriction (actor is also Balrog);
    // any remaining non-viability would have to come from a different reason.
    expect(plays.some(ea => ea.viable)).toBe(true);
  });
});
