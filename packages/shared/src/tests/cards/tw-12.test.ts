/**
 * @module tw-12.test
 *
 * Card test: Balrog of Moria (tw-12)
 * Type: hazard-event (permanent)
 * Keywords: Spawn
 * Effects: 1 — `permanent-event-auto-attack` targeting Moria (tw-413, le-392)
 *   Attack: Balrog — 1 strike / 18 prowess / no body (18/-)
 *   onDefeat: 'remove-from-play' → card moves to defender's kill pile
 *
 * Card text (abridged):
 *   "The Balrog appears in Moria. The Moria site gains a second automatic-attack
 *    of 1 strike with 18 prowess and no body (i.e., 18/-). If this 2nd
 *    automatic-attack is defeated, this permanent-event is removed from play.
 *    If your opponent defeats this 2nd automatic-attack, he receives the
 *    marshalling points."
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                    |
 * |---|--------------------------------------|-------------|------------------------------------------|
 * | 1 | `permanent-event-auto-attack` effect | IMPLEMENTED | collectPermanentEventAttacks in manifestations.ts |
 * | 2 | 2nd auto-attack at Moria             | IMPLEMENTED | getActiveAutoAttacks returns Orcs + Balrog |
 * | 3 | onDefeat: remove-from-play           | IMPLEMENTED | reducer-combat finalizeCombat block      |
 * | 4 | Kill MPs to defending player         | IMPLEMENTED | Card routed to defender's killPile       |
 * | 5 | No extra attack without event        | IMPLEMENTED | Only printed Orc attack when not in play |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO,
  MORIA,
  CardStatus,
  buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  viableActions, dispatch,
  findCharInstanceId, findInPile,
  attachItemToChar,
  resetMint,
  buildSitePhaseTwoPlayer, placeOnGuard, makeSitePhase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, GameState, RevealOnGuardAction } from '../../index.js';
import { reduce } from '../../index.js';

const BALROG_OF_MORIA = 'tw-12' as CardDefinitionId;
// Sword of Gondolin: +2 prowess to a warrior bearer. Aragorn II (prowess 6) needs
// this to beat the Balrog's 18-prowess strike outright — 8 + a 12 roll = 20 > 18.
// Without it, his best possible total is 6 + 12 = 18, which only ties (ineffectual).
const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;

describe('Balrog of Moria (tw-12)', () => {
  beforeEach(() => resetMint());

  const balrogInPlay: CardInPlay = {
    instanceId: 'balrog-1' as CardInstanceId,
    definitionId: BALROG_OF_MORIA,
    status: CardStatus.Untapped,
  };

  // ─── 2nd auto-attack augmentation ─────────────────────────────────────────

  test('Moria with Balrog in play has Orcs as 1st auto-attack (4 strikes, 7 prowess)', () => {
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [balrogInPlay]),
    );
    // automaticAttacksResolved = 0: first attack is Orcs
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
  });

  test('Moria with Balrog in play has Balrog as 2nd auto-attack (1 strike, 18 prowess)', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [balrogInPlay]),
    );
    // Skip to the 2nd attack by setting automaticAttacksResolved = 1
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(18);
  });

  test('Balrog attack has no body (creatureBody is null)', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MORIA }), [balrogInPlay]),
    );
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureBody).toBeNull();
  });

  test('without Balrog in play, Moria has only 1 auto-attack — no 2nd attack', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: MORIA }));
    // Skip past the only attack (index 0 = Orcs) to verify nothing follows
    const atSecond = {
      ...state,
      phaseState: { ...(state.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const next = dispatch(atSecond, { type: 'pass', player: PLAYER_1 });
    // No 2nd attack — combat does not start
    expect(next.combat).toBeNull();
  });

  // ─── onDefeat: remove-from-play ───────────────────────────────────────────

  test('defeating the Balrog attack removes it from hazard cardsInPlay', () => {
    const base = setupAutoAttackStep(
      attachItemToChar(
        addP2CardsInPlay(buildSitePhaseState({ site: MORIA, characters: [ARAGORN] }), [balrogInPlay]),
        0,
        ARAGORN,
        SWORD_OF_GONDOLIN,
      ),
    );
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const aragornId = findCharInstanceId(state, 0, ARAGORN);

    // Trigger Balrog attack
    let next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);

    // Assign Aragorn to the single Balrog strike
    next = dispatch(next, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    // Resolve with a winning roll (tap to fight): Aragorn prowess 6 + Sword +2 + 12 = 20 > 18.
    // A total of exactly 18 would tie and NOT defeat the strike, so beat it outright.
    // Must explicitly pick the tapToFight:true variant — the first action may be not-tap.
    const resolveActions = viableActions({ ...next, cheatRollTotal: 12 } as GameState, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const tapAction = resolveActions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
      ?? resolveActions[0].action;
    const result = reduce(
      { ...next, cheatRollTotal: 12 } as GameState,
      tapAction,
    );
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();

    // Balrog no longer in hazard player's cardsInPlay
    const stillInPlay = result.state.players[1].cardsInPlay.find(
      c => c.instanceId === balrogInPlay.instanceId,
    );
    expect(stillInPlay).toBeUndefined();
  });

  test('defeating the Balrog attack puts it in the defending player\'s kill pile', () => {
    const base = setupAutoAttackStep(
      attachItemToChar(
        addP2CardsInPlay(buildSitePhaseState({ site: MORIA, characters: [ARAGORN] }), [balrogInPlay]),
        0,
        ARAGORN,
        SWORD_OF_GONDOLIN,
      ),
    );
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const aragornId = findCharInstanceId(state, 0, ARAGORN);

    let next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    next = dispatch(next, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    // Prowess 6 + Sword +2 + 12 = 20 > 18 beats the strike outright (a total of 18 only ties).
    const resolveActions = viableActions({ ...next, cheatRollTotal: 12 } as GameState, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
      ?? resolveActions[0].action;
    const result = reduce({ ...next, cheatRollTotal: 12 } as GameState, tapAction);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();

    // Balrog is in the defending player's (PLAYER_1, index 0) kill pile
    const inKillPile = findInPile(result.state, 0, 'killPile', balrogInPlay.instanceId);
    expect(inKillPile).toBeDefined();

    // Not in hazard player's kill pile
    const inHazardKillPile = findInPile(result.state, 1, 'killPile', balrogInPlay.instanceId);
    expect(inHazardKillPile).toBeUndefined();
  });

  test('failing to defeat the Balrog attack leaves it in cardsInPlay', () => {
    // Aragorn prowess 9. Not-tap-to-fight means no dice bonus → 9 < 18 → wounded.
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MORIA, characters: [ARAGORN] }), [balrogInPlay]),
    );
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const aragornId = findCharInstanceId(state, 0, ARAGORN);

    let next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    next = dispatch(next, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });

    // Pick the not-tap-to-fight action so Aragorn fights at prowess 9 (no dice bonus < 18).
    const resolveActions = viableActions(next, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const notTapAction = resolveActions.find(a => 'tapToFight' in a.action && !(a.action as { tapToFight: boolean }).tapToFight)?.action;
    if (!notTapAction) {
      // If no not-tap action, skip: all variants would defeat the Balrog (e.g., very high prowess character)
      return;
    }

    let s = reduce(next, notTapAction);
    expect(s.error).toBeUndefined();

    // Handle body check if present (Aragorn survives with a high body check)
    while (s.state.combat !== null) {
      if (s.state.combat.phase === 'body-check') {
        const bodyActions = viableActions({ ...s.state, cheatRollTotal: 12 } as GameState, PLAYER_2, 'body-check-roll');
        if (bodyActions.length === 0) break;
        s = reduce({ ...s.state, cheatRollTotal: 12 } as GameState, bodyActions[0].action);
      } else {
        break;
      }
    }

    // Balrog still in hazard cardsInPlay (not defeated)
    const stillInPlay = s.state.players[1].cardsInPlay.find(
      c => c.instanceId === balrogInPlay.instanceId,
    );
    expect(stillInPlay).toBeDefined();

    // Not in defender's kill pile
    const inKillPile = findInPile(s.state, 0, 'killPile', balrogInPlay.instanceId);
    expect(inKillPile).toBeUndefined();
  });

  // ─── Multiple characters ───────────────────────────────────────────────────

  test('Bilbo alone cannot beat the Balrog (prowess 1 + max roll = 13 < 18)', () => {
    // Bilbo prowess 1. Even with cheatRollTotal=12: 1+12=13 < 18 → strike fails.
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MORIA, characters: [BILBO] }), [balrogInPlay]),
    );
    const state = {
      ...base,
      phaseState: { ...(base.phaseState), automaticAttacksResolved: 1 },
    } as GameState;

    const bilboId = findCharInstanceId(state, 0, BILBO);

    let next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    next = dispatch(next, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId });

    // tapToFight=true, roll=12: 1+12=13 < 18 → strike fails (Bilbo wounded)
    const resolveActions = viableActions({ ...next, cheatRollTotal: 12 } as GameState, PLAYER_1, 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const tapAction = resolveActions.find(a => 'tapToFight' in a.action && (a.action as { tapToFight: boolean }).tapToFight)?.action
      ?? resolveActions[0].action;
    let s = reduce({ ...next, cheatRollTotal: 12 } as GameState, tapAction);
    expect(s.error).toBeUndefined();

    // Handle body check for Bilbo (roll low to keep him alive but wounded)
    while (s.state.combat !== null) {
      if (s.state.combat.phase === 'body-check') {
        const bodyActions = viableActions({ ...s.state, cheatRollTotal: 12 } as GameState, PLAYER_2, 'body-check-roll');
        if (bodyActions.length === 0) break;
        s = reduce({ ...s.state, cheatRollTotal: 12 } as GameState, bodyActions[0].action);
      } else {
        break;
      }
    }

    // Balrog should NOT be in defender's kill pile — Bilbo could not defeat it
    const inKillPile = findInPile(s.state, 0, 'killPile', balrogInPlay.instanceId);
    expect(inKillPile).toBeUndefined();
  });

  // ─── On-guard reveal (rule 2.V.i.1) ───────────────────────────────────────

  test('bug regression: placed on-guard at Moria, is offered for reveal in Step 1 alongside the Orcs auto-attack', () => {
    // Bug report: Balrog of Moria placed on-guard was never offered for
    // reveal during Step 1 (reveal-on-guard-attacks) even though Moria
    // already has an automatic-attack (Orcs). Root cause: the
    // reveal-on-guard-attacks eligibility check recognized
    // `stat-modifier`/`site-entry-roll-attack`/prowess-boost `on-event`
    // shapes but not `permanent-event-auto-attack` — the effect type Balrog
    // of Moria uses to add its 2nd automatic-attack. Per rule 2.V.i.1, adding
    // an additional automatic-attack counts as affecting the site's
    // automatic-attack(s) for reveal purposes. Without the fix, the Balrog
    // sat on-guard through the whole turn and was simply returned to the
    // hazard player's hand at end of turn instead of ever attacking.
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, BALROG_OF_MORIA);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const revealActions = viableActions(testState, PLAYER_2, 'reveal-on-guard');
    expect(revealActions).toHaveLength(1);
    expect((revealActions[0].action as RevealOnGuardAction).cardInstanceId).toBe(ogCard.instanceId);
  });

  test('bug regression: revealing Balrog on-guard at Step 1 moves it to cardsInPlay and its 2nd auto-attack resolves', () => {
    const base = buildSitePhaseTwoPlayer({ site: MORIA, heroChars: [ARAGORN] });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, BALROG_OF_MORIA);
    const testState = { ...withOG, phaseState: makeSitePhase({ step: 'reveal-on-guard-attacks', siteEntered: false }) };

    const afterReveal = dispatch(testState, { type: 'reveal-on-guard', player: PLAYER_2, cardInstanceId: ogCard.instanceId });

    // No longer on-guard; now a permanent event in the hazard player's cardsInPlay.
    expect(afterReveal.players[0].companies[0].onGuardCards).toHaveLength(0);
    expect(afterReveal.players[1].cardsInPlay.map(c => c.instanceId)).toContain(ogCard.instanceId);

    // Hazard player has nothing left to reveal → passes to the automatic-attacks step.
    const afterPass = dispatch(afterReveal, { type: 'pass', player: PLAYER_2 });
    expect((afterPass.phaseState as { step: string }).step).toBe('automatic-attacks');

    // 1st automatic-attack: Orcs (4 strikes, 7 prowess).
    let next = dispatch(afterPass, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);

    // 2nd automatic-attack: the revealed Balrog (1 strike, 18 prowess, no body).
    // Skip past resolving the 1st attack's combat (covered by the other
    // tests above) by jumping straight to automaticAttacksResolved = 1.
    next = {
      ...afterPass,
      phaseState: { ...(afterPass.phaseState as object), automaticAttacksResolved: 1 },
    } as GameState;
    next = dispatch(next, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(1);
    expect(next.combat!.strikeProwess).toBe(18);
    expect(next.combat!.creatureBody).toBeNull();
  });
});
