/**
 * @module wh-81.test
 *
 * Card test: Spells Born of Discord (wh-81)
 * Type: minion-resource-event (permanent), alignment: stage, starting-item
 *
 * Text:
 *   "Your Fallen-wizard may use sorcery, spirit-magic, and shadow-magic.
 *    Cannot be duplicated by a given player."
 *
 * | # | Rule                                                 | Status      |
 * |---|------------------------------------------------------|-------------|
 * | 1 | Your Fallen-wizard may use sorcery                  | IMPLEMENTED |
 * | 2 | Your Fallen-wizard may use spirit-magic             | IMPLEMENTED |
 * | 3 | Your Fallen-wizard may use shadow-magic             | IMPLEMENTED |
 * | 4 | Cannot be duplicated by a given player              | IMPLEMENTED |
 * | 5 | Stage points (2) while in play                      | IMPLEMENTED |
 *
 * Modeling:
 *  - Rules 1-3: three `grant-skill` effects with `recipient:
 *    "own-fallen-wizard"`. The card is a general permanent event in its
 *    controller's `cardsInPlay`; `getEffectiveSkills` adds the skills to that
 *    player's Fallen-wizard only (not other characters, not the opponent's
 *    Fallen-wizard). Verified via certified magic-skill-gated probes:
 *    Govern the Storms (wh-45, sorcery), Words of Menace and Deceit (le-258,
 *    spirit-magic), Deeper Shadow (le-179, shadow-magic). Radagast (wh-8) is
 *    used as the Fallen-wizard because he has none of these skills printed.
 *  - Rule 4: `duplication-limit` `scope: "player"`, `max: 1`.
 *  - Rule 5: `stage-points` value 2.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, makePlayDeck, resetMint, makeMHState,
  viableActions, addCardInPlay, addCardToHand, recomputeDerived,
  findCharInstanceId, findHandCardId, shortEventTargetIds,
  playPermanentEventAndResolve,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import { Phase, Alignment, RegionType, SiteType } from '../../index.js';

/** Spells Born of Discord — the card under test. */
const SPELLS_BORN_OF_DISCORD = 'wh-81' as CardDefinitionId;
/** Radagast — Fallen-wizard avatar with no printed magic skill. */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Dorelas — a normal Man, no magic skill (not a Fallen-wizard). */
const DORELAS = 'le-8' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rivendell — filler opposing haven. */
const RIVENDELL = 'tw-421' as CardDefinitionId;
/** Aragorn — filler opposing character. */
const ARAGORN = 'tw-120' as CardDefinitionId;
/** Minas Tirith — filler opposing site. */
const MINAS_TIRITH = 'tw-412' as CardDefinitionId;

/** Govern the Storms — sorcery-skill play-target probe (certified wh-45). */
const GOVERN_STORMS = 'wh-45' as CardDefinitionId;
/** Words of Menace and Deceit — spirit-magic-skill play-target probe (certified le-258). */
const WORDS_OF_MENACE = 'le-258' as CardDefinitionId;
/** Deeper Shadow — shadow-magic-skill probe (certified le-179), needs a moving company. */
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;
/** Ettenmoors — minion ruins-and-lairs destination for the M/H scenario. */
const ETTENMOORS = 'le-373' as CardDefinitionId;
/** Dol Guldur — minion haven (site of origin for the M/H scenario). */
const DOL_GULDUR = 'le-367' as CardDefinitionId;
/** Moria (minion) — filler siteDeck entry. */
const MORIA_MINION = 'le-392' as CardDefinitionId;

/** Organization-phase setup: Radagast + Dorelas at Isengard; opponent is also a Fallen-wizard player. */
const ORG_CONFIG: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      alignment: Alignment.FallenWizard,
      companies: [{ site: ISENGARD, characters: [RADAGAST, DORELAS] }],
      hand: [] as CardDefinitionId[],
      siteDeck: [ISENGARD],
      playDeck: makePlayDeck(),
    },
    {
      id: PLAYER_2,
      alignment: Alignment.FallenWizard,
      companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
      hand: [] as CardDefinitionId[],
      siteDeck: [MINAS_TIRITH],
      playDeck: makePlayDeck(),
    },
  ],
};

/** Moving-company setup: Radagast travelling Dol Guldur → Ettenmoors with Deeper Shadow in hand. */
const MH_CONFIG: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  players: [
    {
      id: PLAYER_1,
      alignment: Alignment.FallenWizard,
      companies: [{ site: DOL_GULDUR, destinationSite: ETTENMOORS, characters: [RADAGAST] }],
      hand: [DEEPER_SHADOW],
      siteDeck: [MORIA_MINION],
    },
    {
      id: PLAYER_2,
      companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
      hand: [] as CardDefinitionId[],
      siteDeck: [MINAS_TIRITH],
    },
  ],
};

/** M/H phase state for the moving company (shadow-land + wilderness path). */
const MH_PHASE = {
  activeCompanyIndex: 0,
  siteRevealed: true,
  destinationSiteType: SiteType.RuinsAndLairs,
  destinationSiteName: 'Ettenmoors',
  resolvedSitePath: [RegionType.Shadow, RegionType.Wilderness],
  resolvedSitePathNames: ['Angmar', 'Rhudaur'],
};

describe('Spells Born of Discord (wh-81)', () => {
  beforeEach(() => resetMint());

  // ── Rule 5 + playability: played as a general permanent event ──────────────

  test('playable from hand in organization; adds 2 stage points while in play', () => {
    const state = addCardToHand(buildTestState(ORG_CONFIG), RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);

    const cardId = findHandCardId(state, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD);
    expect(state.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cardId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SPELLS_BORN_OF_DISCORD)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);

    // Once played, the Fallen-wizard can use sorcery.
    const radagastId = findCharInstanceId(after, RESOURCE_PLAYER, RADAGAST) as string;
    expect(shortEventTargetIds(after, PLAYER_1, RESOURCE_PLAYER, GOVERN_STORMS)).toContain(radagastId);
  });

  // ── Rule 1: sorcery ───────────────────────────────────────────────────────

  test('Fallen-wizard may use sorcery (Govern the Storms targets him); other characters may not', () => {
    const without = buildTestState(ORG_CONFIG);
    const radagastId = findCharInstanceId(without, RESOURCE_PLAYER, RADAGAST) as string;
    const dorelasId = findCharInstanceId(without, RESOURCE_PLAYER, DORELAS) as string;
    expect(shortEventTargetIds(without, PLAYER_1, RESOURCE_PLAYER, GOVERN_STORMS)).not.toContain(radagastId);

    const withCard = recomputeDerived(addCardInPlay(without, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD));
    const targets = shortEventTargetIds(withCard, PLAYER_1, RESOURCE_PLAYER, GOVERN_STORMS);
    expect(targets).toContain(radagastId);
    expect(targets).not.toContain(dorelasId);
  });

  // ── Rule 2: spirit-magic ──────────────────────────────────────────────────

  test('Fallen-wizard may use spirit-magic (Words of Menace and Deceit targets him)', () => {
    const without = buildTestState(ORG_CONFIG);
    const radagastId = findCharInstanceId(without, RESOURCE_PLAYER, RADAGAST) as string;
    const dorelasId = findCharInstanceId(without, RESOURCE_PLAYER, DORELAS) as string;
    expect(shortEventTargetIds(without, PLAYER_1, RESOURCE_PLAYER, WORDS_OF_MENACE)).not.toContain(radagastId);

    const withCard = recomputeDerived(addCardInPlay(without, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD));
    const targets = shortEventTargetIds(withCard, PLAYER_1, RESOURCE_PLAYER, WORDS_OF_MENACE);
    expect(targets).toContain(radagastId);
    expect(targets).not.toContain(dorelasId);
  });

  test('"Your" Fallen-wizard: the opponent\'s copy grants nothing to this player\'s Fallen-wizard', () => {
    const state = recomputeDerived(addCardInPlay(buildTestState(ORG_CONFIG), HAZARD_PLAYER, SPELLS_BORN_OF_DISCORD));
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST) as string;
    expect(shortEventTargetIds(state, PLAYER_1, RESOURCE_PLAYER, GOVERN_STORMS)).not.toContain(radagastId);
    expect(shortEventTargetIds(state, PLAYER_1, RESOURCE_PLAYER, WORDS_OF_MENACE)).not.toContain(radagastId);
  });

  // ── Rule 3: shadow-magic ──────────────────────────────────────────────────

  test('Fallen-wizard may use shadow-magic (Deeper Shadow playable for his moving company)', () => {
    const base = buildTestState(MH_CONFIG);
    const without: GameState = { ...base, phaseState: makeMHState(MH_PHASE) };
    expect(viableActions(without, PLAYER_1, 'play-short-event')).toHaveLength(0);

    const withCard: GameState = {
      ...addCardInPlay(base, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD),
      phaseState: makeMHState(MH_PHASE),
    };
    expect(viableActions(withCard, PLAYER_1, 'play-short-event').length).toBeGreaterThan(0);
  });

  // ── Rule 4: cannot be duplicated by a given player ────────────────────────

  test('a second copy is not playable while one is already in play for this player', () => {
    let state = addCardInPlay(buildTestState(ORG_CONFIG), RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD);
    state = addCardToHand(state, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('the opponent\'s copy does not block this player from playing one', () => {
    let state = addCardInPlay(buildTestState(ORG_CONFIG), HAZARD_PLAYER, SPELLS_BORN_OF_DISCORD);
    state = addCardToHand(state, RESOURCE_PLAYER, SPELLS_BORN_OF_DISCORD);
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(1);
  });
});
