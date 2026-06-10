/**
 * @module le-286.test
 *
 * Card test: Snaga-hai (le-286)
 * Type: minion-resource-faction (orc, NON-unique, 1 MP, influence # 10)
 *
 * "Playable at any tapped or untapped Shadow-hold [{S}] if the influence check
 *  is greater than 9. Once in play, the number required to influence this
 *  faction is 0."
 *
 * Key rules modelled:
 * - `playableAt: [{ siteType: "shadow-hold" }]` — playable at ANY shadow-hold,
 *   not a single named site.
 * - `play-flag: playable-at-tapped-site` — the faction may be influenced even
 *   when the company's current site is already tapped, overriding the default
 *   "factions require an untapped site" rule (CoE 2.V.3). This is the card's
 *   distinguishing "tapped or untapped" clause.
 * - `unique: false` — Snaga-hai is the only non-unique faction in the pool;
 *   multiple copies may be in play at once, so the faction-duplicate gate in
 *   legal-actions/site.ts must not block a second copy.
 * - `influenceNumber: 10` — "greater than 9" means the modified roll must be
 *   ≥ 10 (engine compares `total >= influenceNumber`). `need = 10 - modifier`.
 * - `inPlayInfluenceNumber: 0` — once in play, the opponent re-influence
 *   threshold (CoE 8.3) is 0.
 *
 * Engine Support:
 * | # | Feature                                                  | Status      |
 * |---|----------------------------------------------------------|-------------|
 * | 1 | Playable at any shadow-hold (siteType entry)             | IMPLEMENTED |
 * | 2 | Influence # 10 (greater than 9)                          | IMPLEMENTED |
 * | 3 | Playable at an ALREADY-TAPPED shadow-hold (play-flag)    | IMPLEMENTED |
 * | 4 | NOT playable at a non-shadow-hold site                   | IMPLEMENTED |
 * | 5 | Non-unique: duplicate copies in play do not block        | IMPLEMENTED |
 * | 6 | Opponent re-influence while in play (value = 0)          | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  makeSitePhase, setCompanySiteStatus,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId,
} from '../../index.js';

const SNAGA_HAI = 'le-286' as CardDefinitionId;
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // unique faction, home = Goblin-gate (a shadow-hold)

const CIRYAHER = 'le-6' as CardDefinitionId;   // dúnadan scout/sage, DI 2, no influence effects
const LAGDUF = 'le-18' as CardDefinitionId;     // orc warrior, DI 0, no influence effects

const MORIA = 'le-392' as CardDefinitionId;        // shadow-hold (Redhorn Gate)
const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // shadow-hold (High Pass), also le-265's home
const ETTENMOORS = 'le-373' as CardDefinitionId;   // ruins-and-lairs (Rhudaur) — NOT a shadow-hold

const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven (site-deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven

describe('Snaga-hai (le-286)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at an untapped Shadow-hold; need = 10 - DI', () => {
    // Ciryaher (DI 2) at Moria (shadow-hold). need = influenceNumber(10) - DI(2) = 8.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [SNAGA_HAI], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('influence # 10 ("greater than 9"): a DI-0 influencer needs a modified roll of 10', () => {
    // Lagduf (DI 0) at Moria. need = influenceNumber(10) - DI(0) = 10.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [SNAGA_HAI], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('playable at an ALREADY-TAPPED Shadow-hold; a normal faction at the same tapped site is not', () => {
    // Goblin-gate is a shadow-hold and the home of Goblins of Goblin-gate (le-265, unique).
    // Both factions are in hand; the site is tapped. Snaga-hai carries
    // `playable-at-tapped-site`, so it remains influence-able; the ordinary
    // faction is rejected because factions normally require an untapped site.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: GOBLIN_GATE, characters: [CIRYAHER] }], hand: [SNAGA_HAI, GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...setCompanySiteStatus(base, 0, 0, CardStatus.Tapped), phaseState: makeSitePhase() };

    const snagaId = state.players[0].hand.find(c => c.definitionId === SNAGA_HAI)!.instanceId;
    const goblinsId = state.players[0].hand.find(c => c.definitionId === GOBLINS_OF_GOBLIN_GATE)!.instanceId;

    const snagaAttempt = firstFactionInfluenceAttempt(state, snagaId);
    expect(snagaAttempt).toBeDefined();
    expect(snagaAttempt!.need).toBe(8); // 10 - DI(2)

    const goblinsAttempt = firstFactionInfluenceAttempt(state, goblinsId);
    expect(goblinsAttempt).toBeUndefined();
  });

  test('NOT influence-able at a non-Shadow-hold site', () => {
    // Ettenmoors is ruins-and-lairs, not a shadow-hold.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [CIRYAHER] }], hand: [SNAGA_HAI], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeUndefined();
  });

  test('non-unique: a copy already in the controller\'s play area does not block a second', () => {
    // Snaga-hai is non-unique; the duplicate-in-play gate must not fire.
    const copyInPlay: CardInPlay = {
      instanceId: 'snaga-own-1' as CardInstanceId,
      definitionId: SNAGA_HAI,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [SNAGA_HAI], siteDeck: [DOL_GULDUR], cardsInPlay: [copyInPlay] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('non-unique: a copy in the OPPONENT\'s play area does not block', () => {
    const copyInPlay: CardInPlay = {
      instanceId: 'snaga-opp-1' as CardInstanceId,
      definitionId: SNAGA_HAI,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [SNAGA_HAI], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [copyInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(8);
  });

  test('opponent can re-influence Snaga-hai while in play at a Shadow-hold; value = 0', () => {
    // CoE 8.3: the in-play influence threshold is the card's inPlayInfluenceNumber (0).
    // PLAYER_2 controls Snaga-hai; PLAYER_1 is the active resource player at the same shadow-hold.
    const factionInPlay: CardInPlay = {
      instanceId: 'snaga-inplay-1' as CardInstanceId,
      definitionId: SNAGA_HAI,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [CIRYAHER] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MORIA, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR], cardsInPlay: [factionInPlay] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, factionInPlay.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
    expect(attempt!.explanation).toContain('faction in-play influence #: 0');
  });
});
