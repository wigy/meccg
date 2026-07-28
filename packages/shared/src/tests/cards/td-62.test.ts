/**
 * @module td-62.test
 *
 * Card test: Scatha at Home (td-62)
 * Type: hazard-event (Permanent-event), neutral, unique,
 *       keyword `dragon-manifestation`, manifestId td-60 (Scatha).
 *
 * Text:
 *   "Unique. Unless Scatha Ahunt is in play, Gondmaeglom has an additional
 *    automatic-attack: Dragon — 3 strikes at 16/9. In addition, -1 to all
 *    influence attempts."
 *
 * Effects:
 * | # | Effect Type    | Status | Notes                                                          |
 * |---|----------------|--------|----------------------------------------------------------------|
 * | 1 | dragon-at-home | OK     | +Dragon (3 strikes, 16 prowess) on Gondmaeglom — hero td-177    |
 * |   |                |        | and minion le-379, both `lairOf` td-60; suppressed while Scatha |
 * |   |                |        | Ahunt (td-61, the same chain's long-event) is in play           |
 * | 2 | check-modifier | OK     | -1 to every influence attempt by EITHER player                  |
 * |   |                |        | (`check: "influence"`, `target: "all-in-play"`, the td-76       |
 * |   |                |        | Times Are Evil game-wide scope)                                 |
 *
 * The augment attack's printed "/9" body follows the codebase convention for
 * Dragon lair auto-attacks: every printed Dragon-lair automatic-attack
 * (including Gondmaeglom's own 1×14) is modeled with strikes+prowess only, so
 * the augment is likewise modeled as {Dragon, 3 strikes, 16 prowess}.
 *
 * Rule coverage:
 * | # | Rule                                                                    | Status      |
 * |---|-------------------------------------------------------------------------|-------------|
 * | 1 | Card resolves bare into the play area (not bound to the hazarded company)| IMPLEMENTED |
 * | 2 | Gondmaeglom gains a second automatic-attack: Dragon 3 strikes at 16      | IMPLEMENTED |
 * | 3 | Both site versions are augmented (hero td-177, minion le-379)           | IMPLEMENTED |
 * | 4 | Scatha Ahunt (td-61) in play suppresses the augmentation                | IMPLEMENTED |
 * | 5 | Only Scatha's lair is augmented, not another Dragon's lair              | IMPLEMENTED |
 * | 6 | -1 to an influence attempt while the card is in the OPPONENT's play area| IMPLEMENTED |
 * | 7 | -1 also to the card owner's OWN influence attempts ("all")              | IMPLEMENTED |
 * | 8 | The -1 is applied at roll resolution, not only in the display           | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   SCATHA_AT_HOME (td-62)        - this card (hazard permanent-event)
 *   SCATHA_AHUNT (td-61)          - the same chain's long-event (suppressor)
 *   GONDMAEGLOM_HERO (td-177)     - Scatha's lair, hero version, Dragon 1×14
 *   GONDMAEGLOM_MINION (le-379)   - Scatha's lair, minion version, Dragon 1×14
 *   LONELY_MOUNTAIN (tw-428)      - a different Dragon's lair (Smaug, tw-90)
 *   LAGDUF (le-18)                - orc character, DI 0, no effects (influencer)
 *   GOBLINS_GOBLIN_GATE (le-265)  - orc faction, influence # 9, at Goblin-gate
 *   GOBLIN_GATE (le-378)          - shadow-hold (home of GOBLINS_GOBLIN_GATE)
 *   CARN_DUM (le-359)             - minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  LORIEN, RIVENDELL, MINAS_TIRITH, MORIA,
  buildTestState, resetMint, makeMHState, makeSitePhase,
  addCardInPlay, handCardId, companyIdAt, playHazardAndResolve,
  dispatch, viableActions, firstFactionInfluenceAttempt,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { getActiveAutoAttacks } from '../../engine/manifestations.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, SiteCard, FactionInfluenceRollAction,
} from '../../index.js';

const SCATHA_AT_HOME = 'td-62' as CardDefinitionId;
const SCATHA_AHUNT = 'td-61' as CardDefinitionId;
const GONDMAEGLOM_HERO = 'td-177' as CardDefinitionId;   // Scatha's lair (lairOf td-60), hero version
const GONDMAEGLOM_MINION = 'le-379' as CardDefinitionId; // Scatha's lair (lairOf td-60), minion version
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;    // Smaug's lair — a different Dragon
const LAGDUF = 'le-18' as CardDefinitionId;
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Scatha at Home (td-62)', () => {
  beforeEach(() => resetMint());

  // ─── placement in play ────────────────────────────────────────────────────

  test('enters the general play area — not bound to the hazarded company', () => {
    // Scatha at Home declares no `play-target`: it augments Gondmaeglom's
    // automatic-attacks and every influence attempt in the game, regardless of
    // company. The company named by the play-hazard action is only the company
    // being hazarded (hazard-limit bookkeeping) and must NOT bind the card.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SCATHA_AT_HOME], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };
    const cardId = handCardId(mhState, HAZARD_PLAYER);
    const companyId = companyIdAt(mhState, RESOURCE_PLAYER);
    const s = playHazardAndResolve(mhState, PLAYER_2, cardId, companyId);

    const inPlay = s.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SCATHA_AT_HOME);
    expect(inPlay).toBeDefined();
    expect(inPlay!.companyId).toBeUndefined();
  });

  // ─── dragon-at-home augmentation ──────────────────────────────────────────

  test('Gondmaeglom has only its printed Dragon attack when no At-Home is in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gondmaeglom = state.cardPool[GONDMAEGLOM_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, gondmaeglom);
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
  });

  test('At-Home in play appends the extra Dragon (3 strikes, 16 prowess) to hero Gondmaeglom', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME);
    const gondmaeglom = state.cardPool[GONDMAEGLOM_HERO] as SiteCard;
    const attacks = getActiveAutoAttacks(state, gondmaeglom);
    expect(attacks).toHaveLength(2);
    expect(attacks[0]).toMatchObject({ creatureType: 'Dragon', strikes: 1, prowess: 14 });
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 16 });
  });

  test('At-Home also augments the minion version of Gondmaeglom (le-379)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME);
    const gondmaeglomMinion = state.cardPool[GONDMAEGLOM_MINION] as SiteCard;
    const attacks = getActiveAutoAttacks(state, gondmaeglomMinion);
    expect(attacks).toHaveLength(2);
    expect(attacks[1]).toMatchObject({ creatureType: 'Dragon', strikes: 3, prowess: 16 });
  });

  test('Scatha Ahunt in play suppresses the At-Home augmentation', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME), HAZARD_PLAYER, SCATHA_AHUNT);
    expect(getActiveAutoAttacks(state, state.cardPool[GONDMAEGLOM_HERO] as SiteCard)).toHaveLength(1);
    expect(getActiveAutoAttacks(state, state.cardPool[GONDMAEGLOM_MINION] as SiteCard)).toHaveLength(1);
  });

  test("At-Home augments only Scatha's lair, not a different Dragon's lair", () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME);
    // The Lonely Mountain is Smaug's lair (tw-90) → unaffected by Scatha at Home.
    expect(getActiveAutoAttacks(state, state.cardPool[LONELY_MOUNTAIN] as SiteCard)).toHaveLength(1);
  });

  // ─── check-modifier: -1 to all influence attempts ─────────────────────────

  test('baseline: influence attempt need is 9 with no At-Home in play', () => {
    // Lagduf (DI 0) influencing Goblins of Goblin-gate (inf# 9): need = 9.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('adds -1 (need 9 → 10) when the At-Home sits in the OPPONENT play area', () => {
    // Game-wide scope: the hazard player's card penalises the resource player's
    // influence attempt.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state: GameState = { ...addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME), phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test("adds -1 (need 9 → 10) even to the card owner's OWN influence attempts", () => {
    // "-1 to all influence attempts" — not owner-scoped-to-benefit; it hurts the
    // influencing player even when that player controls the At-Home.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state: GameState = { ...addCardInPlay(base, RESOURCE_PLAYER, SCATHA_AT_HOME), phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(10);
  });

  test('the -1 is applied at roll resolution: a roll passing at need 9 fails at need 10', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state: GameState = { ...addCardInPlay(base, HAZARD_PLAYER, SCATHA_AT_HOME), phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    // Declare the attempt (opens the chain), then pass priority until the chain
    // resolves to the paused faction-influence-roll.
    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(10);

    // Force a raw roll total of 9 (would pass at need 9) and resolve.
    cur = { ...cur, cheatRollTotal: 9 };
    cur = dispatch(cur, rollActions[0].action);

    // -1 applied → total 8 < 9 → attempt failed → faction NOT in play.
    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).not.toContain(GOBLINS_GOBLIN_GATE);
  });

  test('control: the same raw roll of 9 succeeds when the At-Home is NOT in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: GOBLIN_GATE, characters: [LAGDUF] }],
          hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeSitePhase() };
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();

    let cur = dispatch(state, attempt!);
    for (let i = 0; i < 10 && cur.chain !== null; i++) {
      const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
      if (pass.length === 0) break;
      cur = dispatch(cur, pass[0].action);
    }

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(9);

    cur = { ...cur, cheatRollTotal: 9 };
    cur = dispatch(cur, rollActions[0].action);

    expect(cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId)).toContain(GOBLINS_GOBLIN_GATE);
  });
});
