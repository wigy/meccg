/**
 * @module wh-105.test
 *
 * Card test: Pallando's Hood (wh-105)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Pallando specific. Place this card on Pallando if he is in play. If
 *    on Pallando, you may tap Pallando's Hood during your end-of-turn phase to
 *    take Gifts as Given of Old, Wizard's Voice, or Eyes of Mandos from your
 *    discard pile to your hand."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Unique / Pallando specific (playable only if you are Pallando)| IMPLEMENTED |
 * | 2 | Placed on Pallando (only offered on the Pallando character)   | IMPLEMENTED |
 * | 3 | Stage points (1) while in play                                | IMPLEMENTED |
 * | 4 | Tap the Hood during end-of-turn to fetch one of 3 named cards | IMPLEMENTED |
 * | 5 | Only the three named cards are fetchable; only end-of-turn    | IMPLEMENTED |
 * | 6 | Cost taps the Hood itself (not Pallando)                      | IMPLEMENTED |
 * | 7 | Playable bare when Pallando is NOT in play ("if he is in play")| IMPLEMENTED |
 * | 8 | Attaches to Pallando the moment he enters play                | IMPLEMENTED |
 * | 9 | The fetch is unavailable while the card is not on Pallando    | IMPLEMENTED |
 *
 * Modeling (identical shape to Huntsman's Garb wh-92, retargeted to Pallando):
 *  - Rule 1: the `pallando-specific` keyword gates playability to a player whose
 *    revealed avatar is Pallando (`wizardSpecificName`, MEWH), and `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Pallando" }` — the
 *    card attaches to Pallando's `items` (resource permanent-event on a character).
 *  - Rule 3: `stage-points` value 1, summed from characters' items in
 *    `recompute-derived.ts`.
 *  - Rules 4-6: a `grant-action` `pallandos-hood-fetch`, `cost: { tap: "self" }`,
 *    `endOfTurnOnly: true`, whose `apply` is a `move` (`select: target`, `from:
 *    discard`, `to: hand`) filtered to `name $in [Gifts as Given of Old,
 *    Wizard's Voice, Eyes of Mandos]`. It is emitted only by the end-of-turn
 *    discard-pile fetch scanner (`legal-actions/end-of-turn.ts`), one activation
 *    per matching discard card. `tap: self` on an item-borne grant taps the
 *    *item* (via `applyCost` `tapAttachment`), so eligibility keys on the Hood's
 *    own status — not the bearer's — meaning the fetch works even while Pallando
 *    is tapped.
 *  - Rules 7–8: "Place this card on Pallando **if he is in play**" — placement
 *    is conditional, not a play requirement. An untargeted `play-option` gated
 *    on `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Pallando the moment he is revealed —
 *    the wh-99 / Bade to Rule (le-167) pattern.
 *  - Rule 9 falls out of the scanner: `endOfTurnGrantActions` walks characters
 *    and their attached items only, so a Hood sitting bare in `cardsInPlay`
 *    is never a grant source ("If on Pallando, you may tap…").
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

/** Pallando's Hood — the card under test. */
const PALLANDOS_HOOD = 'wh-105' as CardDefinitionId;
/** Pallando — the Fallen-wizard avatar this card is specific to. */
const PALLANDO = 'wh-7' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Pallando
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Pallando" (the
 *  card must never be offered on a character other than Pallando). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site). */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** The White Towers — Pallando's printed home site, so he can be revealed
 *  there from hand. */
const THE_WHITE_TOWERS = 'tw-430' as CardDefinitionId;

/** The three cards the Hood may retrieve from the discard pile. */
const GIFTS_AS_GIVEN_OF_OLD = 'le-188' as CardDefinitionId;
const WIZARDS_VOICE = 'tw-366' as CardDefinitionId;
const EYES_OF_MANDOS = 'dm-126' as CardDefinitionId;
/** A resource NOT in the retrievable set — negative control for the fetch
 *  filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'pallandos-hood-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: FallenWizard P1 (avatar Pallando) with the Hood in
 *  hand at Isengard. `characters` allows the negative controls. */
function pallandoOrgState(opts?: {
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
        companies: [{ site: ISENGARD, characters: opts?.characters ?? [PALLANDO, BOROMIR] }],
        hand: opts?.hand ?? [PALLANDOS_HOOD],
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

/** Attach the Hood to Pallando, seed the discard pile, and enter the end-of-turn
 *  discard step (the window in which the fetch is offered). */
function pallandoEotWithHood(discard: CardDefinitionId[] = [GIFTS_AS_GIVEN_OF_OLD, WIZARDS_VOICE, EYES_OF_MANDOS, DECOY]): GameState {
  const org = pallandoOrgState();
  const pallandoId = findCharInstanceId(org, RESOURCE_PLAYER, PALLANDO);
  const hoodId = findHandCardId(org, RESOURCE_PLAYER, PALLANDOS_HOOD);
  let state = playPermanentEventAndResolve(org, PLAYER_1, hoodId, pallandoId);
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

/** Return a copy of `state` with the Hood item (on Pallando) tapped. */
const withHoodStatus = (state: GameState, pallandoId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) => {
    if (i !== RESOURCE_PLAYER) return p;
    const pallando = p.characters[pallandoId];
    return {
      ...p,
      characters: {
        ...p.characters,
        [pallandoId as string]: {
          ...pallando,
          items: pallando.items.map(it => it.definitionId === PALLANDOS_HOOD ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

describe("Pallando's Hood (wh-105)", () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Pallando specific, placed on Pallando ───────────────────────

  test('offered only on the Pallando character, never on a company-mate', () => {
    const state = pallandoOrgState({ characters: [PALLANDO, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);

    expect(targetIds).toContain(pallandoId);
    expect(targetIds).not.toContain(boromirId);
    expect(actions.length).toBe(1); // exactly Pallando
  });

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // No Pallando in the company → the pallando-specific keyword gate fails, and
    // the play-target { name: "Pallando" } has no match either.
    const state = pallandoOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 1 stage point while attached ───────────────────────

  test('placing the card on Pallando adds it to his items and yields 1 stage point and 1 corruption point', () => {
    const base = pallandoOrgState();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const hoodId = findHandCardId(base, RESOURCE_PLAYER, PALLANDOS_HOOD);
    const cpBefore = getCharacter(base, RESOURCE_PLAYER, PALLANDO).effectiveStats.corruptionPoints;

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, hoodId, pallandoId);

    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === PALLANDOS_HOOD)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).effectiveStats.corruptionPoints).toBe(cpBefore + 1);
  });

  // ── Rules 4–5: end-of-turn fetch of the three named cards ──────────────────

  test('during end-of-turn, offers one fetch per named card in the discard pile, and no others', () => {
    const state = pallandoEotWithHood();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    const grants = grantedActionsFor(state, pallandoId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, GIFTS_AS_GIVEN_OF_OLD));
    expect(targets).toContain(discardInstId(state, WIZARDS_VOICE));
    expect(targets).toContain(discardInstId(state, EYES_OF_MANDOS));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(3);
  });

  test('no fetch is offered when none of the three named cards is in the discard pile', () => {
    const state = pallandoEotWithHood([DECOY]);
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves the chosen card from discard to hand and taps the Hood', () => {
    const state = pallandoEotWithHood();
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    expect(handHas(state, EYES_OF_MANDOS)).toBe(false);
    const grant = grantedActionsFor(state, pallandoId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, EYES_OF_MANDOS))!;
    const after = dispatch(state, grant);

    // Eyes of Mandos is now in hand and no longer in the discard pile.
    expect(handHas(after, EYES_OF_MANDOS)).toBe(true);
    expect(discardInstId(after, EYES_OF_MANDOS)).toBeUndefined();
    // The Hood (item on Pallando) is now tapped.
    const hood = getCharacter(after, RESOURCE_PLAYER, PALLANDO).items.find(i => i.definitionId === PALLANDOS_HOOD)!;
    expect(hood.status).toBe(CardStatus.Tapped);
    // Pallando himself was NOT tapped — the cost taps the Hood, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, PALLANDO).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 6: cost keys on the Hood's status, not Pallando's ─────────────────

  test('the fetch is still offered while Pallando is tapped (the Hood is what taps)', () => {
    const base = pallandoEotWithHood();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const state = withCharStatus(base, pallandoId, CardStatus.Tapped);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(3);
  });

  test('the fetch is NOT offered once the Hood itself is tapped', () => {
    const base = pallandoEotWithHood();
    const pallandoId = findCharInstanceId(base, RESOURCE_PLAYER, PALLANDO);
    const state = withHoodStatus(base, pallandoId, CardStatus.Tapped);
    expect(grantedActionsFor(state, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 4 timing: end-of-turn only ────────────────────────────────────────

  test('the fetch is not offered outside the end-of-turn phase (organization)', () => {
    const eot = pallandoEotWithHood();
    const pallandoId = findCharInstanceId(eot, RESOURCE_PLAYER, PALLANDO);
    // Same attached state, but back in the organization phase.
    const org = {
      ...eot,
      phaseState: { phase: Phase.Organization, characterPlayedThisTurn: false, sideboardFetchedThisTurn: 0, sideboardFetchDestination: null },
    } as GameState;
    expect(grantedActionsFor(org, pallandoId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rules 7–9: playable without Pallando, not usable without Pallando ──────
  // "Place this card on Pallando if he is in play" makes the placement
  // conditional, not the play; the fetch clause is "If on Pallando". Mirrors
  // Huntsman's Garb (wh-92) / Give Welcome to the Unexpected (wh-99).

  /** Organization-phase state with Pallando NOT in play: he sits in hand
   *  (still the declared avatar, so the pallando-specific gate passes) and his
   *  home site heads the site deck so he can be revealed. */
  function pallandoUnrevealedOrgState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [BOROMIR] }],
          hand: [PALLANDOS_HOOD, PALLANDO],
          siteDeck: [THE_WHITE_TOWERS],
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
   *  keyed on — a bare Hood has no bearer to ask `grantedActionsFor` about. */
  const allFetchOffers = (state: GameState) =>
    computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable)
      .map(ea => ea.action)
      .filter(a => a.type === 'activate-granted-action'
        && (a as { actionId?: string }).actionId === FETCH);

  test('playable bare during the organization phase when Pallando is not in play', () => {
    const state = pallandoUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const hoodId = findHandCardId(state, RESOURCE_PLAYER, PALLANDOS_HOOD);
    const after = playPermanentEventAndResolve(state, PLAYER_1, hoodId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PALLANDOS_HOOD)).toBe(true);
    // The stage point is earned whether or not the card sits on Pallando.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(1);
  });

  test('the fetch is NOT offered while the Hood sits in play unattached', () => {
    const org = pallandoUnrevealedOrgState();
    const hoodId = findHandCardId(org, RESOURCE_PLAYER, PALLANDOS_HOOD);
    let state = playPermanentEventAndResolve(org, PLAYER_1, hoodId);
    for (const d of [GIFTS_AS_GIVEN_OF_OLD, WIZARDS_VOICE, EYES_OF_MANDOS]) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
    const eot = {
      ...state,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;

    // Three fetchable cards in the discard pile, and still no offer: only a
    // Hood *on* Pallando can be tapped.
    expect(allFetchOffers(eot).length).toBe(0);
  });

  test('attaches to Pallando the moment he enters play, and the fetch works from then on', () => {
    const org = pallandoUnrevealedOrgState();
    const hoodId = findHandCardId(org, RESOURCE_PLAYER, PALLANDOS_HOOD);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, hoodId);

    // Reveal Pallando at his home site — the Hood leaves `cardsInPlay` for his items.
    const playPallando = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, PALLANDO));
    expect(playPallando).toBeDefined();
    const revealed = dispatch(bare, playPallando!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === PALLANDOS_HOOD)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, PALLANDO).items.some(i => i.definitionId === PALLANDOS_HOOD)).toBe(true);
    expect(revealed.players[RESOURCE_PLAYER].stagePoints).toBe(1);

    // With the Hood on Pallando, the end-of-turn fetch is offered again.
    let seeded = revealed;
    for (const d of [GIFTS_AS_GIVEN_OF_OLD, WIZARDS_VOICE, EYES_OF_MANDOS]) seeded = addCardToDiscardPile(seeded, RESOURCE_PLAYER, d);
    const eot = {
      ...seeded,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;
    expect(allFetchOffers(eot).length).toBe(3);
  });
});
