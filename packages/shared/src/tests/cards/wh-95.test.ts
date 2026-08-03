/**
 * @module wh-95.test
 *
 * Card test: Squire of the Hunt (wh-95)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Alatar specific. Warrior only. Playable on one of your warrior
 *    characters at one of your Wizardhavens [{H}] (or in your starting company).
 *    +1 to his direct influence. This character requires 2 points of influence
 *    to control and may only be controlled by general influence or Alatar."
 *
 * Card data note: the authoritative database (`data/cards.json`, WH-95) lists
 * `body: "+1"` and `prowess: "+1"` as printed stat modifiers (shown as icons on
 * the card, not repeated in the text paragraph). The two other members of this
 * squire family (Gandalf's Friend wh-98, Pallando's Apprentice wh-104) carry no
 * such icons — only the *Hunt* squire, a warrior combat companion, boosts body
 * and prowess. So the card grants +1 prowess, +1 body, and +1 direct influence.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Alatar specific (playable only if you are Alatar)           | IMPLEMENTED |
 * | 2 | Warrior only, not the avatar                                | IMPLEMENTED |
 * | 3 | At one of your Wizardhavens [{H}]                           | IMPLEMENTED |
 * | 4 | +1 prowess / +1 body / +1 direct influence                 | IMPLEMENTED |
 * | 5 | Requires 2 points of influence to control                  | IMPLEMENTED |
 * | 6 | May only be controlled by general influence or Alatar      | IMPLEMENTED |
 * | 7 | Stage points (2) while in play                              | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: `play-condition` `requires: 'player-state'`, `{ player.avatar:
 *    "Alatar" }` — a Fallen-wizard counts "as" his declared avatar (CoE 2.2.F2).
 *  - Rule 2: `play-target` `character` filter `target.isAvatar $ne true` AND
 *    `target.skills $includes "warrior"`.
 *  - Rule 3: `play-condition` `requires: 'company-context'`, `{
 *    site.isOwnWizardhaven: true }` — `matchesCompanyContextCondition` exposes
 *    `site.isOwnWizardhaven` (true only for the player's own Wizardhavens via
 *    `isHavenForPlayer`), distinct from a generic METW Haven sharing
 *    `type: "haven"`. The "(or in your starting company)" clause is subsumed:
 *    the starting company forms at a Wizardhaven.
 *  - Rule 4: three `stat-modifier` effects (prowess/body/direct-influence, +1),
 *    resolved from the bearer's attached items.
 *  - Rules 5–6: `control-restriction` `cost: 2`, `sources: ["general",
 *    "fallen-wizard"]` — "or Alatar" is the Fallen-wizard avatar, the same
 *    generic modeling used by Wizard's Myrmidon (wh-84) / The Forge-master
 *    (wh-117). Read through `engine/control-cost.ts`.
 *  - Rule 7: `stage-points` value 2, summed from characters' items in
 *    `recompute-derived.ts`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  buildTestState, makePlayDeck, resetMint,
  viableActions,
  findCharInstanceId, findHandCardId,
  playPermanentEventAndResolve,
  getCharacter,
  createGame, draftInstId, runActions, pool, recomputeDerived,
} from '../test-helpers.js';
import type { CardDefinitionId, GameConfig } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Squire of the Hunt — the card under test */
const SQUIRE_OF_THE_HUNT = 'wh-95' as CardDefinitionId;
/** Alatar — the Fallen-wizard avatar this card is specific to (warrior). */
const ALATAR = 'wh-1' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Alatar
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior (mind 4, DI 1, body 7, prowess 6). Mind 4 keeps
 *  him controllable by The Mouth's DI 4 in the isolation test below. */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Adrazar — a hero non-warrior (Scout/Diplomat) — negative control for the
 *  "Warrior only" filter. */
const ADRAZAR = 'tw-116' as CardDefinitionId;
/** The Mouth — a normal (non-avatar) character with DI 4. Negative control for
 *  the control-source restriction: a valid direct-influence controller but for
 *  "only general influence or Alatar". */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rivendell — a generic (wizard-alignment) haven; NOT a Fallen-wizard's
 *  Wizardhaven. Negative control for "at one of your Wizardhavens". */
const RIVENDELL = 'tw-421' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function alatarOrgState(opts?: {
  hand?: CardDefinitionId[];
  characters?: CardDefinitionId[];
  site?: CardDefinitionId;
}) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: opts?.site ?? ISENGARD, characters: opts?.characters ?? [ALATAR, BOROMIR] }],
        hand: opts?.hand ?? [SQUIRE_OF_THE_HUNT],
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

describe('Squire of the Hunt (wh-95)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: Warrior only, and never on the Fallen-wizard avatar ────────────

  test('offered on the warrior character, not on a non-warrior nor on the avatar', () => {
    const state = alatarOrgState({ characters: [ALATAR, BOROMIR, ADRAZAR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    const adrazarId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const alatarId = findCharInstanceId(state, RESOURCE_PLAYER, ALATAR);

    expect(targetIds).toContain(boromirId);
    expect(targetIds).not.toContain(adrazarId); // non-warrior excluded
    expect(targetIds).not.toContain(alatarId); // the avatar excluded
    expect(actions.length).toBe(1); // exactly the one warrior
  });

  // ── Rule 1: Alatar specific ────────────────────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // Same warrior + same Wizardhaven, but the avatar is Saruman → play-condition
    // player-state {avatar: "Alatar"} fails and the card is not offered.
    const state = alatarOrgState({ characters: [SARUMAN, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: at one of your Wizardhavens [{H}] ──────────────────────────────

  test('not playable at a generic haven that is not the Fallen-wizard\'s Wizardhaven', () => {
    // Rivendell is a wizard-alignment haven — for a Fallen-wizard it is not one
    // of "your Wizardhavens", so site.isOwnWizardhaven is false.
    const state = alatarOrgState({ site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('playable at the Fallen-wizard\'s own Wizardhaven (Isengard)', () => {
    const state = alatarOrgState({ site: ISENGARD });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    expect(actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId)).toContain(boromirId);
  });

  // ── Rule 4: +1 prowess / +1 body / +1 direct influence ─────────────────────

  test('while attached, raises the bearer prowess, body, and direct influence each by 1', () => {
    const base = alatarOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, SQUIRE_OF_THE_HUNT);

    const before = getCharacter(base, RESOURCE_PLAYER, BOROMIR).effectiveStats;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);

    const bearer = getCharacter(after, RESOURCE_PLAYER, BOROMIR);
    expect(bearer.effectiveStats.prowess).toBe(before.prowess + 1);
    expect(bearer.effectiveStats.body).toBe((before.body ?? 0) + 1);
    expect(bearer.effectiveStats.directInfluence).toBe(before.directInfluence + 1);
    // The card lives as an item on the bearer (resource permanent-event).
    expect(bearer.items.some(i => i.definitionId === SQUIRE_OF_THE_HUNT)).toBe(true);
  });

  // ── Rule 5: requires 2 points of influence to control ──────────────────────

  test('overrides the influence-to-control cost from the printed mind (4) to 2', () => {
    const base = alatarOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, SQUIRE_OF_THE_HUNT);

    // Boromir is held under general influence; the GI he consumes equals his
    // influence-to-control cost. Printed mind 4 → control cost 2, so GI used
    // drops by exactly 2 once the squire is attached (the avatar consumes none).
    const before = base.players[0].generalInfluenceUsed;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);
    expect(after.players[0].generalInfluenceUsed).toBe(before - 2);
  });

  // ── Rule 6: only general influence or Alatar may control ───────────────────

  test('may be moved under the Fallen-wizard avatar, but not under a normal character', () => {
    const withCard = alatarOrgState({ characters: [ALATAR, THE_MOUTH, BOROMIR] });
    const boromirId = findCharInstanceId(withCard, RESOURCE_PLAYER, BOROMIR);
    const alatarId = findCharInstanceId(withCard, RESOURCE_PLAYER, ALATAR);
    const mouthId = findCharInstanceId(withCard, RESOURCE_PLAYER, THE_MOUTH);
    const cardId = findHandCardId(withCard, RESOURCE_PLAYER, SQUIRE_OF_THE_HUNT);

    const attached = playPermanentEventAndResolve(withCard, PLAYER_1, cardId, boromirId);
    const controllers = viableActions(attached, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === boromirId)
      .map(a => a.controlledBy);

    // Alatar (FW avatar, DI 10 ≥ cost 2) may control; The Mouth (normal char,
    // DI 4 ≥ cost 2) may not — the control-source restriction excludes it.
    expect(controllers).toContain(alatarId);
    expect(controllers).not.toContain(mouthId);
  });

  test('without the card, the same normal character IS a valid controller (isolates the restriction)', () => {
    // Identical company but no card played: The Mouth (DI 4) can hold Boromir
    // (mind 5) — proving its exclusion above is the control-source rule, not DI.
    const base = alatarOrgState({ characters: [ALATAR, THE_MOUTH, BOROMIR], hand: [] });
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const mouthId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);

    const controllers = viableActions(base, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === boromirId)
      .map(a => a.controlledBy);

    expect(controllers).toContain(mouthId);
  });

  // ── Rule 7: contributes 2 stage points while attached ──────────────────────

  test('the attached stage points are counted toward the controller stage-point total', () => {
    const base = alatarOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, SQUIRE_OF_THE_HUNT);

    expect(base.players[0].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);
    expect(after.players[0].stagePoints).toBe(2);
  });

  // ── Rule 3 (setup route): "(or in your starting company)" ──────────────────

  test('drafted during the character draft, Squire of the Hunt attaches to the warrior starting character', () => {
    // Regression (bug report): drafted as a Stage resource, the engine used to
    // "put it into play" bare (CoE 1.9.F4) with no character bearer, leaving it
    // stuck in cardsInPlay — invisible and with no effect, exactly like the
    // reported "selected in Draft but wasn't assigned to character" symptom. It
    // must instead attach to a qualifying drafted character, per its own "(or in
    // your starting company)" text.
    const config: GameConfig = {
      players: [
        { id: PLAYER_1, name: 'Alice', alignment: Alignment.FallenWizard,
          draftPool: [SQUIRE_OF_THE_HUNT, BOROMIR], playDeck: makePlayDeck(), siteDeck: [ISENGARD], sideboard: [] },
        { id: PLAYER_2, name: 'Bob', alignment: Alignment.Wizard,
          draftPool: [ADRAZAR], playDeck: makePlayDeck(), siteDeck: [ISENGARD], sideboard: [] },
      ],
      seed: 42,
    };
    let state = createGame(config, pool);

    // Round 1: the Fallen-wizard drafts the Squire — a Stage resource that
    // resolves into play immediately (CoE 1.9.F4) without using a character
    // pick; the opponent picks their (only) character, emptying their pool.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, SQUIRE_OF_THE_HUNT) },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ADRAZAR) },
    ]);
    // The Fallen-wizard then drafts the warrior, which empties the pool and
    // auto-finalises the draft.
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: draftInstId(state, 0, BOROMIR) },
    ]);

    state = recomputeDerived(state);
    const boromir = getCharacter(state, RESOURCE_PLAYER, BOROMIR);
    expect(boromir.items.some(i => i.definitionId === SQUIRE_OF_THE_HUNT)).toBe(true);
    // Never left floating, unattached, in cardsInPlay.
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === SQUIRE_OF_THE_HUNT)).toBe(false);
    // Its stat-modifiers apply immediately (+1 prowess: 6 → 7).
    expect(boromir.effectiveStats.prowess).toBe(7);
  });
});
