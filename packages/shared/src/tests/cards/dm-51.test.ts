/**
 * @module dm-51.test
 *
 * Card test: Doubled Vigilance (dm-51)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "Playable on a Shadow-hold [{S}] (or on a Ruins & Lairs [{R}] or Border-hold
 *    [{B}] if Doors of Night is in play). If the company chooses to enter the
 *    site, its player must make a roll and subtract its company size. If the
 *    result is greater than 6, the company may enter the site as normal.
 *    Otherwise, the company must face an attack to be resolved before any
 *    automatic-attacks: Orcs — 4 strikes at 9 prowess. Discard when the site
 *    card is discarded or returned to its location deck. Can be revealed
 *    on-guard."
 *
 * Effects:
 *   1. play-target { target: "site", filter: shadow-hold, or ruins-and-lairs /
 *      border-hold while `environment.doorsOfNightInPlay` }
 *   2. site-entry-roll-attack { subtractCompanySize, threshold 6, comparison
 *      "gt", attack: Orcs 4 strikes / 9 prowess }
 *
 * | # | Rule                                                     | Status | Notes                                                     |
 * |---|----------------------------------------------------------|--------|-----------------------------------------------------------|
 * | 1 | Playable on a Shadow-hold                                | OK     | play-target site filter (legal-actions/movement-hazard.ts) |
 * | 2 | …or a Ruins & Lairs / Border-hold with Doors of Night    | OK     | `environment.doorsOfNightInPlay` in the filter context     |
 * | 3 | Entering → roll 2d6 − company size                       | OK     | `dice-check` enqueued at `enter-site`                      |
 * | 4 | Result > 6 → enter as normal                             | OK     | pass branch initiates no combat                            |
 * | 5 | Otherwise face Orcs 4 strikes at 9 prowess               | OK     | `site-entry-attack` dice-check onFail verb                 |
 * | 6 | …resolved before any automatic-attacks                   | OK     | `site-entry-attack` step precedes reveal/automatic-attacks |
 * | 7 | Discard when the site is discarded / returned            | OK     | generic `discardOrphanedSiteAttachedEvents` sweep          |
 * | 8 | Can be revealed on-guard                                 | OK     | reveal window at `reveal-on-guard-attacks`, then the gate  |
 *
 * Test sites: Moria (tw-413) — a hero Shadow-hold with an Orcs 4/7
 * automatic-attack; Bandit Lair (tw-373) — Ruins & Lairs with a Men 3/6
 * automatic-attack; Dunnish Clan-hold (tw-390) — Border-hold; Eagles' Eyrie
 * (tw-391) — Free-hold (never a legal target).
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, BILBO, FRODO, DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BANDIT_LAIR, DUNNISH_CLAN_HOLD, EAGLES_EYRIE,
  buildTestState, buildSitePhaseState, addP2CardsInPlay, resetMint, mint, dispatch, viableActions,
  makeMHState, companyIdAt,
  Phase,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardInPlay, CardInstanceId, CardDefinitionId, GameState,
  PlayHazardAction, RevealOnGuardAction, SitePhaseState,
} from '../../index.js';

const DOUBLED_VIGILANCE = 'dm-51' as CardDefinitionId;

/** A Doubled Vigilance in play, bound to `siteDefId` (the hazard player's card). */
const vigilanceOnSite = (siteDefId: CardDefinitionId): CardInPlay => ({
  instanceId: 'vigilance-1' as CardInstanceId,
  definitionId: DOUBLED_VIGILANCE,
  status: CardStatus.Untapped,
  attachedToSite: siteDefId,
});

/** The `play-hazard` actions offering Doubled Vigilance in the current state. */
const vigilancePlayActions = (state: GameState) =>
  viableActions(state, PLAYER_2, 'play-hazard').filter(ea =>
    resolveInstanceId(state, (ea.action as PlayHazardAction).cardInstanceId) === DOUBLED_VIGILANCE);

/**
 * M/H state with PLAYER_1's company moving to `destination` and PLAYER_2
 * holding Doubled Vigilance, optionally with Doors of Night in play.
 */
const movingAgainstVigilance = (destination: CardDefinitionId, doorsOfNight = false): GameState => {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: destination }], hand: [], siteDeck: [destination] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOUBLED_VIGILANCE], siteDeck: [MINAS_TIRITH] },
    ],
  });
  const withEnv = doorsOfNight
    ? addP2CardsInPlay(state, [{ instanceId: mint(), definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped }])
    : state;
  return { ...withEnv, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
};

/**
 * Site-phase state at `site` (default Moria) with the company about to decide
 * whether to enter, and a Doubled Vigilance already bound to the site.
 */
const atEnterOrSkip = (characters: CardDefinitionId[] = [ARAGORN], site: CardDefinitionId = MORIA): GameState => {
  const base = buildSitePhaseState({ site, characters });
  return {
    ...base,
    players: base.players.map((p, i) =>
      i === HAZARD_PLAYER ? { ...p, cardsInPlay: [vigilanceOnSite(site)] } : p) as unknown as typeof base.players,
    phaseState: { ...base.phaseState, step: 'enter-or-skip', siteEntered: false } as SitePhaseState,
  };
};

/** Dispatch the active company's decision to enter its current site. */
const enterSite = (state: GameState): GameState =>
  dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId: companyIdAt(state, RESOURCE_PLAYER) });

describe('Doubled Vigilance (dm-51)', () => {
  beforeEach(() => resetMint());

  // ---- Rule 1: playable on a Shadow-hold ----

  test('playable on a Shadow-hold destination', () => {
    const state = movingAgainstVigilance(MORIA);
    const actions = vigilancePlayActions(state);
    expect(actions.length).toBeGreaterThan(0);
    expect((actions[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(MORIA);
  });

  test('not playable on a Free-hold, even with Doors of Night in play', () => {
    expect(vigilancePlayActions(movingAgainstVigilance(EAGLES_EYRIE))).toHaveLength(0);
    expect(vigilancePlayActions(movingAgainstVigilance(EAGLES_EYRIE, true))).toHaveLength(0);
  });

  // ---- Rule 2: Ruins & Lairs / Border-hold only while Doors of Night is in play ----

  test('not playable on a Ruins & Lairs or Border-hold without Doors of Night', () => {
    expect(vigilancePlayActions(movingAgainstVigilance(BANDIT_LAIR))).toHaveLength(0);
    expect(vigilancePlayActions(movingAgainstVigilance(DUNNISH_CLAN_HOLD))).toHaveLength(0);
  });

  test('playable on a Ruins & Lairs and on a Border-hold once Doors of Night is in play', () => {
    const ruins = vigilancePlayActions(movingAgainstVigilance(BANDIT_LAIR, true));
    expect(ruins.length).toBeGreaterThan(0);
    expect((ruins[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(BANDIT_LAIR);

    const border = vigilancePlayActions(movingAgainstVigilance(DUNNISH_CLAN_HOLD, true));
    expect(border.length).toBeGreaterThan(0);
    expect((border[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(DUNNISH_CLAN_HOLD);
  });

  // ---- Rule 3: choosing to enter triggers the roll, minus company size ----

  test('entering the site enqueues the entry roll instead of advancing to the attacks', () => {
    const state = atEnterOrSkip();
    const after = enterSite(state);

    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('site-entry-attack');
    expect(siteState.siteEntryReturnStep).toBe('reveal-on-guard-attacks');
    expect(siteState.automaticAttacksResolved).toBe(0);

    expect(after.pendingResolutions).toHaveLength(1);
    const kind = after.pendingResolutions[0].kind;
    expect(kind.type).toBe('dice-check');
    if (kind.type !== 'dice-check') throw new Error('expected a dice-check');
    expect(kind.threshold).toBe(6);
    expect(kind.comparison).toBe('gt');
    // Aragorn alone → company size 1 subtracted from the roll.
    expect(kind.modifiers).toEqual([{ kind: 'constant', value: -1 }]);
    expect(kind.roller).toBe(PLAYER_1);

    // The roll is the company controller's to make.
    expect(viableActions(after, PLAYER_1, 'resolve-dice-check')).toHaveLength(1);
  });

  test('the subtracted modifier tracks the company size, halving Hobbits (CoE 3.24)', () => {
    // Aragorn + Legolas + Gimli = 3 full characters.
    const three = enterSite(atEnterOrSkip([ARAGORN, LEGOLAS, GIMLI]));
    const threeKind = three.pendingResolutions[0].kind;
    if (threeKind.type !== 'dice-check') throw new Error('expected a dice-check');
    expect(threeKind.modifiers).toEqual([{ kind: 'constant', value: -3 }]);

    // Aragorn + two Hobbits = 1 + ½ + ½ = 2.
    const hobbits = enterSite(atEnterOrSkip([ARAGORN, BILBO, FRODO]));
    const hobbitKind = hobbits.pendingResolutions[0].kind;
    if (hobbitKind.type !== 'dice-check') throw new Error('expected a dice-check');
    expect(hobbitKind.modifiers).toEqual([{ kind: 'constant', value: -2 }]);
  });

  test('the company may still decline to enter, and then makes no roll', () => {
    const after = dispatch(atEnterOrSkip(), { type: 'pass', player: PLAYER_1 });
    expect(after.pendingResolutions).toHaveLength(0);
    expect(after.combat).toBeNull();
    // The only company did nothing, so its site phase — and the phase — ends.
    expect(after.phaseState.phase).toBe(Phase.EndOfTurn);
  });

  // ---- Rule 4: result > 6 → enter as normal ----

  test('a roll beating 6 after the subtraction lets the company enter as normal', () => {
    const entered = enterSite(atEnterOrSkip());
    // 12 − 1 = 11 > 6 → pass.
    const rolled = dispatch(
      { ...entered, cheatRollTotal: 12 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(rolled.combat).toBeNull();
    expect(rolled.pendingResolutions).toHaveLength(0);

    // Passing on closes the gate window and hands the company to the normal
    // on-guard / automatic-attack sequence.
    const advanced = dispatch(rolled, { type: 'pass', player: PLAYER_1 });
    const siteState = advanced.phaseState as SitePhaseState;
    expect(siteState.step).toBe('reveal-on-guard-attacks');
    expect(siteState.siteEntryReturnStep).toBeUndefined();
    expect(advanced.combat).toBeNull();
  });

  test('a total of exactly 6 fails — the result must be strictly greater', () => {
    const entered = enterSite(atEnterOrSkip());
    // 7 − 1 = 6, which is not > 6 → the attack fires.
    const rolled = dispatch(
      { ...entered, cheatRollTotal: 7 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(rolled.combat).not.toBeNull();
  });

  // ---- Rule 5: failure → Orcs, 4 strikes at 9 prowess ----

  test('a failed roll makes the company face Orcs — 4 strikes at 9 prowess', () => {
    const entered = enterSite(atEnterOrSkip());
    const companyId = companyIdAt(entered, RESOURCE_PLAYER);
    // 2 − 1 = 1, well under the threshold.
    const rolled = dispatch(
      { ...entered, cheatRollTotal: 2 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(rolled.combat).not.toBeNull();
    expect(rolled.combat!.creatureRace).toBe('orc');
    expect(rolled.combat!.strikesTotal).toBe(4);
    expect(rolled.combat!.strikeProwess).toBe(9);
    expect(rolled.combat!.creatureBody).toBeNull();
    expect(rolled.combat!.companyId).toBe(companyId);
    expect(rolled.combat!.defendingPlayerId).toBe(PLAYER_1);
    expect(rolled.combat!.attackingPlayerId).toBe(PLAYER_2);
    expect(rolled.combat!.detainment).toBe(false);
    expect(rolled.combat!.attackSource).toEqual({ type: 'site-entry-attack', eventInstanceId: 'vigilance-1' });
  });

  // ---- Rule 6: the attack resolves before any automatic-attack ----

  test('the entry attack precedes the site automatic-attacks, which follow afterwards', () => {
    const entered = enterSite(atEnterOrSkip());
    const rolled = dispatch(
      { ...entered, cheatRollTotal: 2 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    // Moria's own Orcs 4/7 automatic-attack has not been touched yet.
    expect((rolled.phaseState as SitePhaseState).step).toBe('site-entry-attack');
    expect((rolled.phaseState as SitePhaseState).automaticAttacksResolved).toBe(0);

    // Once the entry combat is over, the normal sequence resumes: the on-guard
    // reveal window, then the site's own automatic-attack.
    const afterCombat = { ...rolled, combat: null };
    const backToSequence = dispatch(afterCombat, { type: 'pass', player: PLAYER_1 });
    expect((backToSequence.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');

    const revealed = dispatch(backToSequence, { type: 'pass', player: PLAYER_2 });
    expect((revealed.phaseState as SitePhaseState).step).toBe('automatic-attacks');
    const autoAttack = dispatch(revealed, { type: 'pass', player: PLAYER_1 });
    expect(autoAttack.combat).not.toBeNull();
    expect(autoAttack.combat!.attackSource.type).toBe('automatic-attack');
    expect(autoAttack.combat!.strikeProwess).toBe(7); // Moria's printed Orcs attack
  });

  test('the gate fires only once per company site phase', () => {
    const entered = enterSite(atEnterOrSkip());
    const rolled = dispatch(
      { ...entered, cheatRollTotal: 12 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect((rolled.phaseState as SitePhaseState).siteEntryGatesFaced)
      .toEqual(['vigilance-1' as CardInstanceId]);

    const advanced = dispatch(rolled, { type: 'pass', player: PLAYER_1 });
    // No second roll was queued on the way out of the gate window.
    expect(advanced.pendingResolutions).toHaveLength(0);
    expect((advanced.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('a following company at the same site makes its own entry roll', () => {
    const base = atEnterOrSkip();
    // The previous company already faced the gate; selecting the next company
    // must clear that record so this one rolls too.
    const stale: GameState = {
      ...base,
      phaseState: {
        ...base.phaseState,
        step: 'select-company',
        siteEntryGatesFaced: ['vigilance-1' as CardInstanceId],
      } as SitePhaseState,
    };
    const selected = dispatch(stale, {
      type: 'select-company',
      player: PLAYER_1,
      companyId: companyIdAt(stale, RESOURCE_PLAYER),
    });
    expect((selected.phaseState as SitePhaseState).siteEntryGatesFaced).toBeUndefined();

    const entered = enterSite(selected);
    expect((entered.phaseState as SitePhaseState).step).toBe('site-entry-attack');
    expect(entered.pendingResolutions).toHaveLength(1);
  });

  // ---- Rule 7: discarded when the bound site leaves play ----

  test('discarded once no company occupies the bound site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        // Neither company is at Moria any more.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const host = vigilanceOnSite(MORIA);
    const withHost = {
      ...base,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [host] } : p)) as unknown as typeof base.players,
    };
    const swept = discardOrphanedSiteAttachedEvents(withHost);
    expect(swept.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === host.instanceId)).toBe(false);
    expect(swept.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === host.instanceId)).toBe(true);
  });

  test('stays in play while a company still occupies the bound site', () => {
    const base = atEnterOrSkip();
    const swept = discardOrphanedSiteAttachedEvents(base);
    expect(swept.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === DOUBLED_VIGILANCE)).toBe(true);
  });

  // ---- Rule 8: can be revealed on-guard ----

  /**
   * Site-phase state at the on-guard reveal window with Doubled Vigilance
   * placed face-down on the company's site.
   */
  const onGuardAt = (site: CardDefinitionId, doorsOfNight = false): GameState => {
    const base = buildSitePhaseState({ site });
    const onGuard = { instanceId: mint(), definitionId: DOUBLED_VIGILANCE, revealed: false };
    return {
      ...base,
      players: base.players.map((p, i) => {
        if (i === RESOURCE_PLAYER) {
          return { ...p, companies: [{ ...p.companies[0], onGuardCards: [onGuard] }] };
        }
        return doorsOfNight
          ? { ...p, cardsInPlay: [{ instanceId: mint(), definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped }] }
          : p;
      }) as unknown as typeof base.players,
      phaseState: { ...base.phaseState, step: 'reveal-on-guard-attacks', siteEntered: false } as SitePhaseState,
    };
  };

  test('may be revealed from an on-guard slot at a Shadow-hold', () => {
    const state = onGuardAt(MORIA);
    const reveals = viableActions(state, PLAYER_2, 'reveal-on-guard');
    expect(reveals).toHaveLength(1);

    const revealed = dispatch(state, reveals[0].action as RevealOnGuardAction);
    // The permanent event enters play attached to the company's site.
    const inPlay = revealed.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === DOUBLED_VIGILANCE);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(MORIA);
    expect(revealed.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
  });

  test('a card revealed on-guard still makes its entry roll before the automatic-attacks', () => {
    const state = onGuardAt(MORIA);
    const reveals = viableActions(state, PLAYER_2, 'reveal-on-guard');
    const revealed = dispatch(state, reveals[0].action as RevealOnGuardAction);

    // Closing the reveal window opens the gate rather than the attacks.
    const closed = dispatch(revealed, { type: 'pass', player: PLAYER_2 });
    const siteState = closed.phaseState as SitePhaseState;
    expect(siteState.step).toBe('site-entry-attack');
    expect(siteState.siteEntryReturnStep).toBe('automatic-attacks');
    expect(siteState.automaticAttacksResolved).toBe(0);
    expect(closed.pendingResolutions).toHaveLength(1);

    const rolled = dispatch(
      { ...closed, cheatRollTotal: 2 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );
    expect(rolled.combat!.strikesTotal).toBe(4);
    expect(rolled.combat!.strikeProwess).toBe(9);
  });

  test('cannot be revealed on-guard at a Ruins & Lairs unless Doors of Night is in play', () => {
    expect(viableActions(onGuardAt(BANDIT_LAIR), PLAYER_2, 'reveal-on-guard')).toHaveLength(0);
    expect(viableActions(onGuardAt(BANDIT_LAIR, true), PLAYER_2, 'reveal-on-guard')).toHaveLength(1);
  });
});
