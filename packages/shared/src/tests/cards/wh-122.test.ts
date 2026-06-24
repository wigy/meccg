/**
 * @module wh-122.test
 *
 * Card test: The White Hand (wh-122)
 * Type: minion-resource-event (permanent), alignment: stage
 * Worth 3 stage points, 6 miscellaneous marshalling points; played on Saruman,
 * granting him +1 prowess and +2 direct influence.
 *
 * Text:
 *   "Saruman specific. Playable on Saruman if he has the following in play: at
 *    least 12 stage points, at least 3 factions, A Strident Spawn, and
 *    Saruman's Machinery. Cannot be duplicated."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                  | Status      |
 * |---|-------------------------------------------------------|-------------|
 * | 1 | Saruman specific (only the Saruman player may play)   | IMPLEMENTED |
 * | 2 | Playable on Saruman (not any other character)         | IMPLEMENTED |
 * | 3 | Requires at least 12 stage points                     | IMPLEMENTED |
 * | 4 | Requires at least 3 factions in play                  | IMPLEMENTED |
 * | 5 | Requires A Strident Spawn in play                     | IMPLEMENTED |
 * | 6 | Requires Saruman's Machinery in play                  | IMPLEMENTED |
 * | 7 | Cannot be duplicated                                  | IMPLEMENTED |
 * | 8 | +1 prowess / +2 direct influence to Saruman           | IMPLEMENTED |
 * | 9 | Contributes 3 stage points while in play              | IMPLEMENTED |
 *
 * The four play prerequisites (rules 3–6) are a single `play-condition`
 * `requires: "player-state"` whose `$and` reads `player.stagePoints >= 12`,
 * `player.factionCount >= 3`, and `{ "inPlay": ... }` for both named cards —
 * the player-state context now exposes `factionCount` and the controller's
 * `inPlay` name list. Rule 2 is a `play-target` `target: "character"` filtered
 * to `target.name: "Saruman"`; rule 7 is a player-scope `duplication-limit`
 * (counts attached copies on characters). Rule 8 is two `stat-modifier`s on the
 * card while borne by Saruman; rule 9 is the `stage-points` effect summed from
 * the bearer's items by `recompute-derived.ts`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  addCardInPlay,
  playPermanentEventAndResolve,
  getCharacter,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** The White Hand — the card under test */
const WHITE_HAND = 'wh-122' as CardDefinitionId;
/** Saruman — the Fallen-wizard avatar this card is played on */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Sly Southerner — a non-Saruman character (negative control for rule 2) */
const SLY_SOUTHERNER = 'wh-10' as CardDefinitionId;
/** A Strident Spawn — a named play prerequisite (stage card, 4 stage points) */
const A_STRIDENT_SPAWN = 'wh-61' as CardDefinitionId;
/** Saruman's Machinery — a named play prerequisite (stage card, 4 stage points) */
const SARUMANS_MACHINERY = 'wh-120' as CardDefinitionId;
/** Saruman's Ring — a filler stage card (2 stage points) */
const SARUMANS_RING = 'wh-121' as CardDefinitionId;
/** Great Patron — a filler stage card (2 stage points) */
const GREAT_PATRON = 'wh-72' as CardDefinitionId;
/** Three factions (count toward the "at least 3 factions" prerequisite) */
const FACTION_A = 'wh-86' as CardDefinitionId; // Greater Half-orcs
const FACTION_B = 'wh-87' as CardDefinitionId; // Half-orcs
const FACTION_C = 'wh-38' as CardDefinitionId; // Beasts of the Wood
/** Isengard — a Fallen-wizard haven */
const ISENGARD_SITE = 'wh-56' as CardDefinitionId;

// ── Builders ─────────────────────────────────────────────────────────────────

/**
 * A Fallen-wizard (Saruman) organization-phase state. `stagePoints` is set
 * directly and the prerequisite/faction cards are appended to `cardsInPlay`,
 * letting each play prerequisite be toggled independently. `recompute: false`
 * keeps the directly-set stage-point total (recompute would re-derive it from
 * the in-play stage cards).
 */
function sarumanOrgState(opts: {
  stagePoints: number;
  cardsInPlay: CardDefinitionId[];
  hand?: CardDefinitionId[];
  characters?: CardDefinitionId[];
}) {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: false,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD_SITE, characters: opts.characters ?? [SARUMAN] }],
        hand: opts.hand ?? [WHITE_HAND],
        siteDeck: [ISENGARD_SITE],
        playDeck: makePlayDeck(),
        stagePoints: opts.stagePoints,
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD_SITE, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD_SITE],
        playDeck: makePlayDeck(),
      },
    ],
  });
  for (const defId of opts.cardsInPlay) {
    state = addCardInPlay(state, 0, defId);
  }
  return state;
}

/** The fully-satisfied set of in-play cards (12 stage points, 3 factions, both named cards). */
const FULL_PREREQS: CardDefinitionId[] = [
  A_STRIDENT_SPAWN, SARUMANS_MACHINERY, SARUMANS_RING, GREAT_PATRON,
  FACTION_A, FACTION_B, FACTION_C,
];

describe('The White Hand (wh-122)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–6: all prerequisites met → playable on Saruman ─────────────────

  test('with all prerequisites met, the card is playable and targets Saruman', () => {
    const state = sarumanOrgState({ stagePoints: 12, cardsInPlay: FULL_PREREQS });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    expect(actions.length).toBe(1);
    expect(targetIds).toContain(sarumanId);
  });

  // ── Rule 2: only Saruman is a legal target, not another company character ──

  test('only Saruman is offered as a target, never another character', () => {
    const state = sarumanOrgState({
      stagePoints: 12,
      cardsInPlay: FULL_PREREQS,
      characters: [SARUMAN, SLY_SOUTHERNER],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const otherId = findCharInstanceId(state, RESOURCE_PLAYER, SLY_SOUTHERNER);
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    expect(targetIds).toContain(sarumanId);
    expect(targetIds).not.toContain(otherId);
    expect(actions.length).toBe(1);
  });

  // ── Rule 1: Saruman specific — a non-Saruman Fallen-wizard may not play it ──

  test('a non-Saruman Fallen-wizard cannot play the card', () => {
    // Same satisfying board, but the avatar is Sly Southerner standing in as a
    // would-be avatar — the wizard-specific gate keys on the revealed avatar's
    // name, which is not "Saruman".
    const state = sarumanOrgState({
      stagePoints: 12,
      cardsInPlay: FULL_PREREQS,
      characters: [SLY_SOUTHERNER],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: at least 12 stage points ───────────────────────────────────────

  test('not playable with only 11 stage points', () => {
    const state = sarumanOrgState({ stagePoints: 11, cardsInPlay: FULL_PREREQS });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 4: at least 3 factions ────────────────────────────────────────────

  test('not playable with only 2 factions in play', () => {
    const state = sarumanOrgState({
      stagePoints: 12,
      cardsInPlay: [A_STRIDENT_SPAWN, SARUMANS_MACHINERY, FACTION_A, FACTION_B],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 5: A Strident Spawn must be in play ───────────────────────────────

  test('not playable while A Strident Spawn is not in play', () => {
    const state = sarumanOrgState({
      stagePoints: 12,
      cardsInPlay: [SARUMANS_MACHINERY, FACTION_A, FACTION_B, FACTION_C],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 6: Saruman's Machinery must be in play ────────────────────────────

  test("not playable while Saruman's Machinery is not in play", () => {
    const state = sarumanOrgState({
      stagePoints: 12,
      cardsInPlay: [A_STRIDENT_SPAWN, FACTION_A, FACTION_B, FACTION_C],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 8: +1 prowess / +2 direct influence to Saruman ────────────────────

  test('while attached, raises Saruman prowess by 1 and direct influence by 2', () => {
    // recompute:true so the avatar's base effective stats are populated before
    // the card is attached; the reduce recomputes after attaching.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_SITE, characters: [SARUMAN] }],
          hand: [WHITE_HAND],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD_SITE, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
      ],
    });

    const beforeProwess = getCharacter(base, RESOURCE_PLAYER, SARUMAN).effectiveStats.prowess;
    const beforeDI = getCharacter(base, RESOURCE_PLAYER, SARUMAN).effectiveStats.directInfluence;
    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WHITE_HAND);

    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, sarumanId);
    const bearer = getCharacter(after, RESOURCE_PLAYER, SARUMAN);

    expect(bearer.effectiveStats.prowess).toBe(beforeProwess + 1);
    expect(bearer.effectiveStats.directInfluence).toBe(beforeDI + 2);
    // The card lives as an item on Saruman (resource permanent-event).
    expect(bearer.items.some(i => i.definitionId === WHITE_HAND)).toBe(true);
  });

  // ── Rule 9: contributes 3 stage points while in play ───────────────────────

  test('contributes 3 stage points once attached to Saruman', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD_SITE, characters: [SARUMAN] }],
          hand: [WHITE_HAND],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD_SITE, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD_SITE],
          playDeck: makePlayDeck(),
        },
      ],
    });
    expect(base.players[0].stagePoints).toBe(0);

    const sarumanId = findCharInstanceId(base, RESOURCE_PLAYER, SARUMAN);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, WHITE_HAND);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, sarumanId);

    expect(after.players[0].stagePoints).toBe(3);
  });

  // ── Rule 7: cannot be duplicated ───────────────────────────────────────────

  test('a second copy cannot be played once one is attached', () => {
    // Stage cards in play sum to 12; after the first copy attaches (+3 from the
    // bearer's items) the total stays ≥12, so the second copy is blocked solely
    // by the duplication limit, not by an unmet prerequisite.
    const state = sarumanOrgState({
      stagePoints: 0,
      cardsInPlay: FULL_PREREQS,
      hand: [WHITE_HAND, WHITE_HAND],
    });
    const sarumanId = findCharInstanceId(state, RESOURCE_PLAYER, SARUMAN);
    const firstId = findHandCardId(state, RESOURCE_PLAYER, WHITE_HAND);

    const attached = playPermanentEventAndResolve(state, PLAYER_1, firstId, sarumanId);
    // After attaching, the recomputed stage total is ≥12 and all prerequisites
    // still hold — but the player-scope duplication limit blocks a second copy.
    expect(attached.players[0].stagePoints).toBeGreaterThanOrEqual(12);
    const actions = viableActions(attached, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });
});
