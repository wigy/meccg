/**
 * @module wh-101.test
 *
 * Card test: The Grey Hat (wh-101)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Gandalf specific. Place this card on Gandalf if he is in play. If
 *    on Gandalf, you may tap The Grey Hat during your end-of-turn phase to take
 *    New Friendship, Wizard's Test, or Hobbit-lore from your discard pile to
 *    your hand."
 *
 * Canonical attributes (data/cards.json WH-101): 1 corruption point, 1 stage
 * point.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                           | Status      |
 * |---|----------------------------------------------------------------|-------------|
 * | 1 | Unique / Gandalf specific (playable only if you are Gandalf)   | IMPLEMENTED |
 * | 2 | Placed on Gandalf (only offered on the Gandalf character)      | IMPLEMENTED |
 * | 3 | Stage points (1) and corruption points (1) while in play       | IMPLEMENTED |
 * | 4 | Tap the Hat during end-of-turn to fetch one of 3 named cards   | IMPLEMENTED |
 * | 5 | Only the three named cards are fetchable; only end-of-turn     | IMPLEMENTED |
 * | 6 | Cost taps the Hat itself (not Gandalf)                         | IMPLEMENTED |
 * | 7 | Playable bare when Gandalf is NOT in play ("if he is in play") | IMPLEMENTED |
 * | 8 | Attaches to Gandalf the moment he enters play                  | IMPLEMENTED |
 * | 9 | The fetch is unavailable while the card is not on Gandalf      | IMPLEMENTED |
 *
 * Modeling — identical shape to Huntsman's Garb (wh-92):
 *  - Rule 1: the `gandalf-specific` keyword gates playability to a player whose
 *    avatar is Gandalf (`wizardSpecificName`, MEWH), and `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Gandalf" }`.
 *  - Rule 3: `stage-points` 1 and a `stat-modifier` `corruption-points` +1 on
 *    the attached card.
 *  - Rules 4–6: `grant-action` `grey-hat-fetch`, `cost: { tap: "self" }`,
 *    `endOfTurnOnly: true`, discard→hand `move` filtered to `name $in [New
 *    Friendship, Wizard's Test, Hobbit-lore]`, emitted by the end-of-turn
 *    scanner (`legal-actions/end-of-turn.ts`) during discard and signal-end
 *    (CRF 22), not reset-hand. `tap: self` taps the Hat item, not Gandalf.
 *  - Rules 7–8: untargeted `play-option` gated on `player.avatarInPlay: false`
 *    plus `on-event: avatar-enters-play` move self → `in-play-on-character`.
 *  - Rule 9: the scanner only walks characters and their items, so a bare Hat
 *    in `cardsInPlay` is never a grant source.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions, viablePlayCharacterActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  addCardToDiscardPile,
  grantedActionsFor,
  getCharacter,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayerState } from '../../index.js';
import { Phase, Alignment, CardStatus, computeLegalActions } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** The Grey Hat — the card under test. */
const GREY_HAT = 'wh-101' as CardDefinitionId;
/** Gandalf — the Fallen-wizard avatar this card is specific to. */
const GANDALF = 'wh-4' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Gandalf
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Gandalf" (the
 *  card must never be offered on a character other than Gandalf). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Edoras — a hero Free-hold, one of Gandalf's home sites ("Any Free-hold"),
 *  so he can be revealed there from hand. */
const EDORAS = 'tw-394' as CardDefinitionId;

/** The three cards the Hat may retrieve from the discard pile. */
const NEW_FRIENDSHIP = 'tw-292' as CardDefinitionId;
const WIZARDS_TEST = 'tw-365' as CardDefinitionId;
const HOBBIT_LORE = 'dm-139' as CardDefinitionId;
/** A hero resource NOT in the retrievable set — negative control for the fetch
 *  filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'grey-hat-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Gandalf) with the Hat in
 *  hand at Isengard. `characters` and `avatar-swap` allow the negative controls. */
function gandalfOrgState(opts?: {
  hand?: CardDefinitionId[];
  characters?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [GANDALF, BOROMIR] }],
        hand: opts?.hand ?? [GREY_HAT],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: ISENGARD, characters: [] }],
        hand: [],
        siteDeck: [ISENGARD],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** Attach the Hat to Gandalf, seed the discard pile, and enter the end-of-turn
 *  discard step (the window in which the fetch is offered). */
function gandalfEotWithHat(discard: CardDefinitionId[] = [NEW_FRIENDSHIP, WIZARDS_TEST, HOBBIT_LORE, DECOY]): GameState {
  const org = gandalfOrgState();
  const gandalfId = findCharInstanceId(org, RESOURCE_PLAYER, GANDALF);
  const hatId = findHandCardId(org, RESOURCE_PLAYER, GREY_HAT);
  let state = playPermanentEventAndResolve(org, PLAYER_1, hatId, gandalfId);
  for (const d of discard) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
  return {
    ...state,
    phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
  } as GameState;
}

/** Return a copy of `state` with the given P1 character's status changed. */
const withCharStatus = (state: GameState, charId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) =>
    i === RESOURCE_PLAYER
      ? { ...p, characters: { ...p.characters, [charId as string]: { ...p.characters[charId], status } } }
      : p) as unknown as GameState['players'],
});

/** Return a copy of `state` with the Hat item (on Gandalf) tapped. */
const withHatStatus = (state: GameState, gandalfId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const gandalf = p.characters[gandalfId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [gandalfId as string]: {
          ...gandalf,
          items: gandalf.items.map(it => it.definitionId === GREY_HAT ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe("The Grey Hat (wh-101)", () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Gandalf specific, placed on Gandalf ───────────────────────────

  test('offered only on the Gandalf character, never on a company-mate', () => {
    const state = gandalfOrgState({ characters: [GANDALF, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(gandalfId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Gandalf
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // No Gandalf in the company → the gandalf-specific keyword gate fails, and the
    // play-target { name: "Gandalf" } has no match either.
    const state = gandalfOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 1 stage point while attached ───────────────────────

  test('placing the card on Gandalf adds it to his items and yields 1 stage point and 1 corruption point', () => {
    const base = gandalfOrgState();
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const hatId = findHandCardId(base, RESOURCE_PLAYER, GREY_HAT);
    const cpBefore = getCharacter(base, RESOURCE_PLAYER, GANDALF).effectiveStats.corruptionPoints;

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, hatId, gandalfId);

    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).items.some(i => i.definitionId === GREY_HAT)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ── Rules 4–5: end-of-turn fetch of the three named cards ──────────────────

  test('during end-of-turn, offers one fetch per named card in the discard pile, and no others', () => {
    const state = gandalfEotWithHat();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    const grants = grantedActionsFor(state, gandalfId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, NEW_FRIENDSHIP));
    expect(targets).toContain(discardInstId(state, WIZARDS_TEST));
    expect(targets).toContain(discardInstId(state, HOBBIT_LORE));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(3);
  });

  test('no fetch is offered when none of the three named cards is in the discard pile', () => {
    const state = gandalfEotWithHat([DECOY]);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves the chosen card from discard to hand and taps the Hat', () => {
    const state = gandalfEotWithHat();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    expect(handHas(state, HOBBIT_LORE)).toBe(false);
    const grant = grantedActionsFor(state, gandalfId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, HOBBIT_LORE))!;
    const after = dispatch(state, grant);

    // Hobbit-lore is now in hand and no longer in the discard pile.
    expect(handHas(after, HOBBIT_LORE)).toBe(true);
    expect(discardInstId(after, HOBBIT_LORE)).toBeUndefined();
    // The Hat (item on Gandalf) is now tapped.
    const hat = getCharacter(after, RESOURCE_PLAYER, GANDALF).items.find(i => i.definitionId === GREY_HAT)!;
    expect(hat.status).toBe(CardStatus.Tapped);
    // Gandalf himself was NOT tapped — the cost taps the Hat, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 6: cost keys on the Hat's status, not Gandalf's ───────────────────

  test('the fetch is still offered while Gandalf is tapped (the Hat is what taps)', () => {
    const base = gandalfEotWithHat();
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const state = withCharStatus(base, gandalfId, CardStatus.Tapped);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is NOT offered once the Hat itself is tapped', () => {
    const base = gandalfEotWithHat();
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const state = withHatStatus(base, gandalfId, CardStatus.Tapped);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 4 timing: end-of-turn only ────────────────────────────────────────

  // CRF 22 (Turn Sequence Rulings, End-of-Turn Phase): "Cards may be played
  // during the End-of-Turn phase after hand size has been reconciled" — the
  // fetch must also be offered during signal-end (step 3, after reset-hand
  // completes), not just discard (step 1).
  test('the fetch is also offered during signal-end, after hand size has been reconciled (CRF 22)', () => {
    const discard = gandalfEotWithHat();
    const signalEnd = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
    } as GameState;
    const gandalfId = findCharInstanceId(signalEnd, RESOURCE_PLAYER, GANDALF);
    expect(grantedActionsFor(signalEnd, gandalfId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is not offered during reset-hand (a locked mandatory draw/discard step)', () => {
    const discard = gandalfEotWithHat();
    const resetHand = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand', discardDone: [true, true], resetHandDone: [false, false] },
    } as GameState;
    const gandalfId = findCharInstanceId(resetHand, RESOURCE_PLAYER, GANDALF);
    expect(grantedActionsFor(resetHand, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const eot = gandalfEotWithHat();
    const gandalfId = findCharInstanceId(eot, RESOURCE_PLAYER, GANDALF);
    // Same attached state, but back in the organization phase.
    const org = {
      ...eot,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    expect(grantedActionsFor(org, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rules 7–9: playable without Gandalf, not usable without Gandalf ──────────
  // "Place this card on Gandalf if he is in play" makes the placement
  // conditional, not the play; the fetch clause is "If on Gandalf".

  /** Organization-phase state with Gandalf NOT in play: he sits in hand (still
   *  the declared avatar, so the gandalf-specific gate passes) and his home
   *  site heads the site deck so he can be revealed. */
  function gandalfUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [GREY_HAT, GANDALF],
          siteDeck: [EDORAS],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: ISENGARD, characters: [] }],
          hand: [],
          siteDeck: [ISENGARD],
          playDeck: makePlayDeck(),
        },
      ],
    });
  }

  /** Every viable end-of-turn fetch offer, regardless of which character it is
   *  keyed on — a bare Hat has no bearer to ask `grantedActionsFor` about. */
  const allFetchOffers = (state: GameState) =>
    computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action)
      .filter(a => a.type === 'activate-granted-action'
        && (a as { actionId?: string }).actionId === FETCH);

  test('playable bare during the organization phase when Gandalf is not in play', () => {
    const state = gandalfUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const hatId = findHandCardId(state, RESOURCE_PLAYER, GREY_HAT);
    const after = playPermanentEventAndResolve(state, PLAYER_1, hatId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GREY_HAT)).toBe(true);
    // The stage point is earned whether or not the card sits on Gandalf.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  test('the fetch is NOT offered while the Hat sits in play unattached', () => {
    const org = gandalfUnrevealedOrgState();
    const hatId = findHandCardId(org, RESOURCE_PLAYER, GREY_HAT);
    let state = playPermanentEventAndResolve(org, PLAYER_1, hatId);
    for (const d of [NEW_FRIENDSHIP, WIZARDS_TEST, HOBBIT_LORE]) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
    const eot = {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;

    // Three fetchable cards in the discard pile, and still no offer: only a
    // Hat *on* Gandalf can be tapped.
    expect(allFetchOffers(eot).length).toBe(0);
  });

  test('attaches to Gandalf the moment he enters play, and the fetch works from then on', () => {
    const org = gandalfUnrevealedOrgState();
    const hatId = findHandCardId(org, RESOURCE_PLAYER, GREY_HAT);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, hatId);

    // Reveal Gandalf at his home site — the Hat leaves `cardsInPlay` for his items.
    const playGandalf = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, GANDALF));
    expect(playGandalf).toBeDefined();
    const revealed = dispatch(bare, playGandalf!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GREY_HAT)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, GANDALF).items.some(i => i.definitionId === GREY_HAT)).toBe(true);
    expect(revealed.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    // With the Hat on Gandalf, the end-of-turn fetch is offered again.
    let seeded = revealed;
    for (const d of [NEW_FRIENDSHIP, WIZARDS_TEST, HOBBIT_LORE]) seeded = addCardToDiscardPile(seeded, RESOURCE_PLAYER, d);
    const eot = {
      ...seeded,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;
    expect(allFetchOffers(eot).length).toBe(3);
  });
});
