/**
 * @module le-114.test
 *
 * Card test: Heedless Revelry (le-114)
 * Type: hazard-event (short)
 *
 * "Playable on a non-Ringwraith company that is not moving. Make a roll for
 *  each untapped non-Wizard character in the company; modify this roll by -2
 *  for hero characters. If the result is greater than the character's mind,
 *  the character becomes tapped. Alternatively, may be revealed as an on-guard
 *  card on a company in response to the play of an item, ally, or faction
 *  (does not interfere with the playing of the card it is revealed in response
 *  to). Tap all untapped non-Ringwraith, non-Wizard characters in the company."
 *
 * Card shape:
 *   - effects[0]: play-target (company; filter target.moving false AND
 *                 target.hasRingwraith false)
 *   - effects[1]: company-tap-roll (filter excluding the wizard race;
 *                 rollModifiers -2 for hero-character card types)
 *   - effects[2]: on-guard-reveal (trigger resource-play, playedFilter
 *                 restricting to item/ally card types, apply
 *                 company-tap-characters excluding wizard + ringwraith races)
 *   - effects[3]: on-guard-reveal (trigger influence-attempt, same apply)
 *
 * Engine support exercised:
 *   - play-target company filter context `moving` / `hasRingwraith`
 *     (company-targeting short-event branch in movement-hazard legal actions)
 *   - company-tap-roll resolution: one `company-tap-roll` pending resolution
 *     carrying every untapped filter-matching character; the company's
 *     controller rolls 2d6 per character (modifier -2 for heroes); roll +
 *     modifier > mind taps the character
 *   - on-guard-reveal playedFilter: reveal legal in the resource-play window
 *     only when the deferred played card matches (items/allies, not short
 *     events); influence-attempt reveals go through the influence chain
 *   - on-guard company-tap-characters apply: on site-phase chain resolution
 *     every untapped non-Wizard, non-Ringwraith character in the company is
 *     tapped; the deferred resource play still resolves afterwards
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  P1_COMPANY,
  ARAGORN, GANDALF, BILBO, STEALTH, DAGGER_OF_WESTERNESSE,
  KNIGHTS_OF_DOL_AMROTH, DOL_AMROTH,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeSitePhase,
  buildSitePhaseState, buildOnGuardSiteScenario, placeOnGuard,
  dispatch, resolveChain,
  findHandCardId, setCharStatus,
  companyIdAt, charIdAt, handCardId,
  expectCharStatus, expectInDiscardPile, expectCharItemCount,
  viableActions,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, CardStatus, Alignment } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, CompanyTapRollAction, PlayShortEventAction, SitePhaseState } from '../../index.js';

const HEEDLESS_REVELRY = 'le-114' as CardDefinitionId;
// Hero characters (hero rolls are modified by -2)
const BARLIMAN = 'tw-125' as CardDefinitionId;   // Man, mind 1
const BARD = 'tw-124' as CardDefinitionId;       // Man, mind 2
// Minion characters (no roll modifier)
const ORC_BRAWLER = 'le-30' as CardDefinitionId; // Orc, mind 1
const GRISHNAKH = 'le-12' as CardDefinitionId;   // Orc, mind 3
const KHAMUL = 'le-55' as CardDefinitionId;      // Ringwraith avatar
const FOUL_SMELLING_PASTE = 'le-310' as CardDefinitionId; // minion minor item
// Minion sites
const GOBLIN_GATE = 'le-378' as CardDefinitionId; // minion shadow-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven

/** Viable play-hazard actions for Heedless Revelry specifically. */
function revelryActions(state: GameState): PlayHazardAction[] {
  const cardId = findHandCardId(state, HAZARD_PLAYER, HEEDLESS_REVELRY);
  return computeLegalActions(state, PLAYER_2)
    .filter(a => a.viable && a.action.type === 'play-hazard'
      && a.action.cardInstanceId === cardId)
    .map(a => a.action as PlayHazardAction);
}

/** Hero company stationed (not moving) at Moria; hazard player holds le-114. */
function heroStationedState(characters: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [HEEDLESS_REVELRY], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** Minion company stationed at Goblin-gate; hazard player holds le-114. */
function minionStationedState(characters: CardDefinitionId[]): GameState {
  const state = buildTestState({
    phase: Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [HEEDLESS_REVELRY], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeMHState() };
}

/** The single pending company-tap-roll action offered to the company's controller. */
function nextRollAction(state: GameState): CompanyTapRollAction {
  const actions = viableActions(state, PLAYER_1, 'company-tap-roll');
  expect(actions).toHaveLength(1);
  return actions[0].action as CompanyTapRollAction;
}

describe('Heedless Revelry (le-114) — played on a company', () => {
  beforeEach(() => resetMint());

  test('playable on a non-Ringwraith company that is not moving', () => {
    const s = heroStationedState([ARAGORN]);
    const actions = revelryActions(s);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCompanyId).toBe(P1_COMPANY);
    expect(actions[0].targetCharacterId).toBeUndefined();
  });

  test('NOT playable on a moving company', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, destinationSite: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [HEEDLESS_REVELRY], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const s = { ...base, phaseState: makeMHState({ destinationSiteName: 'Moria' }) };
    expect(revelryActions(s)).toHaveLength(0);
  });

  test('NOT playable on a company containing a Ringwraith', () => {
    const s = minionStationedState([KHAMUL, ORC_BRAWLER]);
    expect(revelryActions(s)).toHaveLength(0);
  });

  test('playable on a minion company without a Ringwraith', () => {
    const s = minionStationedState([ORC_BRAWLER, GRISHNAKH]);
    expect(revelryActions(s)).toHaveLength(1);
  });

  test('hero characters roll at -2; roll > mind taps, Wizards never roll', () => {
    // Barliman (mind 1), Bard (mind 2), Gandalf (wizard — excluded).
    const s0 = heroStationedState([BARLIMAN, BARD, GANDALF]);
    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(s0, HAZARD_PLAYER, HEEDLESS_REVELRY),
      targetCompanyId: P1_COMPANY,
    });
    s = resolveChain(s);

    // One pending resolution with two rolls queued (Gandalf excluded).
    expect(s.pendingResolutions).toHaveLength(1);
    expect(s.pendingResolutions[0].kind.type).toBe('company-tap-roll');
    if (s.pendingResolutions[0].kind.type === 'company-tap-roll') {
      expect(s.pendingResolutions[0].kind.remaining).toHaveLength(2);
    }

    // Barliman rolls first: 6 - 2 = 4 > mind 1 → tapped.
    const roll1 = nextRollAction(s);
    expect(roll1.modifier).toBe(-2);
    s = dispatch({ ...s, cheatRollTotal: 6 }, roll1);
    expectCharStatus(s, RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);

    // Bard rolls second: 4 - 2 = 2, NOT greater than mind 2 → stays untapped.
    const roll2 = nextRollAction(s);
    expect(roll2.modifier).toBe(-2);
    s = dispatch({ ...s, cheatRollTotal: 4 }, roll2);
    expectCharStatus(s, RESOURCE_PLAYER, BARD, CardStatus.Untapped);

    // All rolls done: resolution gone, chain resolved, wizard untouched,
    // Heedless Revelry discarded with the chain.
    expect(s.pendingResolutions).toHaveLength(0);
    expect(s.chain).toBeNull();
    expectCharStatus(s, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
    const revelryId = s.players[HAZARD_PLAYER].discardPile.find(c => c.definitionId === HEEDLESS_REVELRY);
    expect(revelryId).toBeDefined();
  });

  test('minion characters roll without a modifier', () => {
    // Orc Brawler (mind 1), Grishnákh (mind 3) — no hero modifier.
    const s0 = minionStationedState([ORC_BRAWLER, GRISHNAKH]);
    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(s0, HAZARD_PLAYER, HEEDLESS_REVELRY),
      targetCompanyId: P1_COMPANY,
    });
    s = resolveChain(s);

    // Orc Brawler: roll 2 > mind 1 → tapped.
    const roll1 = nextRollAction(s);
    expect(roll1.modifier).toBe(0);
    s = dispatch({ ...s, cheatRollTotal: 2 }, roll1);
    expectCharStatus(s, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Tapped);

    // Grishnákh: roll 3, NOT greater than mind 3 → stays untapped.
    const roll2 = nextRollAction(s);
    s = dispatch({ ...s, cheatRollTotal: 3 }, roll2);
    expectCharStatus(s, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Untapped);
    expect(s.pendingResolutions).toHaveLength(0);
  });

  test('already-tapped characters do not roll', () => {
    const s0 = setCharStatus(heroStationedState([BARLIMAN, BARD]), RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);
    let s = dispatch(s0, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: findHandCardId(s0, HAZARD_PLAYER, HEEDLESS_REVELRY),
      targetCompanyId: P1_COMPANY,
    });
    s = resolveChain(s);

    // Only Bard (the untapped character) rolls.
    expect(s.pendingResolutions).toHaveLength(1);
    if (s.pendingResolutions[0].kind.type === 'company-tap-roll') {
      expect(s.pendingResolutions[0].kind.remaining).toHaveLength(1);
    }
    const roll = nextRollAction(s);
    s = dispatch({ ...s, cheatRollTotal: 12 }, roll);
    expectCharStatus(s, RESOURCE_PLAYER, BARD, CardStatus.Tapped);
    expect(s.pendingResolutions).toHaveLength(0);
  });
});

describe('Heedless Revelry (le-114) — on-guard reveal', () => {
  beforeEach(() => resetMint());

  test('revealed in response to an item play: taps all untapped non-Wizard characters, item play still resolves', () => {
    // Bilbo will play the Dagger; Barliman idles; Gandalf is a Wizard.
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO, BARLIMAN, GANDALF],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const { state: withOG, ogCard } = placeOnGuard(base, RESOURCE_PLAYER, 0, HEEDLESS_REVELRY);

    const itemId = handCardId(withOG, RESOURCE_PLAYER);
    const bilboId = charIdAt(withOG, RESOURCE_PLAYER, 0);
    const afterPlay = dispatch(withOG, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: itemId,
      companyId: companyIdAt(withOG, RESOURCE_PLAYER),
      attachToCharacterId: bilboId,
    });

    // Item play intercepted: on-guard window queued for the hazard player,
    // the item still in hand.
    expect(afterPlay.pendingResolutions).toHaveLength(1);
    expect(afterPlay.pendingResolutions[0].kind.type).toBe('on-guard-window');
    const reveals = viableActions(afterPlay, PLAYER_2, 'reveal-on-guard');
    expect(reveals).toHaveLength(1);
    expect((reveals[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);

    // Reveal → chain for Heedless Revelry; resolving it taps Bilbo and
    // Barliman but not the Wizard.
    const afterReveal = dispatch(afterPlay, reveals[0].action);
    expect(afterReveal.chain).not.toBeNull();
    const resolved = resolveChain(afterReveal);
    expectCharStatus(resolved, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
    expectInDiscardPile(resolved, HAZARD_PLAYER, ogCard.instanceId);

    // The active player passes to close the window — the deferred item play
    // runs anyway ("does not interfere"): Bilbo gets the Dagger, site taps.
    const afterPass = dispatch(resolved, { type: 'pass', player: PLAYER_1 });
    expectCharItemCount(afterPass, RESOURCE_PLAYER, BILBO, 1);
    expect((afterPass.phaseState as SitePhaseState).resourcePlayed).toBe(true);
    expect(afterPass.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('revealed at a minion item play: taps the Orcs but not the Ringwraith', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [KHAMUL, ORC_BRAWLER, GRISHNAKH] }], hand: [FOUL_SMELLING_PASTE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const { state: withOG, ogCard } = placeOnGuard({ ...base, phaseState: makeSitePhase() }, RESOURCE_PLAYER, 0, HEEDLESS_REVELRY);

    // The minion item play is intercepted by the on-guard window and the
    // reveal is offered (playedFilter matches minion-resource-item).
    const afterPlay = dispatch(withOG, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: handCardId(withOG, RESOURCE_PLAYER),
      companyId: companyIdAt(withOG, RESOURCE_PLAYER),
      attachToCharacterId: charIdAt(withOG, RESOURCE_PLAYER, 0, 1), // Orc Brawler
    });
    expect(afterPlay.pendingResolutions).toHaveLength(1);
    expect(afterPlay.pendingResolutions[0].kind.type).toBe('on-guard-window');
    const reveals = viableActions(afterPlay, PLAYER_2, 'reveal-on-guard');
    expect(reveals).toHaveLength(1);
    expect((reveals[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);

    // Reveal + chain resolution taps both Orcs; the Ringwraith is exempt.
    const resolved = resolveChain(dispatch(afterPlay, reveals[0].action));
    expectCharStatus(resolved, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, GRISHNAKH, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, KHAMUL, CardStatus.Untapped);
  });

  test('NOT revealable in response to a resource short-event (playedFilter)', () => {
    // Stealth is a scout-skill short event: it opens the on-guard window,
    // but Heedless Revelry's playedFilter (items/allies only) rejects it.
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [STEALTH],
    });
    const { state: withOG } = placeOnGuard(base, RESOURCE_PLAYER, 0, HEEDLESS_REVELRY);

    const afterPlay = dispatch(withOG, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: handCardId(withOG, RESOURCE_PLAYER),
      targetScoutInstanceId: charIdAt(withOG, RESOURCE_PLAYER),
    } as PlayShortEventAction);

    expect(afterPlay.pendingResolutions).toHaveLength(1);
    expect(afterPlay.pendingResolutions[0].kind.type).toBe('on-guard-window');
    expect(viableActions(afterPlay, PLAYER_2, 'reveal-on-guard')).toHaveLength(0);
    // Only pass is available; the deferred short then runs normally.
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_2 });
    expect(afterPass.pendingResolutions).toHaveLength(0);
  });

  test('revealed at a faction influence attempt: taps company, attempt still proceeds', () => {
    const { testState, ogCard } = buildOnGuardSiteScenario({
      site: DOL_AMROTH,
      heroChars: [ARAGORN, BARLIMAN, GANDALF],
      heroHand: [KNIGHTS_OF_DOL_AMROTH],
      onGuard: HEEDLESS_REVELRY,
    });

    const influence = viableActions(testState, PLAYER_1, 'influence-attempt')[0];
    expect(influence).toBeDefined();
    const afterAttempt = dispatch(testState, influence.action);

    // Heedless Revelry is revealable on the influence chain (one action,
    // not per-character — it targets the whole company).
    const reveals = viableActions(afterAttempt, PLAYER_2, 'reveal-on-guard');
    expect(reveals).toHaveLength(1);
    expect((reveals[0].action as { cardInstanceId: string }).cardInstanceId).toBe(ogCard.instanceId);

    const afterReveal = dispatch(afterAttempt, reveals[0].action);
    expect(afterReveal.chain!.entries).toHaveLength(2);

    // Chain resolves LIFO: Heedless taps the company (except the Wizard),
    // then the influence attempt pauses at its roll — it was not interfered
    // with.
    const resolved = resolveChain(afterReveal);
    expectCharStatus(resolved, RESOURCE_PLAYER, BARLIMAN, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, GANDALF, CardStatus.Untapped);
    expect(viableActions(resolved, PLAYER_1, 'faction-influence-roll')).toHaveLength(1);
  });
});
