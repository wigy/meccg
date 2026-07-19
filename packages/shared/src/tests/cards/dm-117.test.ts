/**
 * @module dm-117.test
 *
 * Card test: Await the Advent of Allies (dm-117)
 * Type: hero-resource-event (permanent)
 * Alignment: wizard (Hero)
 *
 * Text (CRF-22 erratum, matches printed):
 *   "Playable on a non-Wizard character with a mind of six or less at a
 *    non-Haven site. The character's company may not move. Target character
 *    does not count against general influence and its marshalling points do
 *    not count. Discard this card when the character leaves play or becomes
 *    wounded, or when you play a resource that taps or requires the site (as an
 *    active condition of playing the resource itself). Cannot be duplicated on
 *    a given character."
 *
 * Engine support:
 * | # | Rule                                                       | Status      |
 * |---|------------------------------------------------------------|-------------|
 * | 1 | On a non-Wizard, mind ≤ 6 character (play-target filter)    | IMPLEMENTED |
 * | 2 | At a non-Haven site (play-condition site-type)             | IMPLEMENTED |
 * | 3 | Company may not move (play-flag bearer-cannot-move)        | IMPLEMENTED |
 * | 4 | Does not count against general influence (marker effect)   | IMPLEMENTED |
 * | 5 | Its marshalling points do not count (marker effect)        | IMPLEMENTED |
 * | 6 | Discard when the character leaves play (elimination path)  | IMPLEMENTED |
 * | 7 | Discard when the character becomes wounded (bearer-wounded)| IMPLEMENTED |
 * | 8 | Discard on a resource that taps/requires the site          | IMPLEMENTED |
 * | 9 | Cannot be duplicated on a given character (dup-limit)      | IMPLEMENTED |
 *
 * The three continuous effects (no-move, GI-exempt, MP-not-counted) are derived
 * from the card's presence in the host character's `items`, so discarding the
 * card by any of its triggers restores the character to an ordinary company
 * member with no lifecycle to unwind.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, buildSitePhaseState, makePlayDeck, resetMint,
  viableActions, dispatch,
  findCharInstanceId, findHandCardId, getCharacter, companyIdAt,
  attachItemToChar, playPermanentEventAndResolve,
  makeMHState, expectInDiscardPile, executeAction,
  assertEveryInstanceReachable,
} from '../test-helpers.js';
import { Phase, CardStatus, reduce } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CombatState, GameState,
  PlanMovementAction, PlayHeroResourceAction,
} from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Await the Advent of Allies — the card under test. */
const AWAIT = 'dm-117' as CardDefinitionId;
/** Balin (tw-123) — Dwarf, mind 5, prowess 4, body 7, character MP 2 (eligible). */
const BALIN = 'tw-123' as CardDefinitionId;
/** Celeborn (tw-136) — Elf, mind 6 (boundary-eligible). */
const CELEBORN = 'tw-136' as CardDefinitionId;
/** Beorn (tw-126) — Man, mind 7 (> 6, ineligible). */
const BEORN = 'tw-126' as CardDefinitionId;
/** Gandalf (tw-156) — the Wizard avatar (a Wizard, ineligible). */
const GANDALF = 'tw-156' as CardDefinitionId;
/** Bergil (tw-129) — Dúnadan, mind 2 (a second eligible / mover). */
const BERGIL = 'tw-129' as CardDefinitionId;

/** Amon Hen (tw-371) — hero ruins-and-lairs (non-Haven), plays minor items. */
const AMON_HEN = 'tw-371' as CardDefinitionId;
/** Bandit Lair (tw-373) — hero ruins-and-lairs (non-Haven), used for movement. */
const BANDIT_LAIR = 'tw-373' as CardDefinitionId;
/** Dol Guldur (tw-387) — hero dark-hold, a movement destination. */
const DOL_GULDUR = 'tw-387' as CardDefinitionId;
/** Rivendell (tw-421) — hero haven. */
const RIVENDELL = 'tw-421' as CardDefinitionId;
/** Elven Cloak (tw-225) — a plain minor item; playing it taps the site. */
const ELVEN_CLOAK = 'tw-225' as CardDefinitionId;
/** Cave-drake (tw-082) — a bodyless drake creature used to wound the bearer. */
const CAVE_DRAKE = 'tw-082' as CardDefinitionId;
/** Legolas (tw-168) — opponent filler character. */
const LEGOLAS = 'tw-168' as CardDefinitionId;

// ── Builders ──────────────────────────────────────────────────────────────────

function orgState(opts: {
  characters?: (CardDefinitionId | { defId: CardDefinitionId; items?: CardDefinitionId[] })[];
  site?: CardDefinitionId;
  hand?: CardDefinitionId[];
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: opts.site ?? AMON_HEN, characters: opts.characters ?? [BALIN] }],
        hand: opts.hand ?? [AWAIT],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [DOL_GULDUR],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/**
 * A single-strike M/H combat where `CAVE_DRAKE` attacks the resource player's
 * first company (containing the bearer). Mirrors the as-76 bearer-wounded setup.
 */
function setupCombat(state: GameState): GameState {
  const creatureInstanceId = 'creature-drake-1' as CardInstanceId;
  const hazardPlayer = state.players[HAZARD_PLAYER];
  const players = [
    state.players[RESOURCE_PLAYER],
    {
      ...hazardPlayer,
      cardsInPlay: [
        ...hazardPlayer.cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: CAVE_DRAKE, status: CardStatus.Untapped },
      ],
    },
  ] as unknown as typeof state.players;

  const combat: CombatState = {
    attackSource: { type: 'creature', instanceId: creatureInstanceId },
    companyId: companyIdAt(state, RESOURCE_PLAYER),
    defendingPlayerId: PLAYER_1,
    attackingPlayerId: PLAYER_2,
    strikesTotal: 1,
    strikeProwess: 9,
    creatureBody: null,
    creatureRace: 'drake',
    strikeAssignments: [],
    currentStrikeIndex: 0,
    phase: 'assign-strikes',
    assignmentPhase: 'defender',
    bodyCheckTarget: null,
    detainment: false,
  };
  return { ...state, players, phaseState: makeMHState(), combat };
}

describe('Await the Advent of Allies (dm-117)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: playable on a non-Wizard, mind ≤ 6 character ───────────────────

  test('playable on a mind-5 character at a non-Haven site', () => {
    const state = orgState({ characters: [BALIN], site: AMON_HEN });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, BALIN);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBe(charId);
  });

  test('playable on a boundary mind-6 character (Celeborn)', () => {
    const state = orgState({ characters: [CELEBORN], site: AMON_HEN });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
  });

  test('NOT playable on a character whose mind exceeds 6 (Beorn, mind 7)', () => {
    const state = orgState({ characters: [BEORN], site: AMON_HEN });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('NOT playable on the Wizard avatar (Gandalf)', () => {
    const state = orgState({ characters: [GANDALF], site: AMON_HEN });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 2: only at a non-Haven site ───────────────────────────────────────

  test('NOT playable when the company is at a Haven (Rivendell)', () => {
    const state = orgState({ characters: [BALIN], site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 4: does not count against general influence ───────────────────────

  test('bearer no longer costs general influence once the card is attached', () => {
    const base = orgState({ characters: [BALIN], site: AMON_HEN });
    // Before: Balin (mind 5) costs 5 of general influence.
    expect(base.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(5);

    const charId = findCharInstanceId(base, RESOURCE_PLAYER, BALIN);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, AWAIT);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, charId);
    // After: Balin does not count against general influence.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(0);
  });

  // ── Rule 5: its marshalling points do not count ────────────────────────────

  test('bearer\'s own marshalling points stop counting once attached', () => {
    const base = orgState({ characters: [BALIN], site: AMON_HEN });
    // Before: Balin's character MP (2) counts.
    expect(base.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(2);

    const charId = findCharInstanceId(base, RESOURCE_PLAYER, BALIN);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, AWAIT);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, charId);
    expect(after.players[RESOURCE_PLAYER].marshallingPoints.character).toBe(0);
  });

  // ── Rule 3: the character's company may not move ───────────────────────────

  test('baseline: without the card the bearer\'s company may declare movement', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [BALIN] }], hand: [], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const company = companyIdAt(base, RESOURCE_PLAYER, 0);
    const moves = viableActions(base, PLAYER_1, 'plan-movement')
      .map(a => a.action as PlanMovementAction)
      .filter(a => a.companyId === company);
    expect(moves.length).toBeGreaterThan(0);
  });

  test('with the card attached, the bearer\'s company is offered no movement — a company without him still is', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: BANDIT_LAIR, characters: [BALIN] },
            { site: BANDIT_LAIR, characters: [BERGIL] },
          ],
          hand: [], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);
    const bearerCompany = companyIdAt(state, RESOURCE_PLAYER, 0);
    const otherCompany = companyIdAt(state, RESOURCE_PLAYER, 1);
    const moves = viableActions(state, PLAYER_1, 'plan-movement')
      .map(a => a.action as PlanMovementAction);
    expect(moves.some(a => a.companyId === bearerCompany)).toBe(false);
    expect(moves.some(a => a.companyId === otherCompany)).toBe(true);
  });

  test('the reducer rejects a plan-movement forced through for the bearer\'s company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BANDIT_LAIR, characters: [BALIN] }], hand: [], siteDeck: [DOL_GULDUR], playDeck: makePlayDeck() },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const bearerCompany = companyIdAt(base, RESOURCE_PLAYER, 0);
    const legal = viableActions(base, PLAYER_1, 'plan-movement')
      .map(a => a.action as PlanMovementAction)
      .find(a => a.companyId === bearerCompany)!;

    const state = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);
    const result = reduce(state, legal);
    expect(result.error).toMatch(/may not move/i);
    expect(result.state.players[RESOURCE_PLAYER].companies[0].destinationSite).toBeNull();
  });

  // ── Rule 8: discard when a resource that taps the site is played ───────────

  test('discarded when the bearer\'s company plays a site-tapping resource', () => {
    const base = buildSitePhaseState({
      characters: [BALIN],
      site: AMON_HEN,
      hand: [ELVEN_CLOAK],
    });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);

    // Sanity: the card is attached and Balin is exempt from GI while it is.
    const balinId = findCharInstanceId(withCard, RESOURCE_PLAYER, BALIN);
    expect(getCharacter(withCard, RESOURCE_PLAYER, BALIN).items.some(i => i.definitionId === AWAIT)).toBe(true);

    const cloakId = withCard.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === ELVEN_CLOAK)!.instanceId;
    const playAction = viableActions(withCard, PLAYER_1, 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .find(a => a.cardInstanceId === cloakId)!;
    expect(playAction).toBeDefined();

    const after = dispatch(withCard, playAction);

    // The site is now tapped by the item play …
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite!.status).toBe(CardStatus.Tapped);
    // … so the awaiting card self-discards, leaving only the played item.
    const balin = after.players[RESOURCE_PLAYER].characters[balinId];
    expect(balin.items.some(i => i.definitionId === AWAIT)).toBe(false);
    expect(balin.items.some(i => i.definitionId === ELVEN_CLOAK)).toBe(true);
    expectInDiscardPile(after, RESOURCE_PLAYER, AWAIT);
    // Balin now counts against general influence again.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(5);
    assertEveryInstanceReachable(after);
  });

  // ── Rule 7: discard when the bearer becomes wounded ────────────────────────

  test('discarded when the bearer is wounded in combat (survives wounded)', () => {
    // Balin: prowess 4, body 7. Strike prowess 9.
    // resolve-strike roll 2 → 2 + 4 = 6 < 9 → wounded.
    // body-check roll 7 → 7 is not > body 7 → survives (wounded).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: AMON_HEN, characters: [BALIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);
    const combatState = setupCombat(withCard);

    const balinId = findCharInstanceId(combatState, RESOURCE_PLAYER, BALIN);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: balinId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);   // wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 7);  // survives wounded

    expect(s.combat).toBeNull();
    // Balin survives (wounded), the awaiting card is discarded off him.
    expect(s.players[RESOURCE_PLAYER].characters[balinId]).toBeDefined();
    expect(s.players[RESOURCE_PLAYER].characters[balinId].items.some(i => i.definitionId === AWAIT)).toBe(false);
    expectInDiscardPile(s, RESOURCE_PLAYER, AWAIT);
  });

  test('NOT discarded when the bearer wins the strike unwounded', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: AMON_HEN, characters: [BALIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);
    const combatState = setupCombat(withCard);

    const balinId = findCharInstanceId(combatState, RESOURCE_PLAYER, BALIN);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: balinId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // 12 + 4 = 16 > 9 → success, no wound

    expect(s.combat).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[balinId].items.some(i => i.definitionId === AWAIT)).toBe(true);
  });

  // ── Rule 6: discard when the bearer leaves play (eliminated) ───────────────

  test('discarded when the bearer leaves play (eliminated by a body check)', () => {
    // resolve-strike roll 2 → wounded; body-check roll 12 → 12 > body 7 → eliminated.
    // Balin is solo, so his possessions (the awaiting card) discard directly.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: AMON_HEN, characters: [BALIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, BALIN, AWAIT);
    const combatState = setupCombat(withCard);

    const balinId = findCharInstanceId(combatState, RESOURCE_PLAYER, BALIN);
    let s = dispatch(combatState, { type: 'assign-strike', player: PLAYER_1, characterId: balinId });
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);    // wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 12);  // 12 > 7 → eliminated

    expect(s.combat).toBeNull();
    // Balin has left play; the awaiting card is in the discard pile.
    expect(s.players[RESOURCE_PLAYER].characters[balinId]).toBeUndefined();
    expectInDiscardPile(s, RESOURCE_PLAYER, AWAIT);
    assertEveryInstanceReachable(s);
  });

  // ── Rule 9: cannot be duplicated on a given character ──────────────────────

  test('a second copy cannot be played on a character already bearing one', () => {
    const base = orgState({ characters: [BALIN], site: AMON_HEN, hand: [AWAIT, AWAIT] });
    const charId = findCharInstanceId(base, RESOURCE_PLAYER, BALIN);
    const firstCardId = findHandCardId(base, RESOURCE_PLAYER, AWAIT);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, firstCardId, charId);
    const actions = viableActions(attached, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('a second copy is still playable on a different eligible character', () => {
    const base = orgState({ characters: [BALIN, BERGIL], site: AMON_HEN, hand: [AWAIT, AWAIT] });
    const balinId = findCharInstanceId(base, RESOURCE_PLAYER, BALIN);
    const bergilId = findCharInstanceId(base, RESOURCE_PLAYER, BERGIL);
    const firstCardId = findHandCardId(base, RESOURCE_PLAYER, AWAIT);
    const attached = playPermanentEventAndResolve(base, PLAYER_1, firstCardId, balinId);
    const targets = viableActions(attached, PLAYER_1, 'play-permanent-event')
      .map(a => (a.action as { targetCharacterId?: unknown }).targetCharacterId);
    expect(targets).toContain(bergilId);
    expect(targets).not.toContain(balinId);
  });
});
