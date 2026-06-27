/**
 * @module draft-hidden-haven-render.test
 *
 * Regression test for rendering a drafted Hidden Haven (wh-75) paired with its
 * "brought-out" site during the character draft. CRF 22 makes the paired site
 * public, so it must render — beside the Hidden Haven — in BOTH the drafter's
 * and the opponent's board view. The opponent path is the one that regressed:
 * its site deck is otherwise redacted, so the renderer must use the one site the
 * projection un-redacts (the paired Hidden Haven site) rather than `undefined`.
 *
 * The view shapes below mirror what `projectPlayerView` actually emits for this
 * scenario — that contract is pinned independently by the game-server
 * `projection.test.ts` (opponent.siteDeck reveals the paired site). Here we feed
 * that contract to the real `renderDrafted` and assert both cards paint.
 *
 * Uses a tiny hand-rolled DOM stub (the package runs vitest in the default node
 * environment, with no jsdom) — just enough for `createElement`/`getElementById`
 * /`appendChild`/`innerHTML` as the board renderer uses them.
 */

import './test-dom-bootstrap.js'; // must precede the render-board import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { UNKNOWN_CARD, loadCardPool } from '@meccg/shared';
import type { PlayerView, CardDefinitionId, CardInstanceId } from '@meccg/shared';
import { renderDrafted } from './render-board.js';

const pool = loadCardPool();

const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;
const BALIN = 'tw-123' as CardDefinitionId;
const WORTHY_HILLS = 'as-142' as CardDefinitionId;
const RIVENDELL = 'tw-258' as CardDefinitionId;

// Instance ids: Alice (the Fallen-wizard drafter) is players[0]; Bob is players[1].
const HH_INST = 'p1-29' as CardInstanceId;   // Alice's drafted Hidden Haven
const SITE_INST = 'p1-28' as CardInstanceId;  // Alice's paired Worthy Hills (in her site deck)
const BOB_SITE_INST = 'p2-28' as CardInstanceId;

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(): void { /* no-op */ }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let containers: Record<string, StubEl>;

beforeEach(() => {
  containers = {
    'drafted-self': new StubEl('div'),
    'drafted-opponent': new StubEl('div'),
    'set-aside': new StubEl('div'),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => containers[id] ?? null,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

// --- View fixtures ----------------------------------------------------------

const ref = (instanceId: CardInstanceId, definitionId: CardDefinitionId): { instanceId: CardInstanceId; definitionId: CardDefinitionId } =>
  ({ instanceId, definitionId });

/** Alice's drafted Hidden Haven, paired to Worthy Hills (her drafted side). */
const aliceDraft = {
  pool: [ref('p1-30' as CardInstanceId, BALIN)],
  drafted: [],
  draftedStageResources: [ref(HH_INST, HIDDEN_HAVEN)],
  stageResourceSites: [{ stageResourceInstanceId: HH_INST, siteInstanceId: SITE_INST }],
  currentPick: null,
  stopped: false,
};

/** Bob's drafted Aragorn (no stage resources). */
const bobDraft = {
  pool: [ref('p2-30' as CardInstanceId, BALIN)],
  drafted: [ref('p2-29' as CardInstanceId, ARAGORN)],
  draftedStageResources: [],
  stageResourceSites: undefined,
  currentPick: null,
  stopped: false,
};

/** A draft entry redacted as the opponent sees it (pool hidden). */
const redactedPool = [ref('px' as CardInstanceId, UNKNOWN_CARD)];

/** Build a character-draft PlayerView. Only the fields renderDrafted reads are set. */
function draftView(opts: {
  draftState: [unknown, unknown];
  selfSiteDeck: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[];
  oppSiteDeck: { instanceId: CardInstanceId; definitionId: CardDefinitionId }[];
}): PlayerView {
  return {
    self: { siteDeck: opts.selfSiteDeck, characters: {} },
    opponent: { siteDeck: opts.oppSiteDeck },
    phaseState: { phase: 'setup', setupStep: { step: 'character-draft', draftState: opts.draftState, setAside: [[], []] } },
    legalActions: [],
  } as unknown as PlayerView;
}

// --- Tests ------------------------------------------------------------------

describe('Hidden Haven paired site renders during the draft', () => {
  /** Definition IDs of every rendered card image inside a container. */
  const renderedCardIds = (container: StubEl): string[] =>
    container.all().filter(el => el.tagName === 'img' && el.dataset.cardId).map(el => el.dataset.cardId);

  test("the drafter's board shows both the Hidden Haven and its paired site", () => {
    // Alice's own view: her pool is real, Bob's is redacted -> selfIdx 0.
    const view = draftView({
      draftState: [aliceDraft, { ...bobDraft, pool: redactedPool }],
      selfSiteDeck: [ref(SITE_INST, WORTHY_HILLS)],
      oppSiteDeck: [ref(BOB_SITE_INST, RIVENDELL)],
    });
    renderDrafted(view, pool);
    const ids = renderedCardIds(containers['drafted-self']);
    expect(ids).toContain(HIDDEN_HAVEN);
    expect(ids).toContain(WORTHY_HILLS);
  });

  test("the opponent's board shows both the Hidden Haven and its paired site", () => {
    // Bob's view: his pool is real (index 1), Alice's is redacted -> selfIdx 1,
    // so Alice renders on the opponent side, using opponent.siteDeck (the
    // projection un-redacts only her brought-out site there).
    const view = draftView({
      draftState: [{ ...aliceDraft, pool: redactedPool }, bobDraft],
      selfSiteDeck: [ref(BOB_SITE_INST, RIVENDELL)],
      oppSiteDeck: [ref(SITE_INST, WORTHY_HILLS)],
    });
    renderDrafted(view, pool);
    const ids = renderedCardIds(containers['drafted-opponent']);
    expect(ids).toContain(HIDDEN_HAVEN);
    expect(ids).toContain(WORTHY_HILLS);
  });
});
