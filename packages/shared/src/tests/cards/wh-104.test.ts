/**
 * @module wh-104.test
 *
 * Card test: Pallando's Apprentice (wh-104)
 * Type: minion-resource-event (permanent), alignment: stage
 *
 * Text:
 *   "Unique. Pallando specific. Sage only. Playable on a non-Hobbit, non-Dwarf
 *    sage character at one of your Wizardhavens [{H}] (or in your starting
 *    company). +1 to his direct influence. This character requires 2 points of
 *    influence to control and may only be controlled by general influence or
 *    Pallando. This character may tap to use a Palantír he bears."
 *
 * Card data note: the authoritative database (`data/cards.json`, WH-104) lists
 * no printed prowess/body icons — unlike the warrior *Squire of the Hunt*
 * (wh-95), this sage companion boosts only direct influence.
 *
 * Engine Support (see step-7 report):
 * | # | Rule                                                        | Status      |
 * |---|-------------------------------------------------------------|-------------|
 * | 1 | Pallando specific (playable only if you are Pallando)       | IMPLEMENTED |
 * | 2 | Sage only, non-Hobbit, non-Dwarf, not the avatar            | IMPLEMENTED |
 * | 3 | At one of your Wizardhavens [{H}]                           | IMPLEMENTED |
 * | 4 | +1 direct influence                                        | IMPLEMENTED |
 * | 5 | Requires 2 points of influence to control                  | IMPLEMENTED |
 * | 6 | May only be controlled by general influence or Pallando    | IMPLEMENTED |
 * | 7 | May tap to use a Palantír he bears                          | IMPLEMENTED |
 * | 8 | Stage points (2) while in play                             | IMPLEMENTED |
 *
 * Modeling:
 *  - Rule 1: `play-condition` `requires: 'player-state'`, `{ player.avatar:
 *    "Pallando" }` — a Fallen-wizard counts "as" his declared avatar.
 *  - Rule 2: `play-target` `character` filter `target.isAvatar $ne true` AND
 *    `target.skills $includes "sage"` AND `target.race $ne "hobbit"` AND
 *    `target.race $ne "dwarf"`.
 *  - Rule 3: `play-condition` `requires: 'company-context'`, `{
 *    site.isOwnWizardhaven: true }` (shared with Squire of the Hunt wh-95). The
 *    "(or in your starting company)" clause is subsumed — the starting company
 *    forms at a Wizardhaven.
 *  - Rule 4: `stat-modifier` `direct-influence` +1, resolved from the bearer's
 *    attached items.
 *  - Rules 5–6: `control-restriction` `cost: 2`, `sources: ["general",
 *    "fallen-wizard"]` — "or Pallando" is the Fallen-wizard avatar.
 *  - Rule 7: `play-flag` `can-use-palantir` — the same primitive Align Palantír
 *    (tw-190) / Focus Palantír (le-184) use to set `bearer.canUsePalantir`,
 *    which gates every Palantír item's grant-action.
 *  - Rule 8: `stage-points` value 2.
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
import type { ActivateGrantedAction, CardDefinitionId } from '../../index.js';
import { Phase, Alignment } from '../../index.js';

// ── Local card-ID constants (single-use — not promoted to card-ids.ts) ──

/** Pallando's Apprentice — the card under test */
const PALLANDOS_APPRENTICE = 'wh-104' as CardDefinitionId;
/** Pallando — the Fallen-wizard avatar this card is specific to. */
const PALLANDO = 'wh-7' as CardDefinitionId;
/** Saruman — a *different* Fallen-wizard avatar (negative control for "Pallando
 *  specific"). */
const SARUMAN = 'wh-9' as CardDefinitionId;
/** Dorelas — a normal (non-avatar) Man sage, mind 3, DI 1. Mind 3 keeps him
 *  controllable by The Mouth's DI 4 in the isolation test below. */
const DORELAS = 'le-8' as CardDefinitionId;
/** Náin — a Dwarf sage — negative control for the "non-Dwarf" filter. */
const NAIN = 'le-26' as CardDefinitionId;
/** Bilbo — a Hobbit sage — negative control for the "non-Hobbit" filter. */
const BILBO = 'tw-131' as CardDefinitionId;
/** The Mouth — a normal (non-avatar) Man, DI 4, warrior/diplomat (NOT a sage).
 *  Doubles as the non-sage filter negative control and the control-source
 *  negative control (a valid direct-influence controller but for "only general
 *  influence or Pallando"). */
const THE_MOUTH = 'le-24' as CardDefinitionId;
/** Palantír of Minas Tirith — a Palantír item with a `palantir-peek-shuffle`
 *  grant-action gated on `bearer.canUsePalantir`. */
const PALANTIR_OF_MINAS_TIRITH = 'le-333' as CardDefinitionId;
/** Isengard — a Fallen-wizard Wizardhaven. */
const ISENGARD = 'wh-56' as CardDefinitionId;
/** Rivendell — a generic (wizard-alignment) haven; NOT a Fallen-wizard's
 *  Wizardhaven. Negative control for "at one of your Wizardhavens". */
const RIVENDELL = 'tw-421' as CardDefinitionId;

// ── Builder ──────────────────────────────────────────────────────────────────

function pallandoOrgState(opts?: {
  hand?: CardDefinitionId[];
  characters?: (CardDefinitionId | { defId: CardDefinitionId; items: CardDefinitionId[] })[];
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
        companies: [{ site: opts?.site ?? ISENGARD, characters: opts?.characters ?? [PALLANDO, DORELAS] }],
        hand: opts?.hand ?? [PALLANDOS_APPRENTICE],
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

describe("Pallando's Apprentice (wh-104)", () => {
  beforeEach(() => resetMint());

  // ── Rule 2: Sage only; non-Hobbit, non-Dwarf; never the avatar ─────────────

  test('offered on the non-Hobbit non-Dwarf sage, not on dwarves/hobbits/non-sages/avatar', () => {
    const state = pallandoOrgState({ characters: [PALLANDO, DORELAS, THE_MOUTH, NAIN, BILBO] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const targetIds = actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId);

    const dorelasId = findCharInstanceId(state, RESOURCE_PLAYER, DORELAS);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const pallandoId = findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO);

    expect(targetIds).toContain(dorelasId);
    expect(targetIds).not.toContain(mouthId); // non-sage excluded
    expect(targetIds).not.toContain(nainId); // dwarf excluded
    expect(targetIds).not.toContain(bilboId); // hobbit excluded
    expect(targetIds).not.toContain(pallandoId); // the avatar excluded
    expect(actions.length).toBe(1); // exactly the one eligible sage
  });

  // ── Rule 1: Pallando specific ──────────────────────────────────────────────

  test('not playable when the player counts as a different Fallen-wizard (Saruman)', () => {
    const state = pallandoOrgState({ characters: [SARUMAN, DORELAS] });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Rule 3: at one of your Wizardhavens [{H}] ──────────────────────────────

  test('not playable at a generic haven that is not the Fallen-wizard\'s Wizardhaven', () => {
    const state = pallandoOrgState({ site: RIVENDELL });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  test('playable at the Fallen-wizard\'s own Wizardhaven (Isengard)', () => {
    const state = pallandoOrgState({ site: ISENGARD });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const dorelasId = findCharInstanceId(state, RESOURCE_PLAYER, DORELAS);
    expect(actions.map(ea => (ea.action as { targetCharacterId?: unknown }).targetCharacterId)).toContain(dorelasId);
  });

  // ── Rule 4: +1 direct influence ────────────────────────────────────────────

  test('while attached, raises the bearer direct influence by 1', () => {
    const base = pallandoOrgState();
    const dorelasId = findCharInstanceId(base, RESOURCE_PLAYER, DORELAS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, PALLANDOS_APPRENTICE);

    const before = getCharacter(base, RESOURCE_PLAYER, DORELAS).effectiveStats;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, dorelasId);

    const bearer = getCharacter(after, RESOURCE_PLAYER, DORELAS);
    expect(bearer.effectiveStats.directInfluence).toBe(before.directInfluence + 1);
    // The card lives as an item on the bearer (resource permanent-event).
    expect(bearer.items.some(i => i.definitionId === PALLANDOS_APPRENTICE)).toBe(true);
  });

  // ── Rule 5: requires 2 points of influence to control ──────────────────────

  test('overrides the influence-to-control cost from the printed mind (3) to 2', () => {
    const base = pallandoOrgState();
    const dorelasId = findCharInstanceId(base, RESOURCE_PLAYER, DORELAS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, PALLANDOS_APPRENTICE);

    // Dorelas is held under general influence; the GI he consumes equals his
    // influence-to-control cost. Printed mind 3 → control cost 2, so GI used
    // drops by exactly 1 once the apprentice is attached (the avatar consumes
    // none of its own).
    const before = base.players[0].generalInfluenceUsed;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, dorelasId);
    expect(after.players[0].generalInfluenceUsed).toBe(before - 1);
  });

  // ── Rule 6: only general influence or Pallando may control ─────────────────

  test('may be moved under the Fallen-wizard avatar, but not under a normal character', () => {
    const withCard = pallandoOrgState({ characters: [PALLANDO, THE_MOUTH, DORELAS] });
    const dorelasId = findCharInstanceId(withCard, RESOURCE_PLAYER, DORELAS);
    const pallandoId = findCharInstanceId(withCard, RESOURCE_PLAYER, PALLANDO);
    const mouthId = findCharInstanceId(withCard, RESOURCE_PLAYER, THE_MOUTH);
    const cardId = findHandCardId(withCard, RESOURCE_PLAYER, PALLANDOS_APPRENTICE);

    const attached = playPermanentEventAndResolve(withCard, PLAYER_1, cardId, dorelasId);
    const controllers = viableActions(attached, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === dorelasId)
      .map(a => a.controlledBy);

    // Pallando (FW avatar, DI 7 ≥ cost 2) may control; The Mouth (normal char,
    // DI 4 ≥ cost 2) may not — the control-source restriction excludes it.
    expect(controllers).toContain(pallandoId);
    expect(controllers).not.toContain(mouthId);
  });

  test('without the card, the same normal character IS a valid controller (isolates the restriction)', () => {
    // Identical company but no card played: The Mouth (DI 4) can hold Dorelas
    // (mind 3) — proving its exclusion above is the control-source rule, not DI.
    const base = pallandoOrgState({ characters: [PALLANDO, THE_MOUTH, DORELAS], hand: [] });
    const dorelasId = findCharInstanceId(base, RESOURCE_PLAYER, DORELAS);
    const mouthId = findCharInstanceId(base, RESOURCE_PLAYER, THE_MOUTH);

    const controllers = viableActions(base, PLAYER_1, 'move-to-influence')
      .map(ea => ea.action as { characterInstanceId?: unknown; controlledBy?: unknown })
      .filter(a => a.characterInstanceId === dorelasId)
      .map(a => a.controlledBy);

    expect(controllers).toContain(mouthId);
  });

  // ── Rule 7: may tap to use a Palantír he bears ─────────────────────────────

  test('the apprentice enables the bearer to use a Palantír he bears', () => {
    const state = pallandoOrgState({
      characters: [PALLANDO, { defId: DORELAS, items: [PALANTIR_OF_MINAS_TIRITH, PALLANDOS_APPRENTICE] }],
      hand: [],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea =>
      (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(palantirActions.length).toBe(1);
  });

  test('without the apprentice, the same sage cannot use the Palantír (isolates rule 7)', () => {
    const state = pallandoOrgState({
      characters: [PALLANDO, { defId: DORELAS, items: [PALANTIR_OF_MINAS_TIRITH] }],
      hand: [],
    });
    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantirActions = actions.filter(ea =>
      (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(palantirActions.length).toBe(0);
  });

  // ── Rule 8: contributes 2 stage points while attached ──────────────────────

  test('the attached stage points are counted toward the controller stage-point total', () => {
    const base = pallandoOrgState();
    const dorelasId = findCharInstanceId(base, RESOURCE_PLAYER, DORELAS);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, PALLANDOS_APPRENTICE);

    expect(base.players[0].stagePoints).toBe(0);
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, dorelasId);
    expect(after.players[0].stagePoints).toBe(2);
  });
});
