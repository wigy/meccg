/**
 * @module stage-resource-characters
 *
 * Helpers for relating a character-bound Stage resource to the drafted
 * character it is placed with.
 *
 * A `recruitment-vehicle` Stage resource (Thrall of the Voice, wh-82) is "placed
 * with a character" rather than bound to a site location: its card text reads
 * "Place this card with the character." Unlike Hidden Haven — whose site pairing
 * the player chooses explicitly (and which is stored in
 * {@link DraftPlayerState.stageResourceSites}) — the Thrall's character is chosen
 * deterministically when the draft is finalised: prefer an as-yet-unthralled
 * agent (the gate it most often lifts), then the highest-mind character.
 *
 * Both the engine (when finalising the draft) and the clients (when rendering the
 * draft board, so the Thrall hangs beside its character like a starting item
 * rather than floating in its own row) need the *same* pairing. This module is
 * the single source of truth for that rule so the displayed pairing always
 * matches the one the engine will actually apply.
 */

import type { CardDefinition } from './types/cards.js';
import { isCharacterCard } from './types/cards.js';
import type { CardDefinitionId, CardInstanceId } from './types/common.js';

/** The minimum a drafted character / Stage resource needs to be paired. */
export interface StageResourceCharacterRef {
  readonly instanceId: CardInstanceId;
  readonly definitionId: CardDefinitionId;
}

/** A resolved Thrall-of-the-Voice → character placement. */
export interface ThrallCharacterPairing {
  /** The recruitment-vehicle Stage resource (Thrall of the Voice). */
  readonly stageResourceInstanceId: CardInstanceId;
  /** The drafted character it is placed with. */
  readonly characterInstanceId: CardInstanceId;
}

/** True if `def` is an agent character (the draft gate Thrall most often lifts). */
function isAgent(def: CardDefinition | undefined): boolean {
  return isCharacterCard(def) && (def.keywords ?? []).includes('agent');
}

/** True if `def` carries a `recruitment-vehicle` effect (Thrall of the Voice). */
function isRecruitmentVehicle(def: CardDefinition | undefined): boolean {
  const effects = (def as { effects?: readonly { type: string }[] } | undefined)?.effects ?? [];
  return effects.some(e => e.type === 'recruitment-vehicle');
}

/** Mind cost of a character definition, or 0 for a mindless / non-character card. */
function mindOf(def: CardDefinition | undefined): number {
  return isCharacterCard(def) && def.mind !== null ? def.mind : 0;
}

/**
 * Pair each `recruitment-vehicle` Stage resource (Thrall of the Voice) with the
 * drafted character it is placed with. Stage resources are processed in order;
 * each consumes a distinct character, preferring an as-yet-unthralled agent and
 * otherwise the highest-mind character. A Thrall with no remaining character to
 * pair (every drafted character already carries one, or there are none) is
 * omitted — the engine keeps such a card in hand, and the client shows it
 * full-size.
 *
 * @param characters - The drafted characters, in draft order.
 * @param stageResources - The drafted Stage resources, in draft order.
 * @param lookupDef - Resolves a definition id to its card definition.
 * @returns One pairing per Thrall that found a character.
 */
export function resolveThrallCharacterPairings(
  characters: readonly StageResourceCharacterRef[],
  stageResources: readonly StageResourceCharacterRef[],
  lookupDef: (defId: CardDefinitionId) => CardDefinition | undefined,
): readonly ThrallCharacterPairing[] {
  const used = new Set<string>();
  const pairings: ThrallCharacterPairing[] = [];
  for (const sr of stageResources) {
    if (!isRecruitmentVehicle(lookupDef(sr.definitionId))) continue;
    const candidates = characters.filter(c => !used.has(c.instanceId as string));
    if (candidates.length === 0) continue;
    const agents = candidates.filter(c => isAgent(lookupDef(c.definitionId)));
    const pickFrom = agents.length > 0 ? agents : candidates;
    const target = [...pickFrom].sort(
      (a, b) => mindOf(lookupDef(b.definitionId)) - mindOf(lookupDef(a.definitionId)),
    )[0];
    used.add(target.instanceId as string);
    pairings.push({ stageResourceInstanceId: sr.instanceId, characterInstanceId: target.instanceId });
  }
  return pairings;
}
