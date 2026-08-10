/**
 * @module wh-82.test
 *
 * Card test: Thrall of the Voice (wh-82)
 * Type: hero-resource-event (permanent, fallen-wizard alignment)
 *
 * Card text:
 *   "Instead of a normal character, during your organization phase you may
 *    bring into play one character (including a minion agent) with up to a 6
 *    mind. Place this card with the character. -1 to his mind to a minimum of
 *    1. Such a character may also be in your starting company."
 *
 * The CRF/French printing clarifies: the special play counts against the
 * one-character-per-turn limit, and the card "cannot be used to … allow a
 * Fallen-wizard player to bring an Orc or Troll character into play without an
 * appropriate card".
 *
 * Implemented as a `recruitment-vehicle` effect (maxMind 6) plus the original
 * `stat-modifier` (mind, "-1 … min 1") and a `starting-company-placement`:
 *  - Organization phase (rules 1–3): when the Fallen-wizard holds Thrall,
 *    `playCharacterActions` emits a `play-character` carrying
 *    `viaRecruitmentInstanceId` for a character whose printed mind exceeds the
 *    Fallen-wizard maximum of 5 (up to maxMind 6) and is not an Orc/Troll; the
 *    influence cost uses the reduced mind. `handlePlayCharacter` places Thrall
 *    with the recruit (attaches it, removing it from hand) and consumes the
 *    one-character-per-turn slot. `recomputeDerived` then reduces the recruit's
 *    mind by one (floor 1).
 *  - Setup (rule 4): Thrall is a Stage resource drafted during the character
 *    draft (rules 1.42/1.44). Drafting it lifts the Fallen-wizard restriction on
 *    drafting mind > 5 / agent characters; at draft finalize it is attached to a
 *    qualifying drafted character, reducing that character's mind, so such a
 *    character may be in the starting company.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Recruit a character (mind ≤ 6, incl. minion agent) instead of | OK     |
 * |   | a normal character, within the one-character-per-turn limit   |        |
 * | 2 | Place this card with the recruited character                  | OK     |
 * | 3 | -1 to the borne character's mind, to a minimum of 1           | OK     |
 * | 4 | Such a character may also be in your starting company         | OK     |
 * | 5 | Stage resource: contributes 1 stage point while in play       | OK     |
 *
 * Note: drafting Thrall lifts the Fallen-wizard mind > 5 / agent draft gate
 * (rules 1.42/1.44, covered by their own rule tests); rule 4 here is exercised
 * as its positive outcome — a mind-6 character drafted after Thrall sits in the
 * FW starting company with Thrall attached to it, reducing its mind.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA,
  resetMint, buildTestState, attachItemToChar, getCharacter,
  recomputeDerived, dispatch, createGame, draftInstId, runActions, makePlayDeck, pool,
  Phase, Alignment, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { formatCharacterLine } from '../../format-cards.js';
import type { CardDefinitionId, CardInstanceId, GameState, GameConfig } from '../../index.js';

const THRALL_OF_THE_VOICE = 'wh-82' as CardDefinitionId;
const IVIC = 'dm-17' as CardDefinitionId;          // minion agent, mind 6 (→ 5)
const BILL_FERNY = 'dm-3' as CardDefinitionId;      // minion agent, mind 3 (→ 2)
const ORC_BRAWLER = 'le-30' as CardDefinitionId;    // orc, mind 1 (→ floor 1)
const GIMLI = 'tw-159' as CardDefinitionId;         // hero character, mind 6, not an agent, not Orc/Troll
const BALIN = 'tw-123' as CardDefinitionId;         // hero character, mind 5 — non-gated draft filler
const GORBAG = 'le-11' as CardDefinitionId;         // orc, mind 6 — excluded by the CRF Orc/Troll clause
const ARAGORN = 'tw-120' as CardDefinitionId;       // mind 9 — exceeds the vehicle's maxMind of 6
const AMON_HEN = 'tw-371' as CardDefinitionId;      // a Ruins & Lairs (FW company's filler site)
const WIZARDHAVEN = 'wh-56' as CardDefinitionId;    // Isengard — a Fallen-wizard Wizardhaven (recruits enter play here)
const RIVENDELL = 'tw-421' as CardDefinitionId;
const OPPONENT_CHAR = 'tw-155' as CardDefinitionId; // Gamling the Old — opponent filler

/**
 * Build a Fallen-wizard company holding `charDef`, attach Thrall of the Voice
 * to that character, recompute derived stats, and return the resulting state.
 */
function thrallAttachedState(charDef: CardDefinitionId) {
  let state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [charDef] }], hand: [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
    ],
  });
  state = attachItemToChar(state, RESOURCE_PLAYER, charDef, THRALL_OF_THE_VOICE);
  return recomputeDerived(state);
}

/**
 * Build a Fallen-wizard organization-phase state: a filler company at Amon Hen,
 * a Wizardhaven (Isengard) in the site deck (where recruits may enter play),
 * and `hand` in the FW player's hand.
 */
function fwOrgState(hand: CardDefinitionId[]): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [BILL_FERNY] }], hand, siteDeck: [WIZARDHAVEN] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

function recruitmentPlays(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId
      && (a.action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId !== undefined,
  );
}

function anyPlay(state: GameState, charDef: CardDefinitionId) {
  const charId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === charDef)?.instanceId;
  return computeLegalActions(state, PLAYER_1).filter(
    a => a.viable && a.action.type === 'play-character'
      && (a.action as { characterInstanceId?: CardInstanceId }).characterInstanceId === charId,
  );
}

describe('Thrall of the Voice (wh-82)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: recruit an otherwise-ineligible character ───────────────────────

  test('without Thrall, a Fallen-wizard cannot bring a mind-6 character into play', () => {
    expect(anyPlay(fwOrgState([GIMLI]), GIMLI)).toHaveLength(0);
  });

  test('with Thrall, a mind-6 character may be recruited (via the vehicle)', () => {
    const state = fwOrgState([GIMLI, THRALL_OF_THE_VOICE]);
    const thrallId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THRALL_OF_THE_VOICE)!.instanceId;
    const plays = recruitmentPlays(state, GIMLI);
    expect(plays.length).toBeGreaterThan(0);
    expect((plays[0].action as { viaRecruitmentInstanceId?: CardInstanceId }).viaRecruitmentInstanceId).toBe(thrallId);
  });

  test('Thrall is never offered as a standalone play-permanent-event — only bundled with a character recruit', () => {
    // Bug report: a player played a second Thrall of the Voice as a bare
    // permanent event (no character target); it resolved into play unattached
    // in cardsInPlay, permanently spent with no character to pair it with, so
    // a character played later could never use it. The card text is explicit
    // — "Instead of a normal character... Place this card with the character"
    // — so its only organization-phase play mode is bundled with a
    // play-character action via viaRecruitmentInstanceId; it must never appear
    // as a standalone play-permanent-event action.
    const state = fwOrgState([GIMLI, THRALL_OF_THE_VOICE]);
    const thrallId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THRALL_OF_THE_VOICE)!.instanceId;
    const standalonePlays = computeLegalActions(state, PLAYER_1).filter(
      a => a.viable && a.action.type === 'play-permanent-event'
        && (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === thrallId,
    );
    expect(standalonePlays).toHaveLength(0);
  });

  test('a mind-6 minion agent (Ivic) is blocked for a Fallen-wizard without Thrall', () => {
    // Ivic is a mind-6 agent: without the vehicle the Fallen-wizard mind cap of
    // 5 blocks it. The vehicle path (exercised with Gimli) is what lifts the
    // cap; "(including a minion agent)" is covered by the same mind > 5 rule.
    expect(anyPlay(fwOrgState([IVIC]), IVIC)).toHaveLength(0);
  });

  test('the CRF clause: Thrall cannot bring an Orc into play (Gorbag, mind 6)', () => {
    const state = fwOrgState([GORBAG, THRALL_OF_THE_VOICE]);
    expect(anyPlay(state, GORBAG)).toHaveLength(0);
  });

  test('Thrall cannot bring a character whose mind exceeds 6 (Aragorn, mind 9)', () => {
    const state = fwOrgState([ARAGORN, THRALL_OF_THE_VOICE]);
    expect(anyPlay(state, ARAGORN)).toHaveLength(0);
  });

  // ── Rules 2 + 3: place the card with the recruit; -1 to his mind ────────────

  test('recruiting places Thrall with the character, reduces its mind, and consumes the turn slot', () => {
    const state = fwOrgState([GIMLI, THRALL_OF_THE_VOICE]);
    const thrallId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THRALL_OF_THE_VOICE)!.instanceId;
    const play = recruitmentPlays(state, GIMLI)[0];

    const after = recomputeDerived(dispatch(state, play.action));

    // Gimli is in play with Thrall placed on him (in his items), removed from hand.
    const gimli = getCharacter(after, RESOURCE_PLAYER, GIMLI);
    expect(gimli).toBeDefined();
    expect(gimli.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === thrallId)).toBe(false);

    // -1 to his mind (6 → 5).
    expect(gimli.effectiveStats.mind).toBe(5);

    // Counts against the one-character-per-turn limit.
    expect((after.phaseState as { characterPlayedThisTurn?: boolean }).characterPlayedThisTurn).toBe(true);
  });

  // ── Rule 3: -1 to mind, with the floor, via direct attachment ───────────────

  test('reduces a mind-6 agent to an effective mind of 5', () => {
    expect(getCharacter(thrallAttachedState(IVIC), RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBe(5);
  });

  test('reduces a mind-3 character to an effective mind of 2', () => {
    expect(getCharacter(thrallAttachedState(BILL_FERNY), RESOURCE_PLAYER, BILL_FERNY).effectiveStats.mind).toBe(2);
  });

  test('does not reduce a mind-1 character below 1', () => {
    expect(getCharacter(thrallAttachedState(ORC_BRAWLER), RESOURCE_PLAYER, ORC_BRAWLER).effectiveStats.mind).toBe(1);
  });

  test('the formatted character line shows the reduced mind, not the printed mind', () => {
    // Bug report: a player attached Thrall of the Voice to Théoden (printed mind
    // 6) and the text-client's character line kept showing "6 Mind" instead of
    // reflecting the -1 reduction, because formatCharacterLine read the raw
    // definition's `mind` instead of the character's effective (post-modifier)
    // mind — unlike direct-influence, which was already read from effectiveStats.
    const state = thrallAttachedState(BILL_FERNY);
    const char = getCharacter(state, RESOURCE_PLAYER, BILL_FERNY);
    const defOf = (id: CardDefinitionId) => state.cardPool[id];
    const instOf = (id: CardInstanceId) => (id === char.instanceId ? char.definitionId : undefined);
    const line = formatCharacterLine(char, defOf, instOf);
    expect(line).toContain('2 Mind');
    expect(line).not.toContain('3 Mind');
  });

  test('mind is unmodified when the card is not attached', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [IVIC] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, IVIC).effectiveStats.mind).toBeUndefined();
  });

  // ── Stage points: Thrall is a Stage resource worth 1 stage point ────────────

  test('a Thrall in play contributes 1 stage point to its Fallen-wizard', () => {
    expect(thrallAttachedState(IVIC).players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  test('two Thralls in play contribute 2 stage points', () => {
    let state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.FallenWizard, companies: [{ site: AMON_HEN, characters: [IVIC, BILL_FERNY] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [OPPONENT_CHAR] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, IVIC, THRALL_OF_THE_VOICE);
    state = attachItemToChar(state, RESOURCE_PLAYER, BILL_FERNY, THRALL_OF_THE_VOICE);
    expect(recomputeDerived(state).players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ── Rule 4: such a character may also be in your starting company ───────────

  test('drafted during the character draft, Thrall attaches to a mind-6 starting character and reduces its mind', () => {
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, GIMLI], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Round 1: the Fallen-wizard drafts Thrall — a Stage resource that resolves
    // into play immediately (CoE 1.9.F4) without using a character pick — lifting
    // the mind > 5 gate; the opponent picks their (only) character, emptying their
    // pool. The Fallen-wizard then drafts the mind-6 character Thrall enables as
    // the round's character pick, which reveals against the opponent's pick.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    // The opponent has now exhausted and auto-stopped; the Fallen-wizard drafts
    // the mind-6 character, which empties the pool and auto-finalises the draft.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, GIMLI) },
    ]);

    // Draft finalised: Thrall is attached to Gimli, in the FW starting company.
    state = recomputeDerived(state);
    const gimli = getCharacter(state, RESOURCE_PLAYER, GIMLI);
    expect(gimli.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    // …and its mind (6) is reduced to 5.
    expect(gimli.effectiveStats.mind).toBe(5);
  });

  test('with several drafted characters, Thrall is placed with the gated (mind-6) one, not a mind-5 filler', () => {
    // Regression: on the draft board the Thrall must render beside the very
    // character it ends up placed with — not in a separate row. Engine placement
    // and the renderer share `resolveThrallCharacterPairings`, so asserting the
    // engine attaches Thrall to the right character among several guards the
    // pairing the board displays. A single Thrall enables exactly one gated
    // (mind > 5) character (rules 1.42/1.44), so the other drafted characters are
    // ordinary mind ≤ 5 ones; Thrall must hang beside the mind-6 character.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, GIMLI, BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Thrall first — it resolves immediately and lifts the mind > 5 gate without
    // using a character pick; the opponent's single pick empties their pool.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    // The Fallen-wizard drafts the gated mind-6 character (consuming the vehicle)
    // and a mind-5 filler; the last pick empties the pool and auto-finalises.
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, GIMLI) }]);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) }]);

    state = recomputeDerived(state);
    const gimli = getCharacter(state, RESOURCE_PLAYER, GIMLI); // mind 6 (gated)
    const balin = getCharacter(state, RESOURCE_PLAYER, BALIN); // mind 5 (filler)
    expect(gimli.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    expect(balin.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(false);
  });

  test('a surplus Thrall with no gated character left to pair stays in hand for a later organization phase', () => {
    // Bug: drafting one Thrall per gated character is a common pattern (e.g. two
    // agents), but if a player drafts more Thralls than they use during the
    // character draft, the leftover copy must stay in hand — playable later via
    // `viaRecruitmentInstanceId` (rules 2–3 above) — rather than being
    // force-attached to an ordinary mind ≤ 5, non-agent character, which would
    // waste it for no rules benefit and strand it out of reach for a later
    // organization-phase recruitment.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [THRALL_OF_THE_VOICE, THRALL_OF_THE_VOICE, IVIC, BALIN], playDeck: makePlayDeck(), siteDeck: [RIVENDELL], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [OPPONENT_CHAR], playDeck: makePlayDeck(), siteDeck: [MORIA], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Both Thralls first — each resolves immediately (CoE 1.9.F4) without using a
    // character pick; the opponent's single pick empties their pool.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, OPPONENT_CHAR) },
    ]);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, THRALL_OF_THE_VOICE) },
    ]);
    // One gated agent (Ivic, mind 6) consumes the first vehicle; a mind-5 filler
    // (Balin, not gated) needs no vehicle at all — the second Thrall has nothing
    // left to pair with.
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, IVIC) }]);
    state = runActions(state, [{ type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BALIN) }]);

    state = recomputeDerived(state);
    const ivic = getCharacter(state, RESOURCE_PLAYER, IVIC);
    const balin = getCharacter(state, RESOURCE_PLAYER, BALIN);
    expect(ivic.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(true);
    expect(balin.items.some(i => i.definitionId === THRALL_OF_THE_VOICE)).toBe(false);

    // The surplus Thrall lands in hand, not lost, and remains playable as a
    // recruitment vehicle for a later organization phase.
    const hand = state.players[RESOURCE_PLAYER].hand;
    expect(hand.filter(c => c.definitionId === THRALL_OF_THE_VOICE)).toHaveLength(1);
  });
});
