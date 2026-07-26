# Training a MECCG Player: System, Algorithms, and Results

*Status: 2026-07-26. Describes what is implemented and measured in
`packages/sim`. Numbers are from the runs cited; unverified claims are
marked as such.*

## 1. Summary

We train a Middle-earth CCG player by imitation followed by gated
self-play reinforcement learning, on top of the existing pure game
engine. The current champion beats the imitation baseline by **+157 Elo
[+122, +194]** and the hand-written heuristic AI by **+36 Elo [+2, +70]**
(400 paired-seed games each, zero engine failures).

Every strength claim in this document comes from paired-seed,
side-swapped matches with 95% confidence intervals, because early in the
project several "improvements" that looked good on point estimates did
not survive interval testing.

Two components are explicitly **not** yet working: determinized search
does not beat the bare policy, and the RL loop has plateaued. Both are
analysed in §8 and §9.

## 2. Why MECCG is hard

Four properties drive every design decision.

- **Imperfect information.** Hands, decks, sideboards, face-down
  on-guard cards and agent identities are hidden. Agents observe only
  `projectPlayerView(state, playerId)`, never `GameState`.
- **Variable, large action space.** ~158 action types parameterised by
  card instance ids. Branching is ~8.9 on average but ranges from 1 to
  over 1300, and **~52% of decisions are forced** (a single legal
  action).
- **Long episodes, sparse reward.** A game runs 600–2000 decisions per
  player and yields one ternary outcome.
- **Privately constructed decks.** The opponent's deck is chosen and
  ordered by them, so the hidden "range" is not a small common-knowledge
  universe. This is why whole-game CFR was rejected as a backbone.

## 3. Simulation substrate

`playGame()` loops `projectPlayerView → agent → reduce` in process. The
engine is a pure reducer with all randomness threaded through a seeded
Mulberry32 `RngState`, so a game is bit-reproducible from
`(seed, decks, agents)`. Each agent draws from its own derived stream, so
agent sampling never perturbs engine randomness.

Measured throughput (random vs random, 1000 games, full recording):
0.70 games/sec and 1391 decisions/sec on one core; mean 2001 decisions
and 74.6 turns per game. Data export runs at ~630 examples/sec serially
and scales near-linearly with `--jobs` (112,419 examples from 60 games in
80 s at 12 jobs), since games are independent and seeded: a batch splits
into contiguous seed slices whose merged output is bit-identical to a
serial run.

**Self-play as an engine test.** Random and heuristic self-play are run
as an invariant: any `deadlock` or `engine-error` outcome is an engine
bug. This has found and fixed 19 distinct engine defects to date,
including five during multi-deck training data generation. The dominant
recurring class is *offer/validate asymmetry* — the legal-action
generator offers an action the reducer then rejects — which no
hand-written test had caught.

## 4. Evaluation methodology

Evaluation is the backbone of the project, built before any learning.

- **Paired seeds with side-swap.** Every scheduled seed is played twice
  with seats exchanged, cancelling seat, deck, and shuffle luck.
- **Glicko-2 ratings** with rating periods per round, verified against
  the worked example in Glickman's paper.
- **Score-rate Elo with a 95% interval**, which is the promotion
  statistic.
- **A gate** passes only when the Elo-difference lower bound clears a
  threshold *and* every game completes; it exits non-zero for CI.

The gate is deliberately conservative, and this mattered: it blocked a
deliberately weakened agent (14.4% score, −310 Elo), passed an
equal-strength control (50.0% over 400 games, +0 [−34, +34]), and later
rejected several RL candidates whose point estimates looked positive but
whose intervals did not exclude zero.

## 5. Representation

A single feature spec (versioned; `FEATURE_SPEC_VERSION`) serves
imitation, RL, and search. It consumes only the projected view.

- **Global vector, 54 dimensions**: turn, phase one-hot, pile sizes,
  influence, stage points, deck exhaustions, marshalling points by
  category for both players, tournament scores, and combat/chain flags.
- **Entity rows, 13 dimensions each**, one per visible card in a
  structured zone (hand, characters with their items/allies/hazards,
  company sites, permanents, on-guard cards, agents, own site deck):
  zone id, owner, card-vocabulary index, tap status, company grouping,
  bearer, live effective stats, and a zone-specific flag.
- **Action vectors, 9 dimensions each**, one per candidate from
  `computeLegalActions`: action-type index, viability mask, up to four
  referenced card-vocabulary indices resolved through the instance
  lookup, and numeric parameters.

The action encoding is what makes the variable action space tractable:
the policy scores each candidate, so branching is a runtime set size
rather than an architecture constant.

The card vocabulary (1683 definitions, index 0 reserved for
hidden/unknown) is hashed with FNV-1a; the hash travels with every
exported dataset and every weights file, and inference refuses to run on
a mismatch.

## 6. Network and imitation learning

An action-conditioned policy/value network, 46,738 parameters:
embeddings for cards, action types and zones; a mean-pooled set encoder
over entity rows; a torso combining that with the encoded global vector;
a per-candidate scorer producing logits with the viability mask applied
inside the softmax; and a tanh value head.

Behavioural cloning trains the policy against the heuristic teacher's
normalised candidate weights as soft targets, and the value head against
the final game outcome.

**Top-1 agreement: 72.1% overall, 42.2% on contested decisions.** The
contested figure must be read against a ceiling: the teacher *samples*
from its weight distribution, so the expected maximum achievable
agreement is 47.0% (mean of the teacher's max normalised weight). BC
therefore captured ~92% of what imitation can capture, and more data
barely moved this number.

Play strength, however, kept improving with data well after top-1
saturated: a 40-game teacher dataset produced 35.8% against the teacher,
while a 400-game dataset reached parity (50.0% over 200 games,
+0 [−47, +47]). Agreement on individual decisions and strength over full
games are only loosely coupled.

**Inference runs in TypeScript**, mirroring the PyTorch forward pass over
weights exported as JSON. Every weights file embeds a self-test (a real
example's inputs and the trainer's outputs); the agent replays it on load
and refuses to play if the runtimes deviate by more than 2e-4. This
guards against silent featurizer or architecture drift, and caught an
architecture-compatibility bug during development.

## 7. Self-play reinforcement learning

The RL loop is: roll out games with the champion **sampling** at
temperature 1, update, then gate.

**Update.** PPO with a clipped ratio against the behaviour probabilities
recorded in the rollout (at temperature 1 the stored policy distribution
*is* the sampling distribution, so no extra bookkeeping is needed),
advantages fixed once from the value head, entropy bonus, and KL
early-stopping. Learning rate 3e-5 over 4 epochs.

Three stabilisers were each added in response to a measured failure:

1. **Advantage normalisation per rollout file.** Without it, batches
   dominated by same-sign advantages produced updates that collapsed the
   policy (a distinctive draw-spike failure mode).
2. **Value pre-fit before advantage computation.** The warm-started value
   head is mis-calibrated on states shaped by unfamiliar opponents; the
   resulting bias blanket-suppressed every action from those games. With
   heuristic-dominated rollouts this cost ~−113 Elo on *all* axes.
3. **KL early-stop** (target 0.02) as a runaway guard.

**League.** Pure self-play measurably overfits to its own family: an
early candidate gained ~+26 Elo on its parent while *losing* ~−77 Elo to
the heuristic. Rollouts therefore mix self-play with games against frozen
league members, with the learner alternating seats, and only the
learner's decisions enter the gradient (the opponents' recorded
probabilities belong to different policies, so PPO ratios against them
would be invalid). Promotion requires beating the champion *and* not
regressing against any league member. The league gate demonstrably works:
it rejected a candidate that beat its champion by +47 Elo while
regressing −47 against the heuristic.

**Accumulation.** Since a strict 200-game gate can rarely confirm a true
+30 Elo edge, learning continues from the latest candidate whether or not
it was promoted; gates decide only what is *recorded* as champion. A
drift valve resets the line if a candidate fails a league gate badly.

**Result.** Two chained promotions, each independently gated:
`bc-400g → runA-it5 (+74) → gen2-it3 (+72)`. Against the P3 baseline the
champion scores 71.1% (+157 [+122, +194], 400 games); against the
heuristic 55.1% (+36 [+2, +70], 400 games).

**Plateau.** Two subsequent generations (8 and 12 iterations, larger
rollouts, rotating learning rates) produced no promotion against a
three-member league. The recipe has reached its level; §9 identifies the
most likely cause.

## 8. Determinized search

The search layer sits behind the same agent interface.

**Determinizer.** Given a view, it samples a full `GameState` by assigning
each hidden card slot a definition drawn without replacement from the
owner's *unseen pool* (deck list plus draft pool, minus every identity
already observed). Engine internals absent from the view are synthesised,
including a fresh seeded RNG — re-seeding per determinization is how
chance is marginalised. The load-bearing property, verified on real
mid-game positions, is that re-projecting a sampled world reproduces the
searching player's original candidate list exactly.

**PUCT.** For each of K sampled worlds, a tree search over the real
reducer with net priors and leaf values, aggregating root visit counts
across worlds by canonical action id. Forced nodes are auto-advanced
without consuming budget — essential, given that ~52% of decisions are
forced. States with an open chain, active combat, or pending effects are
out of scope in v1; the agent falls back to the policy there.

**Result: search does not yet beat the policy** — 50.5%, +3 Elo
[−61, +69] over 100 games at 192 simulations per decision. §9 explains
why, and the fix is in progress.

## 9. Value function analysis

Search truncates games that run 600–2000 decisions after a few dozen
plies, so a leaf's evaluation is almost entirely the value head's
opinion. A diagnostic (`train/eval_value.py`) scores a value head by game
stage in minutes, versus an hour for a search gate.

The champion's value head turned out to be **at or below chance through
the entire middle game**, which is exactly where search leaves land:

| stage | champion | rebuilt head |
|---|---|---|
| early | 0.637 | 0.666 |
| mid-early | 0.486 | 0.839 |
| mid-late | 0.482 | 0.763 |
| late | 0.784 | 0.908 |
| overall MSE | 1.089 | 0.561 |

*(sign accuracy = fraction of decisions where the value's sign matches
the eventual winner; measured on 190 fully held-out games)*

Notably, the raw tournament-score differential — a feature the network
already receives — predicts the winner at 0.56/0.63/0.68/0.79 by quarter.
The old head was losing to one of its own inputs, so this was an
engineering failure, not an intrinsic property of the game.

Three changes fixed it:

1. **Train on all decisions.** Forced decisions carry full outcome signal
   but no policy gradient (a masked softmax over one candidate is
   identically 1), so filtering to contested decisions cost the value
   head half its data for nothing.
2. **A skip connection** feeding the global vector directly to the value
   head. The shared torso is optimised almost entirely by the policy loss
   (≈1.5 versus ≈0.2), so the value head had been reading a
   representation shaped for a different objective.
3. **Many more games.** *Value sample size is games, not decisions*: all
   decisions in a game share one target, so a 60-game dataset lets the
   head memorise (training loss 0.04 against holdout 1.1) and produces a
   head that is confidently wrong on unseen games. Training on 1286 games
   dropped holdout MSE from ~1.04 to 0.41.

This also explains the RL plateau: PPO advantages are computed from this
value head, so mid-game advantages were largely noise.

## 10. Negative results

Recorded because they cost real time and are easy to repeat.

- **Blending the score differential into search leaf values is harmful.**
  It predicts better than the old value head mid-game, so it looked like
  free signal — but at weight 0.5 search fell to 2 wins in 12 games.
  Maximising immediate score spread is greedy in a game where
  marshalling points are bought with corruption risk and capped by the
  doubling rule.
- **More imitation data does not beat RL.** A 1520-game, multi-deck BC
  model lost to the RL champion (−81 Elo). Imitation is bounded by the
  teacher.
- **Self-play strength is non-transitive.** Candidates repeatedly gained
  against their own lineage while losing to the heuristic. Elo is only
  meaningful relative to a stated opponent pool.
- **Costless no-op loops.** Some cards permit a zero-cost cycle (*I'll
  Report You*: return to hand during any organization phase, no cost). A
  deterministic argmax policy rides such a loop forever — two agents
  burned a 25,000-decision budget inside turn 1. Agents now track a
  coarse state signature and prefer an action not yet tried from that
  signature.

## 11. Limitations

- Trained and evaluated almost entirely on hero-vs-hero challenge decks;
  9 of 12 deck pairs are currently free of engine errors. Generalisation
  across decks is measured but not optimised.
- Minion, Fallen-wizard, and Balrog play are untested by training.
- Search is unproven; the rebuilt value head has not yet been paired with
  the RL policy, and that combination is the immediate next experiment.
- PIMC-style determinization cannot represent bluffing over on-guard
  cards or hidden agent identities. This ceiling is accepted for now.
- All ratings are relative to a small pool (heuristic, BC, prior
  champions). No human-strength calibration exists; the lobby now
  supports playing against a trained model, which is the intended way to
  obtain one.

## 12. Reproducing

```sh
npm run bench -w @meccg/sim -- --games 100 --seed 1        # throughput + engine invariant
npm run tournament -w @meccg/sim -- --agents random,heuristic
npm run export-training -w @meccg/sim -- --games 400 --jobs 12 --out train.jsonl
python3 packages/sim/train/train_bc.py --data train.jsonl --out bc.json --epochs 3
python3 packages/sim/train/eval_value.py --weights bc.json --data holdout.jsonl
npm run gate -w @meccg/sim -- --challenger bc:bc.json --champion heuristic
packages/sim/train/selfplay_loop.sh bc.json /tmp/run 8    # league RL with gated promotion
```

The original design document is `specs/2026-06-29-ai-training-system-plan.md`.

## 13. Background reading

Organised by the part of this system each topic explains. Where a paper
directly motivated a design choice above, the connection is stated.

### 13.1 Reinforcement learning foundations

- Sutton & Barto, *Reinforcement Learning: An Introduction* (2nd ed.) —
  <http://incompleteideas.net/book/the-book.html>. Chapters 3–6 (MDPs,
  Monte-Carlo methods, temporal-difference learning) and 13 (policy
  gradients) cover everything assumed in §7.
- OpenAI *Spinning Up in Deep RL* — <https://spinningup.openai.com/>.
  The fastest practical on-ramp; its policy-gradient derivation and PPO
  implementation notes map directly onto `train/train_bc.py`.
- Williams (1992), *Simple statistical gradient-following algorithms*
  (REINFORCE) — <https://link.springer.com/article/10.1007/BF00992696>.
  The `--mode reinforce` update is exactly this with a value baseline.

### 13.2 Policy-gradient algorithms (our update rule)

- Schulman et al. (2017), *Proximal Policy Optimization* —
  <https://arxiv.org/abs/1707.06347>. The clipped surrogate we use;
  §3 of the paper explains why the ratio must be computed against the
  behaviour policy, which is why rollouts record their own probabilities.
- Schulman et al. (2015), *Trust Region Policy Optimization* —
  <https://arxiv.org/abs/1502.05477>. The KL-constraint idea behind our
  KL early-stop.
- Schulman et al. (2015), *Generalized Advantage Estimation* —
  <https://arxiv.org/abs/1506.02438>. We currently use the crudest
  possible advantage (terminal outcome minus value); GAE is the obvious
  upgrade and explains the bias/variance trade-off we are sitting at.
- Andrychowicz et al. (2020), *What Matters in On-Policy RL* —
  <https://arxiv.org/abs/2006.05990>. A large ablation study; advantage
  normalisation and value-loss weighting — both of which we had to add
  after observing collapses — are among its headline findings.

### 13.3 Self-play, leagues, and non-transitivity

- Silver et al. (2017), *Mastering the game of Go without human
  knowledge* (AlphaGo Zero) — <https://www.nature.com/articles/nature24270>.
- Silver et al. (2017), *AlphaZero* — <https://arxiv.org/abs/1712.01815>.
  The gated-promotion pattern (train, then only accept a new champion if
  it beats the old one in a match) is taken from here.
- Vinyals et al. (2019), *Grandmaster level in StarCraft II* (AlphaStar)
  — <https://www.nature.com/articles/s41586-019-1724-z>. The league
  concept, and the clearest statement of why pure self-play produces
  exploitable, cyclic strategies.
- Balduzzi et al. (2019), *Open-ended Learning in Symmetric Zero-sum
  Games* — <https://arxiv.org/abs/1901.08106>. Formalises the
  non-transitivity we measured directly (§10): strength is a partial
  order, not a scalar, so a rating is only meaningful against a stated
  pool.
- Lanctot et al. (2017), *A Unified Game-Theoretic Approach to
  Multiagent RL* (PSRO) — <https://arxiv.org/abs/1711.00832>. The
  principled generalisation of our frozen-baseline league.

### 13.4 Search under imperfect information (our P5 layer)

- Kocsis & Szepesvári (2006), *Bandit based Monte-Carlo Planning* (UCT) —
  <https://link.springer.com/chapter/10.1007/11871842_29>.
- Browne et al. (2012), *A Survey of Monte Carlo Tree Search Methods* —
  <https://ieeexplore.ieee.org/document/6145622>. The standard reference
  for MCTS variants and terminology.
- Rosin (2011), *Multi-armed bandits with episode context* — the PUCT
  formula AlphaZero and our `searchBestAction` use:
  <https://link.springer.com/article/10.1007/s10472-011-9258-6>.
- Cowling, Powley & Whitehouse (2012), *Information Set Monte Carlo Tree
  Search* — <https://ieeexplore.ieee.org/document/6203567>. The correct
  treatment of hidden information in MCTS; our determinizer is the
  simpler PIMC cousin.
- Long et al. (2010), *Understanding the Success of Perfect Information
  Monte Carlo Sampling in Game Tree Search* —
  <https://ojs.aaai.org/index.php/AAAI/article/view/7562>. Explains
  *strategy fusion* and *non-locality*, the two failure modes we accept
  in §11, and characterises when PIMC nevertheless works well.
- Frank & Basin (1998), *Search in games with incomplete information* —
  <https://www.sciencedirect.com/science/article/pii/S0004370298000378>.
  The original analysis of why averaging over determinizations is not
  the same as playing the imperfect-information game.

### 13.5 Game-theoretic methods (the reserve option)

- Zinkevich et al. (2007), *Regret Minimization in Games with Incomplete
  Information* (CFR) —
  <https://papers.nips.cc/paper/2007/hash/08d98638c6fcd194a4b1e6992063e944-Abstract.html>.
- Brown et al. (2019), *Deep CFR* — <https://arxiv.org/abs/1811.00164>.
- Moravčík et al. (2017), *DeepStack* — <https://arxiv.org/abs/1701.01724>.
- Brown & Sandholm (2020), *ReBeL* — <https://arxiv.org/abs/2007.13544>.
  Combines search with RL in imperfect-information games; the closest
  published relative of what P5 is reaching for, and the reason the
  design doc demoted whole-game CFR (its range assumptions do not hold
  when the opponent privately constructs a deck).

### 13.6 Imitation learning (our P3 warm start)

- Pomerleau (1991), *Efficient training of artificial neural networks for
  autonomous navigation* — the original behavioural cloning result:
  <https://ieeexplore.ieee.org/document/6796450>.
- Ross, Gordon & Bagnell (2011), *DAgger* —
  <https://arxiv.org/abs/1011.0686>. Explains compounding error under
  distribution shift: exactly why our BC top-1 agreement saturated while
  play strength kept improving with more data.
- Hussein et al. (2017), *Imitation Learning: A Survey* —
  <https://dl.acm.org/doi/10.1145/3054912>.

### 13.7 Representation for large/variable action spaces

- Zaheer et al. (2017), *Deep Sets* — <https://arxiv.org/abs/1703.06114>.
  The permutation-invariant pooling our entity encoder uses.
- Dulac-Arnold et al. (2015), *Deep RL in Large Discrete Action Spaces* —
  <https://arxiv.org/abs/1512.07679>. Action embeddings scored against a
  state vector — the pattern behind our action-conditioned policy head.
- Vaswani et al. (2017), *Attention Is All You Need* —
  <https://arxiv.org/abs/1706.03762>. The natural upgrade from mean
  pooling when entity interactions start to matter.

### 13.8 Card games and other imperfect-information domains

- Li et al. (2020), *Suphx: Mastering Mahjong with Deep RL* —
  <https://arxiv.org/abs/2003.13590>. Closest in spirit: huge hidden
  state, long episodes, and heavy use of an oracle/distillation trick.
- Zha et al. (2021), *DouZero* — <https://arxiv.org/abs/2106.06135>.
  Shows how far well-engineered action encoding plus plain Monte-Carlo
  methods can go in a card game.
- Cowling, Ward & Powley (2012), *Ensemble Determinization in MCTS for
  Magic: The Gathering* — <https://ieeexplore.ieee.org/document/6218176>.
  The most directly comparable prior work: determinized MCTS in a
  deck-building CCG.
- Bard et al. (2020), *The Hanabi Challenge* —
  <https://arxiv.org/abs/1902.00506>. Why reasoning about hidden
  information is qualitatively harder than reasoning under noise.

### 13.9 Evaluation, ratings, and statistics

- Glickman, *The Glicko-2 system* —
  <http://www.glicko.net/glicko/glicko2.pdf>. Implemented verbatim in
  `src/glicko2.ts` and tested against the paper's worked example.
- Elo rating theory, Chess Programming Wiki —
  <https://www.chessprogramming.org/Match_Statistics>.
- Sequential Probability Ratio Test (SPRT) as used by chess-engine
  testing frameworks —
  <https://www.chessprogramming.org/Sequential_Probability_Ratio_Test>.
  The principled replacement for our fixed-N gates: it stops as soon as
  the evidence is decisive, which is the obvious next upgrade given how
  many of our runs are gate-bound.
- Fishtest / OpenBench methodology —
  <https://github.com/official-stockfish/fishtest/wiki>. Practical
  guidance on paired openings, variance reduction, and avoiding the
  best-of-N selection bias we hit when re-gating a hand-picked candidate.

### 13.10 Pitfalls we hit, and the literature on them

- Henderson et al. (2018), *Deep RL that Matters* —
  <https://arxiv.org/abs/1709.06560>. Seed variance and evaluation
  fragility; the reason every claim here carries an interval.
- Agarwal et al. (2021), *Deep RL at the Edge of the Statistical
  Precipice* — <https://arxiv.org/abs/2108.13264>. Correct reporting for
  small numbers of runs.
- Cobbe et al. (2019), *Quantifying Generalization in RL* —
  <https://arxiv.org/abs/1812.02341>. Overfitting to a narrow training
  distribution — our single-deck-pair training, and the value head
  memorising a 60-game dataset.
- Zhang et al. (2018), *A Study on Overfitting in Deep RL* —
  <https://arxiv.org/abs/1804.06893>. Directly relevant to the
  correlated-samples problem behind our "value sample size is games, not
  decisions" finding.

### 13.11 MECCG itself

- Council of Elrond rules, `docs/coe-rules.md` in this repository, and
  the CRF-22 errata in `docs/crf-22.md`. Every engine behaviour the
  agents exploit or stumble over is specified there; the offer/validate
  asymmetries in §3 are all discrepancies against these documents.
