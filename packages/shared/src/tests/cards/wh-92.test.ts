/**
 * @module wh-92.test
 *
 * Card test: Huntsman's Garb (wh-92)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Alatar specific. Place this card on Alatar if he is in play. If on
 *    Alatar, you may tap Huntsman's Garb during your end-of-turn phase to take
 *    Risky Blow, True Fána, or The Hunt from your discard pile to your hand."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Unique / Alatar specific (playable only if you are Alatar)    | IMPLEMENTED |
 * | 2 | Placed on Alatar (only offered on the Alatar character)       | IMPLEMENTED |
 * | 3 | Stage points (1) while in play                                | IMPLEMENTED |
 * | 4 | Tap the Garb during end-of-turn to fetch one of 3 named cards | IMPLEMENTED |
 * | 5 | Only the three named cards are fetchable; only end-of-turn    | IMPLEMENTED |
 * | 6 | Cost taps the Garb itself (not Alatar)                        | IMPLEMENTED |
 *
 * Modeling:
 *  - Rules 1: the `alatar-specific` keyword gates playability to a player whose
 *    revealed avatar is Alatar (`wizardSpecificName`, MEWH), and `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Alatar" }` — the
 *    card attaches to Alatar's `items` (resource permanent-event on a character).
 *  - Rule 3: `stage-points` value 1, summed from characters' items in
 *    `recompute-derived.ts`.
 *  - Rules 4–6: a `grant-action` `huntsmans-garb-fetch`, `cost: { tap: "self" }`,
 *    `endOfTurnOnly: true`, whose `apply` is a `move` (`select: target`, `from:
 *    discard`, `to: hand`) filtered to `name $in [Risky Blow, True Fána, The
 *    Hunt]`. It is emitted by the end-of-turn discard-pile fetch scanner
 *    (`legal-actions/end-of-turn.ts`) during both the discard step and the
 *    signal-end step (CRF 22: "Cards may be played during the End-of-Turn
 *    phase after hand size has been reconciled") — but not reset-hand, one
 *    activation per matching discard card.
 *    `tap: self` on an item-borne grant taps the *item* (via `applyCost`
 *    `tapAttachment`), so eligibility keys on the Garb's own status — not the
 *    bearer's — meaning the fetch works even while Alatar is tapped.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  addCardToDiscardPile,
  grantedActionsFor,
  getCharacter,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayerState } from '../../index.js';
import { Phase, Alignment, CardStatus } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Huntsman's Garb — the card under test. */
const HUNTSMANS_GARB = 'wh-92' as CardDefinitionId;
/** Alatar — the Fallen-wizard avatar this card is specific to. */
const ALATAR = 'wh-1' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Alatar
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Alatar" (the
 *  card must never be offered on a character other than Alatar). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;

/** The three cards the Garb may retrieve from the discard pile. */
const RISKY_BLOW = 'tw-319' as CardDefinitionId;
const TRUE_FANA = 'tw-354' as CardDefinitionId;
const THE_HUNT = 'dm-143' as CardDefinitionId;
/** A hero resource NOT in the retrievable set — negative control for the fetch
 *  filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'huntsmans-garb-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Alatar) with the Garb in
 *  hand at Isengard. `characters` and `avatar-swap` allow the negative controls. */
function alatarOrgState(opts?: {
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
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [ALATAR, BOROMIR] }],
        hand: opts?.hand ?? [HUNTSMANS_GARB],
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

/** Attach the Garb to Alatar, seed the discard pile, and enter the end-of-turn
 *  discard step (the window in which the fetch is offered). */
function alatarEotWithGarb(discard: CardDefinitionId[] = [RISKY_BLOW, TRUE_FANA, THE_HUNT, DECOY]): GameState {
  const org = alatarOrgState();
  const alatarId = findCharInstanceId(org, RESOURCE_PLAYER, ALATAR);
  const garbId = findHandCardId(org, RESOURCE_PLAYER, HUNTSMANS_GARB);
  let state = playPermanentEventAndResolve(org, PLAYER_1, garbId, alatarId);
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

/** Return a copy of `state` with the Garb item (on Alatar) tapped. */
const withGarbStatus = (state: GameState, alatarId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const alatar = p.characters[alatarId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [alatarId as string]: {
          ...alatar,
          items: alatar.items.map(it => it.definitionId === HUNTSMANS_GARB ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe("Huntsman's Garb (wh-92)", () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Alatar specific, placed on Alatar ───────────────────────────

  test('offered only on the Alatar character, never on a company-mate', () => {
    const state = alatarOrgState({ characters: [ALATAR, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(alatarId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Alatar
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // No Alatar in the company → the alatar-specific keyword gate fails, and the
    // play-target { name: "Alatar" } has no match either.
    const state = alatarOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 1 stage point while attached ───────────────────────

  test('placing the card on Alatar adds it to his items and yields 1 stage point', () => {
    const base = alatarOrgState();
    const alatarId = findCharInstanceId(base, RESOURCE_PLAYER, ALATAR);
    const garbId = findHandCardId(base, RESOURCE_PLAYER, HUNTSMANS_GARB);

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, garbId, alatarId);

    expect(getCharacter(after, RESOURCE_PLAYER, ALATAR).items.some(i => i.definitionId === HUNTSMANS_GARB)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  // ── Rules 4–5: end-of-turn fetch of the three named cards ──────────────────

  test('during end-of-turn, offers one fetch per named card in the discard pile, and no others', () => {
    const state = alatarEotWithGarb();
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);

    const grants = grantedActionsFor(state, alatarId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, RISKY_BLOW));
    expect(targets).toContain(discardInstId(state, TRUE_FANA));
    expect(targets).toContain(discardInstId(state, THE_HUNT));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(3);
  });

  test('no fetch is offered when none of the three named cards is in the discard pile', () => {
    const state = alatarEotWithGarb([DECOY]);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);
    expect(grantedActionsFor(state, alatarId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves the chosen card from discard to hand and taps the Garb', () => {
    const state = alatarEotWithGarb();
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);

    expect(handHas(state, THE_HUNT)).toBe(false);
    const grant = grantedActionsFor(state, alatarId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, THE_HUNT))!;
    const after = dispatch(state, grant);

    // The Hunt is now in hand and no longer in the discard pile.
    expect(handHas(after, THE_HUNT)).toBe(true);
    expect(discardInstId(after, THE_HUNT)).toBeUndefined();
    // The Garb (item on Alatar) is now tapped.
    const garb = getCharacter(after, RESOURCE_PLAYER, ALATAR).items.find(i => i.definitionId === HUNTSMANS_GARB)!;
    expect(garb.status).toBe(CardStatus.Tapped);
    // Alatar himself was NOT tapped — the cost taps the Garb, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, ALATAR).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 6: cost keys on the Garb's status, not Alatar's ───────────────────

  test('the fetch is still offered while Alatar is tapped (the Garb is what taps)', () => {
    const base = alatarEotWithGarb();
    const alatarId = findCharInstanceId(base, RESOURCE_PLAYER, ALATAR);
    const state = withCharStatus(base, alatarId, CardStatus.Tapped);
    expect(grantedActionsFor(state, alatarId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is NOT offered once the Garb itself is tapped', () => {
    const base = alatarEotWithGarb();
    const alatarId = findCharInstanceId(base, RESOURCE_PLAYER, ALATAR);
    const state = withGarbStatus(base, alatarId, CardStatus.Tapped);
    expect(grantedActionsFor(state, alatarId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 4 timing: end-of-turn only ────────────────────────────────────────

  // CRF 22 (Turn Sequence Rulings, End-of-Turn Phase): "Cards may be played
  // during the End-of-Turn phase after hand size has been reconciled" — the
  // fetch must also be offered during signal-end (step 3, after reset-hand
  // completes), not just discard (step 1).
  test('the fetch is also offered during signal-end, after hand size has been reconciled (CRF 22)', () => {
    const discard = alatarEotWithGarb();
    const signalEnd = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
    } as GameState;
    const alatarId = findCharInstanceId(signalEnd, RESOURCE_PLAYER, ALATAR);
    expect(grantedActionsFor(signalEnd, alatarId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is not offered during reset-hand (a locked mandatory draw/discard step)', () => {
    const discard = alatarEotWithGarb();
    const resetHand = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand', discardDone: [true, true], resetHandDone: [false, false] },
    } as GameState;
    const alatarId = findCharInstanceId(resetHand, RESOURCE_PLAYER, ALATAR);
    expect(grantedActionsFor(resetHand, alatarId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const eot = alatarEotWithGarb();
    const alatarId = findCharInstanceId(eot, RESOURCE_PLAYER, ALATAR);
    // Same attached state, but back in the organization phase.
    const org = {
      ...eot,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    expect(grantedActionsFor(org, alatarId, FETCH, PLAYER_1).length).toBe(0);
  });
});
