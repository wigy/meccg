/**
 * @module ba-28.test
 *
 * Card test: Ungoliant's Foul Issue (ba-28)
 * Type: hazard-event (permanent), Unique, Spawn, 4 kill MP.
 *
 * Card text (authoritative — data/cards.json BA-28):
 *   "Unique. Spawn. Ancient Deep-hold has an additional automatic-attack:
 *    Spawn — 2 strikes with 17/7 prowess/body. In addition, non-unique Spider
 *    creatures can be keyed to Under-deeps Ruins & Lairs [{R}] and
 *    Shadow-holds [{S}]."
 *
 * The second sentence was missing from the imported local `text` and is
 * restored this pass; the auto-attack effect was missing `onDefeat` (the
 * ba-21/ba-24 latent bug, CoE rule 964 — a kill-MP hazard-event that creates
 * an attack goes to the defender's marshalling-point pile when defeated).
 *
 * Since ba-83 was certified (2026-07-13) it carries three printed Undead
 * automatic-attacks (4×7, 3×8, 2×10), so the Foul Issue Spawn is appended as
 * the *fourth* attack (index 3). The auto-attack tests below jump to that
 * index via `automaticAttacksResolved: 3` (mirroring ba-24's `atSecondAttack`).
 *
 * Effects:
 *   1. `permanent-event-auto-attack` targeting Ancient Deep-hold (ba-83):
 *      Spawn — 2 strikes / 17 prowess / 7 body, `onDefeat: "remove-from-play"`.
 *   2. `grant-creature-keying` (new primitive): while in play, any hazard
 *      creature whose definition is a non-unique Spider may be keyed to any
 *      site whose effective type is Ruins & Lairs / Shadow-hold and which
 *      carries the `under-deeps` keyword.
 *
 * Engine Support:
 * | # | Feature                                            | Status      | Notes                                            |
 * |---|----------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | `permanent-event-auto-attack` augmentation         | IMPLEMENTED | collectPermanentEventAttacks in manifestations.ts |
 * | 2 | onDefeat: remove-from-play → defender kill pile     | IMPLEMENTED | combat-finalize.ts (shared with tw-12/ba-21/24)  |
 * | 3 | No 4th attack at ba-83 without the event in play   | IMPLEMENTED | getActiveAutoAttacks appends only when in play   |
 * | 4 | `grant-creature-keying` — non-unique Spider bypass  | IMPLEMENTED | inPlayGrantsCreatureKeying (new, movement-hazard) |
 * | 5 | Grant excludes unique Spiders / non-Spiders         | IMPLEMENTED | creatureFilter `$and` race+unique                |
 * | 6 | Grant requires the `under-deeps` keyword            | IMPLEMENTED | siteFilter.siteKeywords ["under-deeps"]          |
 *
 * Playable: YES
 * Certified: 2026-07-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, LORIEN, MINAS_TIRITH, BANDIT_LAIR,
  resetMint,
  buildTestState, buildSitePhaseState, makeMHState,
  addP2CardsInPlay, setupAutoAttackStep,
  viableActions, dispatch, findCharInstanceId, findInPile,
} from '../test-helpers.js';
import { Phase, Alignment, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayHazardAction,
} from '../../index.js';

const UNGOLIANTS_FOUL_ISSUE = 'ba-28' as CardDefinitionId;
const ANCIENT_DEEP_HOLD = 'ba-83' as CardDefinitionId;       // balrog-site targeted by the augment
const THE_UNDER_GROTTOS = 'ba-101' as CardDefinitionId;      // Under-deeps Ruins & Lairs [{R}]
const THE_UNDER_LEAS = 'ba-102' as CardDefinitionId;         // Under-deeps Shadow-hold [{S}]
const BOROMIR = 'tw-134' as CardDefinitionId;                // prowess 6 (2nd defender for a 2-strike attack)
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;         // Balrog company filler
// Shelob's Brood: non-unique Spider with an EMPTY keyedTo — normally keyable
// nowhere, so its keyability isolates the grant.
const SHELOBS_BROOD = 'ba-13' as CardDefinitionId;
// Spider of the Môrlat: a UNIQUE Spider (empty keyedTo) — excluded by the grant.
const SPIDER_OF_MORLAT = 'dm-110' as CardDefinitionId;
// Assassin: a Man (not a Spider), keyed to {B}{F} — never bypassed by the grant.
const ASSASSIN = 'tw-8' as CardDefinitionId;

/** A fixed in-play instance of Ungoliant's Foul Issue. */
const foulIssueInPlay: CardInPlay = {
  instanceId: 'foul-issue-1' as CardInstanceId,
  definitionId: UNGOLIANTS_FOUL_ISSUE,
  status: CardStatus.Untapped,
};

/**
 * Ancient Deep-hold (ba-83) has three printed Undead automatic-attacks
 * (indices 0–2); the Foul Issue Spawn augment is appended at index 3. Jump the
 * site-phase step straight to that fourth attack so the tests exercise the
 * augment without driving through the three intrinsic attacks first.
 */
const atSpawnAttack = (state: GameState): GameState => ({
  ...state,
  phaseState: { ...state.phaseState, automaticAttacksResolved: 3 },
} as GameState);

/**
 * Balrog company (defended by PLAYER_1) at `site` in the Movement/Hazard phase;
 * the Wizard hazard player (PLAYER_2) holds `hazardHand` and — when
 * `withFoulIssue` — has Ungoliant's Foul Issue in play.
 */
function mhAt(site: CardDefinitionId, hazardHand: CardDefinitionId[], withFoulIssue: boolean): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: hazardHand, siteDeck: [MINAS_TIRITH],
        cardsInPlay: withFoulIssue ? [foulIssueInPlay] : [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/**
 * Whether the hazard player is offered a viable `play-hazard` for `instanceId`
 * that is keyed via the keying-bypass method (i.e. the grant made it keyable).
 */
function offeredViaKeyingBypass(state: GameState, instanceId: CardInstanceId): boolean {
  return viableActions(state, PLAYER_2, 'play-hazard').some(ea => {
    const a = ea.action as PlayHazardAction;
    return a.cardInstanceId === instanceId && a.keyedBy?.method === 'keying-bypass';
  });
}

describe("Ungoliant's Foul Issue (ba-28)", () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: permanent-event auto-attack at Ancient Deep-hold ────────────

  test('Ancient Deep-hold gains the Spawn auto-attack (2 strikes, 17 prowess, 7 body) while in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ANCIENT_DEEP_HOLD, characters: [ARAGORN, BOROMIR] }), [foulIssueInPlay]),
    );
    // Skip the three printed Undead attacks (indices 0–2) → the appended Spawn (index 3).
    const next = dispatch(atSpawnAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(17);
    expect(next.combat!.creatureBody).toBe(7);
  });

  test('without Ungoliant\'s Foul Issue in play, Ancient Deep-hold has no such attack', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: ANCIENT_DEEP_HOLD, characters: [ARAGORN, BOROMIR] }));
    // ba-83's three printed Undead attacks (indices 0–2) are already resolved; without
    // the event there is no fourth attack, so nothing fires.
    const next = dispatch(atSpawnAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  test('defeating the Spawn auto-attack removes the event to the defending player\'s kill pile (onDefeat)', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ANCIENT_DEEP_HOLD, characters: [ARAGORN, BOROMIR] }), [foulIssueInPlay]),
    );
    let s = dispatch(atSpawnAttack(base), { type: 'pass', player: PLAYER_1 });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikesTotal).toBe(2);

    const aragornId = findCharInstanceId(s, RESOURCE_PLAYER, ARAGORN);
    const boromirId = findCharInstanceId(s, RESOURCE_PLAYER, BOROMIR);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: boromirId });

    // Drive the whole attack to completion with max rolls: both strikes are
    // parried (prowess 6 + 12 = 18 > 17) and each creature body check (12 > 7)
    // slays the Spawn. Whatever the intermediate phases, every strike ends as a
    // 'success', so the attack is defeated → onDefeat fires.
    let guard = 0;
    while (s.combat !== null && guard++ < 30) {
      const cheat = { ...s, cheatRollTotal: 12 } as GameState;
      const order = viableActions(cheat, PLAYER_1, 'choose-strike-order');
      if (order.length) { s = dispatch(cheat, order[0].action); continue; }
      const resolve = viableActions(cheat, PLAYER_1, 'resolve-strike');
      if (resolve.length) {
        const tap = resolve.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
          ?? resolve[0].action;
        s = dispatch(cheat, tap); continue;
      }
      const bcDef = viableActions(cheat, PLAYER_1, 'body-check-roll');
      if (bcDef.length) { s = dispatch(cheat, bcDef[0].action); continue; }
      const bcAtk = viableActions(cheat, PLAYER_2, 'body-check-roll');
      if (bcAtk.length) { s = dispatch(cheat, bcAtk[0].action); continue; }
      break;
    }

    expect(s.combat).toBeNull();
    // Card removed from the hazard player's cardsInPlay …
    expect(s.players[HAZARD_PLAYER].cardsInPlay.find(c => c.instanceId === foulIssueInPlay.instanceId)).toBeUndefined();
    // … and delivered to the defending (PLAYER_1) player's kill pile for its 4 MP.
    expect(findInPile(s, RESOURCE_PLAYER, 'killPile', foulIssueInPlay.instanceId)).toBeDefined();
    expect(findInPile(s, HAZARD_PLAYER, 'killPile', foulIssueInPlay.instanceId)).toBeUndefined();
  });

  // ─── Effect 2: grant-creature-keying (non-unique Spider bypass) ────────────

  test('a non-unique Spider (Shelob\'s Brood, no keying) is keyable at an Under-deeps Ruins & Lairs while in play', () => {
    const state = mhAt(THE_UNDER_GROTTOS, [SHELOBS_BROOD], true);
    const broodId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, broodId)).toBe(true);
  });

  test('a non-unique Spider is keyable at an Under-deeps Shadow-hold while in play', () => {
    const state = mhAt(THE_UNDER_LEAS, [SHELOBS_BROOD], true);
    const broodId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, broodId)).toBe(true);
  });

  test('without the event in play, the same Spider is NOT keyable at the Under-deeps Ruins & Lairs', () => {
    const state = mhAt(THE_UNDER_GROTTOS, [SHELOBS_BROOD], false);
    const broodId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, broodId)).toBe(false);
    // No normal keying either (empty keyedTo) → no viable play-hazard at all.
    expect(viableActions(state, PLAYER_2, 'play-hazard').some(ea => (ea.action as PlayHazardAction).cardInstanceId === broodId)).toBe(false);
  });

  test('a UNIQUE Spider (Spider of the Môrlat) is NOT keyed by the grant (non-unique clause)', () => {
    const state = mhAt(THE_UNDER_GROTTOS, [SPIDER_OF_MORLAT], true);
    const spiderId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, spiderId)).toBe(false);
  });

  test('a non-Spider creature (Assassin) is NOT keyed by the grant at the Under-deeps Ruins & Lairs', () => {
    const state = mhAt(THE_UNDER_GROTTOS, [ASSASSIN], true);
    const assassinId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, assassinId)).toBe(false);
  });

  test('the grant requires the under-deeps keyword: a non-unique Spider is NOT keyable at a surface Ruins & Lairs (Bandit Lair)', () => {
    const state = mhAt(BANDIT_LAIR, [SHELOBS_BROOD], true);
    const broodId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, broodId)).toBe(false);
    expect(viableActions(state, PLAYER_2, 'play-hazard').some(ea => (ea.action as PlayHazardAction).cardInstanceId === broodId)).toBe(false);
  });
});
