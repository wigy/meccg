/**
 * @module wh-52.test
 *
 * Card test: Liquid Fire (wh-52)
 * Type: minion-resource-item (subtype "special", keyword Technology)
 * Corruption: 1 · Marshalling points: 1 (item)
 *
 * Card text:
 *   "Technology. Playable at a tapped or untapped Shadow-hold [{S}],
 *    Dark-hold [{D}], or a site with a Dwarf automatic-attack. Discard to
 *    cause all strikes from all attacks of a non-Dragon, non-Nazgûl,
 *    non-Balrog creature keyed to a site to fail (resulting body checks for
 *    the creature are modified by -2)."
 *
 * | # | Effect Type    | Status | Notes                                                    |
 * |---|----------------|--------|-----------------------------------------------------------|
 * | 1 | item-play-site | OK     | filter: shadow-hold / dark-hold / Dwarf auto-attack;      |
 * |   |                |        | allowTapped bypasses the tapped-site gate                 |
 * | 2 | grant-action   | OK     | activeSitePhase discard → `defeat-attack-strikes`         |
 * |   |                |        | constraint (bodyCheckModifier -2, excludes Dragon/         |
 * |   |                |        | Ringwraith/Balrog)                                         |
 *
 * Playable: YES
 *
 * Fixtures are minion (ringwraith) sites/characters:
 *  - Goblin-gate (le-378): shadow-hold with an Orcs automatic-attack.
 *  - Cirith Gorgor (le-361): dark-hold.
 *  - Easterling Camp (le-371): border-hold (no Dwarf auto-attack) — the
 *    play restriction must reject it.
 *  - A synthetic ruins-and-lairs site with a Dwarves automatic-attack
 *    isolates the "site with a Dwarf automatic-attack" clause.
 *  - A synthetic site with a very high (unbeatable) automatic-attack prowess
 *    AND a body value isolates the "all strikes fail; resulting body checks
 *    modified by -2" clause — no real site in the pool carries a body value
 *    on its automatic-attack.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  buildMinionSitePhaseState, buildSitePhaseState, buildTestState, resetMint,
  viableActions, viableActionsForHandCard, attachItemToChar, setupAutoAttackStep, executeAction,
  findCharInstanceId, companyIdAt, dispatch,
  pool, LORIEN, MORIA, MINAS_TIRITH, LEGOLAS,
} from '../test-helpers.js';
import { Phase, CardStatus } from '../../index.js';
import type {
  CardDefinitionId, SitePhaseState, SiteCard, GameState, ActivateGrantedAction,
} from '../../index.js';

const LIQUID_FIRE = 'wh-52' as CardDefinitionId;
const GOBLIN_GATE = 'le-378' as CardDefinitionId;     // shadow-hold, Orcs auto-attack
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;   // dark-hold
const EASTERLING_CAMP = 'le-371' as CardDefinitionId; // border-hold (no Dwarf AA)
const ASTERNAK = 'le-1' as CardDefinitionId;          // minion character (man, DI 2)
const GORBAG = 'le-11' as CardDefinitionId;           // minion character (orc, prowess 6)
const TEST_DWARF_LAIR = 'test-dwarf-lair' as CardDefinitionId;

/** An enter-or-skip SitePhaseState for the active company (index 0). */
function enterOrSkipStep(): SitePhaseState {
  return {
    phase: Phase.Site,
    step: 'enter-or-skip',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: false,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
}

describe('Liquid Fire (wh-52)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site playability ────────────────────────────────

  test('playable at an untapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [LIQUID_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, LIQUID_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a TAPPED Shadow-hold (allowTapped bypasses the tapped-site gate)', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: GOBLIN_GATE,
      hand: [LIQUID_FIRE],
      siteStatus: CardStatus.Tapped,
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, LIQUID_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('playable at a Dark-hold', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: CIRITH_GORGOR,
      hand: [LIQUID_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, LIQUID_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Border-hold without a Dwarf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: EASTERLING_CAMP,
      hand: [LIQUID_FIRE],
    });
    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, LIQUID_FIRE);
    expect(offered).toHaveLength(0);
  });

  test('playable at a (non-hold) site with a Dwarf automatic-attack', () => {
    const realSite = pool[GOBLIN_GATE as string] as SiteCard;
    const dwarfLair = {
      ...realSite,
      id: TEST_DWARF_LAIR,
      name: 'Test Dwarf Lair',
      siteType: 'ruins-and-lairs',
      automaticAttacks: [{ creatureType: 'Dwarves', strikes: 1, prowess: 8 }],
      effects: [],
    } as unknown as SiteCard;

    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: TEST_DWARF_LAIR, characters: [ASTERNAK] }], hand: [LIQUID_FIRE], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = {
      ...base,
      cardPool: { ...base.cardPool, [TEST_DWARF_LAIR as string]: dwarfLair },
      phaseState: {
        phase: Phase.Site, step: 'play-resources', activeCompanyIndex: 0, handledCompanyIds: [],
        siteEntered: true, resourcePlayed: false, minorItemAvailable: false, hoardBountyAvailable: false,
        thoroughSearchAvailable: false, declaredAgentAttack: null, automaticAttacksResolved: 0,
        awaitingOnGuardReveal: false, pendingResourceAction: null, opponentInteractionThisTurn: null,
        pendingOpponentInfluence: null,
      } as SitePhaseState,
    };

    const offered = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, LIQUID_FIRE);
    expect(offered.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Effect 2: discard grant-action ───────────────────────────────────────

  test('discard ability is offered at the enter-or-skip step while borne', () => {
    let state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [ASTERNAK] });
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, ASTERNAK, LIQUID_FIRE), phaseState: enterOrSkipStep() };

    const discard = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'liquid-fire-defeat-attack',
    );
    expect(discard).toHaveLength(1);
  });

  test('discarding adds a defeat-attack-strikes constraint (-2, excludes Dragon/Ringwraith/Balrog)', () => {
    let state = buildMinionSitePhaseState({ site: GOBLIN_GATE, characters: [ASTERNAK] });
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, ASTERNAK, LIQUID_FIRE), phaseState: enterOrSkipStep() };
    const cid = companyIdAt(state, RESOURCE_PLAYER);

    const discardAction = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'liquid-fire-defeat-attack',
    );
    expect(discardAction).toBeDefined();
    const after = dispatch(state, discardAction!.action);

    // The item is discarded (no longer borne; in the owner's discard pile).
    const asternakId = findCharInstanceId(after, RESOURCE_PLAYER, ASTERNAK);
    expect(after.players[RESOURCE_PLAYER].characters[asternakId].items.some(i => i.definitionId === LIQUID_FIRE)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LIQUID_FIRE)).toBe(true);

    const constraint = after.activeConstraints.find(
      c => c.kind.type === 'defeat-attack-strikes'
        && c.target.kind === 'company'
        && c.target.companyId === cid,
    );
    expect(constraint).toBeDefined();
    expect(constraint!.kind.type === 'defeat-attack-strikes' && constraint!.kind.bodyCheckModifier).toBe(-2);
    expect(constraint!.kind.type === 'defeat-attack-strikes' && constraint!.kind.excludeRaces).toEqual(['dragon', 'ringwraith', 'balrog']);
    expect(constraint!.scope.kind).toBe('company-site-phase');
  });

  // ─── Effect 2 (cont.): forced strike defeat + penalized creature body check ──

  // No real site in the pool carries a `body` value on its automatic-attack,
  // so a synthetic site isolates "all strikes fail (body checks modified by
  // -2)": prowess 20 makes a normal strike unwinnable for Gorbag (prowess 6),
  // and body 10 gives the forced-defeat strike a creature body check to run.
  // Ruins & Lairs (not a Shadow/Dark-hold) keeps the attack a normal one —
  // CoE §3.II.2.R1 makes Shadow/Dark-hold automatic-attacks detainment
  // (tap-only, no strike/body-check resolution) against a minion company.
  const DEADLY_HOLD = 'test-deadly-hold' as CardDefinitionId;
  function deadlyHoldDef(creatureType: string): SiteCard {
    const realSite = pool[GOBLIN_GATE as string] as SiteCard;
    return {
      ...realSite,
      id: DEADLY_HOLD,
      name: 'Test Deadly Hold',
      siteType: 'ruins-and-lairs',
      automaticAttacks: [{ creatureType, strikes: 1, prowess: 20, body: 10 }],
      effects: [],
    } as unknown as SiteCard;
  }

  function withDeadlyHold(creatureType: string): GameState {
    const built = buildMinionSitePhaseState({ site: DEADLY_HOLD, characters: [GORBAG], hand: [] });
    return { ...built, cardPool: { ...built.cardPool, [DEADLY_HOLD as string]: deadlyHoldDef(creatureType) } };
  }

  /** Assign the (single) pending strike to the defending company's only character. */
  function assignSoleStrike(state: GameState): GameState {
    const action = viableActions(state, PLAYER_1, 'assign-strike')[0].action;
    return dispatch(state, action);
  }

  test('without discarding, the automatic-attack resolves normally (Gorbag cannot win the strike)', () => {
    const base = withDeadlyHold('Orcs');
    const ready = setupAutoAttackStep(base);
    const inCombat = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.forcedStrikeDefeat ?? false).toBe(false);

    // Best possible roll (12) + Gorbag's prowess (6) = 18 < creature prowess 20 → wounded.
    const afterStrike = executeAction(assignSoleStrike(inCombat), PLAYER_1, 'resolve-strike', 12, true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
  });

  test('discarding forces the strike to fail even on the worst possible roll', () => {
    let state = withDeadlyHold('Orcs');
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, GORBAG, LIQUID_FIRE), phaseState: enterOrSkipStep() };

    const discardAction = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'liquid-fire-defeat-attack',
    )!.action;
    const afterDiscard = dispatch(state, discardAction);

    const ready = setupAutoAttackStep(afterDiscard);
    const inCombat = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.forcedStrikeDefeat).toBe(true);
    expect(inCombat.combat!.forcedDefeatBodyCheckModifier).toBe(-2);

    // The defeat-attack-strikes constraint was consumed (removed).
    expect(inCombat.activeConstraints.some(c => c.kind.type === 'defeat-attack-strikes')).toBe(false);

    // Worst possible roll (2) — would normally wound Gorbag (2+6=8 < 20) — but
    // the forced defeat makes the strike succeed regardless, opening a
    // creature body check (the site's automatic-attack carries body: 10).
    const afterStrike = executeAction(assignSoleStrike(inCombat), PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');

    // Body check roll of 11: unmodified 11 > body 10 would defeat the
    // creature; with Liquid Fire's -2, 11-2=9 <= 10 and the creature survives.
    const afterBodyCheck = executeAction(afterStrike, PLAYER_1, 'body-check-roll', 11);
    // Combat resolves (single strike) — the creature survived, so the
    // company did not score a kill.
    expect(afterBodyCheck.combat).toBeNull();
    expect(afterBodyCheck.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === DEADLY_HOLD)).toBe(false);
  });

  test('Nazgûl automatic-attack is excluded — the constraint is left unconsumed', () => {
    let state = withDeadlyHold('Nazgûl');
    state = { ...attachItemToChar(state, RESOURCE_PLAYER, GORBAG, LIQUID_FIRE), phaseState: enterOrSkipStep() };

    const discardAction = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'liquid-fire-defeat-attack',
    )!.action;
    const afterDiscard = dispatch(state, discardAction);

    const ready = setupAutoAttackStep(afterDiscard);
    const inCombat = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect(inCombat.combat).not.toBeNull();
    expect(inCombat.combat!.creatureRace).toBe('ringwraith');
    expect(inCombat.combat!.forcedStrikeDefeat ?? false).toBe(false);

    // The constraint is still active — excluded races do not consume it.
    expect(inCombat.activeConstraints.some(c => c.kind.type === 'defeat-attack-strikes')).toBe(true);

    // Normal resolution: worst roll (2) + prowess 6 = 8 < 20 → wounded.
    const afterStrike = executeAction(assignSoleStrike(inCombat), PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
  });
});
