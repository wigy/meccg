/**
 * @module le-252.test
 *
 * Card test: We Have Come to Kill (le-252)
 * Type: minion-resource-event (short, ringwraith alignment), non-unique, 0 MP.
 *
 * Card text:
 *   "A character may be brought into play under general or direct influence
 *    (if you have enough unused) at any Shadow-hold [{S}], Ruins & Lairs [{R}],
 *    or Border-hold [{B}]. This does not count against the one character per
 *    turn limit. May be played on your turn during any phase the company is at
 *    a site. May be used to bring in Ringwraith followers or agents, but not
 *    Ringwraiths or Fallen-wizards."
 *
 * Modelled with a single `recruit-character` effect — the A Chance Meeting
 * (tw-188) primitive, extended for this card:
 *   - `controlledBy: "either"` — the recruit may be paid for with the player's
 *     unused general influence OR with a company member's unused direct
 *     influence. The general-influence branch overrides rule 2.II.2.2's
 *     "only at the avatar's site" restriction, just as the site list overrides
 *     the normal haven / home-site restriction.
 *   - `siteTypes: [shadow-hold, ruins-and-lairs, border-hold]`.
 *   - `filter: $not race $in [ringwraith, fallen-wizard]` — "but not
 *     Ringwraiths or Fallen-wizards" (both are avatar races).
 *   - `allowAgents: true` — "or agents", overriding rule 2.II.2.2.5 which
 *     otherwise confines an agent played as a character to its home site.
 *   - `allowRingwraithFollowers: true` — the event is "a card or ability that
 *     allows a Ringwraith follower to be played" (rule 2.II.2.1.R4). Per rule
 *     2.II.2.1.R5 the follower costs one point of the revealed Ringwraith's
 *     direct influence, unless a no-influence ability covers it (a free
 *     `ringwraith-follower-slots` slot, or `ringwraith-self-follower`).
 *   - `bypassOneCharacterLimit: true`.
 *
 * The legal-action helper `recruitViaEventActions` is wired into the
 * organization, movement/hazard and site phase aggregators ("any phase the
 * company is at a site") and only runs for the active player ("on your turn").
 * `handlePlayCharacter` discards the event and skips the one-character-per-turn
 * bookkeeping.
 *
 * | # | Rule                                                            | Status |
 * |---|-----------------------------------------------------------------|--------|
 * | 1 | A character may be brought in under direct influence             | OK     |
 * | 2 | …or under general influence                                      | OK     |
 * | 3 | …only if you have enough unused influence                        | OK     |
 * | 4 | …at any Shadow-hold, Ruins & Lairs or Border-hold (only those)   | OK     |
 * | 5 | Does not count against the one-character-per-turn limit          | OK     |
 * | 6 | Playable on your turn during any phase the company is at a site  | OK     |
 * | 7 | May bring in agents (not confined to the agent's home site)      | OK     |
 * | 8 | May bring in Ringwraith followers (1 DI, or free via a slot)     | OK     |
 * | 9 | May NOT bring in Ringwraiths (as your avatar) or Fallen-wizards  | OK     |
 *
 * Playable: YES
 * Certified: 2026-07-26
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  LEGOLAS, LORIEN, MINAS_TIRITH,
  resetMint, buildTestState, makeMHState, dispatch,
  getCharacter, findCharInstanceId, findHandCardId, viablePlayCharacterActions,
  Phase,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, GameState, SitePhaseState } from '../../index.js';

const WE_HAVE_COME_TO_KILL = 'le-252' as CardDefinitionId;

// Minion sites.
const MOUNT_GRAM = 'le-394' as CardDefinitionId;   // shadow-hold [{S}], Angmar
const BANDIT_LAIR = 'le-351' as CardDefinitionId;  // ruins-and-lairs [{R}], Brown Lands
const CAMETH_BRIN = 'le-358' as CardDefinitionId;  // border-hold [{B}], Rhudaur (no allow-agent-play)
const BARAD_DUR = 'le-352' as CardDefinitionId;    // dark-hold [{D}] — not on the card's list
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // Darkhaven — not on the card's list

// Minion characters.
const THE_MOUTH = 'le-24' as CardDefinitionId;      // Man, mind 9, DI 4 — the DI controller
const LUITPRAND = 'le-23' as CardDefinitionId;      // Man, mind 1, DI 0 — the recruit
const ORC_BRAWLER = 'le-30' as CardDefinitionId;    // Orc, mind 1, DI 0 — a company with no DI
const LT_DOL_GULDUR = 'le-21' as CardDefinitionId;  // Troll, mind 9, DI 3 — too expensive for any DI
const UFTHAK = 'le-48' as CardDefinitionId;         // Orc, mind 4 — follower used to drain DI
const GRISHNAKH = 'le-12' as CardDefinitionId;      // Orc, mind 3 — follower used to drain DI
const HERION = 'dm-16' as CardDefinitionId;         // Agent, mind 3, home Lond Galen / Dol Amroth

// Ringwraith avatars.
const REN = 'le-56' as CardDefinitionId;            // DI 4, no follower-slot ability
const THE_WITCH_KING = 'le-58' as CardDefinitionId; // DI 3, ringwraith-follower-slots count 2
const HOARMURATH = 'le-53' as CardDefinitionId;     // follower candidate, home Udûn
const SARUMAN_FW = 'wh-9' as CardDefinitionId;      // Fallen-wizard avatar

describe('We Have Come to Kill (le-252)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1 & 4: direct influence at a Shadow-hold / R&L / Border-hold ─────

  test('offers a recruit under a company member’s direct influence at each of the three site types', () => {
    for (const site of [MOUNT_GRAM, BANDIT_LAIR, CAMETH_BRIN]) {
      const state = buildTestState({
        phase: Phase.Organization,
        activePlayer: PLAYER_1,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      });
      const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
      const luitprandId = findHandCardId(state, RESOURCE_PLAYER, LUITPRAND);
      const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
      const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

      const recruits = viablePlayCharacterActions(state, PLAYER_1)
        .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === luitprandId);

      // Under The Mouth's direct influence, into the company at that site.
      const underDI = recruits.find(a => a.controlledBy === mouthId);
      expect(underDI).toBeDefined();
      expect(underDI!.atSite).toBe(siteId);
    }
  });

  test('no recruit is offered at a Dark-hold or at a Darkhaven', () => {
    for (const site of [BARAD_DUR, DOL_GULDUR]) {
      const state = buildTestState({
        phase: Phase.Organization,
        activePlayer: PLAYER_1,
        recompute: true,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [MOUNT_GRAM] },
          { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        ],
      });
      const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
      expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.viaEventInstanceId === eventId)).toHaveLength(0);
    }
  });

  // ── Rule 2: general influence ─────────────────────────────────────────────

  test('offers the recruit under general influence when no company member has direct influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_BRAWLER] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const luitprandId = findHandCardId(state, RESOURCE_PLAYER, LUITPRAND);
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    // The Orc Brawler has 0 direct influence, so general influence is the only
    // way in — and it is offered even though the site is not a haven.
    const recruits = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === luitprandId);
    expect(recruits).toHaveLength(1);
    expect(recruits[0].controlledBy).toBe('general');
    expect(recruits[0].atSite).toBe(siteId);
  });

  test('both influence options are offered when both can pay', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: BANDIT_LAIR, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const luitprandId = findHandCardId(state, RESOURCE_PLAYER, LUITPRAND);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);

    const controllers = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === luitprandId)
      .map(a => a.controlledBy);
    expect(controllers).toContain('general');
    expect(controllers).toContain(mouthId);
  });

  test('the general-influence recruit enters play under general influence and spends the mind cost', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [ORC_BRAWLER] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const recruit = viablePlayCharacterActions(state, PLAYER_1).find(a => a.viaEventInstanceId === eventId)!;
    const giBefore = state.players[RESOURCE_PLAYER].generalInfluenceUsed;

    const after = dispatch(state, recruit);

    const luitprand = getCharacter(after, RESOURCE_PLAYER, LUITPRAND);
    expect(luitprand.controlledBy).toBe('general');
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(luitprand.instanceId);
    // Luitprand's mind of 1 is now committed to general influence.
    expect(after.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(giBefore + 1);
  });

  // ── Rule 3: only if you have enough unused influence ───────────────────────

  test('no recruit when neither the unused general influence nor any direct influence covers the mind', () => {
    // Three mind-9 characters commit 27 of the 20-point general-influence pool,
    // so nothing is left; the highest direct influence in the company is 4.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GRAM, characters: [THE_MOUTH, LT_DOL_GULDUR] }],
          hand: [WE_HAVE_COME_TO_KILL, LT_DOL_GULDUR],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    // 18 of 20 general influence is used; the mind-9 recruit needs 9, and
    // The Mouth's 4 / the Lieutenant's 3 direct influence are both short.
    expect(state.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(18);
    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.viaEventInstanceId === eventId)).toHaveLength(0);
  });

  // ── Rule 5: does not count against the one-character-per-turn limit ────────

  test('resolving the recruit discards the event and leaves the turn’s character slot unused', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CAMETH_BRIN, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);
    const recruit = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.viaEventInstanceId === eventId && a.controlledBy === mouthId)!;

    const after = dispatch(state, recruit);

    const luitprand = getCharacter(after, RESOURCE_PLAYER, LUITPRAND);
    expect(luitprand.controlledBy).toBe(mouthId);
    expect(getCharacter(after, RESOURCE_PLAYER, THE_MOUTH).followers).toContain(luitprand.instanceId);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === eventId)).toBe(false);
    expect((after.phaseState as { characterPlayedThisTurn?: boolean }).characterPlayedThisTurn).toBe(false);
  });

  // ── Rule 6: any phase the company is at a site, on your turn only ──────────

  test('the recruit is offered during the movement/hazard phase and resolves there', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = { ...base, phaseState: makeMHState({ step: 'play-hazards', activeCompanyIndex: 0 }) };
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);

    const recruit = viablePlayCharacterActions(state, PLAYER_1).find(a => a.viaEventInstanceId === eventId);
    expect(recruit).toBeDefined();

    const after = dispatch(state, recruit!);
    expect(getCharacter(after, RESOURCE_PLAYER, LUITPRAND)).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === eventId)).toBe(true);
  });

  test('the recruit is offered during the site phase', () => {
    const base = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: BANDIT_LAIR, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const state: GameState = { ...base, phaseState: sitePhaseState };
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);

    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.viaEventInstanceId === eventId).length).toBeGreaterThan(0);
  });

  test('the opponent is never offered the recruit on your turn', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, LUITPRAND], siteDeck: [DOL_GULDUR] },
      ],
    });
    const eventId = findHandCardId(state, HAZARD_PLAYER, WE_HAVE_COME_TO_KILL);
    expect(viablePlayCharacterActions(state, PLAYER_2).filter(a => a.viaEventInstanceId === eventId)).toHaveLength(0);
  });

  // ── Rule 7: agents ────────────────────────────────────────────────────────

  test('an agent may be brought in at a qualifying site that is not his home site', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CAMETH_BRIN, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, HERION], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const herionId = findHandCardId(state, RESOURCE_PLAYER, HERION);
    const mouthId = findCharInstanceId(state, RESOURCE_PLAYER, THE_MOUTH);

    // Cameth Brin is neither Herion's home site (Lond Galen / Dol Amroth) nor a
    // site with its own agent permission (unlike Bree le-356).
    const recruits = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === herionId);
    expect(recruits.map(a => a.controlledBy)).toContain(mouthId);
    expect(recruits.map(a => a.controlledBy)).toContain('general');
  });

  test('without the event the same agent cannot be played there at all', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CAMETH_BRIN, characters: [THE_MOUTH] }], hand: [HERION], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const herionId = findHandCardId(state, RESOURCE_PLAYER, HERION);
    expect(viablePlayCharacterActions(state, PLAYER_1).filter(a => a.characterInstanceId === herionId)).toHaveLength(0);
  });

  // ── Rule 8: Ringwraith followers ──────────────────────────────────────────

  test('a Ringwraith avatar joins the revealed Ringwraith as a follower for one direct influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // Ren (DI 4) has no follower-slot ability; Grishnákh (mind 3) leaves
        // exactly one unused point of his direct influence — rule 2.II.2.1.R5.
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GRAM, characters: [REN, { defId: GRISHNAKH, followerOf: 0 }] }],
          hand: [WE_HAVE_COME_TO_KILL, HOARMURATH],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const hoarmurathId = findHandCardId(state, RESOURCE_PLAYER, HOARMURATH);
    const renId = findCharInstanceId(state, RESOURCE_PLAYER, REN);
    const siteId = state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;

    // Mount Gram (Angmar) is neither a Darkhaven nor Hoarmûrath's home site, so
    // only the event can bring him in.
    const follower = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.viaEventInstanceId === eventId && a.characterInstanceId === hoarmurathId);
    expect(follower).toBeDefined();
    expect(follower!.controlledBy).toBe(renId);
    expect(follower!.atSite).toBe(siteId);

    const after = dispatch(state, follower!);
    expect(getCharacter(after, RESOURCE_PLAYER, HOARMURATH).controlledBy).toBe(renId);
    expect(getCharacter(after, RESOURCE_PLAYER, REN).followers).toContain(getCharacter(after, RESOURCE_PLAYER, HOARMURATH).instanceId);
  });

  test('no Ringwraith follower when the revealed Ringwraith has no unused direct influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // Ufthak (mind 4) consumes all four of Ren's direct influence.
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MOUNT_GRAM, characters: [REN, { defId: UFTHAK, followerOf: 0 }] }],
          hand: [WE_HAVE_COME_TO_KILL, HOARMURATH],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const hoarmurathId = findHandCardId(state, RESOURCE_PLAYER, HOARMURATH);
    expect(viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === hoarmurathId)).toHaveLength(0);
  });

  test('a free follower slot on the revealed Ringwraith makes the follower cost no influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // The Witch-king's three direct influence is fully spent on Ufthak
        // (mind 4 > 3), yet his two follower slots still admit Hoarmûrath.
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BANDIT_LAIR, characters: [THE_WITCH_KING, { defId: UFTHAK, followerOf: 0 }] }],
          hand: [WE_HAVE_COME_TO_KILL, HOARMURATH],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const hoarmurathId = findHandCardId(state, RESOURCE_PLAYER, HOARMURATH);
    const wkId = findCharInstanceId(state, RESOURCE_PLAYER, THE_WITCH_KING);

    const follower = viablePlayCharacterActions(state, PLAYER_1)
      .find(a => a.viaEventInstanceId === eventId && a.characterInstanceId === hoarmurathId);
    expect(follower).toBeDefined();
    expect(follower!.controlledBy).toBe(wkId);
  });

  // ── Rule 9: not Ringwraiths, not Fallen-wizards ───────────────────────────

  test('a Ringwraith cannot be brought in as an avatar when none is revealed', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        // No Ringwraith is in play, so there is nobody for a follower to follow
        // — and the event never reveals a Ringwraith avatar.
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [THE_MOUTH] }], hand: [WE_HAVE_COME_TO_KILL, HOARMURATH], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const hoarmurathId = findHandCardId(state, RESOURCE_PLAYER, HOARMURATH);
    expect(viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === hoarmurathId)).toHaveLength(0);
  });

  test('a Fallen-wizard is never offered as a recruit', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [REN] }], hand: [WE_HAVE_COME_TO_KILL, SARUMAN_FW], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const eventId = findHandCardId(state, RESOURCE_PLAYER, WE_HAVE_COME_TO_KILL);
    const sarumanId = findHandCardId(state, RESOURCE_PLAYER, SARUMAN_FW);
    expect(viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.viaEventInstanceId === eventId && a.characterInstanceId === sarumanId)).toHaveLength(0);
  });
});
