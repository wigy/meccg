# Chain of Effects — Implementation Plan

## Design: Chain as State Overlay

The chain doesn't replace phases — it **layers on top**, like `CombatState` already does. When `state.chain` is non-null, `computeLegalActions` delegates to chain logic instead of the phase handler. The underlying phase (M/H, Site, etc.) stays intact.

## Key Types

### `ChainState` (added to `GameState`)

- `mode`: `'declaring'` | `'resolving'`
- `entries`: LIFO stack of `ChainEntry` (card, player, payload, resolved/negated flags)
- `priority` / pass flags for alternating between players
- `deferredPassives`: passive conditions queued for a follow-up chain
- `parentChain`: saved parent for nested chains (on-guard interrupts, body checks)
- `restriction`: `'normal'` | `'body-check'` | `'end-of-phase'` | `'beginning-of-phase'`

### `ChainEntry`

Each entry on the stack tracks:

- `index`: sequential position (0 = first declared)
- `declaredBy`: player who declared it
- `cardInstanceId` / `definitionId`: the card being played (null for non-card actions like passive conditions)
- `payload`: discriminated union (`short-event`, `creature`, `corruption-card`, `passive-condition`, `activated-ability`, `on-guard-reveal`, `body-check`)
- `resolved` / `negated`: resolution status flags

### `DeferredPassive`

Passive conditions triggered during resolution, queued for a follow-up chain:

- `sourceCardId`: the card whose passive triggered
- `trigger`: description of the trigger condition
- `payload`: `ChainEntryPayload` for declaring in the follow-up chain

## New Actions

- `pass-chain-priority` — pass; when both pass, chain transitions to resolving mode
- `order-passives` — resource player orders multiple triggered passives for follow-up chain

No separate "declare chain action" exists. Existing card-play actions (`play-short-event`, `play-creature`, `play-corruption-card`, etc.) become chain-aware: when played during a chain, the reducer pushes a `ChainEntry` onto the stack and flips priority instead of resolving immediately. When played outside a chain, they initiate one.

## New Files

- **`packages/shared/src/engine/legal-actions/chain.ts`** — computes what's playable in response, respecting chain restrictions
- **`packages/shared/src/engine/chain-reducer.ts`** — handles initiation, declaration, resolution loop, nested chains, deferred passives

## Integration Points

### `computeLegalActions` (legal-actions/index.ts)

New early check before the phase switch:

```typescript
if (state.chain !== null) {
  return chainActions(state, playerId);
}
```

Chain takes priority over combat, which takes priority over phase.

### `reduce()` (reducer.ts)

1. Early dispatch for `pass-chain-priority` and `order-passives`
2. Existing card-play actions (`play-short-event`, `play-creature`, etc.) detect chain context: if `state.chain` is non-null, push entry + flip priority; if null, initiate a new chain with this card as the first entry
3. After both players pass, reducer resolves entries in a loop, stopping when player input is needed

### Phase Handlers

- "Both players pass" patterns in M/H and Site phases check for end-of-phase passive conditions first
- Each action initiates a chain; opponent can respond before resolution

### Player View Projection

Chain state is visible to both players (all declared cards are face-up). `ChainState` passes through projection largely as-is.

## Key Design Decisions

1. **Auto-resolution** — the reducer resolves entries in a loop, stopping only when player input is needed (e.g., combat strike assignment)
2. **Priority alternates** starting with the non-initiator (CoE rule 672). Resource player always has priority to *initiate* a new chain (CoE rule 673).
3. **"Immediate" effects** bypass the chain entirely — no entry created, no response opportunity
4. **Chain as overlay, not phase replacement** — `phaseState` is unchanged; chain is orthogonal. Phase-specific bookkeeping (hazard count, company index) stays intact.

## CoE Rules Covered

From `docs/coe-rules.md`:

| Rule | Line | Summary |
|------|------|---------|
| LIFO resolution | 671 | Last declared resolves first |
| Response/priority | 672 | Opponent may respond before resolution; priority alternates |
| Resource player priority | 673 | Resource player initiates new chains first |
| Active conditions | 674 | Do NOT initiate separate chains |
| Immediate effects | 675 | Resolve without chain, no response |
| Multiple card actions | 676 | Resolve in printed order (reverse declaration order) |
| Passive conditions | 678–680 | Triggered passives queue into a new chain after current resolves |
| Resolution validity | 681 | Conditions must still be legal at resolution time |
| Discard exception | 682 | Passive conditions causing discard resolve immediately |
| Beginning-of-phase | 684 | Declared in single chain before other actions |
| End-of-phase | 685 | Declared in single chain after both pass |
| On-guard interrupts | 382 | Separate sub-chain, then original resumes |
| Body checks | 455 | Own chain with restricted responses |
| Creatures/corruption | 307, 599 | Must initiate a new chain (can't be in response) |
| Targeting | 656 | Cards targetable after resolution; dice-rolling targetable in same chain |

## Implementation Sequence

### Phase 1: Types & Plumbing (no behavioral change)

1. Add `ChainState`, `ChainEntry`, `ChainEntryPayload`, `DeferredPassive` types to `state.ts`
2. Add `chain: ChainState | null` to `GameState` (initialized to `null`)
3. Add `pass-chain-priority` and `order-passives` actions to `actions.ts` and `GameAction` union
4. Create empty `chain.ts` and `chain-reducer.ts`
5. Wire early dispatch in `computeLegalActions` and `reduce()`

### Phase 2: Chain Initiation & Priority Passing

1. Implement `initiateChain()` — creates `ChainState` from first card-play action
2. Make existing card-play reducers chain-aware — if chain exists, push entry + flip priority; if not, call `initiateChain()`
3. Implement `pass-chain-priority` reducer — set flags, transition to resolving when both pass
4. Implement `chainActions()` legal action computation — playable response cards + `pass-chain-priority`

### Phase 3: Chain Resolution

1. Implement `resolveNextEntry()` — resolve single entry, check negation/validity, apply effects
2. Implement `completeChain()` — clean up chain, handle deferred passives, restore parent
3. Auto-advance: resolver processes entries in sequence, returning intermediate states

### Phase 4: Short Events on the Chain

1. Short events initiate a chain (or add to current chain as response)
2. Resolution applies card effects via the DSL resolver

### Phase 5: Creatures on the Chain

1. Creature play initiates a chain instead of directly resolving
2. When creature entry resolves, transition into `CombatState`
3. After combat completes, resume chain resolution

### Phase 6: Passive Conditions

1. Detect passive conditions during resolution (scan in-play `on-event` triggers)
2. Queue triggered passives into `deferredPassives`
3. Implement immediate-discard exception
4. Implement `order-passives` action and follow-up chain creation

### Phase 7: Nested Chains

1. Implement `interruptWithSubChain()` for on-guard reveals
2. Implement body-check sub-chains with `'body-check'` restriction
3. Test parent chain restoration after sub-chain completion

### Phase 8: Phase Boundary Chains

1. At phase transitions, scan for beginning-of-phase passives → create restricted chain
2. Before advancing from a phase, scan for end-of-phase passives → create restricted chain

## UI Display

### Player View Projection

`ChainState` is projected to both players largely as-is — all declared cards on the chain are face-up public information. The `visibleInstances` map is extended to include any card instance IDs referenced in chain entries, so clients can resolve names and images.

### Debug View (Text Client + Web Debug Panel)

The chain gets its own dedicated section/box, following the same pattern as the draft and M/H info panels: a `renderChainInfo()` function that shows/hides a `chain-section` element based on whether `state.chain` is non-null.

#### `renderChainInfo()` (in `render.ts`)

Follows the `renderDraft()` / `renderMHInfo()` / `renderSiteInfo()` pattern:

- Own `<section id="chain-section">` in the HTML, hidden when `state.chain` is null
- Renders lines of text into a `<pre id="chain-info">` element via `ansiToHtml()`

#### Chain Display Format

```text
Mode: declaring — Alice has priority
  1. [Alice] Play ‹Dark Numbers› targeting [Mordor]
  2. [Bob]   Play ‹Twilight› in response
  > [Alice]  May respond or pass
```

During resolution:

```text
Mode: resolving 2/2
  1. [Alice] Play ‹Dark Numbers› targeting [Mordor]
  > 2. [Bob]   ‹Twilight› — RESOLVING
```

After negation:

```text
  2. [Bob]   ‹Twilight› — NEGATED (target no longer valid)
```

Key formatting rules:

- Cards use the existing ANSI color scheme (hazard events = magenta, resource events = cyan, creatures = red, etc.)
- Card names use `\x02` markers so the web client renders hover-preview spans
- `>` marker indicates the current entry (priority holder during declaring, resolving entry during resolution)
- Resolved entries show their outcome (resolved, negated)
- Nested chains (on-guard interrupts) are indented under a `SUB-CHAIN:` heading
- Deferred passives shown below the chain: `DEFERRED: [Corruption check on Aragorn II]`

### Visual View (Web Client)

The visual view displays the chain as a **horizontal strip in the center of the battlefield**, between the two players' areas — similar to how a physical game would have cards laid out on the table between players.

#### Chain Strip Layout

```text
┌─────────────────────────────────────────────────┐
│  Opponent area (companies, hand count, etc.)    │
├─────────────────────────────────────────────────┤
│  ┌──────┐  ┌──────┐  ┌──────┐                  │
│  │Card 1│→ │Card 2│→ │Card 3│  ← chain strip   │
│  │(dim) │  │(dim) │  │⚡glow│                   │
│  └──────┘  └──────┘  └──────┘                  │
│  "Resolving: Twilight — Bob may respond"        │
├─────────────────────────────────────────────────┤
│  Self area (hand arc, companies, etc.)          │
└─────────────────────────────────────────────────┘
```

#### Visual Elements

**Cards on the chain:**

- Displayed as standard card images (using existing `createCardImage()` helper)
- Arranged left-to-right in declaration order (first declared = leftmost)
- Arrow connectors (`→`) between cards to show the chain
- Small player-name label below each card (whose declaration it is)

**Active entry highlighting:**

- During `declaring`: the last-declared card has a **golden border** (same as selectable highlight)
- During `resolving`: the currently-resolving card has a **pulsing glow** effect; already-resolved cards are **dimmed**
- Negated cards get a **red strikethrough overlay** and are dimmed

**Priority indicator:**

- Instruction text below the chain strip shows whose turn it is:
  - Declaring: `"Chain: [PlayerName] may respond or pass"`
  - Resolving: `"Resolving: [CardName]"`
  - For the non-priority player: `"Waiting for [PlayerName] to respond..."`

**Legal action buttons:**

- When the current player has priority, playable response cards in hand get **golden highlight** (existing selectable style)
- A **"Pass"** button appears in the action panel
- Clicking a hand card to play it as a response follows the existing two-step selection pattern (golden → green → target if needed)

#### Chain Restriction Indicators

When the chain has a restriction (`body-check`, `end-of-phase`, etc.), the instruction text includes the restriction:

- `"Body Check Chain: only actions affecting the body check"`
- `"End of Phase: only 'at the end' actions"`

#### Nested Chains (On-Guard Interrupts)

When a sub-chain interrupts:

1. The parent chain strip slides up and dims (smaller scale, reduced opacity)
2. The sub-chain appears in the main chain strip position
3. A label shows `"On-Guard Interrupt"` or `"Body Check"`
4. When the sub-chain resolves, it fades out and the parent slides back down

#### Animations

Using the existing FLIP animation system (`flip-animate.ts`):

- **Declaration**: Card slides from hand to chain strip position (FLIP transition)
- **Resolution**: Card briefly enlarges (pulse), then fades/dims
- **Negation**: Card flashes red, then dims with strikethrough
- **Chain complete**: All chain cards fade out simultaneously
- **Sub-chain push/pop**: Parent chain scales down/up with opacity transition

#### CSS Classes

```css
.chain-strip          /* Horizontal flex container in battlefield center */
.chain-entry          /* Individual card wrapper in the chain */
.chain-entry--active  /* Currently resolving entry (pulsing glow) */
.chain-entry--resolved /* Already resolved (dimmed) */
.chain-entry--negated  /* Negated before resolution (red strikethrough + dim) */
.chain-arrow          /* → connector between entries */
.chain-label          /* Player name label below card */
.chain-parent         /* Dimmed parent chain during nested sub-chain */
.chain-restriction    /* Restriction badge text */
```

### Text Client

The text client uses the same `formatChain()` output as the web debug panel. Chain state appears in the state display, and legal actions show numbered options for declaring responses or passing.

## Testing

Tests fill existing `test.todo()` stubs in `packages/shared/src/tests/rules/14-actions-timing.test.ts`:

- LIFO resolution order
- Resource player priority to initiate
- No actions during resolution
- Immediate effects bypass chain
- Passive conditions: new chain when triggered
- Beginning/end-of-phase passive chains
