/**
 * @module legal-actions/pending
 *
 * Glue between {@link computeLegalActions} and the unified pending system
 * (resolutions + constraints) defined in `engine/pending.ts` and
 * `types/pending.ts`.
 *
 * Two entry points:
 *
 *  - {@link resolutionLegalActions} — invoked when a {@link PendingResolution}
 *    is queued for the actor; collapses the legal action menu to the
 *    actions that resolve the top entry.
 *  - {@link applyConstraints} — invoked after the per-phase legal actions
 *    have been computed; rewrites the menu by dropping or adding actions
 *    according to the active {@link ActiveConstraint}s in scope.
 *
 * Per-kind handlers are filled in as the migration steps move each
 * legacy `pending*` field over to the new system.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  PendingResolution,
  ActiveConstraint,
  CardInstanceId,
  CompanyId,
} from '../../index.js';
import { isCharacterCard, isAllyCard, isFactionCard, Phase, CardStatus, matchesCondition } from '../../index.js';
import type { PlayOptionEffect, PlayTargetEffect, CardEffect } from '../../types/effects.js';
import { resolveInstanceId } from '../../types/state.js';
import { resolveDef, collectCharacterEffects, resolveCheckModifier, resolveStatModifiers } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { buildPlayOptionContext } from './organization.js';
import { logDetail } from './log.js';

/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: import('../../index.js').GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Compute the (single) set of legal actions for the actor while the
 * given resolution is at the top of the queue. Dispatches on
 * `top.kind.type`. Each handler is added in the migration step that
 * moves its old per-phase short-circuit over.
 */
export function resolutionLegalActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  switch (top.kind.type) {
    case 'corruption-check':
      return corruptionCheckActions(state, actor, top);
    case 'order-effects':
      return [];
    case 'on-guard-window':
      return onGuardWindowActions(state, actor, top);
    case 'opponent-influence-defend':
      return opponentInfluenceDefendActions(state, actor, top);
    case 'faction-influence-roll':
      return factionInfluenceRollActions(state, actor, top);
  }
}

/**
 * Compute the legal actions for the actor of a queued `on-guard-window`
 * resolution.
 *
 * - During the `reveal-window` stage (hazard player), produce one
 *   `reveal-on-guard` action per eligible on-guard hazard event in the
 *   active company plus a `pass` action that closes the window.
 * - During the `awaiting-pass` stage (resource player after the chain
 *   has resolved), the only legal action is `pass`, which runs the
 *   deferred action.
 */
function onGuardWindowActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'on-guard-window') return [];
  if (top.kind.stage === 'awaiting-pass') {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }

  // reveal-window stage: produce reveal-on-guard actions for the
  // active company's on-guard hazard events that target a character or
  // are revealable in this window. Mirrors the legacy
  // `onGuardRevealAtResourceActions`.
  if (state.activePlayer === null) {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }
  const activePlayerObj = state.players.find(p => p.id === state.activePlayer);
  if (!activePlayerObj) {
    return [{ action: { type: 'pass', player: actor }, viable: true }];
  }
  const phaseState = state.phaseState as { activeCompanyIndex?: number };
  const activeCompanyIndex = phaseState.activeCompanyIndex ?? 0;
  const company = activePlayerObj.companies[activeCompanyIndex];

  const actions: EvaluatedAction[] = [];

  if (company) {
    for (const ogCard of company.onGuardCards) {
      if (ogCard.revealed) continue;
      const def = state.cardPool[ogCard.definitionId as string];
      if (!def) continue;
      if (def.cardType !== 'hazard-event') continue;

      // Per CoE rule 2.V.6, only hazard events that directly affect the
      // company may be revealed from on-guard when a resource is played.
      // Cards must declare an on-guard-reveal effect with a matching trigger.
      const hasResourceTrigger = 'effects' in def && def.effects?.some(
        (e: { type: string; trigger?: string }) =>
          e.type === 'on-guard-reveal' && (e.trigger === 'resource-play' || e.trigger === 'influence-attempt'),
      );
      if (!hasResourceTrigger) continue;

      // play-target DSL: character-targeting events get one action per character
      const isCharTargeting = 'effects' in def && def.effects?.some(
        e => e.type === 'play-target' && e.target === 'character',
      );
      if (isCharTargeting) {
        for (const charId of company.characters) {
          actions.push({
            action: {
              type: 'reveal-on-guard',
              player: actor,
              cardInstanceId: ogCard.instanceId,
              targetCharacterId: charId,
            },
            viable: true,
          });
        }
      } else {
        actions.push({
          action: {
            type: 'reveal-on-guard',
            player: actor,
            cardInstanceId: ogCard.instanceId,
          },
          viable: true,
        });
      }
    }
  }

  actions.push({ action: { type: 'pass', player: actor }, viable: true });
  return actions;
}

/**
 * Compute the (single) legal action for the hazard player while an
 * opponent-influence-defend resolution is queued — they roll the
 * defensive 2d6 by submitting an `opponent-influence-defend` action.
 * Builds a human-readable explanation from the pending attempt data
 * so the UI can display a situation banner before the roll.
 */
function opponentInfluenceDefendActions(
  state: GameState,
  actor: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'opponent-influence-defend') return [];
  const { attempt } = top.kind;

  const influencerDef = resolveDef(state, attempt.influencerId);
  const influencerName = influencerDef && isCharacterCard(influencerDef) ? influencerDef.name : '?';

  const targetDef = resolveDef(state, attempt.targetInstanceId);
  const targetName = targetDef && (isCharacterCard(targetDef) || isAllyCard(targetDef))
    ? targetDef.name : '?';

  const parts: string[] = [
    `Attacker roll: ${attempt.attackerRoll}`,
    `Influencer DI: ${attempt.influencerDI}`,
    `Your GI: ${attempt.opponentGI}`,
    `Controller DI: ${attempt.controllerDI}`,
    `Target mind: ${attempt.targetMind}`,
  ];

  const explanation = `${influencerName} influences ${targetName}: ${parts.join(', ')}`;

  return [{
    action: { type: 'opponent-influence-defend', player: actor, explanation },
    viable: true,
  }];
}

/**
 * Compute the single faction-influence-roll action that resolves a queued
 * `faction-influence-roll` resolution. Calculates all modifiers from the
 * current game state (post-chain) so the UI can display a full breakdown
 * before the player commits to rolling.
 */
function factionInfluenceRollActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'faction-influence-roll') return [];
  const { factionInstanceId, factionDefinitionId, influencingCharacterId } = top.kind;

  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];

  const def = state.cardPool[factionDefinitionId as string];
  if (!def || !isFactionCard(def)) return [];

  const charInPlay = player.characters[influencingCharacterId as string];
  if (!charInPlay) return [];

  const charDef = state.cardPool[charInPlay.definitionId as string];
  const charName = isCharacterCard(charDef) ? charDef.name : '?';
  const factionName = def.name;

  // Calculate influence modifier using current state (post-chain effects)
  let modifier = 0;
  const parts: string[] = [];

  if (charDef && isCharacterCard(charDef)) {
    modifier += charDef.directInfluence;
    parts.push(`DI ${charDef.directInfluence}`);

    const resolverCtx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: {
        race: charDef.race,
        skills: charDef.skills,
        baseProwess: charDef.prowess,
        baseBody: charDef.body,
        baseDirectInfluence: charDef.directInfluence,
        name: charDef.name,
      },
      faction: {
        name: def.name,
        race: def.race,
      },
    };

    const charEffects = collectCharacterEffects(state, charInPlay, resolverCtx);

    if (def.effects) {
      for (const effect of def.effects) {
        if (effect.when && !matchesCondition(effect.when, resolverCtx as unknown as Record<string, unknown>)) continue;
        charEffects.push({ effect, sourceDef: def, sourceInstance: factionInstanceId });
      }
    }

    const dslModifier = resolveCheckModifier(charEffects, 'influence');
    if (dslModifier !== 0) {
      modifier += dslModifier;
      parts.push(`check mod ${dslModifier >= 0 ? '+' : ''}${dslModifier}`);
    }

    const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
    if (dslDI !== 0) {
      modifier += dslDI;
      parts.push(`DI mod ${dslDI >= 0 ? '+' : ''}${dslDI}`);
    }
  }

  const influenceNumber = def.influenceNumber;
  const need = influenceNumber - modifier;
  const modStr = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  logDetail(`Pending faction-influence-roll for ${factionName} by ${charName}: need 2d6 >= ${need}${modStr}`);

  return [{
    action: {
      type: 'faction-influence-roll' as const,
      player: playerId,
      factionInstanceId,
      influencingCharacterId,
      need,
      explanation: `${charName} influences ${factionName}: need roll >= ${need} (influence # ${influenceNumber}, modifier ${modifier >= 0 ? '+' : ''}${modifier}${modStr})`,
    },
    viable: true,
  }];
}

/**
 * Compute the single corruption-check action that resolves a queued
 * `corruption-check` resolution. The action carries the precomputed
 * CP, modifier, possessions list, and a human-readable explanation —
 * the same shape the legacy per-phase short-circuits used to produce.
 *
 * For transfer corruption checks, the transferred item is included in
 * both the CP total and the possessions list, even though it has already
 * physically moved to its new bearer.
 */
function corruptionCheckActions(
  state: GameState,
  playerId: PlayerId,
  top: PendingResolution,
): EvaluatedAction[] {
  if (top.kind.type !== 'corruption-check') return [];
  const { characterId, modifier, reason, transferredItemId } = top.kind;

  // Find the character on either player (corruption checks are owned by
  // the actor, but the actor may not be the active player in all cases).
  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return [];
  const player = state.players[actorIndex];
  const char = player.characters[characterId as string];
  if (!char) {
    // Character was eliminated — auto-resolve via pass.
    logDetail(`Corruption check (${reason}): character ${characterId as string} no longer in play — pass to skip`);
    return viable([{ type: 'pass', player: playerId }]);
  }

  const charDef = resolveDef(state, char.instanceId);
  const charName = isCharacterCard(charDef) ? charDef.name : '?';

  // Base CP from current effective stats
  let cp = char.effectiveStats.corruptionPoints;

  // Built-in character corruption modifier (canonical source — many character
  // defs duplicate this as a check-modifier effect, so we ignore effects on
  // the character's own definition to avoid double-counting).
  const baseModifier = isCharacterCard(charDef) ? charDef.corruptionModifier : 0;

  // The producing effect's own modifier (e.g. Barrow-wight's -2)
  let totalModifier = baseModifier + modifier;

  // Add one-shot `check-modifier` constraints targeting this character and
  // keyed to corruption checks (e.g. Halfling Strength +4). Generic enough
  // that any future card granting a one-shot corruption / influence / other
  // check bonus reuses the same constraint machinery.
  for (const constraint of state.activeConstraints) {
    if (constraint.kind.type !== 'check-modifier') continue;
    if (constraint.kind.check !== 'corruption') continue;
    if (constraint.target.kind !== 'character') continue;
    if (constraint.target.characterId !== characterId) continue;
    totalModifier += constraint.kind.value;
    logDetail(`One-shot check-modifier ${constraint.kind.value >= 0 ? '+' : ''}${constraint.kind.value} from constraint ${constraint.id}`);
  }

  // Build possessions list. For transfer checks, the item physically lives
  // on the new bearer but is counted on the original character for this check.
  const possessions: CardInstanceId[] = [
    ...(transferredItemId ? [transferredItemId] : []),
    ...char.items.map(i => i.instanceId),
    ...char.allies.map(a => a.instanceId),
    ...char.hazards.map(h => h.instanceId),
  ];

  // For transfer checks, also count the transferred item's CP toward the total
  if (transferredItemId) {
    const transferredDefId = resolveInstanceId(state, transferredItemId);
    const transferredDef = transferredDefId ? state.cardPool[transferredDefId as string] : undefined;
    if (transferredDef && 'corruptionPoints' in transferredDef) {
      cp += (transferredDef as { corruptionPoints: number }).corruptionPoints;
    }
  }

  const ccNeed = cp + 1 - totalModifier;
  const parts = [`CP ${cp}`];
  if (totalModifier !== 0) parts.push(`modifier ${totalModifier >= 0 ? '+' : ''}${totalModifier}`);
  logDetail(`Pending corruption check for ${charName} (${reason}: CP ${cp}, modifier ${totalModifier >= 0 ? '+' : ''}${totalModifier}, ${possessions.length} possession(s))`);

  const rollAction: EvaluatedAction = {
    action: {
      type: 'corruption-check',
      player: playerId,
      characterId,
      corruptionPoints: cp,
      corruptionModifier: totalModifier,
      possessions,
      need: ccNeed,
      explanation: `${reason}: need roll > ${cp - totalModifier} (${parts.join(', ')})`,
    },
    viable: true,
  };

  // Scan the actor's hand for reactive short-event plays whose DSL
  // declares itself relevant to this corruption check. Halfling Strength's
  // `corruption-check-boost` option matches here via
  // `when: { "pending.corruptionCheckTargetsMe": true }` evaluated against
  // the per-candidate context built from the resolving character. Playing
  // one of these emits a constraint that the roll action re-reads on the
  // next legal-action cycle, so the reactive play → roll sequence is a
  // normal two-action flow.
  const reactivePlays = reactiveCorruptionCheckPlays(state, playerId, char);
  if (reactivePlays.length > 0) {
    return [rollAction, ...reactivePlays];
  }
  return [rollAction];
}

/**
 * Enumerates `play-short-event` actions the actor can take during a
 * pending corruption-check resolution. Scans the actor's hand for short
 * event cards whose DSL declares itself relevant to this check:
 *
 *   1. The card declares a `play-target` with `target: "character"` and
 *      a `filter` that matches the resolving character.
 *   2. The card has at least one `play-option` whose `when` condition is
 *      satisfied by the per-candidate context built from the resolving
 *      character (notably `pending.corruptionCheckTargetsMe === true`).
 *
 * One action is emitted per eligible (card, option) pair. The reducer
 * handles the play via the normal `play-short-event` path; the chosen
 * option's `apply` clause runs through the generic dispatcher. No
 * per-card branches.
 */
function reactiveCorruptionCheckPlays(
  state: GameState,
  playerId: PlayerId,
  targetChar: import('../../index.js').CharacterInPlay,
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const actorIndex = state.players.findIndex(p => p.id === playerId);
  if (actorIndex === -1) return actions;
  const player = state.players[actorIndex];

  const ctx = buildPlayOptionContext(state, targetChar, player);

  for (const handCard of player.hand) {
    const def = state.cardPool[handCard.definitionId as string];
    if (!def || def.cardType !== 'hero-resource-event') continue;
    const shortDef = def;
    if (shortDef.eventType !== 'short') continue;
    const effects = shortDef.effects;
    if (!effects) continue;

    const playTarget = effects.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (!playTarget || playTarget.target !== 'character') continue;
    if (playTarget.filter && !matchesCondition(playTarget.filter, ctx)) continue;

    const options = effects.filter(
      (e): e is PlayOptionEffect => e.type === 'play-option',
    );
    for (const opt of options) {
      if (opt.when && !matchesCondition(opt.when, ctx)) continue;
      logDetail(`Reactive corruption-check play available: ${shortDef.name} option "${opt.id}" on ${targetChar.instanceId as string}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId: handCard.instanceId,
          targetCharacterId: targetChar.instanceId,
          optionId: opt.id,
        },
        viable: true,
      });
    }
  }

  return actions;
}

/**
 * Filter the per-phase legal actions through every active constraint.
 * Each constraint kind decides for itself whether the player's current
 * action computation is in its scope; cross-player constraints (e.g.
 * Stealth filtering the hazard player's plays) work transparently.
 *
 * Initially a pass-through; constraint kinds are added one at a time
 * during the cert steps.
 */
export function applyConstraints(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
): EvaluatedAction[] {
  if (state.activeConstraints.length === 0) return base;

  let result = base;
  for (const c of state.activeConstraints) {
    result = applyOneConstraint(state, _playerId, result, c);
  }
  return result;
}

function applyOneConstraint(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  switch (constraint.kind.type) {
    case 'site-phase-do-nothing':
      return applySitePhaseDoNothing(state, playerId, base, constraint);
    case 'no-creature-hazards-on-company':
      return applyNoCreatureHazardsOnCompany(state, playerId, base, constraint);
    case 'check-modifier':
      return base;
    case 'deny-scout-resources':
      return applyDenyScoutResources(state, playerId, base, constraint);
    case 'auto-attack-prowess-boost':
    case 'site-type-override':
    case 'region-type-override':
      // Consulted directly by the combat / keying code paths — no
      // legal-action filtering needed here.
      return base;
  }
}

/**
 * Find the active company for the given player in the current site or
 * MH phase. Returns null if the phase has no active company concept or
 * the constraint's target is not the active company.
 */
function activeCompanyId(state: GameState): CompanyId | null {
  const ps = state.phaseState;
  if (ps.phase === Phase.Site) {
    const sps = ps;
    if (state.activePlayer === null) return null;
    const player = state.players.find(p => p.id === state.activePlayer);
    if (!player) return null;
    return player.companies[sps.activeCompanyIndex]?.id ?? null;
  }
  if (ps.phase === Phase.MovementHazard) {
    const mps = ps;
    if (state.activePlayer === null) return null;
    const player = state.players.find(p => p.id === state.activePlayer);
    if (!player) return null;
    return player.companies[mps.activeCompanyIndex]?.id ?? null;
  }
  return null;
}

/**
 * Lost in Free-domains / River constraint: during the affected company's
 * `enter-or-skip` step, drop every legal action except `pass`. When the
 * constraint declares a `cancelWhen` DSL condition, each character in
 * the target company whose attributes satisfy the condition gets a
 * `cancel-constraint` action added back — tapping that character
 * cancels the constraint and frees the company to act normally.
 *
 * Implementation note (River): the card text says the ranger may cancel
 * "even at the start of his company's site phase" — tightening the
 * first-action timing is tracked in a follow-up PR.
 */
function applySitePhaseDoNothing(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (constraint.kind.type !== 'site-phase-do-nothing') return base;
  if (state.phaseState.phase !== Phase.Site) return base;
  const sps = state.phaseState;
  if (sps.step !== 'enter-or-skip') return base;
  if (state.activePlayer !== playerId) return base;
  const targetCompanyId = constraint.target.companyId;
  if (activeCompanyId(state) !== targetCompanyId) return base;

  logDetail(`Constraint ${constraint.id as string} (site-phase-do-nothing): collapsing to pass for company ${targetCompanyId as string}`);
  const filtered = base.filter(ea => ea.action.type === 'pass');

  const cancelWhen = constraint.kind.cancelWhen;
  if (!cancelWhen) return filtered;

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return filtered;
  const player = state.players[playerIndex];
  const constraintCompany = player.companies.find(c => c.id === targetCompanyId);
  if (!constraintCompany) return filtered;

  for (const charId of constraintCompany.characters) {
    const char = player.characters[charId as string];
    if (!char) continue;
    const def = resolveDef(state, char.instanceId);
    if (!isCharacterCard(def)) continue;
    const statusStr = char.status === CardStatus.Untapped ? 'untapped'
      : char.status === CardStatus.Tapped ? 'tapped'
      : 'inverted';
    const ctx = {
      actor: {
        name: def.name,
        race: def.race,
        skills: def.skills,
        status: statusStr,
      },
    };
    if (!matchesCondition(cancelWhen, ctx)) continue;
    logDetail(`Constraint ${constraint.id as string} (cancelWhen): offering cancel-constraint on ${def.name}`);
    filtered.push({
      action: {
        type: 'activate-granted-action',
        player: playerId,
        characterId: char.instanceId,
        sourceCardId: constraint.source,
        sourceCardDefinitionId: constraint.sourceDefinitionId,
        actionId: 'cancel-constraint',
        rollThreshold: 0,
      },
      viable: true,
    });
  }
  return filtered;
}

/**
 * Stealth constraint: drop every play-hazard / place-on-guard action
 * whose target company matches the constraint's target *and* whose card
 * is a hazard creature. Other hazard categories and creature plays
 * against other companies are unaffected.
 */
function applyNoCreatureHazardsOnCompany(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  const protectedCompany = constraint.target.companyId;

  return base.filter(ea => {
    if (ea.action.type !== 'play-hazard') return true;
    const targetCompanyId = (ea.action as { targetCompanyId?: CompanyId }).targetCompanyId;
    if (targetCompanyId !== protectedCompany) return true;
    // Check whether the played card is a hazard creature
    const cardInstId = (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!cardInstId) return true;
    const defId = resolveInstanceId(state, cardInstId);
    const def = defId ? state.cardPool[defId as string] : undefined;
    if (!def || def.cardType !== 'hazard-creature') return true;
    logDetail(`Constraint ${constraint.id as string} (no-creature-hazards-on-company): dropping creature play "${def.name}" against protected company ${protectedCompany as string}`);
    return false;
  });
}

/**
 * Check whether a card's effects reference the scout skill as a requirement.
 * Covers `cancel-attack` with `requiredSkill: "scout"` and `play-target`
 * with a filter that includes `target.skills: { "$includes": "scout" }`.
 */
function requiresScout(effects: readonly CardEffect[]): boolean {
  return effects.some(e => {
    if (e.type === 'cancel-attack' && 'requiredSkill' in e && e.requiredSkill === 'scout') return true;
    if (e.type === 'play-target' && e.filter) {
      const json = JSON.stringify(e.filter);
      if (json.includes('"scout"') && json.includes('skills')) return true;
    }
    return false;
  });
}

/**
 * Little Snuffler constraint: when the creature's attack is not defeated,
 * resources that require a scout in the target company cannot be played
 * for the rest of the turn. Drops play-short-event and play-permanent-event
 * actions whose card definition has scout-requiring effects.
 */
function applyDenyScoutResources(
  state: GameState,
  _playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (state.phaseState.phase !== Phase.Site) return base;
  const targetCompanyId = constraint.target.companyId;
  if (activeCompanyId(state) !== targetCompanyId) return base;

  return base.filter(ea => {
    const actionType = ea.action.type;
    if (actionType !== 'play-short-event' && actionType !== 'play-permanent-event') return true;
    const cardInstId = (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId;
    if (!cardInstId) return true;
    const defId = resolveInstanceId(state, cardInstId);
    const def = defId ? state.cardPool[defId as string] : undefined;
    if (!def || !('effects' in def) || !def.effects) return true;
    if (!requiresScout(def.effects)) return true;
    logDetail(`Constraint ${constraint.id as string} (deny-scout-resources): dropping "${def.name}" — requires scout`);
    return false;
  });
}
