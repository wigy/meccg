/**
 * @module ba-45.test
 *
 * Card test: Evil Things Lingering (ba-45)
 * Type: minion-resource-ally (alignment ringwraith; Balrog-specific)
 * Stats: prowess 9, body 9, 2 MP (ally). Unique. Spawn.
 *
 * Card text:
 *   "Unique. Balrog specific. Spawn. Playable at The Under-galleries, The
 *    Under-courts, or Remains of Thangorodrim. Its controlling character's
 *    company is overt. Discard this ally if its company moves using region or
 *    starter movement. If this ally's controlling character is not The Balrog,
 *    your opponent makes a roll during your organization phase and subtracts
 *    four. The controlling character is eliminated if the result is greater
 *    than his mind."
 *
 * Effects:
 *   1. company-overt — controlling character's company is overt
 *   2. on-event: bearer-company-moves (when movementType ∈ {region, starter})
 *      → self-discard
 *   3. on-event: organization-phase-start (when bearer.name ≠ "The Balrog")
 *      → enqueue-opponent-elimination-roll (modifier -4)
 *   + playableAt: [The Under-galleries, The Under-courts, Remains of Thangorodrim]
 *   + unique: true
 *
 * | # | Rule                                                       | Status | Notes                                                    |
 * |---|------------------------------------------------------------|--------|----------------------------------------------------------|
 * | 1 | Unique                                                     | OK     | unique:true → site.ts unique-in-play gate                |
 * | 2 | Playable at the three named Under-deeps sites only         | OK     | playableAt site-name match in site.ts                    |
 * | 3 | Spawn / Balrog specific                                    | OK     | creature-type/deck tags — no play-time engine effect     |
 * | 4 | Its controlling character's company is overt               | OK     | company-overt via reducer-utils isCovertCompany          |
 * | 5 | Discard if company moves via region/starter movement       | OK     | bearer-company-moves self-discard gated on movementType  |
 * | 6 | NOT discarded on Under-deeps (or special) movement         | OK     | movementType gate excludes non-region/starter moves      |
 * | 7 | non-Balrog controller → opponent org-phase roll -4;        | OK     | organization-phase-start enqueue-opponent-elimination-   |
 * |   | controller eliminated if result > his mind                |        | roll → generic dice-check, onPass eliminate-character    |
 * | 8 | controller IS The Balrog → no roll                         | OK     | `when: bearer.name ≠ "The Balrog"` gate                  |
 *
 * Playable: YES
 *
 * Note on "Balrog specific" / "Spawn": these are deck-construction / creature-type
 * tags. Balrog-specificity is a deck-validation rule (not enforced at play time),
 * and no implemented card keys off the Spawn ally identity, so neither carries a
 * play-time engine effect beyond the card's own uniqueness (rule 1).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  resetMint, buildTestState, buildMinionSitePhaseState,
  attachAllyToChar, getCharacter, findCharInstanceId,
  makeMHState, runActions, reduce,
  Alignment, Phase,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { CardDefinitionId, PlayHeroResourceAction, GameState } from '../../index.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';
import { endCompanyMH } from '../../engine/mh-hazard-play.js';

const EVIL_THINGS = 'ba-45' as CardDefinitionId;

// The three sites the ally may be played at.
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;
const UNDER_COURTS = 'ba-98' as CardDefinitionId;
const REMAINS_THANGORODRIM = 'ba-95' as CardDefinitionId;
// A different Under-deeps site NOT in the ally's list.
const SULFUR_DEEPS = 'ba-97' as CardDefinitionId;

// Characters
const THE_BALROG = 'ba-3' as CardDefinitionId; // avatar, name "The Balrog", mind null
const ASTERNAK = 'le-1' as CardDefinitionId;    // man, mind 5 (a non-Balrog controller)

describe('Evil Things Lingering (ba-45)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 2: playable only at the three named sites ───────────────────────

  test.each([UNDER_GALLERIES, UNDER_COURTS, REMAINS_THANGORODRIM])(
    'IS playable at %s',
    (site) => {
      const state = buildMinionSitePhaseState({
        characters: [ASTERNAK],
        site,
        hand: [EVIL_THINGS],
      });
      const allyInst = state.players[0].hand[0].instanceId;
      const playActions = computeLegalActions(state, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'play-hero-resource')
        .map(a => a.action as PlayHeroResourceAction)
        .filter(a => a.cardInstanceId === allyInst);
      expect(playActions.length).toBeGreaterThanOrEqual(1);
    },
  );

  test('NOT playable at an Under-deeps site not on its list (Sulfur-deeps)', () => {
    const state = buildMinionSitePhaseState({
      characters: [ASTERNAK],
      site: SULFUR_DEEPS,
      hand: [EVIL_THINGS],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 4: controlling character's company is overt ─────────────────────

  test('a Man-only company bearing the ally is OVERT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [ASTERNAK] }], hand: [], siteDeck: [SULFUR_DEEPS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: SULFUR_DEEPS, characters: [] }], hand: [], siteDeck: [UNDER_GALLERIES] },
      ],
    });
    // Control: without the ally, an all-Man company is covert.
    expect(isCovertCompany(base.players[RESOURCE_PLAYER].companies[0], base.players[RESOURCE_PLAYER], base)).toBe(true);

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, EVIL_THINGS);
    const company = withAlly.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, withAlly.players[RESOURCE_PLAYER], withAlly)).toBe(false);
  });

  // ─── Rules 5 & 6: discard on region/starter movement, not Under-deeps ──────

  /** Build an M/H state where the ally-bearing company is completing a move. */
  function buildMovingCompany(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: UNDER_GALLERIES, characters: [ASTERNAK], destinationSite: SULFUR_DEEPS }],
          hand: [], siteDeck: [], playDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_COURTS, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, EVIL_THINGS);
  }

  test.each([MovementType.Region, MovementType.Starter])(
    'the ally is discarded when its company moves using %s movement',
    (movementType) => {
      const state = buildMovingCompany();
      const allyInst = getCharacter(state, RESOURCE_PLAYER, ASTERNAK).allies[0].instanceId;

      const result = endCompanyMH(state, makeMHState({ movementType, activeCompanyIndex: 0 }));
      const after = result.state;

      // Ally gone from the character, and sits in the controlling player's discard.
      expect(getCharacter(after, RESOURCE_PLAYER, ASTERNAK).allies).toHaveLength(0);
      expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInst)).toBe(true);
    },
  );

  test('the ally is NOT discarded when its company moves using Under-deeps movement', () => {
    const state = buildMovingCompany();
    const allyInst = getCharacter(state, RESOURCE_PLAYER, ASTERNAK).allies[0].instanceId;

    const result = endCompanyMH(state, makeMHState({ movementType: MovementType.UnderDeeps, activeCompanyIndex: 0 }));
    const after = result.state;

    // Still attached; not in the discard pile.
    const allies = getCharacter(after, RESOURCE_PLAYER, ASTERNAK).allies;
    expect(allies.some(a => a.instanceId === allyInst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInst)).toBe(false);
  });

  // ─── Rules 7 & 8: opponent elimination roll during the org phase ──────────

  /**
   * Build an Untap-phase state for the active (Balrog) player whose company
   * bears the ally on the given controller, then advance into the Organization
   * phase (which is when the elimination roll, if any, is enqueued).
   */
  function advanceToOrgWithAllyOn(controller: CardDefinitionId): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [controller] }], hand: [], siteDeck: [SULFUR_DEEPS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_COURTS, characters: [] }], hand: [], siteDeck: [UNDER_GALLERIES] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, controller, EVIL_THINGS);
    return runActions(withAlly, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
  }

  test('a non-Balrog controller triggers an opponent dice-check at org-phase start', () => {
    const afterOrg = advanceToOrgWithAllyOn(ASTERNAK);
    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);

    const rolls = afterOrg.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(1);
    // The opponent (hazard player) is the roller/actor.
    expect(rolls[0].actor).toBe(PLAYER_2);
    // Threshold is the controller's mind (Asternak = 5); modifier is -4.
    expect(rolls[0].kind.type === 'dice-check' && rolls[0].kind.threshold).toBe(5);
    expect(rolls[0].kind.type === 'dice-check' && rolls[0].kind.comparison).toBe('gt');
  });

  test('the controller is eliminated when the modified roll beats his mind', () => {
    const afterOrg = advanceToOrgWithAllyOn(ASTERNAK);
    const asternakId = findCharInstanceId(afterOrg, RESOURCE_PLAYER, ASTERNAK);
    const allyInst = getCharacter(afterOrg, RESOURCE_PLAYER, ASTERNAK).allies[0].instanceId;

    // Roll 10 → 10 - 4 = 6 > mind 5 → eliminated.
    const resolved = reduce(
      { ...afterOrg, cheatRollTotal: 10 },
      { type: 'resolve-dice-check', player: PLAYER_2, explanation: '' },
    );
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    // Controller removed from play and sent to the OUT-OF-PLAY pile (eliminated,
    // not merely discarded); its ally is discarded.
    expect(after.players[RESOURCE_PLAYER].characters[asternakId]).toBeUndefined();
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === asternakId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInst)).toBe(true);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('the controller survives when the modified roll does not beat his mind', () => {
    const afterOrg = advanceToOrgWithAllyOn(ASTERNAK);
    const asternakId = findCharInstanceId(afterOrg, RESOURCE_PLAYER, ASTERNAK);

    // Roll 9 → 9 - 4 = 5, not > mind 5 → survives.
    const resolved = reduce(
      { ...afterOrg, cheatRollTotal: 9 },
      { type: 'resolve-dice-check', player: PLAYER_2, explanation: '' },
    );
    expect(resolved.error).toBeUndefined();
    const after = resolved.state;

    expect(after.players[RESOURCE_PLAYER].characters[asternakId]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].characters[asternakId].status).not.toBe(undefined);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile).toHaveLength(0);
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('no roll is triggered when the controlling character IS The Balrog', () => {
    const afterOrg = advanceToOrgWithAllyOn(THE_BALROG);
    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(afterOrg.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
  });
});
