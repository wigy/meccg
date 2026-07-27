/**
 * @module le-237.test
 *
 * Card test: Swarm of Bats (le-237)
 * Type: minion-resource-event (permanent, company-targeting)
 * Alignment: ringwraith
 * Text:
 *   "Playable at a Darkhaven [{DH}], Shadow-hold [{S}], or Dark-hold [{D}] during the
 *    organization phase on an overt company that has more than one Orc. Any attack
 *    against this company has its prowess and body modified by -1. Discard this card
 *    if a character leaves the company for any reason. Cannot be duplicated on a
 *    given company."
 *
 * Effects:
 * | # | Effect Type          | Status | Notes                                                   |
 * |---|----------------------|--------|---------------------------------------------------------|
 * | 1 | play-target: company | OK     | filter: siteType∈[haven,shadow-hold,dark-hold], overt,  |
 * |   |                      |        | orcCount≥2 — organization-events.ts                     |
 * | 2 | stat-modifier prowess| OK     | -1 to all-attacks, company-scoped — resolver.ts         |
 * | 3 | stat-modifier body   | OK     | -1 to all-attacks, company-scoped — resolver.ts         |
 * | 4 | on-event:company-    | OK     | sweepCompanyMembershipChangedEvents — reducer-utils.ts  |
 * |   | membership-changes   |        |                                                          |
 * | 5 | duplication-limit    | OK     | scope=company, max=1 — organization-events.ts           |
 *
 * Fixtures:
 *   - GORBAG (le-11): orc character, mind 6
 *   - ORC_CAPTAIN (le-31): orc character, mind 3
 *   - ASTERNAK (le-1): man character, mind 3 (not an orc)
 *   - WULUAG (as-6): troll character (overt but not orc), mind 4
 *   - DOL_GULDUR (le-367): siteType=haven (darkhaven)
 *   - MORIA_MINION (le-392): siteType=shadow-hold; auto-attack Orcs 4s/7p
 *   - BARAD_DUR (le-352): siteType=dark-hold
 *   - BAG_END_MINION (le-350): siteType=free-hold (not valid for Swarm)
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  buildSitePhaseState,
  PLAYER_1, PLAYER_2,
  Phase, Alignment, CardStatus,
  viableActions,
  companyIdAt, mint,
  playPermanentEventAndResolve,
  handCardId,
  addP1CardsInPlay,
  setupAutoAttackStep,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInPlay } from '../../index.js';
import { reduce } from '../../engine/reducer.js';
import { resolveAttackBody } from '../../engine/effects/index.js';
import { buildInPlayNames } from '../../engine/recompute-derived.js';
import { Race } from '../../index.js';

const SWARM_OF_BATS = 'le-237' as CardDefinitionId;

const GORBAG = 'le-11' as CardDefinitionId;         // orc, mind 6, prowess 6
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;    // orc, mind 3
const ASTERNAK = 'le-1' as CardDefinitionId;         // man, mind 3 (not orc)
const WULUAG = 'as-6' as CardDefinitionId;           // troll, mind 4 (overt, not orc)

const DOL_GULDUR = 'le-367' as CardDefinitionId;    // haven (darkhaven)
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold; auto-attack Orcs 4s/7p
const BARAD_DUR = 'le-352' as CardDefinitionId;     // dark-hold
const BAG_END_MINION = 'le-350' as CardDefinitionId; // free-hold (not valid)

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Add Swarm of Bats to P1's cardsInPlay bound to the P1 company. */
function addSwarmToP1Company(state: ReturnType<typeof buildTestState>): ReturnType<typeof buildTestState> {
  const compId = companyIdAt(state, RESOURCE_PLAYER);
  const swarmInstance: CardInPlay = {
    instanceId: mint(),
    definitionId: SWARM_OF_BATS,
    status: CardStatus.Untapped,
    companyId: compId,
  };
  return addP1CardsInPlay(state, [swarmInstance]);
}

describe('Swarm of Bats (le-237)', () => {
  beforeEach(() => resetMint());

  // ─── Play restriction: valid site types ──────────────────────────────────

  test('playable at a Darkhaven (siteType=haven) with 2+ Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as { targetCompanyId?: unknown }).targetCompanyId).toBe(
      companyIdAt(state, RESOURCE_PLAYER),
    );
  });

  test('playable at a Shadow-hold with 2+ Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  test('playable at a Dark-hold with 2+ Orcs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
  });

  test('NOT playable at a Free-hold', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BAG_END_MINION, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ─── Play restriction: more than one Orc ─────────────────────────────────

  test('NOT playable when company has exactly one Orc', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, ASTERNAK] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  test('NOT playable when company has no Orcs (Troll + Man overt company)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [WULUAG, ASTERNAK] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });

  // ─── After resolve: card in cardsInPlay bound to company ─────────────────

  test('resolves to cardsInPlay with companyId bound to the target company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const swarmId = handCardId(state, RESOURCE_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, swarmId, undefined, { targetCompanyId: companyId });

    const swarmInPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(
      c => c.definitionId === SWARM_OF_BATS,
    );
    expect(swarmInPlay).toBeDefined();
    expect(swarmInPlay!.companyId).toBe(companyId);
  });

  // ─── Attack modification: prowess -1 (via automatic attack) ─────────────

  test('automatic attack at a site against the bound company has prowess reduced by 1', () => {
    // MORIA_MINION auto-attack: Orcs, 4 strikes, prowess 7
    // With Swarm of Bats: prowess should be 7 - 1 = 6
    const base = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [GORBAG, ORC_CAPTAIN],
    });

    const withSwarm = addSwarmToP1Company(base);
    const attackState = setupAutoAttackStep(withSwarm);

    // Trigger the automatic attack with pass
    const result = reduce(attackState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    // MORIA_MINION Orcs: base 7, reduced by Swarm to 6
    expect(result.state.combat!.strikeProwess).toBe(6);
  });

  test('automatic attack against a company WITHOUT Swarm has unmodified prowess', () => {
    // Same setup but no Swarm in cardsInPlay — verify baseline is 7
    const base = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [GORBAG, ORC_CAPTAIN],
    });

    const attackState = setupAutoAttackStep(base);
    const result = reduce(attackState, { type: 'pass', player: PLAYER_1 });
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeDefined();
    // No Swarm — baseline prowess is 7
    expect(result.state.combat!.strikeProwess).toBe(7);
  });

  // ─── Attack modification: body -1 (via resolver) ─────────────────────────

  test('attack body is reduced by 1 for the bound company', () => {
    const base = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [GORBAG, ORC_CAPTAIN],
    });

    const compId = companyIdAt(base, RESOURCE_PLAYER);
    const withSwarm = addSwarmToP1Company(base);

    // Verify that resolveAttackBody subtracts 1 for the bound company
    const inPlayNames = buildInPlayNames(withSwarm);
    const bodyWithSwarm = resolveAttackBody(withSwarm, 8, inPlayNames, Race.Orc, { companyId: compId });
    const bodyWithout = resolveAttackBody(base, 8, inPlayNames, Race.Orc, { companyId: compId });

    expect(bodyWithout).toBe(8);    // baseline
    expect(bodyWithSwarm).toBe(7);  // reduced by 1
  });

  test('attack body is NOT reduced for a different company', () => {
    const base = buildSitePhaseState({
      site: MORIA_MINION,
      characters: [GORBAG, ORC_CAPTAIN],
    });

    // Swarm bound to P1 company; asking about P2 company — should not reduce
    const p2CompId = companyIdAt(base, HAZARD_PLAYER);
    const withSwarm = addSwarmToP1Company(base);

    const inPlayNames = buildInPlayNames(withSwarm);
    const body = resolveAttackBody(withSwarm, 8, inPlayNames, Race.Orc, { companyId: p2CompId });
    expect(body).toBe(8); // Swarm is on P1's company, not P2's
  });

  // ─── Discard when character leaves ───────────────────────────────────────

  test('discards from cardsInPlay when a character splits from the company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const swarmId = handCardId(state, RESOURCE_PLAYER);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withSwarm = playPermanentEventAndResolve(state, PLAYER_1, swarmId, undefined, { targetCompanyId: companyId });

    expect(withSwarm.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(1);

    // Orc Captain (second character in company) leaves via split-company
    const orcCaptainInstId = withSwarm.players[RESOURCE_PLAYER].companies[0].characters[1];
    const splitResult = reduce(withSwarm, {
      type: 'split-company',
      player: PLAYER_1,
      sourceCompanyId: companyId,
      characterId: orcCaptainInstId,
    });
    expect(splitResult.error).toBeUndefined();
    const afterSplit = splitResult.state;

    // Swarm must be discarded — membership changed
    expect(afterSplit.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(
      afterSplit.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SWARM_OF_BATS),
    ).toBe(true);
  });

  // ─── Duplication limit: one per company ──────────────────────────────────

  test('cannot play a second copy on the same company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG, ORC_CAPTAIN] }],
          hand: [SWARM_OF_BATS],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: BARAD_DUR, characters: [ASTERNAK] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const existingSwarm: CardInPlay = {
      instanceId: mint(),
      definitionId: SWARM_OF_BATS,
      status: CardStatus.Untapped,
      companyId,
    };
    const withExisting = addP1CardsInPlay(state, [existingSwarm]);

    const actions = viableActions(withExisting, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(0);
  });
});
