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
import { isCharacterCard, Phase, Skill, CardStatus } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { resolveDef } from '../effects/index.js';
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
      return opponentInfluenceDefendActions(actor);
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
 */
function opponentInfluenceDefendActions(actor: PlayerId): EvaluatedAction[] {
  return [{
    action: { type: 'opponent-influence-defend', player: actor },
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
  const totalModifier = baseModifier + modifier;

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

  return [{
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
  }];
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
    case 'site-phase-do-nothing-unless-ranger-taps':
      return applySitePhaseDoNothingUnlessRanger(state, playerId, base, constraint);
    case 'no-creature-hazards-on-company':
      return applyNoCreatureHazardsOnCompany(state, playerId, base, constraint);
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
 * Lost in Free-domains constraint: during the affected company's
 * `enter-or-skip` step, drop every legal action except `pass`. The
 * resource player can then only choose to do nothing for the company.
 */
function applySitePhaseDoNothing(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (state.phaseState.phase !== Phase.Site) return base;
  const sps = state.phaseState;
  if (sps.step !== 'enter-or-skip') return base;
  if (state.activePlayer !== playerId) return base;
  if (activeCompanyId(state) !== constraint.target.companyId) return base;

  logDetail(`Constraint ${constraint.id as string} (site-phase-do-nothing): collapsing to pass for company ${constraint.target.companyId as string}`);
  return base.filter(ea => ea.action.type === 'pass');
}

/**
 * River constraint: same restriction as Lost in Free-domains, but with
 * an extra escape hatch — a ranger in the affected company may tap to
 * cancel the constraint, *only at the very first action* of the
 * company's enter-or-skip step. The cancellation action is added to the
 * legal action menu via `tap-ranger-to-cancel-river` (handled by the
 * granted-action machinery; the constraint filter only injects the
 * candidate ranger taps when applicable).
 *
 * Implementation note: the "first action" timing is not yet enforced
 * here. The legal action filter offers cancellation at every visit to
 * `enter-or-skip` while the constraint lives. Tightening this is
 * tracked in the follow-up PR for River.
 */
function applySitePhaseDoNothingUnlessRanger(
  state: GameState,
  playerId: PlayerId,
  base: EvaluatedAction[],
  constraint: ActiveConstraint,
): EvaluatedAction[] {
  if (constraint.target.kind !== 'company') return base;
  if (state.phaseState.phase !== Phase.Site) return base;
  const sps = state.phaseState;
  if (sps.step !== 'enter-or-skip') return base;
  if (state.activePlayer !== playerId) return base;
  if (activeCompanyId(state) !== constraint.target.companyId) return base;

  // Drop everything except pass.
  const filtered = base.filter(ea => ea.action.type === 'pass');

  // Add a tap-ranger-to-cancel-river action for each untapped ranger in
  // the constrained company.
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return filtered;
  const player = state.players[playerIndex];
  const targetCompanyId = constraint.target.companyId;
  const constraintCompany = player.companies.find(c => c.id === targetCompanyId);
  if (!constraintCompany) return filtered;

  // Resolve the source card's definition ID for logging / action shape.
  const sourceDefId = resolveInstanceId(state, constraint.source);
  if (!sourceDefId) return filtered;

  for (const charId of constraintCompany.characters) {
    const char = player.characters[charId as string];
    if (!char) continue;
    if (char.status !== CardStatus.Untapped) continue;
    const def = resolveDef(state, char.instanceId);
    if (!isCharacterCard(def)) continue;
    if (!def.skills.includes(Skill.Ranger)) continue;
    logDetail(`Constraint ${constraint.id as string} (river): offering tap-ranger-to-cancel-river on ${def.name}`);
    filtered.push({
      action: {
        type: 'activate-granted-action',
        player: playerId,
        characterId: char.instanceId,
        sourceCardId: constraint.source,
        sourceCardDefinitionId: sourceDefId,
        actionId: 'tap-ranger-to-cancel-river',
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
