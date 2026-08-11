/**
 * @module manifestations
 *
 * Manifestation-chain state derivation for the Dragons expansion (and any
 * future multi-form entity such as Aragorn or Gollum manifestations).
 *
 * A **manifestation chain** is a set of cards that together represent
 * multiple in-game forms of one entity — for Dragons, the basic creature
 * (e.g. Smaug), the Ahunt long-event, and the At-Home permanent-event.
 * Every card in one chain carries the same {@link ManifestId} (by
 * convention the basic form's definition id).
 *
 * Chain-level state is derived from the eliminated pile, not stored
 * separately. Rationale: a second source of truth would be easy to drift
 * from pile contents; deriving keeps the no-card-disappears invariant
 * load-bearing (see `feedback_no_card_disappears`). See the expansion plan
 * §4.3 for the design discussion.
 */

import type {
  AutomaticAttack,
  CardDefinition,
  CardEffect,
  CardInstance,
  DragonAtHomeEffect,
  GameState,
  HazardEventCard,
  ManifestId,
  PlayerState,
  SiteCard,
} from '../index.js';
import type { CardInstanceId } from '../types/common.js';
import { Race } from '../types/common.js';
import { hasPlayFlag } from '../effects/play-flags.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { ownerOf } from '../types/state.js';
import { isBalrogAvatarDef } from '../state-utils.js';
import { logDetail } from './legal-actions/log.js';
import { cardName, defById, getCardEffects, matchesDefinition, toCardInstance } from './reducer-utils.js';
import { isFactionCard } from '../types/cards.js';
import { factionRaceToAttackType, normalizeCreatureRace } from './effects/index.js';
import { resolveSiteInstanceTransform } from './effective.js';

/**
 * Extracts a card definition's {@link ManifestId} if it has one.
 * Returns `undefined` for cards that are not part of any manifestation
 * chain (every non-Dragon card today, and most future cards).
 */
export function manifestIdOf(def: CardDefinition | undefined): ManifestId | undefined {
  if (!def) return undefined;
  return (def as { manifestId?: ManifestId }).manifestId;
}

/**
 * True when two card definitions are manifestations of the same entity via
 * the `manifestId` chain tag. The tag may be one-sided (glossary: "if a card
 * indicates that it is the manifestation of another card, the latter is also
 * considered a manifestation of the former"), so the comparison is symmetric:
 * `a` tagging `b`'s id, `b` tagging `a`'s id, or both tagging the same chain.
 *
 * Same-name duplicates are deliberately NOT treated as manifestations here —
 * they are the plain uniqueness check's concern, and non-unique characters
 * (three copies of the same Orc) must not collide.
 */
export function sameManifestationEntity(
  a: CardDefinition | undefined,
  b: CardDefinition | undefined,
): boolean {
  if (!a || !b) return false;
  const ma = manifestIdOf(a);
  const mb = manifestIdOf(b);
  if (ma !== undefined && (ma === b.id || ma === mb)) return true;
  if (mb !== undefined && mb === a.id) return true;
  return false;
}

/**
 * Glossary rule g.man.1: only one manifestation of an entity can be in play,
 * regardless of the cards' alignment. Returns the name of an in-play
 * character (either player) that is a manifestation of the same entity as
 * `def` (e.g. Strider ba-1 blocks a normal play of Aragorn II tw-120, and
 * vice versa), or `null` when nothing blocks.
 *
 * Scans characters only: hazard-side chain sisters (Balrog of Moria tw-12
 * vs The Balrog ba-3, Nazgûl permanent-events vs Ringwraiths) leave play
 * when the character enters via their own discard-on-play rules — the
 * "unless the current manifestation would leave play … when the new
 * manifestation is played" clause of g.man.1. The sanctioned path around
 * this block for characters is the `manifestation-swap` action, where the
 * old manifestation is removed from the game as part of the play.
 */
export function manifestationOfEntityInPlay(
  state: GameState,
  def: CardDefinition,
): string | null {
  const nameOf = (d: CardDefinition): string => (d as { name?: string }).name ?? (d.id as string);
  for (const player of state.players) {
    // Characters in play.
    for (const char of Object.values(player.characters)) {
      const charDef = defById(state, char.definitionId);
      if (charDef && sameManifestationEntity(charDef, def)) return nameOf(charDef);
      // Allies attached to a character (a manifestation may be an ally, e.g.
      // Mistress Lobelia dm-178 — a hero-resource-ally manifestation of the
      // same entity as the hazard agent Lobelia dm-28).
      for (const ally of char.allies) {
        const allyDef = defById(state, ally.definitionId);
        if (allyDef && sameManifestationEntity(allyDef, def)) return nameOf(allyDef);
      }
    }
    // Agents in play (a manifestation may be a hazard agent).
    for (const agent of player.agents) {
      const agentDef = defById(state, agent.character.definitionId);
      if (agentDef && sameManifestationEntity(agentDef, def)) return nameOf(agentDef);
    }
  }
  return null;
}

/**
 * Companion to {@link manifestationOfEntityInPlay} that scans the two players'
 * `cardsInPlay` (in-play factions, permanent-events, long-events) for a card
 * that is a manifestation of the same entity as `def`. Used for faction
 * manifestation uniqueness (g.man.1): a Dragons "Roused" faction such as Smaug
 * Roused (le-285) cannot be played while another form of the same Dragon — its
 * Ahunt long-event, At-Home permanent-event, or another Roused faction — is
 * already in play on either side. Returns the blocking card's name, or `null`.
 */
export function manifestationInCardsInPlay(
  state: GameState,
  def: CardDefinition,
): string | null {
  const nameOf = (d: CardDefinition): string => (d as { name?: string }).name ?? (d.id as string);
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const cardDef = defById(state, card.definitionId);
      if (cardDef && sameManifestationEntity(cardDef, def)) return nameOf(cardDef);
    }
  }
  return null;
}

/**
 * Full g.man.1 gate for playing a character: a manifestation of the same
 * entity in play blocks the play — whether it is a character-side form
 * ({@link manifestationOfEntityInPlay}) or a hazard/event-side form sitting in
 * either player's `cardsInPlay` (e.g. Lady of the Golden Wood as-13 as a
 * permanent-event blocks playing the character Galadriel tw-153).
 *
 * The rule's "unless the current manifestation would leave play … when the new
 * manifestation is played" clause is honoured for `cardsInPlay` sisters in two
 * directions:
 *
 * - the character being played carries an `on-event: self-enters-play` discard
 *   `move` whose filter matches that sister (The Balrog ba-3 discards Balrog of
 *   Moria tw-12 on entering play, so tw-12 in play does not bar playing ba-3);
 * - the *sister itself* carries a `discard-self-when` whose condition becomes
 *   true once this character is in play (Gandalf the White Rider as-11:
 *   "Discard this card if Gandalf comes into play" — so the in-play White Rider
 *   never bars playing Gandalf; the post-action sweep discards it instead).
 *
 * Returns the blocking card's name, or `null` when nothing blocks.
 */
export function blockingManifestationForCharacterPlay(
  state: GameState,
  def: CardDefinition,
): string | null {
  const inCharacters = manifestationOfEntityInPlay(state, def);
  if (inCharacters) return inCharacters;
  const nameOf = (d: CardDefinition): string => (d as { name?: string }).name ?? (d.id as string);
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const sisterDef = defById(state, card.definitionId);
      if (!sisterDef || !sameManifestationEntity(sisterDef, def)) continue;
      // "Would leave play when the new manifestation is played": the new
      // character discards the sister via a self-enters-play move apply.
      const sisterLeavesOnPlay = getCardEffects(def).some(e =>
        e.type === 'on-event'
        && e.event === 'self-enters-play'
        && e.apply.type === 'move'
        && e.apply.to === 'discard'
        && e.apply.filter !== undefined
        && matchesDefinition(sisterDef, e.apply.filter));
      if (sisterLeavesOnPlay) continue;
      // …or the sister's own `discard-self-when` fires once this character is
      // in play. Evaluated against a hypothetical context in which the played
      // character has already joined the in-play characters; a condition over
      // any other context path simply fails to match, so the sister keeps
      // blocking (the conservative default).
      const hypothetical = {
        charactersInPlayAnywhere: [...charactersInPlayNames(state), nameOf(def)],
      };
      const sisterYields = getCardEffects(sisterDef).some(e =>
        e.type === 'discard-self-when' && matchesCondition(e.condition, hypothetical));
      if (!sisterYields) return nameOf(sisterDef);
    }
  }
  return null;
}

/**
 * The terminal off-board piles — cards here are gone for good. The
 * discard pile is intentionally excluded: a routine end-of-LE-phase
 * discard of an Ahunt is just that one instance expiring, not the
 * Dragon being defeated, so it must not break the chain or sweep
 * sisters. Cards actively *removed from play* by an effect end up in
 * `outOfPlayPile`, which IS terminal.
 */
function chainCardInPile(state: GameState, m: ManifestId, pile: readonly CardInstance[]): boolean {
  for (const card of pile) {
    const def = defById(state, card.definitionId);
    if (manifestIdOf(def) === m) return true;
  }
  return false;
}

/**
 * Returns true iff any card from the chain identified by `m` has been
 * defeated (`killPile`) or eliminated (`outOfPlayPile`). Discard piles
 * are NOT consulted: an Ahunt expiring at end-of-long-event is a
 * normal lifecycle event, not a defeat — the Dragon's other
 * manifestations remain valid and the lair keeps its auto-attack.
 *
 * The scan is O(total terminal-pile size) with a tag check.
 */
export function isManifestationDefeated(state: GameState, m: ManifestId): boolean {
  for (const player of state.players) {
    if (chainCardInPile(state, m, player.outOfPlayPile)) return true;
    if (chainCardInPile(state, m, player.killPile)) return true;
  }
  return false;
}

/**
 * Defeat-cascade pass (METD §4.2). When any manifestation card lands
 * in a terminal off-board pile (`killPile` for defeats, `outOfPlayPile`
 * for elimination/removal-from-play), every sister card of the same
 * chain that is still in play is swept into the **owning** player's
 * `outOfPlayPile`. This blocks further plays of the chain (via
 * {@link isManifestationDefeated}) and removes lair augmentations
 * (because no `dragon-at-home` permanent-event remains in `cardsInPlay`).
 *
 * Routine discards (long-event expiry, hand-size discards) are
 * intentionally not a trigger — they don't break the chain.
 *
 * The pass is idempotent — running it twice is a no-op once the cascade
 * is fully resolved. Owner is derived from the instance ID prefix via
 * {@link ownerOf}, so cross-player sweeps land in the correct
 * player's pile (preserving the no-card-disappears invariant and the
 * §4.1 MP attribution rule).
 */
export function applyManifestationCascade(state: GameState): GameState {
  // Identify every chain that has a card in a terminal off-board pile.
  const removed = new Set<string>();
  for (const player of state.players) {
    for (const pile of [player.outOfPlayPile, player.killPile]) {
      for (const card of pile) {
        const def = defById(state, card.definitionId);
        const m = manifestIdOf(def);
        if (m) removed.add(m as string);
      }
    }
  }
  if (removed.size === 0) return state;

  // Sweep in-play sister cards. Each gets routed to its owner's
  // outOfPlayPile based on the instance ID prefix.
  const players = state.players.map(p => ({ ...p, cardsInPlay: [...p.cardsInPlay], characters: { ...p.characters } }));
  const additions: Record<string, CardInstance[]> = {};
  let changed = false;
  for (let pi = 0; pi < players.length; pi++) {
    const p = players[pi];
    const keep: typeof p.cardsInPlay = [];
    for (const card of p.cardsInPlay) {
      const def = defById(state, card.definitionId);
      const m = manifestIdOf(def);
      if (m && removed.has(m as string)) {
        const owner = ownerOf(card.instanceId) as string;
        (additions[owner] ??= []).push(toCardInstance(card));
        changed = true;
      } else {
        keep.push(card);
      }
    }
    p.cardsInPlay = keep;
  }
  if (!changed) return state;
  // Apply additions to the matching player's outOfPlayPile.
  const finalPlayers = players.map(p => {
    const adds = additions[p.id as string];
    if (!adds || adds.length === 0) return p;
    return { ...p, outOfPlayPile: [...p.outOfPlayPile, ...adds] };
  }) as unknown as readonly [PlayerState, PlayerState];
  return { ...state, players: finalPlayers };
}

/**
 * Returns a site's automatic-attacks filtered for the current game state.
 *
 * - If the site is a Dragon lair (`lairOf` set) and that Dragon is
 *   defeated, the site's Dragon-typed printed attacks are suppressed.
 * - Any in-play "At-Home" permanent-event for the same Dragon appends an
 *   additional Dragon attack, *unless* the matching Ahunt long-event is
 *   also in play (the rule's "Unless [Dragon] Ahunt is in play" clause).
 *
 * Callers in reducer-site / legal-actions should always use this instead
 * of reading `siteDef.automaticAttacks` directly, so all manifestation
 * gating lives in one place.
 */
export function getActiveAutoAttacks(
  state: GameState,
  siteDef: SiteCard,
  siteInstanceId?: CardInstanceId,
): readonly AutomaticAttack[] {
  const lairOf = (siteDef as { lairOf?: ManifestId }).lairOf;

  let printed: readonly AutomaticAttack[] = siteDef.automaticAttacks;

  if (lairOf) {
    if (isManifestationDefeated(state, lairOf)) {
      // Dragon defeated → strip its Dragon-typed printed attacks. Other
      // attacks on the same site (rare) are left intact.
      printed = printed.filter(a => normalizeCreatureRace(a.creatureType) !== Race.Dragon);
    }

    // Augment with any in-play At-Home effect for this manifestation,
    // unless the matching Ahunt is also in play.
    if (!isAhuntInPlay(state, lairOf)) {
      const augments = collectAtHomeAttacks(state, lairOf);
      if (augments.length > 0) printed = [...printed, ...augments];
    }
  }

  // Rhosgobel (as-159): "If the Wizard card Radagast is in play, the
  // automatic-attacks are removed." A `cancel-attacks-if-character-in-play`
  // site rule strips all of the site's *printed* automatic-attacks while a
  // character with the given name — any version of it (Radagast tw-178 /
  // wh-8) — is in play for either player. Applied before hazard augments so
  // attacks added to the site by hazard effects are unaffected.
  const printedCancelRule = (siteDef as { effects?: readonly CardEffect[] }).effects?.find(
    (e): e is Extract<CardEffect, { type: 'site-rule'; rule: 'cancel-attacks-if-character-in-play' }> =>
      e.type === 'site-rule' && e.rule === 'cancel-attacks-if-character-in-play',
  );
  if (printedCancelRule && printed.length > 0 && isNamedCharacterInPlay(state, printedCancelRule.characterName)) {
    logDetail(`cancel-attacks-if-character-in-play: "${printedCancelRule.characterName}" is in play — all ${printed.length} printed automatic-attack(s) at ${siteDef.name} removed`);
    printed = [];
  }

  // Augment with any permanent-event-auto-attack effects targeting this site.
  const peAugments = collectPermanentEventAttacks(state, siteDef);
  let combined: readonly AutomaticAttack[] = peAugments.length === 0 ? printed : [...printed, ...peAugments];

  // FEAR! FIRE! FOES! (as-29) Mode A: turn-scoped `extra-automatic-attack`
  // constraints append one additional real automatic-attack to the specific
  // site *instance* they were created at (matched by instance id, not
  // definition id, so only the targeted company's site is augmented).
  if (siteInstanceId) {
    const extras = state.activeConstraints.filter(
      c => c.kind.type === 'extra-automatic-attack' && c.kind.siteInstanceId === siteInstanceId,
    );
    for (const c of extras) {
      if (c.kind.type !== 'extra-automatic-attack') continue;
      logDetail(`extra-automatic-attack: appending ${c.kind.attack.creatureType || 'no-type'} attack (${c.kind.attack.strikes} strikes, ${c.kind.attack.prowess} prowess${c.kind.attack.forceDetainment ? ', detainment' : ''}) at ${siteDef.name}`);
      combined = [...combined, c.kind.attack];
    }
  }

  // MEBA: "If The Balrog is in play or has been defeated, ignore all Balrog
  // automatic-attacks (i.e., at The Under-gates)." Strip Balrog-typed attacks
  // (e.g. The Under-gates dm-38, 2×16) once the Balrog avatar has entered play
  // or has been defeated/eliminated.
  if (combined.some(a => normalizeCreatureRace(a.creatureType) === Race.Balrog) && isBalrogInPlayOrDefeated(state)) {
    const before = combined.length;
    combined = combined.filter(a => normalizeCreatureRace(a.creatureType) !== Race.Balrog);
    logDetail(`MEBA: Balrog in play or defeated — ${before - combined.length} Balrog automatic-attack(s) at ${siteDef.name} ignored`);
  }

  // Apply cancel-first-attack-if-in-play site rules: if the referenced card
  // is in any player's cardsInPlay, remove the first attack from the list.
  // Used by The Under-gates (dm-38) when Balrog of Moria is in play.
  const siteEffects = (siteDef as { effects?: readonly import('../types/effects.js').CardEffect[] } | undefined)?.effects;
  if (siteEffects) {
    for (const siteEff of siteEffects) {
      if (siteEff.type !== 'site-rule') continue;
      if (siteEff.rule !== 'cancel-first-attack-if-in-play') continue;
      const refDefId = siteEff.definitionId as string;
      const refInPlay = state.players.some(p => p.cardsInPlay.some(c => c.definitionId === refDefId));
      if (refInPlay && combined.length > 0) {
        combined = combined.slice(1);
        const refName = cardName(state, siteEff.definitionId, refDefId);
        logDetail(`cancel-first-attack-if-in-play: "${refName}" is in play — first attack at ${siteDef.name} canceled`);
      }
      break;
    }
  }

  // Vile Fumes (wh-54): a `replace-automatic-attacks` constraint matching
  // this site definition replaces the entire attack list with its single
  // bespoke attack (Gas). "Its normal automatic-attacks are replaced with:
  // Gas …". Applies to all versions of the site (matched by definition ID).
  const replace = state.activeConstraints.find(
    c => c.kind.type === 'replace-automatic-attacks' && c.kind.siteDefinitionId === siteDef.id,
  );
  if (replace && replace.kind.type === 'replace-automatic-attacks') {
    const a = replace.kind.attack;
    logDetail(`replace-automatic-attacks: ${siteDef.name} automatic-attacks replaced with ${a.creatureType} (${a.strikes} strike, ${a.prowess} prowess${a.uncancelable ? ', uncancelable' : ''})`);
    // Map the constraint's `uncancelable`/`eachCharacter` flags onto the
    // shared combat-rule strings consumed by `handleSiteAutomaticAttacks`.
    const combatRules: string[] = [];
    if (a.uncancelable) combatRules.push('cannot-be-canceled');
    if (a.eachCharacter) combatRules.push('each-character');
    return [{
      creatureType: a.creatureType,
      strikes: a.strikes,
      prowess: a.prowess,
      ...(a.body !== undefined ? { body: a.body } : {}),
      ...(combatRules.length > 0 ? { combatRules } : {}),
    }];
  }

  // Whole Villages Roused (wh-31): a `mirror-automatic-attacks` constraint
  // matching this site *instance* (not definition id — only the visiting
  // company's own copy is affected, for this turn only) replaces the entire
  // attack list with the corresponding site card's (other alignment, same
  // name) automatic-attacks, each boosted by the constraint's prowessBoost
  // and carrying its baked-in detainment mode.
  const mirror = siteInstanceId
    ? state.activeConstraints.find(
      c => c.kind.type === 'mirror-automatic-attacks' && c.kind.siteInstanceId === siteInstanceId,
    )
    : undefined;
  if (mirror && mirror.kind.type === 'mirror-automatic-attacks') {
    const mirrorKind = mirror.kind;
    const mirrorDef = state.cardPool[mirrorKind.mirrorSiteDefinitionId] as SiteCard | undefined;
    const mirrorAttacks = mirrorDef?.automaticAttacks ?? [];
    logDetail(`mirror-automatic-attacks: ${siteDef.name} automatic-attacks replaced with ${mirrorDef?.name ?? mirrorKind.mirrorSiteDefinitionId as string}'s ${mirrorAttacks.length} attack(s), +${mirrorKind.prowessBoost} prowess`);
    return mirrorAttacks.map(a => ({
      ...a,
      prowess: a.prowess + mirrorKind.prowessBoost,
      ...(mirrorKind.detainmentAgainstPlayer !== undefined ? { detainmentAgainstPlayer: mirrorKind.detainmentAgainstPlayer } : {}),
      ...(mirrorKind.detainmentAgainstOvert ? { detainmentAgainstOvert: true } : {}),
    }));
  }

  // Roots of the Earth (ba-74): a `site-instance-transform` strips all
  // automatic-attacks from the associated Darkhaven instance and adds an Orcs
  // 5/9 auto-attack to every other version. Lord and Usurper (ba-65): both the
  // associated and the other versions lose their Dwarf auto-attacks
  // (`removeAutoAttacksByRace`), and the other versions additionally gain an
  // Orcs 4/7 attack. Requires the queried site instance to distinguish the two.
  const transform = resolveSiteInstanceTransform(state, siteDef.id, siteInstanceId);
  if (transform) {
    const roleCfg = transform.role === 'associated'
      ? transform.effect.associated
      : transform.effect.others;
    if (transform.role === 'associated' && transform.effect.associated.removeAllAutoAttacks) {
      logDetail(`site-instance-transform: ${siteDef.name} is the associated ${transform.effect.associated.siteType} — all automatic-attacks removed`);
      return [];
    }
    if (roleCfg.removeAutoAttacksByRace) {
      const race = roleCfg.removeAutoAttacksByRace;
      const before = combined.length;
      combined = combined.filter(a => normalizeCreatureRace(a.creatureType) !== race);
      logDetail(`site-instance-transform: ${transform.role} version of ${siteDef.name} loses ${before - combined.length} ${race} automatic-attack(s)`);
    }
    if (transform.role === 'other' && transform.effect.others.addAutoAttack) {
      const add = transform.effect.others.addAutoAttack;
      logDetail(`site-instance-transform: other version of ${siteDef.name} gains ${add.creatureType} auto-attack (${add.strikes} strikes, ${add.prowess} prowess)`);
      combined = [...combined, { creatureType: add.creatureType, strikes: add.strikes, prowess: add.prowess }];
    }
  }

  return combined;
}

/**
 * True iff a character with the given card name is in play — present in any
 * player's `characters` record. Matched by name so every version of the card
 * counts (e.g. Radagast exists as hero Wizard tw-178 and Fallen-wizard wh-8).
 * Backs the `cancel-attacks-if-character-in-play` site rule (Rhosgobel as-159).
 */
function isNamedCharacterInPlay(state: GameState, name: string): boolean {
  return charactersInPlayNames(state).includes(name);
}

/**
 * The card names of every character in play, for either player.
 *
 * Names rather than definition ids, so all printings of one character count as
 * the same person (Gandalf is hero Wizard tw-156 and Fallen-wizard wh-4;
 * Radagast is tw-178 / wh-8). Exposed to the DSL as `charactersInPlayAnywhere`
 * in the player-state context, which is what lets a card say "discard this card
 * if <character> comes into play" (Gandalf the White Rider as-11) — the
 * `inPlay` / `inPlayAnywhere` name lists cover `cardsInPlay` only and never see
 * characters.
 */
export function charactersInPlayNames(state: GameState): readonly string[] {
  const names: string[] = [];
  for (const player of state.players) {
    for (const char of Object.values(player.characters)) {
      const name = defById(state, char.definitionId)?.name;
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

/**
 * MEBA: true once The Balrog avatar has entered play (present in any player's
 * `characters`) or has been defeated/eliminated (present in any player's
 * `outOfPlayPile`). Backs the rule that Balrog automatic-attacks are ignored
 * from that point on.
 */
function isBalrogInPlayOrDefeated(state: GameState): boolean {
  for (const player of state.players) {
    for (const char of Object.values(player.characters)) {
      if (isBalrogAvatarDef(defById(state, char.definitionId))) return true;
    }
    for (const card of player.outOfPlayPile) {
      if (isBalrogAvatarDef(defById(state, card.definitionId))) return true;
    }
  }
  return false;
}

/**
 * True iff a long-event sharing the given manifestation id is in play
 * for either player. For Dragon chains this means "the Ahunt is up".
 */
function isAhuntInPlay(state: GameState, m: ManifestId): boolean {
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (manifestIdOf(def) !== m) continue;
      if ((def as HazardEventCard | undefined)?.eventType === 'long') return true;
    }
  }
  return false;
}

/**
 * Returns true when the *defending* player has a `reduce-attacks-to-one`
 * permanent event in cardsInPlay (i.e. *Forewarned Is Forearmed* is in play).
 *
 * Forewarned Is Forearmed is a defensive resource event: it protects the
 * company of the player who played it from multi-attack hazards/sites. It
 * must not be scoped to "any player" — a hazard player who happens to have
 * their own copy in play (protecting their own companies elsewhere in the
 * game) must not have it weaken hazards *they* are playing against the
 * opponent.
 */
export function isReduceAttacksToOneInPlay(state: GameState, defendingPlayerIndex: number): boolean {
  const player = state.players[defendingPlayerIndex];
  if (!player) return false;
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def) continue;
    if (!('effects' in def)) continue;
    if (hasPlayFlag(def as { effects?: readonly CardEffect[] }, 'reduce-attacks-to-one')) return true;
  }
  return false;
}

/**
 * Collects `permanent-event-auto-attack` augmentations targeting the given site
 * from all cards currently in any player's cardsInPlay. These are Spawn-type
 * hazard events (e.g. Balrog of Moria TW-12, Monstrosity of Diverse Shape BA-21)
 * that explicitly list site IDs they augment. Unlike dragon-at-home, these are
 * not gated by any manifestation chain — they augment any listed site regardless.
 */
function collectPermanentEventAttacks(state: GameState, siteDef: SiteCard): AutomaticAttack[] {
  const out: AutomaticAttack[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type === 'faction-siege') {
          // Long Grievous Siege (ba-40): every version of the besieged site
          // (matched by printed name — hero/minion twins use distinct
          // definition ids) gains an additional automatic-attack whose type
          // derives from the target faction's race. The attack is detainment
          // against the siege controller's own companies only.
          if (card.attachedToSite === undefined || card.pendingTriggerAttack) continue;
          const boundDef = defById(state, card.attachedToSite);
          if (!boundDef || boundDef.name !== siteDef.name) continue;
          const factionEntry = state.players
            .flatMap(p => p.cardsInPlay)
            .find(c => c.instanceId === card.attachedTo);
          const factionDef = factionEntry ? defById(state, factionEntry.definitionId) : undefined;
          if (!factionDef || !isFactionCard(factionDef)) continue;
          const creatureType = factionRaceToAttackType(factionDef.race);
          logDetail(`faction-siege: ${cardName(state, card.definitionId, '?')} adds ${creatureType} auto-attack (${e.attack.strikes} strikes, ${e.attack.prowess} prowess, detainment vs ${player.id as string}) at ${siteDef.name}`);
          out.push({
            creatureType,
            strikes: e.attack.strikes,
            prowess: e.attack.prowess,
            sourceInstanceId: card.instanceId,
            detainmentAgainstPlayer: player.id,
          });
          continue;
        }
        if (e.type !== 'permanent-event-auto-attack') continue;
        const eff = e;
        // Match either an explicitly listed site definition (Spawn-type events),
        // or, when `siteType` is set, every site of that printed type (Fell
        // Winter le-111: "Each Border-hold receives an additional auto-attack"),
        // or, when `boundSite` is set, every version of the site the card was
        // played on (Nature's Revenge wh-27) — matched by printed name, since
        // the hero/minion/FW/Balrog printings are distinct definitions.
        const matchesById = eff.siteIds.includes(siteDef.id);
        const matchesByType = eff.siteType !== undefined && siteDef.siteType === eff.siteType;
        let matchesByBinding = false;
        if (eff.boundSite && card.attachedToSite !== undefined && !card.pendingTriggerAttack) {
          matchesByBinding = defById(state, card.attachedToSite)?.name === siteDef.name;
        }
        if (!matchesById && !matchesByType && !matchesByBinding) continue;
        out.push({
          creatureType: eff.attack.creatureType,
          strikes: eff.attack.strikes,
          prowess: eff.attack.prowess,
          body: eff.attack.body,
          combatRules: eff.attack.combatRules,
          sourceInstanceId: card.instanceId,
        });
      }
    }
  }
  return out;
}

/**
 * Collects every `dragon-at-home` augmentation attack contributed by
 * in-play permanent-events whose `manifestId` matches.
 */
function collectAtHomeAttacks(state: GameState, m: ManifestId): AutomaticAttack[] {
  const out: AutomaticAttack[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = defById(state, card.definitionId);
      if (manifestIdOf(def) !== m) continue;
      const effects = (def as { effects?: readonly { type: string }[] }).effects;
      if (!effects) continue;
      for (const e of effects) {
        if (e.type === 'dragon-at-home') {
          const attack = (e as DragonAtHomeEffect).attack;
          out.push({
            creatureType: attack.creatureType,
            strikes: attack.strikes,
            prowess: attack.prowess,
            ...(attack.body !== undefined ? { body: attack.body } : {}),
          });
        }
      }
    }
  }
  return out;
}
