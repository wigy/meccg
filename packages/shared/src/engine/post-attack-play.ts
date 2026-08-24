/**
 * @module post-attack-play
 *
 * The "immediately after his company faces an attack" resource play window.
 *
 * A resource permanent-event may declare
 * `{ "type": "play-window", "phase": "combat", "step": "after-attack", "when": … }`.
 * Such a card is never offered by the ordinary organization/site-phase play
 * paths; instead it becomes playable for exactly one window — the moment the
 * attack its company was facing ends. Per CoE rule 8.03 a company has "faced"
 * an attack once combat is initiated, *even if the attack is then canceled*, so
 * the window opens on every combat teardown, not only on a fought-out attack.
 *
 * The trigger is therefore evaluated as a prev/next diff after every reducer
 * step ({@link enqueuePostAttackPlayOffers}, called from `postReduce`), the same
 * reactive pattern used by {@link module:engine/evil-hour} and
 * {@link module:engine/discard-on-card-leaves}. Hooking the diff rather than the
 * individual `combat: null` teardown sites means every way an attack can end —
 * strikes resolved, attack canceled on the chain, all strikes canceled by tap —
 * opens the window exactly once.
 *
 * The window itself is a `post-attack-play-offer` pending resolution owned by
 * the defending player: they either play one of the matched cards on an eligible
 * character (`play-permanent-event`, which routes through the normal chain and
 * so pays the `play-target` tap cost and attaches the card) or decline (`pass`).
 *
 * Used by No News of Our Riding (le-211): "Playable on an untapped character
 * immediately after his company faces an Elf, Dúnadan, or Man hazard creature."
 */

import type { GameState, PlayerState, Company, CombatState, CardInstanceId } from '../index.js';
import type { CardDefinition } from '../types/cards.js';
import type { PlayTargetEffect, PlayWindowEffect } from '../types/effects.js';
import { isCharacterCard } from '../types/cards.js';
import { CardStatus } from '../types/common.js';
import { matchesCondition } from '../effects/condition-matcher.js';
import { logDetail } from './legal-actions/log.js';
import { buildPlayOptionContext } from './legal-actions/organization.js';
import {
  companyById, companySubphaseScope, countAttachedInCompany, defById, getCardEffects,
  findDuplicationLimitEffect, playerById,
} from './reducer-utils.js';
import { enqueueResolution } from './pending.js';

/** The `play-window` of a card, when it declares one. */
function playWindowOf(def: CardDefinition | undefined): PlayWindowEffect | undefined {
  return getCardEffects(def).find((e): e is PlayWindowEffect => e.type === 'play-window');
}

/**
 * True when `def` is a resource permanent-event whose play-window is the
 * after-attack combat window (`phase: "combat"`, `step: "after-attack"`).
 */
export function hasAfterAttackWindow(def: CardDefinition | undefined): boolean {
  if (!def) return false;
  if (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') return false;
  if ((def as { eventType?: string }).eventType !== 'permanent') return false;
  const window = playWindowOf(def);
  return window?.phase === 'combat' && window.step === 'after-attack';
}

/**
 * The condition context an after-attack `play-window` `when` clause is matched
 * against: the same attack discriminators a `cancel-attack` `when` sees, so a
 * card gates its play window and its granted ability with the same expression.
 */
function attackContext(combat: CombatState): Record<string, unknown> {
  return {
    enemy: { race: combat.creatureRace ?? null },
    attack: { source: combat.attackSource.type },
  };
}

/**
 * Characters of `company` that may legally receive `def` right now: they satisfy
 * the card's `play-target` character `filter` and — when the play-target carries
 * a `{ tap: "character" }` cost — are untapped so the cost can be paid.
 *
 * Shared by the enqueue check (is the window worth opening at all?) and the
 * pending resolution's legal actions (which characters may be named), so the
 * offer can never advertise a target the play would reject.
 */
export function afterAttackPlayTargets(
  state: GameState,
  player: PlayerState,
  company: Company,
  def: CardDefinition,
): CardInstanceId[] {
  const playTarget = getCardEffects(def).find(
    (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
  );
  if (!playTarget) return [];
  const requiresUntapped = playTarget.cost?.tap === 'character';

  const out: CardInstanceId[] = [];
  for (const charId of company.characters) {
    const char = player.characters[charId];
    if (!char) continue;
    const charDef = defById(state, char.definitionId);
    if (!charDef || !isCharacterCard(charDef)) continue;
    if (requiresUntapped && char.status !== CardStatus.Untapped) continue;
    if (playTarget.filter && !matchesCondition(playTarget.filter, buildPlayOptionContext(state, char, player))) {
      continue;
    }
    out.push(charId);
  }
  return out;
}

/**
 * Hand cards of `player` whose after-attack window matches the ended attack and
 * that have at least one legal bearer in `company`.
 */
function matchingHandCards(
  state: GameState,
  player: PlayerState,
  company: Company,
  combat: CombatState,
): CardInstanceId[] {
  const ctx = attackContext(combat);
  const out: CardInstanceId[] = [];
  for (const handCard of player.hand) {
    const def = defById(state, handCard.definitionId);
    if (!hasAfterAttackWindow(def) || !def) continue;
    const cardLabel = def.name ?? (handCard.definitionId as string);

    const window = playWindowOf(def);
    if (window?.when && !matchesCondition(window.when, ctx)) {
      logDetail(`After-attack window "${cardLabel}": ended attack does not match (race ${combat.creatureRace ?? 'none'}, source ${combat.attackSource.type})`);
      continue;
    }
    // "Cannot be duplicated in a given company" — a copy already borne by a
    // member of this company closes the window for the rest.
    const companyDupLimit = findDuplicationLimitEffect(def, 'company');
    if (companyDupLimit) {
      const copies = countAttachedInCompany(state, player, company, def.name, 'items');
      if (copies >= companyDupLimit.max) {
        logDetail(`After-attack window "${cardLabel}": company duplication limit reached (${copies}/${companyDupLimit.max})`);
        continue;
      }
    }
    if (afterAttackPlayTargets(state, player, company, def).length === 0) {
      logDetail(`After-attack window "${cardLabel}": no eligible character in the company`);
      continue;
    }
    logDetail(`After-attack window "${cardLabel}": offering play on ${company.id as string}`);
    out.push(handCard.instanceId);
  }
  return out;
}

/**
 * A string identifying one attack within its source type, built from the
 * source's own discriminating fields. Two consecutive attacks of the same
 * source type against the same company must map to different identities, or
 * the after-attack window between them is silently skipped — so multi-attack
 * sources carry their per-attack discriminator (`attackIndex`, the revealed
 * creature, the remaining-attack count). The switch is exhaustive over
 * {@link AttackSource} so a new source type fails the build until it states
 * its identity here.
 */
function attackIdentity(c: CombatState): string {
  const s = c.attackSource;
  switch (s.type) {
    case 'creature': return s.instanceId as string;
    case 'on-guard-creature': return s.cardInstanceId as string;
    case 'automatic-attack': return `${s.siteInstanceId as string}#${s.attackIndex}`;
    case 'tidings-attack': return `${s.eventInstanceId as string}#${s.attackIndex}`;
    case 'great-hunt-attack': return `${s.greatHuntInstanceId as string}#${s.creatureInstanceId as string}`;
    case 'hunt-attack': return `${s.huntInstanceId as string}#${s.creatureInstanceId as string}`;
    case 'long-dark-reach-attack': return `${s.sourceInstanceId as string}#${s.creatureInstanceId as string}`;
    case 'card-triggered-attack': return `${s.cardInstanceId as string}#${s.remainingAttacks?.length ?? 0}`;
    case 'played-auto-attack': return s.instanceId as string;
    case 'agent': return s.instanceId as string;
    case 'company-attack': return s.attackingCompanyId as string;
    case 'ahunt': return s.longEventInstanceId as string;
    case 'stay-her-appetite-attack': return s.allyInstanceId as string;
    case 'lucky-search-attack': return s.scoutInstanceId as string;
    case 'siege-attack': return s.cardInstanceId as string;
    case 'company-strike-event': return s.eventInstanceId as string;
    case 'site-entry-attack': return s.eventInstanceId as string;
    case 'region-shortcut-attack': return s.eventInstanceId as string;
    case 'traitor-attack': return s.eventInstanceId as string;
  }
}

/**
 * True when the combat active in `next` is the *same* attack that was active in
 * `prev` — i.e. the attack has not ended and no window should open. Combats
 * carry no identity of their own, so the defending company plus the attack
 * source type and its per-attack identity ({@link attackIdentity}) identify
 * the attack for this diff. Discriminating every source type matters:
 * multi-attack sequences install the next attack in the same reduce step that
 * finalizes the previous one (The Great Hunt's next creature, Tidings of Bold
 * Spies' next `attackIndex`), and conflating them would skip the CoE 8.03
 * after-attack window between the attacks.
 */
export function sameAttack(a: CombatState, b: CombatState): boolean {
  if (a.companyId !== b.companyId) return false;
  if (a.attackSource.type !== b.attackSource.type) return false;
  return attackIdentity(a) === attackIdentity(b);
}

/**
 * Opens the after-attack play window when the combat active in `prev` has ended
 * in `next`. Returns `next` unchanged when no attack ended, when no card in the
 * defending player's hand matches, or when an offer for the same window is
 * already queued.
 */
export function enqueuePostAttackPlayOffers(prev: GameState, next: GameState): GameState {
  const combat = prev.combat;
  if (!combat) return next;
  if (next.combat && sameAttack(next.combat, combat)) return next;

  const player = playerById(next, combat.defendingPlayerId);
  if (!player) return next;
  const company = companyById(player.companies, combat.companyId);
  if (!company) return next;

  // Fast path: the overwhelmingly common case is a hand with no such card.
  if (!player.hand.some(c => hasAfterAttackWindow(defById(next, c.definitionId)))) return next;

  // Never stack two offers for the same company (e.g. a multi-attack sequence
  // whose earlier offer is still unresolved).
  if (next.pendingResolutions.some(r =>
    r.kind.type === 'post-attack-play-offer' && r.kind.companyId === combat.companyId)) {
    return next;
  }

  const cardInstanceIds = matchingHandCards(next, player, company, combat);
  if (cardInstanceIds.length === 0) return next;

  logDetail(`After-attack play window opens for ${combat.defendingPlayerId as string}: ${cardInstanceIds.length} card(s) playable on company ${combat.companyId as string}`);
  return enqueueResolution(next, {
    source: null,
    actor: combat.defendingPlayerId,
    scope: companySubphaseScope(next.phaseState.phase, combat.companyId),
    kind: { type: 'post-attack-play-offer', companyId: combat.companyId, cardInstanceIds },
  });
}
