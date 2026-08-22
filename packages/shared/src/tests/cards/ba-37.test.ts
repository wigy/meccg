/**
 * @module ba-37.test
 *
 * Card test: Going Ever Under Dark (ba-37)
 * Type: minion-resource-event (alignment ringwraith), Permanent-event. 0 MP.
 * Non-unique.
 *
 * Card text:
 *   "Playable on a company during the organization phase. The company cannot
 *    use starter movement. In addition, if they move with region movement,
 *    they are limited in all cases to 3 regions maximum and their hazard limit
 *    is reduced by one (to a minimum of two). Discard this card from play and
 *    make a roll to attempt to cancel an attack against them by an opponent's
 *    company. If the roll plus the number of scouts in the company is greater
 *    than 7, the attack is canceled. Discard during your organization phase if
 *    you choose. Cannot be duplicated on a given company."
 *
 * CRF 22: "The hazard limit reduction only works if the company is moving."
 *
 * Effects:
 *   1. play-target company
 *   2. company-movement-restriction (noStarter, regionMax 3, hazard −1 floor 2)
 *   3. cancel-attack (requiresCvCC, discard self, roll: >7 + scouts)
 *   4. voluntary-discard (organization)
 *   5. duplication-limit scope company (max 1)
 *
 * | # | Rule                                                    | Status | Notes                                                    |
 * |---|---------------------------------------------------------|--------|----------------------------------------------------------|
 * | 1 | Playable on a company during the organization phase     | OK     | play-target company (organization-events)                |
 * | 2 | Cannot be duplicated on a given company                 | OK     | duplication-limit scope company (countCompanyBoundCopies)|
 * | 3 | The company cannot use starter movement                 | OK     | company-movement-restriction noStarterMovement           |
 * | 4 | Region movement limited in all cases to 3 regions       | OK     | company-movement-restriction regionMovementMax (cap)     |
 * | 5 | Hazard limit −1 (min 2) when moving via region movement | OK     | snapshotHazardLimit modifier, floored, region-gated      |
 * | 6 | No hazard reduction when NOT region-moving              | OK     | CRF 22 — gated on movementType === region                |
 * | 7 | Discard to roll to cancel an opponent-company attack    | OK     | cancel-attack requiresCvCC + roll → dice-check           |
 * | 8 | roll + scouts > 7 cancels; otherwise not                | OK     | scoutBonus modifier, gt threshold 7                       |
 * | 9 | Cancel only vs a company attack (CvCC), not a creature   | OK     | requiresCvCC gate                                        |
 * | 10| Discard during your organization phase if you choose    | OK     | voluntary-discard (organization)                         |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildTestState, addCardInPlay, companyIdAt,
  makeMHState, makeCancelWindowCombat, reduce, viableActions,
  Alignment, Phase,
  RIVENDELL, LORIEN, ARAGORN,
} from '../test-helpers.js';
import { computeLegalActions, formatGameState, Race } from '../../index.js';
import { MovementType } from '../../types/common.js';
import { snapshotHazardLimit } from '../../engine/mh-steps.js';
import type { CardDefinitionId, GameState, CombatState, PlayPermanentEventAction } from '../../index.js';

const GOING_EVER_UNDER_DARK = 'ba-37' as CardDefinitionId;

// Minion sites.
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // Darkhaven
const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold

// RIVENDELL → Ettenmoors is a hero starter adjacency (also reachable by region
// movement), used only to exercise the alignment-agnostic starter suppression.
const ETTENMOORS = 'tw-395' as CardDefinitionId;

// Minion characters.
const ASTERNAK = 'le-1' as CardDefinitionId;       // Warrior/Diplomat, mind 5 — NOT a scout
const BELEGORN = 'le-2' as CardDefinitionId;        // Sage/Diplomat — NOT a scout
const DUNLENDING_SPY = 'le-9' as CardDefinitionId;  // Scout, mind 1
const OSTISEN = 'le-36' as CardDefinitionId;        // Scout, mind 2

describe('Going Ever Under Dark (ba-37)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable on a company during the organization phase ──────────

  test('offers a play-permanent-event action targeting the company during the org phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [GOING_EVER_UNDER_DARK], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
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

  // ─── Rule 2: cannot be duplicated on a given company ──────────────────────

  test('a second copy is NOT offered on a company already bearing one', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [GOING_EVER_UNDER_DARK], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    // Bind one copy to the company already.
    state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
    const handInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const plays = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event')
      .map(a => a.action as PlayPermanentEventAction)
      .filter(a => a.cardInstanceId === handInst && a.targetCompanyId === companyId);

    expect(plays).toHaveLength(0);
  });

  // ─── Rule 3: the company cannot use starter movement ──────────────────────

  /** Rivendell → Moria is a starter adjacency; declare-path offers a starter path. */
  function buildStarterRevealState(): GameState {
    return {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: ETTENMOORS }], hand: [], siteDeck: [] },
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
    const withCard = addCardInPlay(base, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
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

  // ─── Rule 4: region movement limited in all cases to 3 regions ────────────

  test('select-company caps the moving company region distance at 3 (was 4)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK], destinationSite: MORIA_MINION }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const stateAtSelect = (s: GameState): GameState => ({ ...s, phaseState: makeMHState({ step: 'select-company', handledCompanyIds: [] }) });

    // Without the card the base cap is 4.
    const plain = reduce(stateAtSelect(base), { type: 'select-company', player: PLAYER_1, companyId });
    expect(plain.error).toBeUndefined();
    expect((plain.state.phaseState as { maxRegionDistance: number }).maxRegionDistance).toBe(4);

    // With the card bound, the cap is 3.
    const bound = addCardInPlay(base, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
    const capped = reduce(stateAtSelect(bound), { type: 'select-company', player: PLAYER_1, companyId });
    expect(capped.error).toBeUndefined();
    expect((capped.state.phaseState as { maxRegionDistance: number }).maxRegionDistance).toBe(3);
  });

  // ─── Rules 5 & 6: hazard limit −1 (min 2) only when region-moving ──────────

  /** Build a moving minion company bound by the card and snapshot its limit. */
  function hazardLimitFor(characters: CardDefinitionId[], movementType: MovementType, bind: boolean): number {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters, destinationSite: MORIA_MINION }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    if (bind) state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
    const ready: GameState = { ...state, phaseState: makeMHState({ step: 'set-hazard-limit', activeCompanyIndex: 0, movementType }) };
    return snapshotHazardLimit(ready, ready.players[RESOURCE_PLAYER].companies[0]).limit;
  }

  test('region-moving: a size-4 company hazard limit is reduced 4 → 3', () => {
    const chars = [ASTERNAK, BELEGORN, DUNLENDING_SPY, OSTISEN];
    expect(hazardLimitFor(chars, MovementType.Region, false)).toBe(4);
    expect(hazardLimitFor(chars, MovementType.Region, true)).toBe(3);
  });

  test('region-moving: the reduction never drops the limit below 2 (size-2 company stays 2)', () => {
    const chars = [ASTERNAK, BELEGORN];
    expect(hazardLimitFor(chars, MovementType.Region, false)).toBe(2);
    expect(hazardLimitFor(chars, MovementType.Region, true)).toBe(2);
  });

  test('CRF 22: no reduction when the company is NOT moving via region movement', () => {
    const chars = [ASTERNAK, BELEGORN, DUNLENDING_SPY, OSTISEN];
    // Under-deeps movement → base limit unchanged.
    expect(hazardLimitFor(chars, MovementType.UnderDeeps, true)).toBe(4);
  });

  test('the reduction applies through the real declare-path flow, not just a direct snapshot', () => {
    // Regression: snapshotHazardLimit read the movement type from
    // state.phaseState, but at declare-path time the freshly declared type
    // lives only in the mhState argument threaded through
    // enterSetHazardLimitAndAutoAdvance — state.phaseState still holds the
    // pre-declaration M/H state whose movementType is null. The direct-call
    // tests above pre-bake movementType into phaseState, so they passed while
    // the reduction silently never fired in real play.
    function limitViaDeclarePath(bind: boolean): number {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK, BELEGORN, DUNLENDING_SPY, OSTISEN], destinationSite: MORIA_MINION }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
        ],
      });
      const companyId = companyIdAt(state, RESOURCE_PLAYER);
      if (bind) state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
      const ready: GameState = { ...state, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0 }) };

      const declares = computeLegalActions(ready, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'declare-path'
          && (a.action as { movementType?: MovementType }).movementType === MovementType.Region);
      expect(declares.length).toBeGreaterThanOrEqual(1);
      const after = reduce(ready, declares[0].action);
      expect(after.error).toBeUndefined();
      const ps = after.state.phaseState as { hazardLimitAtReveal: number | null };
      expect(ps.hazardLimitAtReveal).not.toBeNull();
      return ps.hazardLimitAtReveal!;
    }

    // Size-4 company: base limit 4; with the card bound the region-movement
    // reduction takes it to 3.
    expect(limitViaDeclarePath(false)).toBe(4);
    expect(limitViaDeclarePath(true)).toBe(3);
  });

  // ─── Rules 7-9: discard to roll to cancel an opponent-company attack ───────

  /**
   * Build a CvCC combat in the pre-strike cancel window in which the P1 company
   * (owner of the card) is the defender. `scouts` extra Scout characters join
   * the company. Returns the state with (optionally) the card bound.
   */
  function buildCvccCancelState(opts: { bind: boolean; scoutChars?: CardDefinitionId[]; cvcc?: boolean }): GameState {
    const chars = [ASTERNAK, ...(opts.scoutChars ?? [])];
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: chars }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: [ARAGORN] }], hand: [], siteDeck: [] },
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
    if (opts.bind) state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
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

    // 0 scouts: roll 8 > 7 → attack canceled.
    const resolved = reduce({ ...declared.state, cheatRollTotal: 8 }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    expect(resolved.error).toBeUndefined();
    expect(resolved.state.combat).toBeNull();
    expect(resolved.state.pendingResolutions).toHaveLength(0);
  });

  test('a low roll fails and the attack continues', () => {
    const state = buildCvccCancelState({ bind: true });
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const declared = reduce(state, { type: 'cancel-attack', player: PLAYER_1, cardInstanceId: cardInst });

    // 0 scouts: roll 7 is NOT > 7 → attack continues.
    const resolved = reduce({ ...declared.state, cheatRollTotal: 7 }, { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' });
    expect(resolved.error).toBeUndefined();
    expect(resolved.state.combat).not.toBeNull();
    expect(resolved.state.pendingResolutions).toHaveLength(0);
  });

  test('scouts in the company add to the roll (roll 7 + 1 scout > 7 cancels)', () => {
    const state = buildCvccCancelState({ bind: true, scoutChars: [DUNLENDING_SPY] });
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const declared = reduce(state, { type: 'cancel-attack', player: PLAYER_1, cardInstanceId: cardInst });

    // The queued roll carries a +1 scout modifier.
    const roll = declared.state.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(roll && roll.kind.type === 'dice-check' && roll.kind.modifiers).toEqual([{ kind: 'constant', value: 1 }]);

    // Roll 7 + 1 scout = 8 > 7 → canceled (would have failed at 0 scouts).
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
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);
    const cardInst = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const discards = viableActions(state, PLAYER_1, 'voluntary-discard-in-play');
    expect(discards).toHaveLength(1);

    const after = reduce(state, { type: 'voluntary-discard-in-play', player: PLAYER_1, cardInstanceId: cardInst });
    expect(after.error).toBeUndefined();
    expect(after.state.players[RESOURCE_PLAYER].cardsInPlay).toHaveLength(0);
    expect(after.state.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === cardInst)).toBe(true);
  });

  // ─── Placement: bound card renders with its company, not the general pile ──
  // Regression for bug report 6e25583bf69deb74 (game ms1ouxw9-n417mp, seq 58):
  // a company-targeting permanent event was shown in the flat "Cards in play"
  // list instead of with the company it is bound to.

  test('the bound card is placed under its company, not in the flat cards-in-play list', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ASTERNAK] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, GOING_EVER_UNDER_DARK, companyId);

    const text = formatGameState(state);
    // Nested under the company block, like items under a character.
    expect(text).toContain('⤷ Going Ever Under Dark (bound to company)');
    // Not duplicated in (nor relegated to) the flat cards-in-play list.
    expect(text).not.toContain('· Going Ever Under Dark');
  });
});
