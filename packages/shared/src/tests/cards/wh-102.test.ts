/**
 * @module wh-102.test
 *
 * Card test: Ring of Fire (wh-102)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Gandalf specific. Place this card on Gandalf if he is in play. If
 *    on Gandalf, you may tap Ring of Fire during your organization phase to
 *    take Narya from your discard pile to your hand."
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                          | Status      |
 * |---|---------------------------------------------------------------|-------------|
 * | 1 | Unique / Gandalf specific (playable only if you are Gandalf)  | IMPLEMENTED |
 * | 2 | Placed on Gandalf (only offered on the Gandalf character)     | IMPLEMENTED |
 * | 3 | Stage points (2) while in play                                | IMPLEMENTED |
 * | 4 | Tap the Ring during the organization phase to fetch Narya     | IMPLEMENTED |
 * | 5 | Only Narya is fetchable                                       | IMPLEMENTED |
 * | 6 | Cost taps the Ring itself (not Gandalf)                       | IMPLEMENTED |
 * | 7 | Playable bare when Gandalf is NOT in play ("if he is in play")| IMPLEMENTED |
 * | 8 | Attaches to Gandalf the moment he enters play                 | IMPLEMENTED |
 * | 9 | The fetch is unavailable while the card is not on Gandalf     | IMPLEMENTED |
 * |10 | The fetch fires only during the organization phase            | IMPLEMENTED |
 *
 * Modeling (same shape as Pallando's Hood wh-105/Stave of Pallando wh-107,
 * retargeted to Gandalf, minus their +1 corruption point which this card's
 * text does not carry):
 *  - Rule 1: the `gandalf-specific` keyword gates playability to a player
 *    whose revealed avatar is Gandalf (`wizardSpecificName`, MEWH), and
 *    `unique`.
 *  - Rule 2: `play-target` `character` filter `{ target.name: "Gandalf" }` —
 *    the card attaches to Gandalf's `items` (resource permanent-event on a
 *    character).
 *  - Rule 3: `stage-points` value 2, summed from characters' items in
 *    `recompute-derived.ts`.
 *  - Rules 4-6: a `grant-action` `ring-of-fire-fetch`, `cost: { tap: "self" }`
 *    — unlike wh-105/wh-107 this carries **no** `endOfTurnOnly` flag, and its
 *    `apply` is a discard→hand `move` (`select: "target"`, `from: "discard"`,
 *    `to: "hand"`, `filter: { name: "Narya" }`) rather than an
 *    `enqueue-pending-fetch`: a bare `enqueue-pending-fetch`-tap ability would
 *    leak through `bareCardGrantActions` (which offers any bare in-play
 *    resource-event's `enqueue-pending-fetch`/`add-constraint` grant-action
 *    regardless of attachment), wrongly making the fetch usable before Gandalf
 *    is even in play. The `move` apply shape is invisible to that scanner (it
 *    only recognizes the other two apply types), so the ability surfaces only
 *    through the item-attached grant-action loop. That loop previously only
 *    offered per-candidate discard→hand `move` fetches from the *end-of-turn*
 *    scanner (`legal-actions/end-of-turn.ts` `isDiscardToHandMove`, gated on
 *    `endOfTurnOnly`); the organization-phase item-attached scan
 *    (`legal-actions/organization.ts` `grantedActionActivations`'s item loop)
 *    gained the same recognition — one activation per matching discard-pile
 *    card — for a plain grant-action whose `apply` is a discard→hand `move`,
 *    giving Ring of Fire its organization-phase timing without touching the
 *    end-of-turn-only cards. `tap: self` on an item-borne grant taps the
 *    *item* (via `applyCost`'s attachment handling), so eligibility keys on
 *    the Ring's own status — not the bearer's — meaning the fetch works even
 *    while Gandalf is tapped.
 *  - Rules 7-8: "Place this card on Gandalf **if he is in play**" — placement
 *    is conditional, not a play requirement. An untargeted `play-option`
 *    gated on `player.avatarInPlay: false` lets the card enter play bare in
 *    `cardsInPlay`, and an `on-event: avatar-enters-play` move (self →
 *    `in-play-on-character`) attaches it to Gandalf the moment he is
 *    revealed — the wh-105 / Bade to Rule (le-167) pattern.
 *  - Rule 9 falls out of the item-attached scan only walking characters'
 *    attached items — a Ring sitting bare in `cardsInPlay` is never a grant
 *    source ("If on Gandalf, you may tap…").
 *  - Rule 10 falls out of `organizationActions` only running during
 *    `Phase.Organization` — the item-attached grant-action scan it calls is
 *    unreachable from any other phase for a plain (non-`anyPhase`,
 *    non-`activeSitePhase`) grant-action.
 *
 * Fixture alignment: minion-resource-event / stage, played by a Fallen-wizard
 * player whose declared avatar is the White-Hand Gandalf (wh-4, alignment
 * `fallen-wizard`) — tests use a mix of WH (Fallen-wizard sites/characters)
 * and TW (Gandalf's own home-site type / Narya) card ids, mirroring wh-105.
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

/** Ring of Fire — the card under test. */
const RING_OF_FIRE = 'wh-102' as CardDefinitionId;
/** Gandalf (White Hand) — the Fallen-wizard avatar this card is specific to. */
const GANDALF = 'wh-4' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for
 *  "Gandalf specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior; negative control for "place on Gandalf" (the
 *  card must never be offered on a character other than Gandalf). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven (haven site), used as an arbitrary
 *  company location. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Edoras — a hero Free-hold, one of Gandalf's home sites ("Any Free-hold"),
 *  so he can be revealed there from hand. */
const EDORAS = 'tw-394' as CardDefinitionId;

/** The one card Ring of Fire may retrieve from the discard pile. */
const NARYA = 'tw-290' as CardDefinitionId;
/** A resource NOT retrievable — negative control for the fetch filter. */
const DECOY = 'tw-188' as CardDefinitionId; // A Chance Meeting

const FETCH = 'ring-of-fire-fetch';

// ── Builder ──────────────────────────────────────────────────────────────────

/** Organization-phase state: Fallen-wizard P1 (avatar Gandalf) with the Ring
 *  in hand at Isengard. `characters` allows the negative controls. */
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
        hand: opts?.hand ?? [RING_OF_FIRE],
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

/** Attach the Ring to Gandalf and seed the discard pile. */
function gandalfOrgWithRing(discard: CardDefinitionId[] = [NARYA, DECOY]): GameState {
  const org = gandalfOrgState();
  const gandalfId = findCharInstanceId(org, RESOURCE_PLAYER, GANDALF);
  const ringId = findHandCardId(org, RESOURCE_PLAYER, RING_OF_FIRE);
  let state = playPermanentEventAndResolve(org, PLAYER_1, ringId, gandalfId);
  for (const d of discard) state = addCardToDiscardPile(state, RESOURCE_PLAYER, d);
  return state;
}

/** Return a copy of `state` with the given P1 character's status changed. */
const withCharStatus = (state: GameState, charId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
  ...state,
  players: state.players.map((p, i) =>
    i === RESOURCE_PLAYER
      ? { ...p, characters: { ...p.characters, [charId as string]: { ...p.characters[charId], status } } }
      : p) as unknown as GameState['players'],
});

/** Return a copy of `state` with the Ring item (on Gandalf) tapped. */
const withRingStatus = (state: GameState, gandalfId: ReturnType<typeof findCharInstanceId>, status: CardStatus): GameState => ({
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
          items: gandalf.items.map(it => it.definitionId === RING_OF_FIRE ? { ...it, status } : it),
        },
      },
    } as PlayerState;
  }) as unknown as GameState['players'],
});

const discardInstId = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === defId)?.instanceId;

const handHas = (state: GameState, defId: CardDefinitionId) =>
  state.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === defId);

/** Every viable `ring-of-fire-fetch` activation, regardless of phase. */
const fetchActivations = (state: GameState) =>
  computeLegalActions(state, PLAYER_1)
    .filter(ea => ea.viable)
    .map(ea => ea.action)
    .filter(a => a.type === 'activate-granted-action' && (a as { actionId?: string }).actionId === FETCH);

describe('Ring of Fire (wh-102)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: Gandalf specific, placed on Gandalf ─────────────────────────

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
    // No Gandalf in the company → the gandalf-specific keyword gate fails, and
    // the play-target { name: "Gandalf" } has no match either.
    const state = gandalfOrgState({ characters: [SARUMAN, BOROMIR] });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Rule 3: contributes 2 stage points while attached ──────────────────────

  test('placing the card on Gandalf adds it to his items and yields 2 stage points', () => {
    const base = gandalfOrgState();
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const ringId = findHandCardId(base, RESOURCE_PLAYER, RING_OF_FIRE);

    expect(base.players[RESOURCE_PLAYER].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, ringId, gandalfId);

    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).items.some(i => i.definitionId === RING_OF_FIRE)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  // ── Rules 4–5: organization-phase fetch of Narya ───────────────────────────

  test('during the organization phase, offers one fetch per matching card in the discard pile, and no others', () => {
    const state = gandalfOrgWithRing([NARYA, DECOY]);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    const grants = grantedActionsFor(state, gandalfId, FETCH, PLAYER_1);
    const targets = grants.map(a => a.targetCardId);

    expect(targets).toContain(discardInstId(state, NARYA));
    expect(targets).not.toContain(discardInstId(state, DECOY));
    expect(grants.length).toBe(1);
  });

  test('no fetch is offered when Narya is not in the discard pile', () => {
    const state = gandalfOrgWithRing([DECOY]);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  test('activating the fetch moves Narya from discard to hand and taps the Ring', () => {
    const state = gandalfOrgWithRing([NARYA, DECOY]);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    expect(handHas(state, NARYA)).toBe(false);
    const grant = grantedActionsFor(state, gandalfId, FETCH, PLAYER_1)
      .find(a => a.targetCardId === discardInstId(state, NARYA))!;
    const after = dispatch(state, grant);

    // Narya is now in hand and no longer in the discard pile.
    expect(handHas(after, NARYA)).toBe(true);
    expect(discardInstId(after, NARYA)).toBeUndefined();
    // The Ring (item on Gandalf) is now tapped.
    const ring = getCharacter(after, RESOURCE_PLAYER, GANDALF).items.find(i => i.definitionId === RING_OF_FIRE)!;
    expect(ring.status).toBe(CardStatus.Tapped);
    // Gandalf himself was NOT tapped — the cost taps the Ring, not the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, GANDALF).status).toBe(CardStatus.Untapped);
  });

  // ── Rule 6: cost keys on the Ring's status, not Gandalf's ──────────────────

  test('the fetch is still offered while Gandalf is tapped (the Ring is what taps)', () => {
    const base = gandalfOrgWithRing([NARYA]);
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const state = withCharStatus(base, gandalfId, CardStatus.Tapped);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(1);
  });

  test('the fetch is NOT offered once the Ring itself is tapped', () => {
    const base = gandalfOrgWithRing([NARYA]);
    const gandalfId = findCharInstanceId(base, RESOURCE_PLAYER, GANDALF);
    const state = withRingStatus(base, gandalfId, CardStatus.Tapped);
    expect(grantedActionsFor(state, gandalfId, FETCH, PLAYER_1).length).toBe(0);
  });

  // ── Rule 10: organization-phase-only timing ────────────────────────────────

  test('the fetch is not offered outside the organization phase (end-of-turn)', () => {
    const org = gandalfOrgWithRing([NARYA]);
    const eot = {
      ...org,
      phaseState: { phase: Phase.EndOfTurn, step: 'discard', discardDone: [false, false], resetHandDone: [false, false] },
    } as GameState;
    expect(fetchActivations(eot).length).toBe(0);
  });

  // ── Rules 7–9: playable without Gandalf, not usable without Gandalf ───────
  // "Place this card on Gandalf if he is in play" makes the placement
  // conditional, not the play; the fetch clause is "If on Gandalf". Mirrors
  // Pallando's Hood (wh-105) / Huntsman's Garb (wh-92).

  /** Organization-phase state with Gandalf NOT in play: he sits in hand
   *  (still the declared avatar, so the gandalf-specific gate passes) and a
   *  Free-hold heads the site deck so he can be revealed there. */
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
          hand: [RING_OF_FIRE, GANDALF],
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

  test('playable bare during the organization phase when Gandalf is not in play', () => {
    const state = gandalfUnrevealedOrgState();
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetCharacterId?: unknown }).targetCharacterId).toBeUndefined();

    const ringId = findHandCardId(state, RESOURCE_PLAYER, RING_OF_FIRE);
    const after = playPermanentEventAndResolve(state, PLAYER_1, ringId);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RING_OF_FIRE)).toBe(true);
    // The stage points are earned whether or not the card sits on Gandalf.
    expect(after.players[RESOURCE_PLAYER].stagePoints).toBe(2);
  });

  test('the fetch is NOT offered while the Ring sits in play unattached', () => {
    const org = gandalfUnrevealedOrgState();
    const ringId = findHandCardId(org, RESOURCE_PLAYER, RING_OF_FIRE);
    let state = playPermanentEventAndResolve(org, PLAYER_1, ringId);
    state = addCardToDiscardPile(state, RESOURCE_PLAYER, NARYA);

    // Narya is in the discard pile, and still no offer: only a Ring *on*
    // Gandalf can be tapped.
    expect(fetchActivations(state).length).toBe(0);
  });

  test('attaches to Gandalf the moment he enters play, and the fetch works from then on', () => {
    const org = gandalfUnrevealedOrgState();
    const ringId = findHandCardId(org, RESOURCE_PLAYER, RING_OF_FIRE);
    const bare = playPermanentEventAndResolve(org, PLAYER_1, ringId);

    // Reveal Gandalf at a Free-hold — the Ring leaves `cardsInPlay` for his items.
    const playGandalf = viablePlayCharacterActions(bare, PLAYER_1).find(a => a.characterInstanceId
      === findHandCardId(bare, RESOURCE_PLAYER, GANDALF));
    expect(playGandalf).toBeDefined();
    const revealed = dispatch(bare, playGandalf!);

    expect(revealed.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === RING_OF_FIRE)).toBe(false);
    expect(getCharacter(revealed, RESOURCE_PLAYER, GANDALF).items.some(i => i.definitionId === RING_OF_FIRE)).toBe(true);
    expect(revealed.players[RESOURCE_PLAYER].stagePoints).toBe(2);

    // With the Ring on Gandalf, the organization-phase fetch is offered again.
    const seeded = addCardToDiscardPile(revealed, RESOURCE_PLAYER, NARYA);
    expect(fetchActivations(seeded).length).toBe(1);
  });
});
