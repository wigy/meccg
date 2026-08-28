/**
 * @module actions-universal
 *
 * Action types available across multiple game phases.
 *
 * These include corruption checks, card draw/discard, passing priority,
 * calling the Free Council, deck exhaustion handling, sideboard access
 * (both resource and hazard), chain-of-effects interactions, the game-end
 * acknowledgement, and the not-playable placeholder.
 */

import type { PlayerId, CardInstanceId, CardDefinitionId, CompanyId } from './common.js';

/**
 * Tap a character to support another character's corruption check.
 *
 * Per CoE rule 7.1.1, a resource player may tap one or more other
 * characters in the same company as a character whose corruption check
 * has been declared but not yet resolved. Each tapped character adds
 * +1 to the corruption check roll.
 */
export interface SupportCorruptionCheckAction {
  readonly type: 'support-corruption-check';
  /** The player whose character is providing support. */
  readonly player: PlayerId;
  /** The untapped character being tapped for +1 support. */
  readonly supportingCharacterId: CardInstanceId;
  /**
   * The character whose check is being supported. Required in the pending
   * corruption-check window (a card like Ren the Unclean tw-83 may queue
   * several supportable checks at once); omitted in the Free Council flow,
   * where the phase state's `pendingCheck` names the target.
   */
  readonly targetCharacterId?: CardInstanceId;
}

/**
 * Trigger a corruption check on one of your own characters.
 *
 * The character rolls 2d6. If the roll is greater than their total
 * corruption points (from items + corruption hazards + modifiers), they
 * pass. Otherwise, they fail and are removed from the game -- the
 * opponent does NOT receive marshalling points for this loss.
 * Corruption checks can be called by either player during Movement/Hazard,
 * Site, and Free Council phases.
 */
export interface CorruptionCheckAction {
  readonly type: 'corruption-check';
  /** The player whose character is making the check. */
  readonly player: PlayerId;
  /** The character instance making the corruption check. */
  readonly characterId: CardInstanceId;
  /** The character's total corruption points at the time the check was generated. */
  readonly corruptionPoints: number;
  /**
   * Total modifier applied to the 2d6 roll. Includes the character's own
   * corruption check modifier from the card definition, plus any situational
   * bonuses (e.g. +2 for Ringwraith/Balrog in company).
   */
  readonly corruptionModifier: number;
  /**
   * Card instance IDs of possessions (items, allies, corruption cards) that
   * will be discarded if the corruption check fails. Pre-computed at action
   * generation time so the client can display what's at stake.
   */
  readonly possessions: readonly CardInstanceId[];
  /** The unmodified 2d6 value needed for success (roll > CP, adjusted for modifier). */
  readonly need: number;
  /** Human-readable breakdown of the target number and modifiers. */
  readonly explanation: string;
}

/**
 * Draw cards from the play deck into hand.
 *
 * Used primarily during the End-of-Turn phase to refill to hand size.
 * If the deck is empty, the discard pile is reshuffled to form a new deck
 * (incrementing deckExhaustionCount).
 */
export interface DrawCardsAction {
  readonly type: 'draw-cards';
  /** The player drawing cards. */
  readonly player: PlayerId;
  /** Number of cards to draw. */
  readonly count: number;
}

/**
 * Discard a card from hand to the discard pile.
 *
 * Used during End-of-Turn to trim down to hand size, or at other
 * times when the rules require discarding.
 */
export interface DiscardCardAction {
  readonly type: 'discard-card';
  /** The player discarding. */
  readonly player: PlayerId;
  /** The card instance to discard from hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Pass priority, indicating the player has no more actions this phase.
 *
 * Available in every phase. In some phases (like Untap and Long-event),
 * passing is the only available action and simply advances to the next phase.
 * In other phases, it signals the player is done with their optional actions.
 */
export interface PassAction {
  readonly type: 'pass';
  /** The player passing. */
  readonly player: PlayerId;
}

/**
 * Call the Free Council, triggering the endgame.
 *
 * Available during End-of-Turn phase. Once called, the game proceeds to
 * the Free Council phase after the current turn completes. Both players
 * then face final corruption checks and marshalling points are tallied.
 * The Free Council is also automatically triggered when a player exhausts
 * their deck for the second time.
 */
export interface CallFreeCouncilAction {
  readonly type: 'call-free-council';
  /** The player calling the Free Council. */
  readonly player: PlayerId;
}

/**
 * Acknowledge deck exhaustion: return sites to location deck, shuffle the
 * discard pile into a new play deck, and increment the exhaustion counter.
 *
 * This is triggered as an explicit action when a player's play deck runs
 * empty after drawing. In the future, sideboard exchange will be added as
 * additional interactive steps before the reshuffle.
 */
export interface DeckExhaustAction {
  readonly type: 'deck-exhaust';
  /** The player whose deck is exhausted. */
  readonly player: PlayerId;
}

/**
 * Exchange one card between discard pile and sideboard during deck exhaustion.
 *
 * Per CoE rule section 10, when a player's deck is exhausted they may exchange
 * up to 5 cards between their discard pile and sideboard (any card type)
 * before the discard is reshuffled into a new play deck.
 */
export interface ExchangeSideboardAction {
  readonly type: 'exchange-sideboard';
  /** The player exchanging cards. */
  readonly player: PlayerId;
  /** The card moving from the discard pile to the sideboard. */
  readonly discardCardInstanceId: CardInstanceId;
  /** The card moving from the sideboard to the discard pile. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

/**
 * Trade a card the opponent's Balrog alignment has made unplayable for one
 * card of any type from the sideboard (CoE 1.8.2 / rule 1.36).
 *
 * Available at any strategy-time step while the opponent is a Balrog player
 * and the hand holds one of the cards banned against them. The banned card
 * leaves the game (CRF 22: "he may remove it from the game") and the chosen
 * sideboard card is shuffled into the play deck.
 */
export interface SwapBannedVsBalrogAction {
  readonly type: 'swap-banned-vs-balrog';
  /** The player making the trade. */
  readonly player: PlayerId;
  /** The banned card in the player's hand, removed from the game. */
  readonly cardInstanceId: CardInstanceId;
  /** The sideboard card brought into the play deck. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch 1 card from sideboard to the play deck.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects exactly 1 resource/character from the sideboard to shuffle
 * into the play deck. Requires at least 5 cards in the play deck.
 *
 * This action taps the avatar and enters the sideboard-to-deck sub-flow.
 * The player must then select a card via {@link FetchFromSideboardAction}.
 */
export interface StartSideboardToDeckAction {
  readonly type: 'start-sideboard-to-deck';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Declare intent to fetch up to 5 cards from sideboard to the discard pile.
 *
 * Per CoE rule 2.II.6, the resource player taps their avatar and then
 * selects 1-5 resources/characters from the sideboard to place in the
 * discard pile.
 *
 * This action taps the avatar and enters the sideboard-to-discard sub-flow.
 * The player then selects cards one at a time via {@link FetchFromSideboardAction},
 * and may pass after at least 1 card has been fetched.
 */
export interface StartSideboardToDiscardAction {
  readonly type: 'start-sideboard-to-discard';
  /** The player starting sideboard access. */
  readonly player: PlayerId;
  /** The avatar character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Fetch a specific card from the sideboard during the sideboard access sub-flow.
 *
 * Can only be used after a {@link StartSideboardToDeckAction} or
 * {@link StartSideboardToDiscardAction} has been executed. The destination
 * (deck or discard) is determined by which start action was used.
 */
export interface FetchFromSideboardAction {
  readonly type: 'fetch-from-sideboard';
  /** The player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

/**
 * Bring a specific card from the sideboard into the play deck during the
 * organization phase, driven by an ability on the card itself.
 *
 * Distinct from the CoE 2.II.6 avatar-tap sideboard access
 * ({@link StartSideboardToDeckAction} / {@link FetchFromSideboardAction}):
 * this is a *card-granted* self-relocation carried by a `move`
 * (`select: 'self'`, `from: ['sideboard']`, `to: 'deck'`) effect. It taps
 * nothing, has no deck-size requirement, and is limited to the one card that
 * declares it. Used by Terror Heralds Doom (ba-78) and the rest of the Balrog
 * sideboard family: "You may bring this card from your sideboard into your
 * play deck and reshuffle during your organization phase."
 */
export interface CardSideboardToDeckAction {
  readonly type: 'card-sideboard-to-deck';
  /** The player relocating their sideboard card. */
  readonly player: PlayerId;
  /** The sideboard card moving itself into the play deck. */
  readonly cardInstanceId: CardInstanceId;
}

// ---- Untap hazard sideboard access ----

/**
 * Declare intent to fetch 1 hazard from sideboard to the play deck during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. Fetching 1 hazard to deck requires
 * at least 5 cards in the play deck. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDeckAction {
  readonly type: 'start-hazard-sideboard-to-deck';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Declare intent to fetch up to 5 hazards from sideboard to the discard pile during untap.
 *
 * Per CoE rule 2.I, the hazard player may access their sideboard if the
 * resource player's avatar is in play. This halves the hazard limit for
 * the upcoming M/H phase.
 */
export interface StartHazardSideboardToDiscardAction {
  readonly type: 'start-hazard-sideboard-to-discard';
  /** The hazard (non-active) player accessing their sideboard. */
  readonly player: PlayerId;
}

/**
 * Fetch a specific hazard from the sideboard during the untap hazard sideboard sub-flow.
 *
 * Can only be used after a {@link StartHazardSideboardToDeckAction} or
 * {@link StartHazardSideboardToDiscardAction} has been executed.
 */
export interface FetchHazardFromSideboardAction {
  readonly type: 'fetch-hazard-from-sideboard';
  /** The hazard player fetching from their sideboard. */
  readonly player: PlayerId;
  /** The sideboard card being fetched. */
  readonly sideboardCardInstanceId: CardInstanceId;
}

// ---- Non-viable placeholder ----

/**
 * Placeholder action attached to hand cards that have no legal play
 * during the current phase. Never submitted — exists only as a
 * non-viable {@link EvaluatedAction} so the client can show a tooltip
 * explaining why the card cannot be used right now.
 */
export interface NotPlayableAction {
  readonly type: 'not-playable';
  /** The player holding the card. */
  readonly player: PlayerId;
  /** The card instance in hand that cannot be played. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Concede the game, immediately handing the win to the opponent.
 *
 * Legal for either player in any phase or sub-state (setup, mid-chain,
 * mid-combat, mid-pending-resolution) — the one action that always stays
 * available regardless of what else is mid-resolution, so a player is never
 * stuck unable to end a match they no longer want to play. Ends the game via
 * the same `endGame()` path every other ending uses, with `WinReason.kind`
 * set to `'concession'`.
 */
export interface ConcedeAction {
  readonly type: 'concede';
  /** The player conceding. */
  readonly player: PlayerId;
}

// ---- Chain of Effects actions ----

/**
 * Pass priority in the current chain of effects.
 *
 * When a player has priority during the declaring phase of a chain,
 * they may pass instead of declaring an action. When both players pass
 * consecutively, the chain transitions to resolving mode.
 */
export interface PassChainPriorityAction {
  readonly type: 'pass-chain-priority';
  /** The player passing priority. */
  readonly player: PlayerId;
}

/**
 * Choose the order of multiple simultaneously-triggered passive conditions.
 *
 * When multiple passive conditions trigger at the same time during chain
 * resolution, the resource player chooses the order in which they are
 * declared in the follow-up chain.
 */
export interface OrderPassivesAction {
  readonly type: 'order-passives';
  /** The player ordering the passives (always the resource player). */
  readonly player: PlayerId;
  /** The ordered list of source card instance IDs, in the desired declaration order. */
  readonly order: readonly CardInstanceId[];
}

/**
 * Acknowledge the game result and record it to player history.
 * Sent by each player after reviewing the final scoring table.
 */
export interface FinishedAction {
  readonly type: 'finished';
  /** The player acknowledging the result. */
  readonly player: PlayerId;
}

/**
 * Return a company to the haven where it began the turn (Great-road effect).
 *
 * Offered during the end-of-turn phase when a `haven-return-option` constraint
 * is active for the company. The company's `currentSite` is replaced with the
 * recorded origin haven; no M/H phase is triggered.
 */
export interface HavenReturnAction {
  readonly type: 'haven-return';
  /** The resource player exercising the option. */
  readonly player: PlayerId;
  /** The company returning to its origin haven. */
  readonly companyId: CompanyId;
}

/**
 * "Run home" — discard a `run-home-to-haven` ally (Bill the Pony tw-198) and
 * move its company to the site's nearest Haven.
 *
 * Offered during the end-of-turn phase when the ally's company is at a
 * non-Haven, non-Under-deeps site whose character count is within the ally's
 * `maxCompanySize`. The company's `currentSite` is replaced with the nearest
 * haven and the ally is discarded; no M/H phase is triggered.
 */
export interface RunHomeAction {
  readonly type: 'run-home';
  /** The resource player exercising the option. */
  readonly player: PlayerId;
  /** The company running home to its nearest haven. */
  readonly companyId: CompanyId;
  /** The ally being discarded to power the move (e.g. Bill the Pony). */
  readonly allyInstanceId: CardInstanceId;
}

/**
 * Tap a character as the mandatory cost of a hazard effect at the start of
 * the site phase (e.g. Stench of Mordor). The resource player selects one
 * untapped character in the active company to tap. Resolves the
 * `tap-one-character` pending resolution.
 */
export interface TapCharacterByEffectAction {
  readonly type: 'tap-character-by-effect';
  /** The resource player performing the tap. */
  readonly player: PlayerId;
  /** The instance ID of the character being tapped. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Untap or heal one character as the optional benefit of a Haven effect
 * immediately following a company's movement/hazard phase (Hall of Fire,
 * dm-134). The improvement is determined by the character's current status:
 * a tapped character untaps, a wounded (inverted) character heals to tapped.
 * Resolves the `haven-restore-character` pending resolution.
 */
export interface RestoreCharacterByEffectAction {
  readonly type: 'restore-character-by-effect';
  /** The player performing the restore (the company's controller). */
  readonly player: PlayerId;
  /** The instance ID of the character being untapped or healed. */
  readonly characterInstanceId: CardInstanceId;
}

/**
 * Left Behind (td-41): rejoin a separate "left behind" company back into the
 * original company it was peeled off from, following all movement/hazard phases.
 * Resolves a `left-behind-rejoin` pending resolution (the player may instead
 * `pass` to keep the company separate).
 */
export interface LeftBehindRejoinAction {
  readonly type: 'left-behind-rejoin';
  /** The player performing the rejoin (the companies' controller). */
  readonly player: PlayerId;
  /** The left-behind company being folded back into its original company. */
  readonly companyId: CompanyId;
}

/**
 * Enduring Tales (dm-125): move a card just discarded from hand to the top
 * of the discarding player's play deck (face down) instead of leaving it in
 * their discard pile. Resolves a `hand-discard-recycle-offer` pending
 * resolution (the player may instead `pass` to leave it discarded).
 */
export interface RecycleHandDiscardAction {
  readonly type: 'recycle-hand-discard';
  /** The player who discarded the card and is choosing its destination. */
  readonly player: PlayerId;
  /** The discarded card instance, currently in the player's discard pile. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Choose the next card (top-first) when ordering the set-aside cards a
 * `cycle-hand` effect placed on top of the play deck (Revealed to all Watchers,
 * dm-85). Resolves one step of an `arrange-deck-top` pending resolution: the
 * chosen card becomes the next-highest card of the arranged block.
 */
export interface ArrangeDeckTopCardAction {
  readonly type: 'arrange-deck-top-card';
  /** The player arranging their own deck top. */
  readonly player: PlayerId;
  /** The instance ID of the card to place next (top-first). */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Choose one of the cards revealed from the top of the play deck to put into
 * hand (Eyes of Mandos, dm-126). Resolves a `reveal-choose-to-hand` pending
 * resolution: the chosen card moves to the player's hand and the remaining
 * play deck is shuffled.
 */
export interface ChooseRevealedCardAction {
  readonly type: 'choose-revealed-card';
  /** The player choosing among their revealed top-of-deck cards. */
  readonly player: PlayerId;
  /** The instance ID of the revealed card to take into hand. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Choose one of the revealed eligible items to place off to the side under
 * the host card (Great Secrets Buried There, dm-63). Resolves a
 * `great-secrets-choose-item` pending resolution: the chosen item is set
 * aside under the host and the remaining revealed cards are shuffled back
 * into the deck. The choice is mandatory (no pass).
 */
export interface ChooseSetAsideItemAction {
  readonly type: 'choose-set-aside-item';
  /** The deck owner choosing which eligible revealed item to set aside. */
  readonly player: PlayerId;
  /** The instance ID of the chosen item. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Choose one of the opponent's revealed discard-pile cards to remove from the
 * game (Aware of their Ways, dm-46). Resolves a `reveal-remove-from-discard`
 * pending resolution: the chosen non-unique card moves from the opponent's
 * discard pile to their out-of-play pile. Declining is a `pass`.
 */
export interface RemoveRevealedCardAction {
  readonly type: 'remove-revealed-card';
  /** The card-player choosing which revealed discard card to remove. */
  readonly player: PlayerId;
  /** The instance ID of the revealed card to remove from play. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * Choose one of the cards revealed from the top of the opponent's play deck and
 * show it to the opponent (Desire All for Thy Belly, ba-16). Resolves a
 * `desire-belly-choose-card` pending resolution; the choice is mandatory.
 */
export interface DesireChooseShownCardAction {
  readonly type: 'desire-choose-shown-card';
  /** The card-player choosing which revealed deck card to show. */
  readonly player: PlayerId;
  /** The instance ID of the revealed card to show to the opponent. */
  readonly cardInstanceId: CardInstanceId;
}

/**
 * The opponent's forced choice after a card was shown by Desire All for Thy
 * Belly (ba-16): either remove the shown card from the game, or permanently
 * reduce his hand size by one. Resolves a `desire-belly-choose-penalty` pending
 * resolution; the choice is mandatory ("He must choose to either…").
 */
export interface DesireChoosePenaltyAction {
  readonly type: 'desire-choose-penalty';
  /** The opponent making the forced choice. */
  readonly player: PlayerId;
  /** Which penalty the opponent accepts. */
  readonly penalty: 'remove-from-game' | 'reduce-hand-size';
}

/**
 * Choose one of the eligible revealed cards from the top of the card-player's
 * own play deck to immediately attack the target company (Long Dark Reach,
 * dm-70). Resolves a `reveal-deck-choose-attacker` pending resolution; the
 * choice is mandatory ("must immediately attack").
 */
export interface ChooseLongDarkReachAttackerAction {
  readonly type: 'choose-long-dark-reach-attacker';
  /** The card-player choosing which revealed creature attacks. */
  readonly player: PlayerId;
  /** The instance ID of the chosen creature. */
  readonly cardInstanceId: CardInstanceId;
  /** Definition ID of the chosen creature (mirrors `ChooseHuntTargetAction`, keeping the choice legible under redaction). */
  readonly definitionId: CardDefinitionId;
}

/**
 * The defending player's forced choice in response to A Lie in Your Eyes
 * (as-23): tap the targeted character, tap one of its untapped allies, or let
 * the card-player roll for a chance to discard the character. Resolves a
 * `tap-or-roll-choice` pending resolution; the choice is mandatory ("Your
 * opponent may either...").
 */
export interface ChooseTapOrRollAction {
  readonly type: 'choose-tap-or-roll';
  /** The defending player making the forced choice. */
  readonly player: PlayerId;
  /** Which response the defender picks. */
  readonly choice: 'tap-character' | 'tap-ally' | 'roll';
  /** Required when `choice` is `'tap-ally'` — the ally instance to tap. */
  readonly allyInstanceId?: CardInstanceId;
}

/**
 * Choose which play deck to look at and shuffle the top of (Mirror of
 * Galadriel, tw-282: "choose to look at the top five cards of any one play
 * deck"). Resolves a `choose-peek-deck` pending resolution; declining the
 * optional look is a `pass`.
 */
export interface ChoosePeekDeckAction {
  readonly type: 'choose-peek-deck';
  /** The player who played the peek effect. */
  readonly player: PlayerId;
  /** Whose play deck to look at and shuffle the top of. */
  readonly deckOwner: 'self' | 'opponent';
}

/**
 * Choose which of the opponent's piles is revealed by The Great Hunt (wh-91).
 * Resolves a `great-hunt-source` pending resolution and kicks off the
 * reveal-and-attack sequence against the controller's Alatar company.
 */
export interface ChooseGreatHuntSourceAction {
  readonly type: 'choose-great-hunt-source';
  /** The Great Hunt controller. */
  readonly player: PlayerId;
  /** Which of the opponent's piles to reveal. */
  readonly source: 'deck' | 'discard';
}

/**
 * Have a hazard-creature the opponent just discarded attack the controller's
 * Alatar company (The Great Hunt wh-91 ongoing trigger). Resolves a
 * `great-hunt-discard-attack` pending resolution; a `pass` declines it.
 */
export interface GreatHuntAttackWithCreatureAction {
  readonly type: 'great-hunt-attack-with-creature';
  /** The Great Hunt controller. */
  readonly player: PlayerId;
  /** The discarded creature instance to attack with. */
  readonly creatureInstanceId: CardInstanceId;
}

/**
 * Name the hazard-creature instance The Hunt (dm-143) forces to attack its
 * bearer. Resolves a `hunt-target-choice` pending resolution; a `pass`
 * declines when no candidate creature exists.
 */
export interface ChooseHuntTargetAction {
  readonly type: 'choose-hunt-target';
  /** The Hunt's controller (the bearer's owner). */
  readonly player: PlayerId;
  /** The named creature instance, found in the opponent's deck or discard. */
  readonly creatureInstanceId: CardInstanceId;
  /**
   * The named creature's definition, carried on the action itself so the
   * choice can be labeled without resolving `creatureInstanceId` through the
   * acting player's (redacted) view of the opponent's deck/discard pile — per
   * CRF 22 the candidate only needs to have been revealed at some point (see
   * `GameState.revealedInstances`, broader than what the pile projection
   * currently exposes), so the instance itself may show as unknown there.
   */
  readonly definitionId: CardDefinitionId;
}

/**
 * Pay (or refuse to pay) one card of the upkeep cost on an in-play event that
 * carries an `event-maintenance` effect — Thrice Outnumbered (le-142) at the
 * end of the opponent's long-event phase, Balance Between Powers (dm-118) at
 * the start of its controller's organization phase.
 *
 * Resolves one step of the `event-maintenance` pending resolution: the actor
 * either discards a qualifying hand card (repeated until the stage's cost is
 * met), discards the source event outright, or declines to bid further.
 */
export interface PayEventMaintenanceAction {
  readonly type: 'pay-event-maintenance';
  /** The player paying (or declining) this stage of the maintenance cost. */
  readonly player: PlayerId;
  /**
   * How to pay:
   * - `'discard-self'` — discard the source event from cardsInPlay (the
   *   controller's `upkeep` stage only).
   * - `'discard-from-hand'` — discard one qualifying card from hand.
   * - `'decline'` — bid nothing: at `challenge` the source survives, at
   *   `counter` it is discarded.
   */
  readonly paymentType: 'discard-self' | 'discard-from-hand' | 'decline';
  /**
   * The card instance to discard.
   * For `discard-self`: the source event's instance ID.
   * For `discard-from-hand`: the hand card's instance ID.
   * For `decline`: the source event's instance ID (nothing is discarded).
   */
  readonly cardInstanceId: CardInstanceId;
  /** The pending resolution's source (the in-play event instance ID). */
  readonly sourceInstanceId: CardInstanceId;
}
