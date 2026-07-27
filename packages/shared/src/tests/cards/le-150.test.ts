/**
 * @module le-150.test
 *
 * Card test: Webs of Fear & Treachery (le-150)
 * Type: hazard-event, subtype Long-event, alignment neutral, non-unique.
 *
 * Text:
 *   "Except for unused general influence and unused normal direct influence
 *    (including influence modifications given in a character's card text), all
 *    modifications to each influence attempt are reduced to zero."
 *
 * Modeled by a single `nullify-influence-modifications` effect. While a card
 * carrying it sits bare in *either* player's `cardsInPlay`,
 * `influenceModificationsNullified` reports true and every influence-check
 * computation in the engine — the faction-influence display
 * (`legal-actions/site.ts`), the paused faction-influence roll
 * (`legal-actions/pending.ts`), the faction roll resolver (`reducer-site.ts`),
 * the opponent-influence attempt (`reducer-site.ts`) and the rule 10.14 agent
 * influence attempt (`mh-agents.ts`) — collapses to the printed target value
 * plus the two contributions the card spares.
 *
 * Interpretation (the card has no published CRF ruling beyond the point below):
 *
 * - **Kept.** The 2d6 roll(s) and the printed target value (a faction's
 *   influence #, a character's/ally's mind, an in-play faction's influence #);
 *   unused **general** influence; unused **normal** direct influence — the
 *   influencer's *printed* direct influence plus "influence modifications given
 *   in a character's card text" (the `direct-influence` modifiers on his own
 *   card), minus his followers' mind cost; and rules-level (non-card)
 *   modifications: the cross-alignment penalty and the rule 10.14 agent
 *   home-site bonuses. The defender's roll in an opponent-influence attempt is
 *   likewise untouched — Mark Alfano ruled at Worlds 2009 that Webs does not
 *   remove the defensive roll.
 * - **Zeroed.** Every other card-sourced modification: influence
 *   `check-modifier` / `direct-influence` `stat-modifier` effects from items
 *   (rings), attached hazards, allies and other in-play events; the faction
 *   card's own printed "Standard Modifications"; one-shot influence boosts
 *   (Muster and friends), which are still *consumed* but worth 0;
 *   player-, site- and game-wide influence constraints; region
 *   `faction-influence-restriction` environments; and paid
 *   `influence-modification` bonuses.
 *
 * "Normal" direct influence is read as the influence the character has of his
 * own: direct influence granted by a *different* card (a ring, a
 * permanent-event played on him) is a modification from that card's text, not
 * part of his normal DI, so it is nullified along with everything else.
 *
 * Rule coverage:
 * | # | Rule                                                                     | Status      |
 * |---|--------------------------------------------------------------------------|-------------|
 * | 1 | Unused normal direct influence still counts                              | IMPLEMENTED |
 * | 2 | Influence modifications in the influencer's own card text still count     | IMPLEMENTED |
 * | 3 | A faction's printed Standard Modifications are reduced to zero            | IMPLEMENTED |
 * | 4 | A game-wide influence modifier (Times Are Evil td-76) is reduced to zero  | IMPLEMENTED |
 * | 5 | "each influence attempt" — either player's copy hits either player        | IMPLEMENTED |
 * | 6 | The roll resolver agrees with the displayed need (nullified)              | IMPLEMENTED |
 * | 7 | A one-shot influence boost is consumed but contributes zero               | IMPLEMENTED |
 * | 8 | Opponent-influence: DI granted by an item is not "normal" DI              | IMPLEMENTED |
 * | 9 | Opponent-influence: unused general influence and the defender's roll stay | IMPLEMENTED |
 * |10 | Playable from hand as a hazard long-event; resolves bare into play        | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   WEBS (le-150)                   - this card (hazard long-event)
 *   LIEUTENANT_OF_MORGUL (le-22)    - minion character, printed DI 2,
 *                                     "+3 direct influence against … Orc factions" (own card text)
 *   LAGDUF (le-18)                  - orc warrior, DI 0, no effects
 *   CIRYAHER (le-6)                 - dúnadan, mind 4 — opponent-influence target
 *   MINOR_RING (le-324)             - item, unconditional "+2 to direct influence"
 *   GOBLINS_GOBLIN_GATE (le-265)    - Orc faction, influence # 9, at Goblin-gate,
 *                                     "Standard Modifications: Grey Mountain Goblins (+2)"
 *   GREY_MOUNTAIN_GOBLINS (le-266)  - Orc faction; in play it triggers the above modification
 *   TIMES_ARE_EVIL (td-76)          - hazard long-event, "All … influence attempts … -3"
 *   GOBLIN_GATE (le-378)            - shadow-hold, home of Goblins of Goblin-gate
 *   MORIA (le-392)                  - shadow-hold (opponent-influence site)
 *   CARN_DUM (le-359) / MINAS_MORGUL (le-390) - minion havens for site decks
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, dispatchResult, viableActions,
  makeSitePhase, firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  findCharInstanceId, findHandCardId, playHazardAndResolve, buildHazardMovingState,
  Phase, CardStatus, Alignment, PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState,
  FactionInfluenceRollAction,
} from '../../index.js';
import { addConstraint } from '../../engine/pending.js';

const WEBS = 'le-150' as CardDefinitionId;
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;
const CIRYAHER = 'le-6' as CardDefinitionId;
const MINOR_RING = 'le-324' as CardDefinitionId;
const GOBLINS_GOBLIN_GATE = 'le-265' as CardDefinitionId;
const GREY_MOUNTAIN_GOBLINS = 'le-266' as CardDefinitionId;
const TIMES_ARE_EVIL = 'td-76' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;
const MORIA = 'le-392' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;

/** Builds a bare card-in-play entry (faction or bare long/permanent event). */
function inPlay(definitionId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId, status: CardStatus.Untapped };
}

/**
 * Site-phase state: the Lieutenant of Morgul (printed DI 2, "+3 DI against Orc
 * factions" in his own card text) stands at Goblin-gate holding Goblins of
 * Goblin-gate (Orc, influence # 9) in hand.
 *
 * `webs` / `timesAreEvil` seed the named hazard long-event into a player's
 * `cardsInPlay` (`'hazard'` = the opponent's area, `'self'` = the influencing
 * player's own); `greyMountainGoblins` puts the faction whose presence triggers
 * Goblins of Goblin-gate's printed Standard Modification into play.
 */
function buildFactionInfluenceState(opts: {
  webs?: 'hazard' | 'self';
  timesAreEvil?: boolean;
  greyMountainGoblins?: boolean;
} = {}): GameState {
  const selfInPlay: CardInPlay[] = [];
  const hazardInPlay: CardInPlay[] = [];
  if (opts.webs === 'self') selfInPlay.push(inPlay(WEBS, 'webs-1'));
  if (opts.webs === 'hazard') hazardInPlay.push(inPlay(WEBS, 'webs-1'));
  if (opts.timesAreEvil) hazardInPlay.push(inPlay(TIMES_ARE_EVIL, 'tae-1'));
  if (opts.greyMountainGoblins) selfInPlay.push(inPlay(GREY_MOUNTAIN_GOBLINS, 'gmg-1'));

  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: GOBLIN_GATE, characters: [LIEUTENANT_OF_MORGUL] }],
        hand: [GOBLINS_GOBLIN_GATE], siteDeck: [CARN_DUM],
        cardsInPlay: selfInPlay,
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: CARN_DUM, characters: [] }], hand: [], siteDeck: [CARN_DUM],
        cardsInPlay: hazardInPlay,
      },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

/**
 * Site-phase state for an opponent-influence attempt: Lagduf (printed DI 0)
 * bearing a Minor Ring ("+2 to direct influence") faces Ciryaher at Moria.
 */
function buildOpponentInfluenceAtMoria(opts: { webs?: boolean } = {}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [{ defId: LAGDUF, items: [MINOR_RING] }] }],
        hand: [], siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2, alignment: Alignment.Ringwraith,
        companies: [{ site: MORIA, characters: [CIRYAHER] }],
        hand: [], siteDeck: [MINAS_MORGUL],
        cardsInPlay: opts.webs ? [inPlay(WEBS, 'webs-1')] : [],
      },
    ],
  });
  return { ...base, turnNumber: 3, phaseState: makeSitePhase() };
}

/** Declare the influence attempt and pass priority until the chain resolves. */
function resolveToInfluenceRoll(state: GameState): GameState {
  const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
  const attempt = firstFactionInfluenceAttempt(state, factionInst);
  if (!attempt) throw new Error('no influence attempt offered');
  let cur = dispatch(state, attempt);
  for (let i = 0; i < 10 && cur.chain !== null; i++) {
    const pass = viableActions(cur, cur.chain.priority, 'pass-chain-priority');
    if (pass.length === 0) break;
    cur = dispatch(cur, pass[0].action);
  }
  return cur;
}

describe('Webs of Fear & Treachery (le-150)', () => {
  beforeEach(() => resetMint());

  // ─── What survives: normal DI + the influencer's own card text ─────────────

  test('baseline: need 4 — printed DI 2 plus his own card-text +3 against Orc factions', () => {
    // Goblins of Goblin-gate influence # 9; Lieutenant of Morgul contributes
    // DI 2 + 3 = 5 → need 9 - 5 = 4.
    const attempt = firstFactionInfluenceAttempt(
      buildFactionInfluenceState(),
      buildFactionInfluenceState().players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  test('unused normal DI and the influencer’s own card-text modification survive', () => {
    // "Except for unused general influence and unused normal direct influence
    // (including influence modifications given in a character's card text)" —
    // the need is unchanged from the baseline.
    const state = buildFactionInfluenceState({ webs: 'hazard' });
    const factionInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInst);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  // ─── What is zeroed ───────────────────────────────────────────────────────

  test('a faction’s printed Standard Modification is reduced to zero', () => {
    // Goblins of Goblin-gate: "Standard Modifications: Grey Mountain Goblins
    // (+2)". With that faction in play the need drops to 2 …
    const without = buildFactionInfluenceState({ greyMountainGoblins: true });
    const attemptWithout = firstFactionInfluenceAttempt(
      without, without.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attemptWithout!.need).toBe(2);

    // … but the +2 comes from the faction's card text, not the influencer's,
    // so Webs reduces it to zero: back to 4.
    const withWebs = buildFactionInfluenceState({ greyMountainGoblins: true, webs: 'hazard' });
    const attemptWith = firstFactionInfluenceAttempt(
      withWebs, withWebs.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attemptWith!.need).toBe(4);
  });

  test('a game-wide influence modifier (Times Are Evil td-76, -3) is reduced to zero', () => {
    // Times Are Evil alone: need 9 - (5 - 3) = 7 …
    const without = buildFactionInfluenceState({ timesAreEvil: true });
    const attemptWithout = firstFactionInfluenceAttempt(
      without, without.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attemptWithout!.need).toBe(7);

    // … and with Webs the -3 is nullified too — Webs zeroes *all* modifications,
    // even a hazard modification that would help its own controller.
    const withWebs = buildFactionInfluenceState({ timesAreEvil: true, webs: 'hazard' });
    const attemptWith = firstFactionInfluenceAttempt(
      withWebs, withWebs.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attemptWith!.need).toBe(4);
  });

  test('"each influence attempt": the influencing player’s OWN copy nullifies his modifications too', () => {
    // The card is game-wide, not owner-scoped: a copy sitting in the
    // influencer's own play area still strips his Grey Mountain Goblins bonus.
    const state = buildFactionInfluenceState({ greyMountainGoblins: true, webs: 'self' });
    const attempt = firstFactionInfluenceAttempt(
      state, state.players[RESOURCE_PLAYER].hand[0].instanceId,
    );
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(4);
  });

  // ─── Resolution path (pending display + reducer roll) ──────────────────────

  test('the roll resolver agrees with the display: a raw 4 succeeds despite Times Are Evil', () => {
    // Without Webs this attempt would need 7 (see above); with Webs the -3 is
    // gone, so a raw total of 4 clears the nullified need of 4 and the faction
    // comes into play.
    const state = buildFactionInfluenceState({ timesAreEvil: true, webs: 'hazard' });
    let cur = resolveToInfluenceRoll(state);

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(4);

    cur = dispatch({ ...cur, cheatRollTotal: 4 }, rollActions[0].action);

    const inPlayDefIds = cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId);
    expect(inPlayDefIds).toContain(GOBLINS_GOBLIN_GATE);
  });

  test('control: the same raw 4 fails when Times Are Evil is NOT nullified', () => {
    const state = buildFactionInfluenceState({ timesAreEvil: true });
    let cur = resolveToInfluenceRoll(state);

    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(7);

    cur = dispatch({ ...cur, cheatRollTotal: 4 }, rollActions[0].action);

    const inPlayDefIds = cur.players[RESOURCE_PLAYER].cardsInPlay.map(c => c.definitionId);
    expect(inPlayDefIds).not.toContain(GOBLINS_GOBLIN_GATE);
  });

  test('a one-shot influence boost is consumed by the attempt but contributes zero', () => {
    // A Muster-style +5 constraint on the influencer. It was played on this
    // attempt, so it is spent — but the bonus is a modification, so it is
    // reduced to zero and the need stays at 4.
    const base = buildFactionInfluenceState({ webs: 'hazard' });
    const lieutenantId = findCharInstanceId(base, RESOURCE_PLAYER, LIEUTENANT_OF_MORGUL);
    const state = addConstraint(base, {
      source: 'muster-1' as CardInstanceId,
      sourceDefinitionId: 'tw-288' as CardDefinitionId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: lieutenantId },
      kind: { type: 'check-modifier', check: 'influence', value: 5 },
    });

    let cur = resolveToInfluenceRoll(state);
    const rollActions = viableActions(cur, PLAYER_1, 'faction-influence-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as FactionInfluenceRollAction).need).toBe(4);

    cur = dispatch({ ...cur, cheatRollTotal: 4 }, rollActions[0].action);

    // Spent all the same: no influence constraint survives the attempt.
    expect(cur.activeConstraints.filter(
      c => c.kind.type === 'check-modifier' && c.kind.check === 'influence',
    )).toHaveLength(0);
  });

  // ─── Opponent-influence attempts (CoE rule 8.3) ───────────────────────────

  test('opponent-influence baseline: a Minor Ring’s +2 direct influence counts', () => {
    const state = buildOpponentInfluenceAtMoria();
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);
    const attempt = firstOpponentInfluenceAttempt(state, ciryaherId);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Lagduf printed DI 0 + the ring's +2 = 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  test('direct influence granted by an item is not "normal" DI and is reduced to zero', () => {
    const state = buildOpponentInfluenceAtMoria({ webs: true });
    const ciryaherId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);
    const attempt = firstOpponentInfluenceAttempt(state, ciryaherId);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // The ring's bonus comes from the ring's card text, not Lagduf's, so his
    // unused *normal* direct influence is his printed 0.
    expect(pending.kind.attempt.influencerDI).toBe(0);
  });

  test('unused general influence and the defender’s roll are untouched', () => {
    // The card spares unused general influence explicitly, and (Alfano, Worlds
    // 2009) it does not remove the opponent's defensive roll: the attempt is
    // still enqueued as an `opponent-influence-defend` resolution for him.
    const plain = buildOpponentInfluenceAtMoria();
    const webs = buildOpponentInfluenceAtMoria({ webs: true });

    const giOf = (state: GameState): number => {
      const targetId = findCharInstanceId(state, HAZARD_PLAYER, CIRYAHER);
      const attempt = firstOpponentInfluenceAttempt(state, targetId);
      const result = dispatchResult(state, attempt!);
      const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
      if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
      expect(pending.actor).toBe(PLAYER_2);
      return pending.kind.attempt.opponentGI;
    };

    // Both players start with the same unused general influence; Webs leaves it
    // alone, so the two attempts agree.
    expect(giOf(webs)).toBe(giOf(plain));
    expect(giOf(webs)).toBeGreaterThan(0);
  });

  // ─── Playability as a hazard long-event ───────────────────────────────────

  test('playable from hand against a moving company and resolves bare into play', () => {
    // The card has no play restriction beyond being a hazard long-event: the
    // hazard player plays it against the moving company during the M/H phase,
    // and it resolves *bare* (unattached) into his play area — which is where
    // `influenceModificationsNullified` looks for it.
    const mh = buildHazardMovingState(GOBLIN_GATE, 'Goblin-gate', [WEBS], [LAGDUF]);

    const websInst = findHandCardId(mh, HAZARD_PLAYER, WEBS);
    const plays = viableActions(mh, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === websInst);
    expect(plays).toHaveLength(1);

    const companyId = mh.players[RESOURCE_PLAYER].companies[0].id;
    const afterPlay = playHazardAndResolve(mh, PLAYER_2, websInst, companyId);

    const entry = afterPlay.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === WEBS);
    expect(entry).toBeDefined();
    expect(entry!.attachedTo).toBeUndefined();
    expect(entry!.companyId).toBeUndefined();
  });
});
