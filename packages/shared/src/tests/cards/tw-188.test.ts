/**
 * @module tw-188.test
 *
 * Card test: A Chance Meeting (tw-188)
 * Type: hero-resource-event (short, wizard alignment)
 *
 * Card text:
 *   "A non-Wizard character (even a Hobbit) may be brought into play with
 *    direct influence at any Free-hold [{F}], Border-hold [{B}], or Ruins &
 *    Lairs [{R}]. This does not count against the one character per turn limit.
 *    May be played on your turn during any phase the company is at a site."
 *
 * Modelled with a single `recruit-character` effect (controlledBy
 * "direct-influence", siteTypes Free-hold/Border-hold/Ruins & Lairs, filter
 * excluding Wizards, bypassOneCharacterLimit). The legal-action helper
 * `recruitViaEventActions` is wired into the organization, movement/hazard, and
 * site phase aggregators and emits a `play-character` carrying
 * `viaEventInstanceId` for each eligible (recruit, qualifying site, DI
 * controller) combination. `handlePlayCharacter` discards the event card and
 * skips the one-character-per-turn bookkeeping for such plays.
 *
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | A non-Wizard character may be brought in with direct influence | OK     |
 * | 2 | …at a Free-hold, Border-hold, or Ruins & Lairs (not a haven)   | OK     |
 * | 3 | Even a Hobbit                                                  | OK     |
 * | 3.1 | …unless it has its own card-specific home-site-only restriction (Sam Gamgee, Frodo) | OK |
 * | 4 | Wizards may not be brought in                                  | OK     |
 * | 5 | Requires a controller with enough unused direct influence      | OK     |
 * | 6 | Does not count against the one-character-per-turn limit        | OK     |
 * | 7 | Playable during any phase the company is at a site             | OK     |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, LORIEN, MORIA, RIVENDELL,
  resetMint, buildTestState, buildSitePhaseState, makeMHState, dispatch,
  getCharacter, viableActions,
  Phase, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';

const A_CHANCE_MEETING = 'tw-188' as CardDefinitionId;
const ELROND = 'tw-145' as CardDefinitionId;        // elf, mind 10, DI 4 — the controller
const EOWYN = 'tw-147' as CardDefinitionId;          // man, mind 2, DI 0 — non-Wizard recruit
const FATTY_BOLGER = 'tw-495' as CardDefinitionId;   // hobbit, mind 3 — "even a Hobbit"
const GANDALF = 'tw-156' as CardDefinitionId;        // wizard avatar — must not be recruitable
const BARLIMAN = 'tw-125' as CardDefinitionId;       // man, mind 1, DI 0 — a no-DI sole company member
const BAG_END = 'tw-372' as CardDefinitionId;        // free-hold
const BREE = 'tw-378' as CardDefinitionId;           // border-hold
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;    // ruins-and-lairs
const FILLER = 'tw-155' as CardDefinitionId;         // Gamling — opponent filler
const SAM_GAMGEE = 'tw-180' as CardDefinitionId;     // hobbit, mind 4, DI 0 — card-specific home-site-only (Bag End)

/**
 * Recruit plays = viable play-character actions carrying viaEventInstanceId.
 * (Inline single-filter over the existing viableActions helper.)
 */
function buildOrg(site: CardDefinitionId, companyChars: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  return buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: companyChars }], hand, siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FILLER] }], hand: [], siteDeck: [MORIA] },
    ],
  });
}

describe('A Chance Meeting (tw-188)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1, 2, 5: recruit a non-Wizard with direct influence at an F/B/R ──

  test('emits a recruit play at a Free-hold under a controller with enough direct influence', () => {
    const state = buildOrg(BAG_END, [ELROND], [A_CHANCE_MEETING, EOWYN]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const eowynId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === EOWYN)!.instanceId;
    const elrondId = getCharacter(state, RESOURCE_PLAYER, ELROND).instanceId;
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .map(a => a.action as { characterInstanceId: CardInstanceId; controlledBy: CardInstanceId | 'general'; atSite: CardInstanceId; viaEventInstanceId?: CardInstanceId })
      .find(a => a.viaEventInstanceId === eventId && a.characterInstanceId === eowynId);

    expect(recruit).toBeDefined();
    // Controlled by Elrond's direct influence (not general influence).
    expect(recruit!.controlledBy).toBe(elrondId);
    // Entering play at the company's Free-hold site.
    expect(recruit!.atSite).toBe(siteId);
  });

  test('also works at a Border-hold and at a Ruins & Lairs', () => {
    for (const site of [BREE, BANDIT_LAIR]) {
      const state = buildOrg(site, [ELROND], [A_CHANCE_MEETING, EOWYN]);
      const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
      const recruit = viableActions(state, PLAYER_1, 'play-character')
        .filter(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId);
      expect(recruit.length).toBeGreaterThan(0);
    }
  });

  // ── Rule 2 (negative): not at a haven ───────────────────────────────────────

  test('does not emit a recruit play at a haven', () => {
    const state = buildOrg(RIVENDELL, [ELROND], [A_CHANCE_MEETING, EOWYN]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId);
    expect(recruit).toHaveLength(0);
  });

  // ── Rule 3: even a Hobbit ───────────────────────────────────────────────────

  test('a Hobbit may be brought into play', () => {
    const state = buildOrg(BAG_END, [ELROND], [A_CHANCE_MEETING, FATTY_BOLGER]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const fattyId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === FATTY_BOLGER)!.instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => {
        const act = a.action as { characterInstanceId: CardInstanceId; viaEventInstanceId?: CardInstanceId };
        return act.viaEventInstanceId === eventId && act.characterInstanceId === fattyId;
      });
    expect(recruit.length).toBeGreaterThan(0);
  });

  // ── Rule 3 (negative): a card-specific home-site-only character is excluded ─

  test('does not emit a recruit play for a home-site-only character away from its home site (Sam Gamgee)', () => {
    const state = buildOrg(BREE, [ELROND], [A_CHANCE_MEETING, SAM_GAMGEE]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const samId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === SAM_GAMGEE)!.instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => {
        const act = a.action as { characterInstanceId: CardInstanceId; viaEventInstanceId?: CardInstanceId };
        return act.viaEventInstanceId === eventId && act.characterInstanceId === samId;
      });
    expect(recruit).toHaveLength(0);
  });

  // ── Rule 4: Wizards are excluded ────────────────────────────────────────────

  test('a Wizard is never offered as a recruit', () => {
    const state = buildOrg(BAG_END, [ELROND], [A_CHANCE_MEETING, GANDALF]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const gandalfId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === GANDALF)!.instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => {
        const act = a.action as { characterInstanceId: CardInstanceId; viaEventInstanceId?: CardInstanceId };
        return act.viaEventInstanceId === eventId && act.characterInstanceId === gandalfId;
      });
    expect(recruit).toHaveLength(0);
  });

  // ── Rule 5 (negative): no controller with enough direct influence ───────────

  test('no recruit when the company has no character with enough direct influence', () => {
    // Barliman (mind 1, DI 0) is the only company member: nobody can control a
    // mind-2 recruit under direct influence.
    const state = buildOrg(BAG_END, [BARLIMAN], [A_CHANCE_MEETING, EOWYN]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .filter(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId);
    expect(recruit).toHaveLength(0);
  });

  // ── Rule 6: does not count against the one-character-per-turn limit ─────────

  test('resolving the recruit brings the character in, discards the event, and does not consume the turn slot', () => {
    const state = buildOrg(BAG_END, [ELROND], [A_CHANCE_MEETING, EOWYN]);
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;
    const elrondId = getCharacter(state, RESOURCE_PLAYER, ELROND).instanceId;
    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .find(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId)!;

    const after = dispatch(state, recruit.action);

    // Éowyn is in play in the company at Bag End, controlled by Elrond's DI.
    const eowyn = getCharacter(after, RESOURCE_PLAYER, EOWYN);
    expect(eowyn).toBeDefined();
    expect(eowyn.controlledBy).toBe(elrondId);
    expect(getCharacter(after, RESOURCE_PLAYER, ELROND).followers).toContain(eowyn.instanceId);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(eowyn.instanceId);

    // The event card has gone to the discard pile and left the hand.
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === eventId)).toBe(false);

    // The one-character-per-turn slot is NOT consumed.
    expect((after.phaseState as { characterPlayedThisTurn?: boolean }).characterPlayedThisTurn).toBe(false);
  });

  // ── Rule 5.1: not offered as a bare no-op play-short-event ───────────────────

  test('is never offered as a standalone play-short-event (rule 5.1 — no effect without a recruit target)', () => {
    const state = buildOrg(BREE, [ELROND], [A_CHANCE_MEETING, EOWYN]);
    const bareShortEvent = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(a => (a.action as { cardInstanceId?: CardInstanceId }).cardInstanceId
        === state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId);
    expect(bareShortEvent).toHaveLength(0);
  });

  // ── Rule 7: playable during any phase the company is at a site ──────────────

  test('the recruit action is offered during the movement/hazard phase', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BAG_END, characters: [ELROND] }], hand: [A_CHANCE_MEETING, EOWYN], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FILLER] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ step: 'play-hazards', activeCompanyIndex: 0 }) };
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;

    const recruit = viableActions(state, PLAYER_1, 'play-character')
      .find(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId);
    expect(recruit).toBeDefined();

    const after = dispatch(state, recruit!.action);
    expect(getCharacter(after, RESOURCE_PLAYER, EOWYN)).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
    // M/H phase state is preserved (no organization bookkeeping leaked in).
    expect(after.phaseState.phase).toBe(Phase.MovementHazard);
  });

  test('the recruit action is offered during the site phase', () => {
    const state = buildSitePhaseState({ characters: [ELROND], site: BAG_END, hand: [A_CHANCE_MEETING, EOWYN] });
    const eventId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === A_CHANCE_MEETING)!.instanceId;

    const recruit = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-character')
      .find(a => (a.action as { viaEventInstanceId?: CardInstanceId }).viaEventInstanceId === eventId);
    expect(recruit).toBeDefined();

    const after = dispatch(state, recruit!.action);
    expect(getCharacter(after, RESOURCE_PLAYER, EOWYN)).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
    expect(after.phaseState.phase).toBe(Phase.Site);
  });
});
