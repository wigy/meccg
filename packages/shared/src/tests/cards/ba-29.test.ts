/**
 * @module ba-29.test
 *
 * Card test: Crept Along Carefully (ba-29)
 * Type: hero-resource-event (alignment wizard), Permanent-event. 0 MP.
 * Non-unique.
 *
 * Card text:
 *   "Playable on a company during the organization phase. The company cannot
 *    use starter movement or move to an Under-deeps site. In addition, if
 *    they move with region movement, they are limited in all cases to 3
 *    regions maximum and their hazard limit is reduced by one (to a minimum
 *    of two). Discard this card from play and make a roll to attempt to
 *    cancel an attack against them by an opponent's company. If the roll
 *    plus the number of rangers in the company is greater than 7, the attack
 *    is canceled. Discard when any play deck is exhausted or, if you choose,
 *    during your organization phase."
 *
 * CRF 22: "The hazard limit reduction only works if the company is moving."
 *
 * Effects:
 *   1. play-target company
 *   2. company-movement-restriction (noStarter, noUnderDeeps, regionMax 3, hazard −1 floor 2)
 *   3. cancel-attack (requiresCvCC, discard self, roll: >7 + rangers)
 *   4. on-event play-deck-exhausted → self-discard
 *   5. voluntary-discard (organization)
 *
 * | # | Rule                                                       | Status | Notes                                                     |
 * |---|-------------------------------------------------------------|--------|------------------------------------------------------------|
 * | 1 | Playable on a company during the organization phase        | OK     | play-target company (organization-events)                |
 * | 2 | The company cannot use starter movement                    | OK     | company-movement-restriction noStarterMovement            |
 * | 3 | The company cannot move to an Under-deeps site              | OK     | company-movement-restriction noUnderDeepsMovement          |
 * | 4 | Region movement limited in all cases to 3 regions          | OK     | company-movement-restriction regionMovementMax (cap)      |
 * | 5 | Hazard limit −1 (min 2) when moving via region movement    | OK     | snapshotHazardLimit modifier, floored, region-gated        |
 * | 6 | No hazard reduction when NOT region-moving                 | OK     | CRF 22 — gated on movementType === region                  |
 * | 7 | Discard to roll to cancel an opponent-company attack       | OK     | cancel-attack requiresCvCC + roll → dice-check              |
 * | 8 | roll + rangers > 7 cancels; otherwise not                  | OK     | skillBonus "ranger" modifier, gt threshold 7                |
 * | 9 | Cancel only vs a company attack (CvCC), not a creature      | OK     | requiresCvCC gate                                           |
 * | 10| Discard during your organization phase if you choose       | OK     | voluntary-discard (organization)                            |
 * | 11| Discard when any play deck is exhausted                    | OK     | on-event play-deck-exhausted → self-discard move             |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildTestState, addCardInPlay, companyIdAt,
  makeMHState, makeCancelWindowCombat, reduce, viableActions, dispatch,
  Alignment, Phase,
  RIVENDELL, LORIEN, ARAGORN, LEGOLAS, GIMLI, THEODEN, BEREGOND,
  expectInPile,
} from '../test-helpers.js';
import { computeLegalActions, formatGameState, Race } from '../../index.js';
import { MovementType } from '../../types/common.js';
import { snapshotHazardLimit } from '../../engine/mh-steps.js';
import type { CardDefinitionId, GameState, CombatState, PlayPermanentEventAction, EndOfTurnPhaseState } from '../../index.js';

const CREPT_ALONG_CAREFULLY = 'ba-29' as CardDefinitionId;

// Hero sites.
// Rivendell → Ettenmoors is a hero starter adjacency (also reachable by region movement).
const ETTENMOORS = 'tw-395' as CardDefinitionId;
// The Gem-deeps: hero Under-deeps site statically adjacent (roll 0) to Glittering Caves.
const GEM_DEEPS = 'dm-30' as CardDefinitionId;
const GLITTERING_CAVES = 'tw-397' as CardDefinitionId;

// Hero characters. Aragorn is the only one with the Ranger skill. None of
// these four are hobbits (which would count as half toward company size and
// throw off the hazard-limit-by-size tests).
const NON_RANGER_1 = LEGOLAS;  // Elf Warrior/Diplomat — NOT a ranger
const NON_RANGER_2 = GIMLI;    // Dwarf Warrior/Diplomat — NOT a ranger
const NON_RANGER_3 = THEODEN;  // Man Warrior/Diplomat — NOT a ranger
const NON_RANGER_4 = BEREGOND; // Dúnadan Warrior — NOT a ranger

describe('Crept Along Carefully (ba-29)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable on a company during the organization phase ──────────

  test('offers a play-permanent-event action targeting the company during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1] }], hand: [CREPT_ALONG_CAREFULLY], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const handInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const companyId = companyIdAt(state, RESOURCE_PLAYER);

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === handInst);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
  });

  // ─── Rule 2: the company cannot use starter movement ───────────────────────

  /** Rivendell → Ettenmoors is a hero starter adjacency; declare-path offers a starter path. */
  function buildStarterRevealState(): GameState {
    return {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1], destinationSite: ETTENMOORS }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
        ],
      }),
      phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }),
    };
  }

  test('starter movement IS offered without the card, but suppressed once it is bound', () => {
    const base = buildStarterRevealState();
    const before = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'declare-path'
        && (a.action as { movementType?: MovementType }).movementType === MovementType.Starter);
    expect(before.length).toBeGreaterThanOrEqual(1);

    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    const after = computeLegalActions(withCard, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'declare-path'
        && (a.action as { movementType?: MovementType }).movementType === MovementType.Starter);
    expect(after).toHaveLength(0);

    // Region movement is still offered (only starter is removed).
    const regionAfter = computeLegalActions(withCard, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'declare-path'
        && (a.action as { movementType?: MovementType }).movementType === MovementType.Region);
    expect(regionAfter.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Rule 3: the company cannot move to an Under-deeps site ────────────────

  test('org-phase plan-movement offers The Gem-deeps only WITHOUT the card bound', () => {
    const withCard = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GLITTERING_CAVES, characters: [NON_RANGER_1] }], hand: [], siteDeck: [GEM_DEEPS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(withCard, RESOURCE_PLAYER);

    const underDeepsDestOffered = (s: GameState): boolean => computeLegalActions(s, PLAYER_1)
      .some(a => a.viable && a.action.type === 'plan-movement'
        && s.players[RESOURCE_PLAYER].siteDeck.find(c => c.instanceId === (a.action as { destinationSite: string }).destinationSite)?.definitionId === GEM_DEEPS);

    expect(underDeepsDestOffered(withCard)).toBe(true);

    const bound = addCardInPlay(withCard, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    expect(underDeepsDestOffered(bound)).toBe(false);
  });

  test('M/H declare-path suppresses the Under-deeps option once the card is bound', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: GLITTERING_CAVES, characters: [NON_RANGER_1], destinationSite: GEM_DEEPS }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }) };

    const underDeepsOffered = (s: GameState): boolean => computeLegalActions(s, PLAYER_1)
      .some(a => a.viable && a.action.type === 'declare-path'
        && (a.action as { movementType?: MovementType }).movementType === MovementType.UnderDeeps);

    expect(underDeepsOffered(state)).toBe(true);

    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const bound = addCardInPlay(state, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    expect(underDeepsOffered(bound)).toBe(false);
  });

  // ─── Rule 4: region movement limited in all cases to 3 regions ────────────

  test('select-company caps the moving company region distance at 3 (was 4)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1], destinationSite: ETTENMOORS }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const stateAtSelect = (s: GameState): GameState => ({ ...s, phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [] }) });

    // Without the card the base cap is 4.
    const plain = reduce(stateAtSelect(base), { type: 'select-company', player: PLAYER_1, companyId });
    expect(plain.error).toBeUndefined();
    expect((plain.state.phaseState as { maxRegionDistance: number }).maxRegionDistance).toBe(4);

    // With the card bound, the cap is 3.
    const bound = addCardInPlay(base, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    const capped = reduce(stateAtSelect(bound), { type: 'select-company', player: PLAYER_1, companyId });
    expect(capped.error).toBeUndefined();
    expect((capped.state.phaseState as { maxRegionDistance: number }).maxRegionDistance).toBe(3);
  });

  // ─── Rules 5 & 6: hazard limit −1 (min 2) only when region-moving ──────────

  /** Build a moving hero company bound by the card and snapshot its limit. */
  function hazardLimitFor(characters: CardDefinitionId[], movementType: MovementType, bind: boolean): number {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters, destinationSite: ETTENMOORS }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    if (bind) state = addCardInPlay(state, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    const ready: GameState = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0, movementType }) };
    return snapshotHazardLimit(ready, ready.players[RESOURCE_PLAYER].companies[0]).limit;
  }

  test('region-moving: a size-4 company hazard limit is reduced 4 → 3', () => {
    const chars = [NON_RANGER_1, NON_RANGER_2, NON_RANGER_3, NON_RANGER_4];
    expect(hazardLimitFor(chars, MovementType.Region, false)).toBe(4);
    expect(hazardLimitFor(chars, MovementType.Region, true)).toBe(3);
  });

  test('region-moving: the reduction never drops the limit below 2 (size-2 company stays 2)', () => {
    const chars = [NON_RANGER_1, NON_RANGER_2];
    expect(hazardLimitFor(chars, MovementType.Region, false)).toBe(2);
    expect(hazardLimitFor(chars, MovementType.Region, true)).toBe(2);
  });

  test('CRF 22: no reduction when the company is NOT moving via region movement', () => {
    const chars = [NON_RANGER_1, NON_RANGER_2, NON_RANGER_3, NON_RANGER_4];
    // Starter movement → base limit unchanged.
    expect(hazardLimitFor(chars, MovementType.Starter, true)).toBe(4);
  });

  // ─── Rules 7-9: discard to roll to cancel an opponent-company attack ───────

  /**
   * Build a CvCC combat in the pre-strike cancel window in which the P1 (hero)
   * company (owner of the card) is the defender. `rangerChars` extra Ranger
   * characters join the company. Returns the state with (optionally) the card bound.
   */
  function buildCvccCancelState(opts: { bind: boolean; rangerChars?: CardDefinitionId[]; cvcc?: boolean }): GameState {
    const chars = [NON_RANGER_1, ...(opts.rangerChars ?? [])];
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: chars }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withCombat = makeCancelWindowCombat(base, { attackSourceType: 'automatic-attack', strikesTotal: 2, strikeProwess: 8 });
    // Turn the generic attack into a company-vs-company attack (or leave it as a
    // creature attack when `cvcc` is false) against the P1 company.
    const cvcc = opts.cvcc ?? true;
    const combat: CombatState = cvcc
      ? { ...(withCombat.combat as CombatState), isCvCC: true, companyId, attackSource: { type: 'company-attack', attackingCompanyId: companyIdAt(base, HAZARD_PLAYER) } }
      : { ...(withCombat.combat as CombatState), isCvCC: false, companyId, attackSource: { type: 'creature', instanceId: 'fake-creature' as never }, creatureRace: Race.Orc };
    let state: GameState = { ...withCombat, combat };
    if (opts.bind) state = addCardInPlay(state, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    return state;
  }

  test('the defender may discard the card to cancel a company (CvCC) attack', () => {
    const state = buildCvccCancelState({ bind: true });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(1);
  });

  test('the cancel is NOT offered against a creature attack (requiresCvCC)', () => {
    const state = buildCvccCancelState({ bind: true, cvcc: false });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('the cancel is NOT offered when the card is not in play', () => {
    const state = buildCvccCancelState({ bind: false });
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('paying the cost discards the card and enqueues a roll; a high roll cancels the attack', () => {
    const state = buildCvccCancelState({ bind: true });
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const declared = reduce(state, { type: 'cancel-attack', player: PLAYER_1, cardInstanceId: cardInst });
    expect(declared.error).toBeUndefined();
    // Card discarded, a dice-check enqueued for the defender, combat still open.
    expect(declared.state.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(declared.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(true);
    const rolls = declared.state.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(1);
    expect(rolls[0].actor).toBe(PLAYER_1);
    expect(declared.state.combat).not.toBeNull();

    // 0 rangers: roll 8 > 7 → attack canceled.
    const resolved = reduce({ ...declared.state, cheatRollTotal: 8 }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    expect(resolved.error).toBeUndefined();
    expect(resolved.state.combat).toBeNull();
    expect(resolved.state.pendingResolutions).toHaveLength(0);
  });

  test('a low roll fails and the attack continues', () => {
    const state = buildCvccCancelState({ bind: true });
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const declared = reduce(state, { type: 'cancel-attack', player: PLAYER_1, cardInstanceId: cardInst });

    // 0 rangers: roll 7 is NOT > 7 → attack continues.
    const resolved = reduce({ ...declared.state, cheatRollTotal: 7 }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    expect(resolved.error).toBeUndefined();
    expect(resolved.state.combat).not.toBeNull();
    expect(resolved.state.pendingResolutions).toHaveLength(0);
  });

  test('rangers in the company add to the roll (roll 7 + 1 ranger > 7 cancels)', () => {
    const state = buildCvccCancelState({ bind: true, rangerChars: [ARAGORN] });
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const declared = reduce(state, { type: 'cancel-attack', player: PLAYER_1, cardInstanceId: cardInst });

    // The queued roll carries a +1 ranger modifier.
    const roll = declared.state.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(roll && roll.kind.type === 'dice-check' && roll.kind.modifiers).toEqual([{ kind: 'constant', value: 1 }]);

    // Roll 7 + 1 ranger = 8 > 7 → canceled (would have failed at 0 rangers).
    const resolved = reduce({ ...declared.state, cheatRollTotal: 7 }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    expect(resolved.state.combat).toBeNull();
  });

  // ─── Rule 10: discard during your organization phase if you choose ─────────

  test('the bound card may be voluntarily discarded during the org phase', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const discards = viableActions(state, PLAYER_1, 'voluntary-discard-in-play');
    expect(discards).toHaveLength(1);

    const after = reduce(state, { type: 'voluntary-discard-in-play', player: PLAYER_1, cardInstanceId: cardInst });
    expect(after.error).toBeUndefined();
    expect(after.state.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(true);
  });

  // ─── Rule 11: discard when any play deck is exhausted ───────────────────────

  test('the bound card discards when a play deck exhaust completes', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1] }], hand: [], siteDeck: [], playDeck: [], discardPile: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withCard = addCardInPlay(resetHandState, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);

    const afterExhaust = dispatch(withCard, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play while the exhaust sub-flow is pending.
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === CREPT_ALONG_CAREFULLY)).toBe(true);

    // Completing the exhaust (pass) fires play-deck-exhausted → self-discard.
    // CRF 22 "Exhausted" shuffles the discard pile (which now holds the card)
    // into the fresh play deck.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === CREPT_ALONG_CAREFULLY)).toBe(false);
    expectInPile(afterPass, RESOURCE_PLAYER, 'playDeck', CREPT_ALONG_CAREFULLY);
  });

  // ─── Placement: bound card renders with its company, not the general pile ──

  test('the bound card is placed under its company, not in the flat cards-in-play list', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [NON_RANGER_1] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, CREPT_ALONG_CAREFULLY, companyId);

    const text = formatGameState(state);
    expect(text).toContain('⤷ Crept Along Carefully (bound to company)');
    expect(text).not.toContain('· Crept Along Carefully');
  });
});
