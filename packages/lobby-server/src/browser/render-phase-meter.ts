/**
 * @module render-phase-meter
 *
 * Renders the "thermometer" phase progress meter at the top of the visual
 * board. The meter has two tiers:
 *
 *  - **Phase track** — the six phases of a normal turn (Untap → Organization
 *    → Long-event → Movement/Hazard → Site → End-of-Turn) shown as segments.
 *    Past phases are filled, the current phase is highlighted, upcoming
 *    phases are dim. During pre-game Setup the track shows the setup steps
 *    instead; FreeCouncil / GameOver collapse to a single segment.
 *  - **Sub-phase track** — segments for the sub-steps of the current phase.
 *    For Movement/Hazard and Site each *company* of the active player gets
 *    its own segment (handled = done, active = current, pending = dim), so
 *    progress through the per-company resolution is explicit.
 *
 * A breadcrumb label above the tracks names the phase including its current
 * sub-phase, e.g. "Movement/Hazard › Gandalf's company › Play hazards".
 */

import type { PlayerView } from '@meccg/shared';
import { Phase, PHASE_ORDER } from '@meccg/shared';
import { cardPool } from './app-state.js';
import { getTargetingInstruction } from './render-selection-state.js';
import { REGION_ICON_CODES } from './render-text-format.js';

/**
 * Look up a region's printed terrain type by name from the card pool.
 * `resolvedSitePathNames` and `resolvedSitePath` are only index-parallel for
 * region movement — for starter (haven-to-haven/haven-to-site) movement,
 * `resolvedSitePathNames` holds just the origin/destination region names
 * while `resolvedSitePath` holds the full printed site-path legs between
 * them, so the two arrays can differ in length (see
 * `engine/region-keying.ts` and `mh-steps.ts` `handleRevealNewSite`).
 * Resolving each name's own region card avoids pairing a name with the
 * wrong leg of that longer path.
 */
function findRegionType(name: string): string | undefined {
  for (const def of Object.values(cardPool)) {
    if (def.cardType === 'region' && def.name === name) return def.regionType;
  }
  return undefined;
}

/**
 * Build a compact movement-path readout (region names + type icons) for the
 * company currently being resolved, sourced from the Movement/Hazard phase
 * state. Used to show the opponent's path while they move — the on-board
 * visual path (company-site.ts) only renders for the viewer's own companies.
 * Returns null if the active company is not moving.
 */
export function buildMovementPathHtml(
  mh: { resolvedSitePathNames?: readonly string[] },
): string | null {
  const names = mh.resolvedSitePathNames ?? [];
  if (names.length === 0) return null;
  const parts: string[] = [];
  for (const name of names) {
    const type = findRegionType(name);
    const code = REGION_ICON_CODES[type ?? ''];
    const icon = code
      ? `<img src="/images/regions/${code}.png" alt="${type}" width="22" height="22" style="vertical-align:middle;position:relative;top:-3px">`
      : '';
    parts.push(`${name} ${icon}`);
  }
  return parts.join(' ');
}

/** Visual state of a single segment in either track. */
type SegmentState = 'done' | 'current' | 'upcoming';

/** A segment shown in the phase or sub-phase track. */
interface Segment {
  /** Human-readable label rendered inside / under the segment. */
  readonly label: string;
  /** Progress state controlling the fill colour. */
  readonly state: SegmentState;
  /**
   * Optional sub-step progress for this segment, rendered as a row of
   * `total` cells divided by vertical bars and filled left-to-right up to
   * `filled`. Used for the per-company segments in the Movement/Hazard and
   * Site sub-tracks so each company doubles as a sub-step progress bar.
   */
  readonly substeps?: { readonly total: number; readonly filled: number };
}

/**
 * Display labels for all phases. Exported for reuse by the toolbar status
 * readout (`render-toolbar-status.ts`) so it names phases the same way the
 * phase meter does, instead of duplicating the mapping.
 */
export const PHASE_LABELS: Readonly<Record<string, string>> = {
  [Phase.Untap]: 'Untap',
  [Phase.Organization]: 'Organization',
  [Phase.LongEvent]: 'Long-event',
  [Phase.MovementHazard]: 'Movement/Hazard',
  [Phase.Site]: 'Site',
  [Phase.EndOfTurn]: 'End of Turn',
  [Phase.Setup]: 'Setup',
  [Phase.FreeCouncil]: 'Free Council',
  [Phase.GameOver]: 'Game Over',
};

/** Ordered setup steps with display labels (used when the meter is in setup mode). */
const SETUP_STEPS: ReadonlyArray<readonly [string, string]> = [
  ['character-draft', 'Char Draft'],
  ['item-draft', 'Items'],
  ['character-deck-draft', 'Deck Draft'],
  ['starting-site-selection', 'Sites'],
  ['character-placement', 'Placement'],
  ['deck-shuffle', 'Shuffle'],
  ['initial-draw', 'Draw'],
  ['initiative-roll', 'Initiative'],
];

/** Friendly label for each Movement/Hazard sub-step. */
const MH_STEP_LABELS: Readonly<Record<string, string>> = {
  'select-company': 'Select company',
  'reveal-new-site': 'Reveal site',
  'under-deeps-roll': 'Under-deeps roll',
  'set-hazard-limit': 'Hazard limit',
  'order-effects': 'Order effects',
  'draw-cards': 'Draw cards',
  'play-hazards': 'Play hazards',
  'reset-hand': 'Reset hand',
};

/** Friendly label for each Site sub-step. */
const SITE_STEP_LABELS: Readonly<Record<string, string>> = {
  'select-company': 'Select company',
  'enter-or-skip': 'Enter or skip',
  'reveal-on-guard-attacks': 'Reveal on-guard',
  'forewarned-select-attack': 'Forewarned',
  'play-site-auto-attack': 'Site auto-attack',
  'automatic-attacks': 'Automatic attacks',
  'declare-agent-attack': 'Agent attack',
  'resolve-attacks': 'Resolve attacks',
  'play-resources': 'Play resources',
  'play-minor-item': 'Minor item',
  'declare-company-attack': 'Company attack',
};

/**
 * Ordered Movement/Hazard sub-steps a single company progresses through.
 * Drives the per-company sub-step progress bar (the `select-company` step
 * is excluded — no company is active yet during it).
 */
const MH_PROGRESS_STEPS: readonly string[] = [
  'reveal-new-site',
  'under-deeps-roll',
  'set-hazard-limit',
  'order-effects',
  'draw-cards',
  'play-hazards',
  'reset-hand',
];

/**
 * Ordered Site sub-steps a single company progresses through.
 * Drives the per-company sub-step progress bar (the `select-company` step
 * is excluded — no company is active yet during it).
 */
const SITE_PROGRESS_STEPS: readonly string[] = [
  'enter-or-skip',
  'reveal-on-guard-attacks',
  'forewarned-select-attack',
  'play-site-auto-attack',
  'automatic-attacks',
  'declare-agent-attack',
  'resolve-attacks',
  'play-resources',
  'play-minor-item',
  'declare-company-attack',
];

/** Friendly label for each End-of-Turn sub-step. */
const END_OF_TURN_STEP_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['discard', 'Discard'],
  ['reset-hand', 'Reset hand'],
  ['signal-end', 'Signal end'],
];

/** Compute the done/current/upcoming state for an item at `index` relative to `currentIndex`. */
function stateFor(index: number, currentIndex: number): SegmentState {
  if (index < currentIndex) return 'done';
  if (index === currentIndex) return 'current';
  return 'upcoming';
}

/** Build the top-tier phase track segments and the index of the current phase. */
function buildPhaseTrack(view: PlayerView): { segments: Segment[]; phaseLabel: string } {
  const phase = view.phaseState.phase;

  // Pre-game setup: the track shows setup steps instead of turn phases.
  if (phase === Phase.Setup) {
    const currentStep = view.phaseState.setupStep.step;
    const currentIndex = SETUP_STEPS.findIndex(([key]) => key === currentStep);
    const segments = SETUP_STEPS.map(([, label], i) => ({
      label,
      state: stateFor(i, currentIndex),
    }));
    return { segments, phaseLabel: 'Setup' };
  }

  // Endgame phases collapse to a single highlighted segment.
  if (phase === Phase.FreeCouncil) {
    return { segments: [{ label: 'Free Council', state: 'current' }], phaseLabel: 'Free Council' };
  }
  if (phase === Phase.GameOver) {
    return { segments: [{ label: 'Game Over', state: 'current' }], phaseLabel: 'Game Over' };
  }

  // Normal turn: the six-phase track.
  const currentIndex = PHASE_ORDER.indexOf(phase);
  const segments = PHASE_ORDER.map((p, i) => ({
    label: PHASE_LABELS[p] ?? p,
    state: stateFor(i, currentIndex),
  }));
  return { segments, phaseLabel: PHASE_LABELS[phase] ?? phase };
}

/**
 * Build per-company sub-phase segments for the Movement/Hazard or Site phase.
 * Each of the active player's companies becomes one segment: handled companies
 * are done, the company at `activeCompanyIndex` is current (unless we are still
 * choosing a company), and the rest are upcoming. Returns the segments plus the
 * name of the active company (for the breadcrumb), if any.
 */
function buildCompanyTrack(
  view: PlayerView,
  activeCompanyIndex: number,
  handledCompanyIds: readonly string[],
  choosingCompany: boolean,
  companyNames: Readonly<Record<string, string>>,
  progressSteps: readonly string[],
  currentStep: string,
): { segments: Segment[]; activeCompanyName: string | null } {
  const active = view.activePlayer;
  const companies = active === view.self.id ? view.self.companies : view.opponent.companies;
  const handled = new Set(handledCompanyIds.map(String));

  const total = progressSteps.length;
  // How far the active company has progressed through the phase's sub-steps.
  // Steps outside the canonical list (e.g. select-company) clamp to the start.
  const stepIndex = progressSteps.indexOf(currentStep);
  const activeFilled = stepIndex < 0 ? 0 : Math.min(stepIndex + 1, total);

  let activeCompanyName: string | null = null;
  const segments = companies.map((company, i) => {
    const id = company.id as string;
    const fullName = companyNames[id];
    const label = fullName ?? `Co. ${i + 1}`;
    let state: SegmentState;
    let filled: number;
    if (handled.has(id)) {
      state = 'done';
      filled = total; // completed company: all sub-steps filled
    } else if (!choosingCompany && i === activeCompanyIndex) {
      state = 'current';
      activeCompanyName = label;
      filled = activeFilled; // active company: filled up to the current sub-step
    } else {
      state = 'upcoming';
      filled = 0; // not yet reached
    }
    return { label, state, substeps: { total, filled } };
  });
  return { segments, activeCompanyName };
}

/** Build simple ordered sub-step segments from a list of [key,label] pairs. */
function buildStepTrack(
  steps: ReadonlyArray<readonly [string, string]>,
  currentStep: string,
): Segment[] {
  const currentIndex = steps.findIndex(([key]) => key === currentStep);
  return steps.map(([, label], i) => ({ label, state: stateFor(i, currentIndex) }));
}

/**
 * Build the bottom-tier sub-phase track and the breadcrumb sub-label.
 * Returns null segments for phases with no meaningful sub-steps.
 */
function buildSubTrack(
  view: PlayerView,
  companyNames: Readonly<Record<string, string>>,
): { segments: Segment[]; subLabel: string | null } {
  const ps = view.phaseState;

  if (ps.phase === Phase.MovementHazard) {
    const choosing = ps.step === 'select-company';
    const { segments, activeCompanyName } = buildCompanyTrack(
      view, ps.activeCompanyIndex, ps.handledCompanyIds as readonly string[], choosing, companyNames,
      MH_PROGRESS_STEPS, ps.step,
    );
    const stepLabel = MH_STEP_LABELS[ps.step] ?? ps.step;
    const subLabel = activeCompanyName ? `${activeCompanyName} › ${stepLabel}` : stepLabel;
    return { segments, subLabel };
  }

  if (ps.phase === Phase.Site) {
    const choosing = ps.step === 'select-company';
    const { segments, activeCompanyName } = buildCompanyTrack(
      view, ps.activeCompanyIndex, ps.handledCompanyIds as readonly string[], choosing, companyNames,
      SITE_PROGRESS_STEPS, ps.step,
    );
    const stepLabel = SITE_STEP_LABELS[ps.step] ?? ps.step;
    const subLabel = activeCompanyName ? `${activeCompanyName} › ${stepLabel}` : stepLabel;
    return { segments, subLabel };
  }

  if (ps.phase === Phase.EndOfTurn) {
    const segments = buildStepTrack(END_OF_TURN_STEP_LABELS, ps.step);
    const current = END_OF_TURN_STEP_LABELS.find(([key]) => key === ps.step);
    return { segments, subLabel: current ? current[1] : null };
  }

  // Untap / Organization / Long-event / Setup / endgame have no per-step track.
  return { segments: [], subLabel: null };
}

/**
 * Build the inner sub-step progress bar for a company segment: `total` cells
 * separated by vertical bars, the first `filled` of them coloured in.
 */
function renderSubstepBar(substeps: { total: number; filled: number }): string {
  if (substeps.total <= 0) return '';
  let cells = '';
  for (let i = 0; i < substeps.total; i++) {
    const on = i < substeps.filled ? ' substep-cell--on' : '';
    cells += `<span class="substep-cell${on}"></span>`;
  }
  return `<div class="substep-bar">${cells}</div>`;
}

/** Render a track of segments into an HTML string. */
function renderTrack(segments: Segment[], extraClass: string): string {
  const cells = segments
    .map(seg => {
      const safe = seg.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const sub = seg.substeps;
      const bar = sub && sub.total > 0 ? renderSubstepBar(sub) : '';
      const subClass = sub && sub.total > 0 ? ' phase-seg--hassub' : '';
      return `<div class="phase-seg phase-seg--${seg.state}${subClass}" title="${safe}">${bar}<span class="phase-seg-label">${safe}</span></div>`;
    })
    .join('');
  return `<div class="phase-track ${extraClass}">${cells}</div>`;
}

/**
 * Render the phase progress meter for the current view.
 *
 * @param view         the current player view
 * @param companyNames map from company id to display name (built by the caller)
 */
export function renderPhaseMeter(
  view: PlayerView,
  companyNames: Readonly<Record<string, string>>,
): void {
  const container = document.getElementById('phase-meter');
  // The body holds the breadcrumb + tracks. Live targeting hints (set via
  // setTargetingInstruction during two-step selections) render into the
  // #phase-target-hint span appended to the breadcrumb below.
  const el = document.getElementById('phase-meter-body');
  if (!container || !el) return;

  const { segments: phaseSegments, phaseLabel } = buildPhaseTrack(view);
  const { segments: subSegments, subLabel } = buildSubTrack(view, companyNames);

  const breadcrumb = subLabel ? `${phaseLabel} › ${subLabel}` : phaseLabel;
  const safeCrumb = breadcrumb.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let html = `<div class="phase-meter-label">${safeCrumb}<span id="phase-target-hint" class="phase-target-hint"></span></div>`;

  // While the opponent moves, show their company's movement path here — the
  // on-board visual path renders only for the viewer's own companies, so this
  // is the only place a defender can see where the active company is heading.
  if (view.phaseState.phase === Phase.MovementHazard && view.activePlayer !== view.self.id) {
    const path = buildMovementPathHtml(view.phaseState);
    if (path) html += `<div class="phase-meter-path">${path}</div>`;
  }
  html += renderTrack(phaseSegments, 'phase-track--phases');
  if (subSegments.length > 0) {
    html += renderTrack(subSegments, 'phase-track--sub');
  }
  el.innerHTML = html;

  // Re-apply any active targeting hint (the body innerHTML above replaced the
  // span). setTargetingInstruction updates this span directly during clicks.
  const hint = getTargetingInstruction();
  const hintEl = document.getElementById('phase-target-hint');
  if (hintEl) hintEl.textContent = hint ? ` — ${hint}` : '';

  container.classList.remove('hidden');
}
