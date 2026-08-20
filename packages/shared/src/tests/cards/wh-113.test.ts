/**
 * @module wh-113.test
 *
 * Card test: Pocketed Robes (wh-113)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Radagast specific. Place this card on Radagast if he is in play.
 *    If on Radagast, you may tap Pocketed Robes during your end-of-turn phase
 *    to take Crept Along Cleverly, Wizard's River-horses, or Herb-lore from
 *    your discard pile to your hand."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                            | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Unique / Radagast specific (playable only if you are Radagast)   | IMPLEMENTED |
 * | 2 | Placed on Radagast (only offered on the Radagast character)      | IMPLEMENTED |
 * | 3 | Stage points (1) while in play                                   | IMPLEMENTED |
 * | 4 | Tap the Robes during end-of-turn to fetch one of 3 named cards   | IMPLEMENTED |
 * | 5 | Only the three named cards are fetchable; only end-of-turn       | IMPLEMENTED |
 * | 6 | Cost taps the Robes themselves (not Radagast)                    | IMPLEMENTED |
 * | 7 | Playable bare when Radagast is NOT in play ("if he is in play")  | IMPLEMENTED |
 * | 8 | Attaches to Radagast the moment he enters play                   | IMPLEMENTED |
 * | 9 | The fetch is unavailable while the card is not on Radagast       | IMPLEMENTED |
 *
 * Modeling: identical shape to Huntsman's Garb (wh-92) — see that card's test
 * for the general pattern this reuses verbatim.
 *  - Rule 1: the `radagast-specific` keyword gates playability to a player
 *    whose revealed avatar is Radagast (`wizardSpecificName`, MEWH), and `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Radagast" }` —
 *    the card attaches to Radagast's `items` (resource permanent-event on a
 *    character).
 *  - Rule 3: `stage-points` value 1, summed from characters' items in
 *    `recompute-derived.ts`.
 *  - Rules 4–6: a `grant-action` `pocketed-robes-fetch`, `cost: { tap: "self" }`,
 *    `endOfTurnOnly: true`, whose `apply` is a `move` (`select: target`, `from:
 *    discard`, `to: hand`) filtered to `name $in [Crept Along Cleverly,
 *    Wizard's River-horses, Herb-lore]`. It is emitted by the end-of-turn
 *    discard-pile fetch scanner (`legal-actions/end-of-turn.ts`) during both
 *    the discard step and the signal-end step (CRF 22: "Cards may be played
 *    during the End-of-Turn phase after hand size has been reconciled") — but
 *    not reset-hand, one activation per matching discard card.
 *    `tap: self` on an item-borne grant taps the *item* (via `applyCost`
 *    `tapAttachment`), so eligibility keys on the Robes' own status — not the
 *    bearer's — meaning the fetch works even while Radagast is tapped.
 *  - Rules 7–9: "Place this card on Radagast **if he is in play**" — placement
 *    is conditional, not a play requirement. An untargeted `play-option` gated
 *    on `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Radagast the moment he is revealed
 *    — the wh-92 / wh-99 / Bade to Rule (le-167) pattern. Rule 9 falls out of
 *    the scanner: `endOfTurnGrantActions` walks characters and their attached
 *    items only, so bare Robes in `cardsInPlay` are never a grant source.
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

/** Pocketed Robes — the card under test. */
const POCKETED_ROBES = 'wh-113' as CardDefinitionId;
/** Radagast — the Fallen-wizard avatar this card is specific to. */
const RADAGAST = 'wh-8' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for
 *  "Radagast specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Radagast" (the
 *  card must never be offered on a character other than Radagast). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Rhosgobel — Radagast's Fallen-wizard Wizardhaven (haven site). */
const RHOSGOBEL = 'wh-57' as CardDefinitionId;

/** The three cards the Robes may retrieve from the discard pile. */
const CREPT_ALONG_CLEVERLY = 'wh-43' as CardDefinitionId;
const WIZARDS_RIVER_HORSES = 'tw-364' as CardDefinitionId;
const HERB_LORE = 'dm-136' as CardDefinitionId;
/** A hero resource NOT in the retrievable set — negative control for the
 *  fetch filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'pocketed-robes-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Radagast) with the Robes
 *  in hand at Rhosgobel. `characters` allow the negative controls. */
function radagastOrgState(opts?: {
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
        companies: [{ site: RHOSGOBEL, characters: opts?.characters ?? [RADAGAST, BOROMIR] }],
        hand: opts?.hand ?? [POCKETED_ROBES],
        siteDeck: [RHOSGOBEL],
        playDeck: makePlayDeck(),
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: RHOSGOBEL, characters: [] }],
        hand: [],
        siteDeck: [RHOSGOBEL],
        playDeck: makePlayDeck(),
      },
    ],
  });
}

/** Attach the Robes to Radagast, seed the discard pile, and enter the
 *  end-of-turn discard step (the window in which the fetch is offered). */
function radagastEotWithRobes(discard: CardDefinitionId[] = [CREPT_ALONG_CLEVERLY, WIZARDS_RIVER_HORSES, HERB_LORE, DECOY]): GameState {
  const org = radagastOrgState();
  const radagastId = findCharInstanceId(org, RESOURCE_PLAYER, RADAGAST);
  const robesId = findHandCardId(org, RESOURCE_PLAYER, POCKETED_ROBES);
  let state = playPermanentEventAndResolve(org, PLAYER_1, robesId, radagastId);
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

/** Return a copy of `state` with the Robes item (on Radagast) tapped. */
const withRobesStatus = (state: GameState, radagastId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const radagast = p.characters[radagastId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [radagastId as string]: {
          ...radagast,
          items: radagast.items.map(it => it.definitionId === POCKETED_ROBES ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe('Pocketed Robes (wh-113)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Radagast specific, placed on Radagast ───────────────────────

  test('offered only on the Radagast character, never on a company-mate', () => {
    const state = radagastOrgState({ characters: [RADAGAST, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(radagastId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Radagast
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // No Radagast in the company → the radagast-specific keyword gate fails,
    // and the play-target { name: "Radagast" } has no match either.
    const state = radagastOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 1 stage point while attached ───────────────────────

  test('placing the card on Radagast adds it to his items and yields 1 stage point', () => {
    const base = radagastOrgState();
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const robesId = findHandCardId(base, RESOURCE_PLAYER, POCKETED_ROBES);

    // Rhosgobel itself grants 1 stage point while a Radagast company occupies
    // it (wh-57's `whileCompanyAtSite` stage-points effect) — that baseline
    // is independent of the Robes.
    const baseline = base.players[RESOURCE_PLAYER].stagePoints;
    const after = playPermanentEventAndResolve(base, PLAYER_1, robesId, radagastId);

    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === POCKETED_ROBES)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(baseline + 1);
  });

  // ── Rules 4–5: end-of-turn fetch of the three named cards ──────────────────

  test('during end-of-turn, offers one fetch per named card in the discard pile, and no others', () => {
    const state = radagastEotWithRobes();
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);

    const grants = grantedActionsFor(state, radagastId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, CREPT_ALONG_CLEVERLY));
    expect(targets).toContain(discardInstId(state, WIZARDS_RIVER_HORSES));
    expect(targets).toContain(discardInstId(state, HERB_LORE));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(3);
  });

  test('no fetch is offered when none of the three named cards is in the discard pile', () => {
    const state = radagastEotWithRobes([DECOY]);
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);
    expect(grantedActionsFor(state, radagastId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves the chosen card from discard to hand and taps the Robes', () => {
    const state = radagastEotWithRobes();
    const radagastId = findCharInstanceId(state, RESOURCE_PLAYER, RADAGAST);

    expect(handHas(state, HERB_LORE)).toBe(false);
    const grant = grantedActionsFor(state, radagastId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, HERB_LORE))!;
    const after = dispatch(state, grant);

    // Herb-lore is now in hand and no longer in the discard pile.
    expect(handHas(after, HERB_LORE)).toBe(true);
    expect(discardInstId(after, HERB_LORE)).toBeUndefined();
    // The Robes (item on Radagast) are now tapped.
    const robes = getCharacter(after, RESOURCE_PLAYER, RADAGAST).items.find(i => i.definitionId === POCKETED_ROBES)!;
    expect(robes.status).toBe(CardStatus.Tapped);
    // Radagast himself was NOT tapped — the cost taps the Robes, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, RADAGAST).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 6: cost keys on the Robes' status, not Radagast's ─────────────────

  test('the fetch is still offered while Radagast is tapped (the Robes are what taps)', () => {
    const base = radagastEotWithRobes();
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const state = withCharStatus(base, radagastId, CardStatus.Tapped);
    expect(grantedActionsFor(state, radagastId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is NOT offered once the Robes themselves are tapped', () => {
    const base = radagastEotWithRobes();
    const radagastId = findCharInstanceId(base, RESOURCE_PLAYER, RADAGAST);
    const state = withRobesStatus(base, radagastId, CardStatus.Tapped);
    expect(grantedActionsFor(state, radagastId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 4 timing: end-of-turn only ────────────────────────────────────────

  // CRF 22 (Turn Sequence Rulings, End-of-Turn Phase): "Cards may be played
  // during the End-of-Turn phase after hand size has been reconciled" — the
  // fetch must also be offered during signal-end (step 3, after reset-hand
  // completes), not just discard (step 1).
  test('the fetch is also offered during signal-end, after hand size has been reconciled (CRF 22)', () => {
    const discard = radagastEotWithRobes();
    const signalEnd = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'signal-end', discardDone: [true, true], resetHandDone: [true, true] },
    } as GameState;
    const radagastId = findCharInstanceId(signalEnd, RESOURCE_PLAYER, RADAGAST);
    expect(grantedActionsFor(signalEnd, radagastId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is not offered during reset-hand (a locked mandatory draw/discard step)', () => {
    const discard = radagastEotWithRobes();
    const resetHand = {
      ...discard,
      phaseState: { phase: Phase.EndOfTurn, step: 'reset-hand', discardDone: [true, true], resetHandDone: [false, false] },
    } as GameState;
    const radagastId = findCharInstanceId(resetHand, RESOURCE_PLAYER, RADAGAST);
    expect(grantedActionsFor(resetHand, radagastId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const eot = radagastEotWithRobes();
    const radagastId = findCharInstanceId(eot, RESOURCE_PLAYER, RADAGAST);
    // Same attached state, but back in the organization phase.
    const org = {
      ...eot,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    expect(grantedActionsFor(org, radagastId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rules 7–9: playable without Radagast, not usable without Radagast ──────
  // "Place this card on Radagast if he is in play" makes the placement
  // conditional, not the play; the fetch clause is "If on Radagast". Mirrors
  // Huntsman's Garb (wh-92) / Give Welcome to the Unexpected (wh-99).

  /** Organization-phase state with Radagast NOT in play: he sits in hand
   *  (still the declared avatar, so the radagast-specific gate passes) and his
   *  home site Rhosgobel heads the site deck so he can be revealed. */
  function radagastUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RHOSGOBEL, characters: [BOROMIR] }],
          hand: [POCKETED_ROBES, RADAGAST],
          siteDeck: [RHOSGOBEL],
          playDeck: makePlayDeck(),
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RHOSGOBEL, characters: [] }],
          hand: [],
          siteDeck: [RHOSGOBEL],
          playDeck: makePlayDeck(),
        },
      ],
    });
  }

  /** Every viable end-of-turn fetch offer, regardless of which character it is
   *  keyed on — bare Robes have no bearer to ask `grantedActionsFor` about. */
  const allFetchOffers = (state: GameState) =>
    computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action)
      .filter(a => a.type === 'activate-granted-action'
        && (a as { actionId?: string }).actionId === FETCH);

  test('playable bare during the organization phase when Radagast is not in play', () => {
    const state = radagastUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const baseline = state.players[RESOURCE_PLAYER].stagePoints;
    const robesId = findHandCardId(state, RESOURCE_PLAYER, POCKETED_ROBES);
    const after = playPermanentEventAndResolve(state, PLAYER_1, robesId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === POCKETED_ROBES)).toBe(true);
    // The stage point is earned whether or not the card sits on Radagast.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(baseline + 1);
  });

  test('the fetch is NOT offered while the Robes sit in play unattached', () => {
    const org = radagastUnrevealedOrgState();
    const robesId = findHandCardId(org, RESOURCE_PLAYER, POCKETED_ROBES);
    let state = playPermanentEventAndResolve(org, PLAYER_1, robesId);
    for (const d of [CREPT_ALONG_CLEVERLY, WIZARDS_RIVER_HORSES, HERB_LORE]) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
    const eot = {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;

    // Three fetchable cards in the discard pile, and still no offer: only
    // Robes *on* Radagast can be tapped.
    expect(allFetchOffers(eot).length).toBe(0);
  });

  test('attaches to Radagast the moment he enters play, and the fetch works from then on', () => {
    const org = radagastUnrevealedOrgState();
    const robesId = findHandCardId(org, RESOURCE_PLAYER, POCKETED_ROBES);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, robesId);

    // Reveal Radagast at his home site — the Robes leave `cardsInPlay` for his items.
    const playRadagast = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, RADAGAST));
    expect(playRadagast).toBeDefined();
    const revealed = dispatch(bare, playRadagast!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === POCKETED_ROBES)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, RADAGAST).items.some(i => i.definitionId === POCKETED_ROBES)).toBe(true);

    // With the Robes on Radagast, the end-of-turn fetch is offered again.
    let seeded = revealed;
    for (const d of [CREPT_ALONG_CLEVERLY, WIZARDS_RIVER_HORSES, HERB_LORE]) seeded = addCardToDiscardPile(seeded, RESOURCE_PLAYER, d);
    const eot = {
      ...seeded,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;
    expect(allFetchOffers(eot).length).toBe(3);
  });
});
