#!/usr/bin/env bash
# Self-play RL loop (P4: PPO by default, REINFORCE via MODE=reinforce),
# with league rollouts and league-wide promotion gates.
#
# Motivation (measured 2026-07-23): pure self-play rollouts overfit to
# exploiting the policy's own family — a candidate gained ~+26 Elo over
# the BC champion while LOSING ~-77 Elo to the heuristic. The fix is the
# classic frozen-baseline league: part of every rollout batch is played
# against frozen league opponents (learner alternating seats, and only the
# learner's decisions enter the gradient — the opponents' recorded
# behavior probabilities belong to different policies), and promotion
# requires beating the champion AND not regressing against any league
# member.
#
# Each iteration:
#   1) rollouts: GAMES self-play games (learner@TEMP both seats) plus, per
#      LEAGUE member, GAMES_OPP games in each seat against it;
#   2) update: PPO (EPOCHS clipped-ratio passes) or REINFORCE on the
#      learner's decisions only;
#   3) gates: candidate (argmax) vs champion at GATE_MIN_ELO, then vs each
#      LEAGUE member at GATE_LEAGUE_MIN_ELO (a no-regression tolerance).
#      All gates must pass for promotion; rejected candidates stay on disk.
#
# Learning accumulates across iterations (ACCUMULATE=1, the default): the
# next iteration rolls out and trains from the latest candidate, promoted
# or not, so stable per-iteration gains compound; the gates only decide
# what gets *recorded* as champion. Motivation (measured 2026-07-24, after
# the PPO stabilizers): per-iteration candidates were stable at ~-25..+33
# Elo with zero collapses, but a strict 200-game lower-bound gate can
# almost never confirm a true +30 edge, and resetting to the champion on
# every rejection threw the gains away — the champion never moved.
# ACCUMULATE=0 restores the old reset-on-rejection behavior. A safety
# valve remains: if the candidate ever fails the league no-regression gate
# by a wide margin (2x GATE_LEAGUE_MIN_ELO below zero on the point
# estimate), learning resets to the champion to escape a drifting line.
#
# Usage:
#   train/selfplay_loop.sh <champion-weights.json> <workdir> [iterations]
#
# Env overrides: LEAGUE (comma-separated agent specs, default "heuristic";
# e.g. "heuristic,bc:/path/frozen.json"), ACCUMULATE (default 1), GAMES
# (self-play games/iter, default 60), GAMES_OPP (games per league member
# per seat, default 30), MODE (ppo|reinforce, default ppo), EPOCHS
# (default 4 for ppo, 1 for reinforce), CLIP (default 0.2), LR (default
# 3e-5), ENTROPY (default 0.01), TEMP (rollout sampling temperature,
# default 1), GATE_PAIRS (default 15), GATE_ROUNDS
# (default 2), GATE_MIN_ELO (default 0), GATE_LEAGUE_MIN_ELO (default
# -25), SEED0 (default 50000).
set -euo pipefail

CHAMPION=$(realpath "$1")
WORKDIR=$(realpath "$2")
ITERS=${3:-5}
LEAGUE=${LEAGUE:-heuristic}
MODE=${MODE:-ppo}
if [ "$MODE" = "ppo" ]; then EPOCHS=${EPOCHS:-4}; else EPOCHS=${EPOCHS:-1}; fi
CLIP=${CLIP:-0.2}
KL_TARGET=${KL_TARGET:-0.02}
GAMES=${GAMES:-60}
GAMES_OPP=${GAMES_OPP:-30}
# 3e-5 after the 2026-07-24 runs: 1e-4 x 4 epochs produced candidate swings
# from -141 to +47 Elo, including repeated draw-spike collapses.
LR=${LR:-3e-5}
ENTROPY=${ENTROPY:-0.01}
# Rollout sampling temperature. Exploration is strictly on-policy here, so a
# peaked policy keeps re-sampling the lines it already plays: strategies that
# need several coordinated low-probability choices in a row (travel to a
# faction's home site, then influence it) are effectively unreachable, and the
# measured models never score a single faction point. Raising this widens the
# rollout distribution; PPO stays correct because the ratio is taken against
# the recorded behaviour probabilities.
TEMP=${TEMP:-1}
GATE_PAIRS=${GATE_PAIRS:-15}
GATE_ROUNDS=${GATE_ROUNDS:-2}
GATE_MIN_ELO=${GATE_MIN_ELO:-0}
GATE_LEAGUE_MIN_ELO=${GATE_LEAGUE_MIN_ELO:--25}
SEED0=${SEED0:-50000}
ACCUMULATE=${ACCUMULATE:-1}

cd "$(dirname "$0")/.."
mkdir -p "$WORKDIR"
IFS=',' read -r -a LEAGUE_MEMBERS <<< "$LEAGUE"

# The learning line: rollouts and updates continue from here. The champion
# is only the promotion record (and the gate reference).
CURRENT="$CHAMPION"

for ((i = 1; i <= ITERS; i++)); do
  seed=$((SEED0 + (i - 1) * 10000))
  candidate="$WORKDIR/candidate-$i.json"
  data_specs=()

  echo "=== iteration $i/$ITERS: self-play rollout $GAMES games (seeds $seed..) from $(basename "$CURRENT") ==="
  rollout="$WORKDIR/rollout-$i-self.jsonl"
  npm run --silent export-training -- \
    --agents "bc:$CURRENT@$TEMP,bc:$CURRENT@$TEMP" --games "$GAMES" --seed "$seed" --out "$rollout"
  data_specs+=("$rollout")
  seed=$((seed + GAMES))

  m=0
  for member in "${LEAGUE_MEMBERS[@]}"; do
    m=$((m + 1))
    echo "=== iteration $i: league rollout vs $member ($GAMES_OPP games per seat) ==="
    rollout="$WORKDIR/rollout-$i-league$m-s0.jsonl"
    npm run --silent export-training -- \
      --agents "bc:$CURRENT@$TEMP,$member" --games "$GAMES_OPP" --seed "$seed" --out "$rollout"
    data_specs+=("$rollout@0")
    seed=$((seed + GAMES_OPP))
    rollout="$WORKDIR/rollout-$i-league$m-s1.jsonl"
    npm run --silent export-training -- \
      --agents "$member,bc:$CURRENT@$TEMP" --games "$GAMES_OPP" --seed "$seed" --out "$rollout"
    data_specs+=("$rollout@1")
    seed=$((seed + GAMES_OPP))
  done

  echo "=== iteration $i: $MODE update ($EPOCHS epoch(s)) over ${#data_specs[@]} rollout file(s) ==="
  python3 train/train_bc.py --mode "$MODE" --init "$CURRENT" \
    --data "${data_specs[@]}" --out "$candidate" --epochs "$EPOCHS" --lr "$LR" \
    --entropy "$ENTROPY" --clip "$CLIP" --kl-target "$KL_TARGET" --holdout 0

  promote=1
  echo "=== iteration $i: gate candidate vs champion (min-elo $GATE_MIN_ELO) ==="
  if ! npm run --silent gate -- --challenger "bc:$candidate" --champion "bc:$CHAMPION" \
    --pairs "$GATE_PAIRS" --rounds "$GATE_ROUNDS" --seed $((seed + 700000)) --min-elo "$GATE_MIN_ELO"; then
    promote=0
  fi
  # The league gates always run: they are both the promotion no-regression
  # criterion and (in accumulate mode) the drift detector for the learning
  # line, so they cannot be short-circuited on a champion-gate failure.
  league_blowout=0
  m=0
  for member in "${LEAGUE_MEMBERS[@]}"; do
    m=$((m + 1))
    gate_log="$WORKDIR/gate-$i-league$m.log"
    echo "=== iteration $i: gate candidate vs league member $member (min-elo $GATE_LEAGUE_MIN_ELO) ==="
    if ! npm run --silent gate -- --challenger "bc:$candidate" --champion "$member" \
      --pairs "$GATE_PAIRS" --rounds "$GATE_ROUNDS" --seed $((seed + 800000)) --min-elo "$GATE_LEAGUE_MIN_ELO" \
      | tee "$gate_log"; then
      promote=0
    fi
    point=$(grep -m1 '^elo diff:' "$gate_log" | sed -E 's/^elo diff:[[:space:]]+([+-]?[0-9]+).*/\1/' || true)
    if [ -n "$point" ] && (( point < 2 * GATE_LEAGUE_MIN_ELO )); then
      league_blowout=1
    fi
  done

  if [ "$promote" = 1 ]; then
    echo "=== iteration $i: PROMOTED $candidate ==="
    CHAMPION=$(realpath "$candidate")
    CURRENT=$(realpath "$candidate")
  elif [ "$ACCUMULATE" = 1 ] && [ "$league_blowout" = 0 ]; then
    echo "=== iteration $i: not promoted — learning continues from candidate ==="
    CURRENT=$(realpath "$candidate")
  elif [ "$league_blowout" = 1 ]; then
    echo "=== iteration $i: league blowout (point < $((2 * GATE_LEAGUE_MIN_ELO))) — learning resets to champion ==="
    CURRENT="$CHAMPION"
  else
    echo "=== iteration $i: candidate rejected, learning resets to champion ==="
    CURRENT="$CHAMPION"
  fi
  rm -f "$WORKDIR/rollout-$i-"*.jsonl
done

echo "final champion: $CHAMPION"
echo "final learning line: $CURRENT"
