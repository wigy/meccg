# Agents Implementation Plan

**Status:** Draft proposal — not yet implemented.
**Scope:** CoE rules §4 (Agents) and §1.3.R2 / §1.3.W2 / §1.3.F4 / §1.3.B2
(alignment-specific agent deck-building rules). Closes the `Agents` EPIC in
`TODO.md` and the `Dark Minions: Agents` bullet in `specs/roadmap.md`.

An agent is a character card that, instead of (or in addition to) being played
into a company, can be played by the hazard player as a free-roaming hazard.
The agent drags its own site along with it, moves around the map during the
opponent's M/H phase, can attack companies at its site, and can key creatures
to that site. For the rest of this doc, "agent" means "agent played as a
hazard" unless stated otherwise.

The nine `test.todo()` files under
`packages/shared/src/tests/rules/09-agents-events-items/rule-9.0[1-8]*` already
enumerate the rules — this plan fills in everything needed to turn those tests
into real tests.

## 1. What already exists

- `AttackSource` has an `'agent'` variant (`types/state-combat.ts:35`).
- The site phase has a `'declare-agent-attack'` step with a
  `DeclareAgentAttackAction` plumbed through the reducer and legal-action
  computer (but the step currently only passes — no agents exist to declare).
- `computeLegalActions` in M/H has a `'select-company'` step and
  `SelectCompanyAction`. The all-companies view already highlights selectable
  companies and routes clicks to that action (`company-views.ts:178-204`).
- The site pile browser already supports "pick a site from the deck with legal
  destinations highlighted" for normal company movement
  (`openMovementViewer` in `render-piles.ts:522`).

We can reuse all four of these.

## 2. Gaps

1. No way to mark a card as an agent. Neither our `CharacterCard` interfaces
   nor the upstream `data/cards.json` carry an explicit agent flag.
2. No state shape for an agent in play: it is neither a `CharacterInPlay` (it
   is not in a `Company`) nor a `CardInPlay` (it has a site and moves).
3. No "play agent as hazard" action; no agent actions during opponent M/H.
4. No face-down site stack — the rules require tracking every site the agent
   has moved through while face-down, in order.
5. UI: agents are not rendered anywhere; `select-company` targeting assumes
   the company list is `view.self.companies` / `view.opponent.companies`.

## 3. Approach — "agent is a virtual company"

Per CoE §4 intro *"an agent is a special type of hazard that acts like its own
company, moving around the map"* — we model it exactly that way. An agent in
play is a `Company`-shaped record with a single character, living in a new
`agentCompanies` list on the owning player. This lets the existing
select-company, site-phase, and combat plumbing reuse the same code paths with
the smallest possible divergence.

### 3.1 Data model changes

**Card definition — character cards (`cards-characters.ts`):**

Add to both `HeroCharacterCard` and `MinionCharacterCard`:

```ts
/**
 * True for character cards that the rules designate as agents.
 * Wizard/Balrog players may only use these as hazards; Ringwraith/Fallen-wizard
 * players may play them as either a character or a hazard (§1.3.R2/F4).
 */
readonly isAgent?: boolean;
```

Upstream `data/cards.json` does not have this flag; we hand-maintain the list
in our local data files. Every card-certify pass for an agent must set
`isAgent: true`. Discovery task (one-off): scan GCCG / CoE errata for the
canonical agent list and seed `isAgent: true` on those character entries in
`packages/shared/src/data/*-characters.json`.

**New state — per-player `AgentInPlay`:**

New file `packages/shared/src/types/state-agents.ts`:

```ts
export interface AgentInPlay {
  /** Identity of the agent as its own tiny "company". Reuses CompanyId
   *  so `select-company` actions can point to it without a discriminator. */
  readonly id: CompanyId;
  /** The agent character instance (lives here, not in `player.characters`). */
  readonly character: CharacterInPlay;
  /** Whether the agent is face-up (revealed) or face-down. */
  readonly revealed: boolean;
  /**
   * Stack of sites the agent has been placed with, oldest first.
   * - Face-up: exactly one entry, the agent's current site (also in play).
   * - Face-down: one or more entries; only the top (last) is the current site.
   * Entries are SiteInPlay so their definitionId survives even while the
   *   player side treats them as "not in play" (rules 4.2.1).
   */
  readonly siteStack: readonly SiteInPlay[];
  /** True once the agent takes an action this turn (one action per turn). */
  readonly actedThisTurn: boolean;
  /** True if the agent was in play at the start of the current turn;
   *  required to take an agent action (rule 4.1). */
  readonly inPlayAtTurnStart: boolean;
  /** True if an agent-hazard attack has been used this site phase at this
   *  site (rule 2.V.iii.1 — once per site phase). */
  readonly attackedThisSitePhase: boolean;
}
```

**`PlayerState`:** add

```ts
readonly agents: readonly AgentInPlay[];
```

Agent characters while face-down are **not** in `players[n].characters` —
otherwise general-influence accounting, followers, and opponent-influence
machinery all try to treat them as normal characters. `player.characters` is
for company-member characters only. Any code that iterates all of a player's
characters (stat recomputation, MP totals, corruption check modifiers) gets an
explicit `includeAgents` boolean; default `false`.

**Non-duplication invariant:** The same agent instance never appears in both
`agents[]` and `characters{}`. A Ringwraith or Fallen-wizard who plays an
agent as a character puts it in `characters{}`; as a hazard, it goes in
`agents[]`. Illegal to move between the two after play.

### 3.2 Selecting among agents in the all-companies view

The user's request: *"during your hazard phase, arrows for selecting company
should be visible so that you can select agent"*.

Today `renderAllCompaniesView` renders the hazard player's companies from
`view.opponent.companies` only when no targeting is active. The fix:

1. `PlayerView.opponent` gains `agents: readonly OpponentAgentView[]`, mirroring
   a pared-down `Company` shape (a single character slot + current site +
   face-down indicator). The projection redacts face-down agent identity: the
   resource player sees "face-down agent at unknown site" until revealed.
2. When the active M/H-phase player is *you* (i.e. it is your opponent's
   hazard turn), `computeLegalActions` adds `SelectCompanyAction` entries for
   each of *your* agents that can still act this turn (`actedThisTurn = false
   && inPlayAtTurnStart = true`). `SelectCompanyAction.companyId` is the
   agent's `id`, reusing the existing handler.
3. `renderAllCompaniesView` loops over `view.self.agents` in addition to
   `view.self.companies` when `selectCompanyActions.size > 0`, rendering an
   agent block that looks like a one-character company. Selectable agents get
   the `company-block--target` class exactly like a regular company.
4. Single-company view's left/right arrows cycle through
   `[...companies, ...agents]` concatenated, so the user can page through
   agents the same way as companies during their own hazard phase.

No new action type is needed for "select the agent" — the existing
`SelectCompanyAction` targets the agent's `CompanyId`.

### 3.3 Rendering an agent and its site stack

The user's request: *"when not revealed, display collected site cards with
little offsets toward left from the current site card"*.

`renderCompanyBlock` (`company-block.ts`) renders one `SiteInPlay`. A new
`renderAgentBlock` variant:

- One character card on top (face-down image `/images/card-back.jpg` if
  `revealed = false`, otherwise the normal front).
- Current site card on the right of the block, same slot as
  `renderCompanyBlock` puts `currentSite`.
- If `siteStack.length > 1` and the agent is face-down, render each earlier
  site card *offset to the left* of the current site in a small fan
  (e.g. `margin-left: -80px` per card, decreasing z-index), showing only their
  backs. This gives the "stack of face-down sites the agent has walked
  through" look the user described.
- If revealed, `siteStack.length` is always 1 and no fan is shown.

The opponent view shows face-down agents as `revealed = false`, card count
derived from the projected stack length (sites themselves are hidden).

### 3.4 Playing an agent from hand

The user's request: *"playing agent from hand creates automatically new virtual
company"*.

New action (in `actions-movement-hazard.ts`):

```ts
export interface PlayAgentHazardAction {
  readonly type: 'play-agent-hazard';
  readonly playerId: PlayerId;
  readonly agentCardInstanceId: CardInstanceId;
  /** Home site chosen from the player's location deck — required by rule
   *  2.IV.vii.1 only when revealing, but we pick one eagerly so the site
   *  stack is never empty. Sent face-down; not in play until revealed. */
  readonly homeSiteInstanceId: CardInstanceId;
}
```

Legal during one's own hazard step (`play-hazards`) in the opponent's M/H
phase. Counts 1 against the hazard limit (rule 2.IV.vii.1). Reducer:

1. Pick the agent character from hand.
2. Pick the chosen home site from the player's site deck (hidden; stays
   hidden while agent is face-down).
3. Build a new `AgentInPlay` with `revealed: false`, `siteStack: [site]`,
   `actedThisTurn: false`, `inPlayAtTurnStart: false`. (A freshly-played
   agent **cannot** act on the turn it was played — rule 4.1. The
   `inPlayAtTurnStart` flag flips to `true` during the next untap reducer.)
4. Insert into `players[hazardPlayer].agents`.

The home site must be one of the agent card's `homesite` values; if the card
lists multiple (e.g. "Any non-Under-deeps Ruins & Lairs"), legal-action
computation emits one `play-agent-hazard` per viable site instance. No new
"virtual company creation" code path — the `AgentInPlay` constructor *is* the
virtual company.

### 3.5 Agent actions during opponent's M/H phase

New sub-step in `MovementHazardPhaseState.step` — **not** a new top-level
step; it lives inside `play-hazards` exactly like `play-hazard` does. An
agent action is just another kind of hazard play that uses one hazard slot,
so it appears in the same action list.

New action variants:

```ts
interface AgentActionBase {
  readonly playerId: PlayerId;        // hazard player
  readonly agentId: CompanyId;        // the agent's virtual-company id
}

type AgentAction =
  | ({ readonly type: 'agent-move'; readonly destinationSiteInstanceId: CardInstanceId }
      & AgentActionBase)
  | ({ readonly type: 'agent-move-back' } & AgentActionBase)     // step back one site in the stack
  | ({ readonly type: 'agent-return-home'; readonly homeSiteInstanceId: CardInstanceId }
      & AgentActionBase)
  | ({ readonly type: 'agent-heal' } & AgentActionBase)
  | ({ readonly type: 'agent-untap' } & AgentActionBase)
  | ({ readonly type: 'agent-turn-face-down' } & AgentActionBase)
  | ({ readonly type: 'agent-key-creatures' } & AgentActionBase);
```

Each action costs 1 against the hazard limit, sets `agent.actedThisTurn =
true`, and (for `agent-move`) taps the agent unless it is already tapped.
Legal-action conditions follow rule 4.1 (tapped/wounded/face-down state
gating, adjacent-region-only movement, etc.).

### 3.6 Agent movement UI flow

The user's request: *"using agent movement goes like this: click site
(highlighted) agent is currently, then it opens site pile browser and
highlights legal sites to move"*.

Reuse `openMovementViewer` (`render-piles.ts:522`) with minimal changes:

1. During your opponent's M/H phase, if any `agent-move` actions are legal,
   the single-company view for that agent highlights the current-site card
   (`site-pile--active` or a new `site--movable` class).
2. Clicking the highlighted current site calls a new `openAgentMovementViewer`
   that filters legal actions to `type === 'agent-move' && agentId ===
   currentAgent.id`, then populates the browser grid with the sites from the
   hazard player's site deck, highlighting those whose instance id matches any
   viable `destinationSiteInstanceId`.
3. Clicking a highlighted site fires `agent-move`.

For `agent-return-home` (rule 4.1 bullet 2) the same viewer shows only that
agent's home site(s) as highlighted; the agent's current stack is returned to
the location deck as part of the reducer.

The three non-movement actions (heal, untap, turn face-down, key creatures)
are tooltip/popup menu items on the agent block itself — piggyback on the
existing character tooltip machinery so we don't auto-execute single-action
menus (per the saved feedback about always showing a popup).

### 3.7 Revealing an agent

Rule 4.2 — revealing during the **resource** player's M/H phase is not an
action and doesn't cost a hazard slot. New action:

```ts
interface RevealAgentAction {
  readonly type: 'reveal-agent';
  readonly playerId: PlayerId;
  readonly agentId: CompanyId;
}
```

Legal whenever the resource player is in M/H phase and the hazard player
owns a face-down agent. Reducer:

1. Walk `siteStack` oldest-first; check each site against movement legality
   using the `movement-map` rules, chained. If any hop is illegal, discard
   the agent and return every site in the stack to the location deck
   (rule 4.2.1). Log each check with `logDetail` so the trace explains the
   decision.
2. If legal, keep only the top site in `siteStack`, set `revealed = true`,
   return the rest to the location deck without having been in play.
3. Check uniqueness against all face-up unique characters and agents
   (rule 4.2.3); if duplicate, discard the newly-revealed agent.

### 3.8 Agent attacks at site phase

Wire the existing `declare-agent-attack` step to actually surface
agents. `computeAgentAttackActions` enumerates every agent (face-up or
face-down) whose current site matches the company's site and whose
`attackedThisSitePhase` is `false`. Declaring the attack reveals the agent if
it isn't already (rule 2.V.iii), then reuses the existing combat state with
`AttackSource = 'agent'`. The prowess/body modifiers from rule 3.iv.6.1
(face-down/face-up × home/non-home) are applied when the strike roll resolves
— new helper `applyAgentAttackModifiers(combat, agent)` called from the
`resolve-strike` handler. Detainment against Ringwraith/Balrog defenders
(rule 3.II.2.R3/B3) already has a TODO in `detainment.ts:65`; wire it to
`AttackSource.type === 'agent'`.

### 3.9 Turn bookkeeping

In the untap reducer, at the start of each turn:

- For every `AgentInPlay`, set `inPlayAtTurnStart = true` and
  `actedThisTurn = false`.

In the site-phase reducer at site-phase start (or M/H end-of-turn), reset
`attackedThisSitePhase = false`.

### 3.10 Alignment-specific nuances

These are spelled out in `rule-9.08-agent-alignment-movement.test.ts`:

- **Wizard (hero):** agents count as hazards for deck-building; the existing
  `isAgent` flag plus `alignment === 'wizard'` in deck-validation rejects
  playing as a character.
- **Ringwraith / Fallen-wizard:** `play-character` and `play-agent-hazard`
  are both legal; the player chooses at play time. Once chosen, locked for
  the life of that instance.
- **Balrog:** agents count as hazards; each agent is worth half a creature
  for deck-building (rule 1.3.B2) — a deck-validation concern, not runtime.
- Movement restrictions (Ringwraith Dagorlad↔Ûdun adjacency,
  Fallen-wizard hero-site-only, Balrog minion-site-only, Balrog
  Dagorlad↔Ûdun adjacency) live in the legal-action computer for
  `agent-move` and in the reveal-legality check in §3.7.

## 4. Implementation order (suggested PRs)

Each bullet is one PR, each PR ends green on build + nightly + lint.

1. **Data + flag.** Add `isAgent?: boolean` to the two character interfaces;
   set it on 2–3 sample minion agents from `data/cards.json` (pick ones that
   appear in existing tests). No behaviour change yet. Update
   `card-effects-dsl.md` with a short note on what the flag means.
2. **`AgentInPlay` state + projection.** New file `state-agents.ts`; add
   `agents: []` to `PlayerState` init and player-view projection; add
   `OpponentAgentView`; wire reducers so the field is carried through
   untouched. Serialization round-trip test.
3. **`play-agent-hazard` action.** Legal during own hazard step; emits
   `AgentInPlay` face-down. Turn rule-9.03 and rule-9.05 todos into real
   tests (revealing, uniqueness).
4. **`reveal-agent` action.** Legality check walks the site stack through
   `movement-map`. Turns rule-9.04 and rule-9.03 edge cases into real tests.
5. **Agent actions during opponent M/H.** Move / move-back / return-home /
   heal / untap / turn-face-down / key-creatures. Each costs 1 hazard slot
   and is gated by the agent's tap/wound/face state. Turns rule-9.01,
   rule-9.02, rule-9.06, rule-9.07 todos into real tests.
6. **Combat integration at site phase.** Wire
   `declare-agent-attack` to real agents + prowess/body modifiers + the
   already-stubbed detainment branch for Ringwraith/Balrog defenders.
7. **UI — all-companies view.** Render `self.agents` and `opponent.agents`
   as one-character blocks, with the face-down site-stack fan. Include
   agents in select-company highlighting.
8. **UI — single-company nav + movement viewer.** Let left/right arrows
   cycle through agents; wire current-site click through
   `openAgentMovementViewer`. Tooltip menu for heal / untap / face-down.
9. **Alignment-specific movement rules.** Finalize rule-9.08.
10. **Deck validation.** 36-mind limit (rule 1.3.2), Balrog half-creature
    counting, reveal-during-draft restriction (rule 1.9.R2 / 1.9.F1). Gate
    behind the deck-editor work already called out in roadmap §4.

## 5. Open questions

- **Where to draw the agent's home site from at play time?** Proposal is to
  use the hazard player's site deck directly, same as sites used by
  companies — no separate "location deck" concept introduced. The rules
  distinguish them but nothing we do today behaves differently; merging the
  two avoids inventing a new pile. Flag this to the user before
  implementing step 3.
- **Do we model "face-up site is in play" for environment effects?** Rule
  4.2.4 says yes. We need to check every effect that iterates "sites in
  play" (River, Twilight, etc.) and decide per effect whether face-up agent
  sites count. Suggest a new helper `allFaceUpSitesInPlay(state)` that
  callers opt into, rather than changing the default.
- **CvCC vs. agents.** An agent at its site can probably be attacked by a
  resource player's company via CvCC (rule 1.3.R2 treats agents played as
  characters this way, but agent-hazards aren't "characters"). Not in
  scope here — revisit when CvCC is generalized beyond Ringwraith.

## 6. Non-goals

- Deck editor UI for the agent flag (separate roadmap item).
- AI support for playing and using agents (stub `agent-*` actions as
  "never take" in the smart-AI evaluator for now; revisit under the
  minion/balrog AI item in the roadmap).
- Under-deeps agent interactions (Balrog expansion; out of scope until
  `Under-deeps movement` ships).
