/**
 * @module le-302.test
 *
 * Card test: Blazon of the Eye (le-302)
 * Type: minion-resource-item (minor, corruption 1)
 *
 * "+2 to direct influence against factions. Cannot be duplicated on a given
 *  character."
 *
 * This tests:
 * 1. stat-modifier: +2 DI during faction-influence-check
 * 2. duplication-limit: max 1 per character (scope "character")
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                           |
 * |---|------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | +2 DI vs factions (faction-influence)    | IMPLEMENTED | stat-modifier direct-influence in site.ts       |
 * | 2 | One copy max per character               | IMPLEMENTED | duplication-limit scope:character in site.ts    |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-resource-item (ringwraith). Tests use minion
 * characters (LE) and a minion shadow-hold so the item sits on legal bearers.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase,
  firstFactionInfluenceAttempt,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BLAZON_OF_THE_EYE = 'le-302' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;

const CIRYAHER = 'le-6' as CardDefinitionId;      // dúnadan scout/sage, DI 2, no effects
const GORBAG = 'le-11' as CardDefinitionId;       // orc warrior/scout, DI 0
const LAGDUF = 'le-18' as CardDefinitionId;       // orc warrior, DI 0, no effects

const GOBLIN_GATE = 'le-378' as CardDefinitionId; // shadow-hold (minor items playable)
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven (site deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;// minion haven

describe('Blazon of the Eye (le-302)', () => {
  beforeEach(() => resetMint());

  // ── stat-modifier: +2 DI during faction-influence-check ──

  test('Ciryaher baseline need vs Goblins of Goblin-gate without Blazon', () => {
    // Ciryaher (DI 2, no effects) at Goblin-gate with Goblins of Goblin-gate
    // in hand. No Grey Mountain Goblins in play → modifier = DI 2.
    // need = influenceNumber(9) - DI(2) = 7.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(7);
  });

  test('+2 DI bonus applies during faction influence check', () => {
    // Same setup but Ciryaher carries Blazon of the Eye.
    //   modifier = DI 2 + Blazon DI bonus 2 = 4
    //   need = 9 - 4 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [{ defId: CIRYAHER, items: [BLAZON_OF_THE_EYE] }] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(ciryaherId);
    expect(attempt!.need).toBe(5);
  });

  // ── duplication-limit: scope "character", max 1 ──

  test('duplication limit: second Blazon cannot be played on the same character', () => {
    // Ciryaher already carries one Blazon. A second Blazon in hand should
    // NOT be playable on Ciryaher (duplication-limit scope:character max:1),
    // but SHOULD be playable on Gorbag (different character, no Blazon yet).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: GOBLIN_GATE,
            characters: [
              { defId: CIRYAHER, items: [BLAZON_OF_THE_EYE] },
              GORBAG,
            ],
          }],
          hand: [BLAZON_OF_THE_EYE],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const actions = computeLegalActions(state, PLAYER_1);

    // Should NOT be playable on Ciryaher (already has one)
    const onCiryaher = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === ciryaherId,
    );
    expect(onCiryaher).toBeUndefined();

    // SHOULD be playable on Gorbag (no Blazon yet)
    const onGorbag = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === gorbagId,
    );
    expect(onGorbag).toBeDefined();
  });

  test('first Blazon can be played on a character with no Blazons', () => {
    // Ciryaher has no items. Blazon of the Eye should be playable on him.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [BLAZON_OF_THE_EYE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const ciryaherId = findCharInstanceId(state, RESOURCE_PLAYER, CIRYAHER);
    const actions = computeLegalActions(state, PLAYER_1);

    const onCiryaher = actions.find(
      a => a.viable
        && a.action.type === 'play-hero-resource'
        && a.action.attachToCharacterId === ciryaherId,
    );
    expect(onCiryaher).toBeDefined();
  });
});
