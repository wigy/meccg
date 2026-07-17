/**
 * @module wh-98.test
 *
 * Card test: Gandalf's Friend (wh-98)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Gandalf specific. Playable on one of your characters at one of your
 *    Wizardhavens [{H}] (or in your starting company). +2 to his direct
 *    influence. This character requires 1 point of influence to control and may
 *    only be controlled by general influence or Gandalf."
 *
 * Card data note: the authoritative database (`data/cards.json`, WH-98) carries
 * no printed prowess/body icons — unlike its warrior cousin Squire of the Hunt
 * (wh-95, +1 prowess / +1 body). Gandalf's Friend is a pure influence card: +2
 * direct influence and a control-cost override, with no combat boost. It is the
 * Gandalf member of the "squire" family (wh-84 / wh-95 / wh-104 / wh-117); the
 * effect types are all engine-supported and certified by those siblings.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Gandalf specific (playable only if you are Gandalf)         | IMPLEMENTED |
 * | 2 | On one of your characters (not the avatar), no skill filter | IMPLEMENTED |
 * | 3 | At one of your Wizardhavens [{H}]                           | IMPLEMENTED |
 * | 4 | +2 direct influence                                         | IMPLEMENTED |
 * | 5 | Requires 1 point of influence to control                   | IMPLEMENTED |
 * | 6 | May only be controlled by general influence or Gandalf     | IMPLEMENTED |
 * | 7 | Stage points (1) while in play                              | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: `play-condition` `requires: 'player-state'`, `{ player.avatar:
 *    "Gandalf" }` — a Fallen-wizard counts "as" his declared avatar (CoE 2.2.F2).
 *  - Rule 2: `play-target` `character` filter `target.isAvatar $ne true`. Unlike
 *    the Squire (warrior only), Gandalf's Friend has no skill restriction — any
 *    of the player's non-avatar characters is a legal bearer.
 *  - Rule 3: `play-condition` `requires: 'company-context'`, `{
 *    site.isOwnWizardhaven: true }` — `matchesCompanyContextCondition` exposes
 *    `site.isOwnWizardhaven` (true only for the player's own Wizardhavens via
 *    `isHavenForPlayer`), distinct from a generic METW Haven. The "(or in your
 *    starting company)" clause is subsumed: the starting company forms at a
 *    Wizardhaven.
 *  - Rule 4: a `stat-modifier` `direct-influence` +2, resolved from the bearer's
 *    attached items.
 *  - Rules 5–6: `control-restriction` `cost: 1`, `sources: ["general",
 *    "fallen-wizard"]` — "or Gandalf" is the Fallen-wizard avatar, the same
 *    generic modeling used by the squire siblings. Read through
 *    `engine/control-cost.ts`.
 *  - Rule 7: `stage-points` value 1, summed from characters' items in
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
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Gandalf's Friend — the card under test */
const GANDALFS_FRIEND = 'wh-98' as CardDefinitionId;
/** Gandalf — the Fallen-wizard avatar this card is specific to (DI 9). */
const GANDALF = 'wh-4' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Gandalf
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Boromir II — a hero warrior (mind 4, DI 1). */
const BOROMIR = 'tw-134' as CardDefinitionId;
/** Adrazar — a hero non-warrior (Scout/Diplomat, mind 3). Shows the card has no
 *  skill filter: any non-avatar character is a legal bearer. */
const ADRAZAR = 'tw-116' as CardDefinitionId;
/** The Mouth — a normal (non-avatar) character with DI 4. Negative control for
 *  the control-source restriction: a valid direct-influence controller but for
 *  "only general influence or Gandalf". */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rivendell — a generic (wizard-alignment) haven; NOT a Fallen-wizard's
 *  Wizardhaven. Negative control for "at one of your Wizardhavens". */
const RIVENDELL = 'tw-421' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function gandalfOrgState(opts?: {
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
        companies: [{ site: opts?.site ?? ISENGARD, characters: opts?.characters ?? [GANDALF, BOROMIR] }],
        hand: opts?.hand ?? [GANDALFS_FRIEND],
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

describe("Gandalf's Friend (wh-98)", () => {
  beforeEach(() => resetMint());

  // ── Rule 2: on any of your characters, but never on the avatar ─────────────

  test('offered on any non-avatar character (no skill filter), never on the avatar', () => {
    const state = gandalfOrgState({ characters: [GANDALF, BOROMIR, ADRAZAR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    const adrazarId = findCharInstanceId(state, RESOURCE_PLAYER, ADRAZAR);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    expect(targetIds).toContain(boromirId); // warrior — offered
    expect(targetIds).toContain(adrazarId); // non-warrior — also offered (no skill filter)
    expect(targetIds).not.toContain(gandalfId); // the avatar excluded
    expect(actions.length).toBe(2); // exactly the two non-avatar characters
  });

  // ── Rule 1: Gandalf specific ───────────────────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    // Same bearer + same Wizardhaven, but the avatar is Saruman → play-condition
    // player-state {avatar: "Gandalf"} fails and the card is not offered.
    const state = gandalfOrgState({ characters: [SARUMAN, BOROMIR] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: at one of your Wizardhavens [{H}] ──────────────────────────────

  test('not playable at a generic haven that is not the Fallen-wizard\'s Wizardhaven', () => {
    // Rivendell is a wizard-alignment haven — for a Fallen-wizard it is not one
    // of "your Wizardhavens", so site.isOwnWizardhaven is false.
    const state = gandalfOrgState({ site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('playable at the Fallen-wizard\'s own Wizardhaven (Isengard)', () => {
    const state = gandalfOrgState({ site: ISENGARD });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const boromirId = findCharInstanceId(state, RESOURCE_PLAYER, BOROMIR);
    expect(actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId)).toContain(boromirId);
  });

  // ── Rule 4: +2 direct influence (and no prowess/body boost) ────────────────

  test('while attached, raises the bearer direct influence by 2 and leaves prowess/body unchanged', () => {
    const base = gandalfOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GANDALFS_FRIEND);

    const before = getCharacter(base, RESOURCE_PLAYER, BOROMIR).effectiveStats;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);

    const bearer = getCharacter(after, RESOURCE_PLAYER, BOROMIR);
    expect(bearer.effectiveStats.directInfluence).toBe(before.directInfluence + 2);
    expect(bearer.effectiveStats.prowess).toBe(before.prowess); // no combat boost
    expect(bearer.effectiveStats.body).toBe(before.body); // no combat boost
    // The card lives as an item on the bearer (resource permanent-event).
    expect(bearer.items.some(i => i.definitionId === GANDALFS_FRIEND)).toBe(true);
  });

  // ── Rule 5: requires 1 point of influence to control ───────────────────────

  test('overrides the influence-to-control cost from the printed mind (4) to 1', () => {
    const base = gandalfOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GANDALFS_FRIEND);

    // Boromir is held under general influence; the GI he consumes equals his
    // influence-to-control cost. Printed mind 4 → control cost 1, so GI used
    // drops by exactly 3 once the friend is attached (the avatar consumes none).
    const before = base.players[0].generalInfluenceUsed;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);
    expect(after.players[0].generalInfluenceUsed).toBe(before - 3);
  });

  // ── Rule 6: only general influence or Gandalf may control ──────────────────

  test('may be moved under the Fallen-wizard avatar, but not under a normal character', () => {
    const withCard = gandalfOrgState({ characters: [GANDALF, THE_MOUTH, BOROMIR] });
    const boromirId = findCharInstanceId(withCard, RESOURCE_PLAYER, BOROMIR);
    const gandalfId = findCharInstanceId(withCard, RESOURCE_PLAYER, GANDALF);
    const mouthId = findCharInstanceId(withCard, RESOURCE_PLAYER, THE_MOUTH);
    const cardId = findHandCardId(withCard, RESOURCE_PLAYER, GANDALFS_FRIEND);

    const attached = playPermanentEventAndResolve(withCard, PLAYER_1, cardId, boromirId);
    const controllers = viableActions(attached, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === boromirId)
      .map(a => a.controlledBy);

    // Gandalf (FW avatar, DI 9 ≥ cost 1) may control; The Mouth (normal char,
    // DI 4 ≥ cost 1) may not — the control-source restriction excludes it.
    expect(controllers).toContain(gandalfId);
    expect(controllers).not.toContain(mouthId);
  });

  test('without the card, the same normal character IS a valid controller (isolates the restriction)', () => {
    // Identical company but no card played: The Mouth (DI 4) can hold Boromir
    // (mind 4) — proving its exclusion above is the control-source rule, not DI.
    const base = gandalfOrgState({ characters: [GANDALF, THE_MOUTH, BOROMIR], hand: [] });
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const mouthId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);

    const controllers = viableActions(base, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === boromirId)
      .map(a => a.controlledBy);

    expect(controllers).toContain(mouthId);
  });

  // ── Rule 7: contributes 1 stage point while attached ───────────────────────

  test('the attached stage point is counted toward the controller stage-point total', () => {
    const base = gandalfOrgState();
    const boromirId = findCharInstanceId(base, RESOURCE_PLAYER, BOROMIR);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, GANDALFS_FRIEND);

    expect(base.players[0].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, boromirId);
    expect(after.players[0].stagePoints).toBe(1);
  });
});
