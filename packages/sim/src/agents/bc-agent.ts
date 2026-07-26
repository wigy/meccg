/**
 * @module agents/bc-agent
 *
 * Behavioral-cloning agent (P3): pure-TypeScript inference for the
 * action-conditioned policy/value net trained by `train/train_bc.py`. The
 * Python trainer exports weights as JSON (shapes + flat row-major data);
 * this module mirrors the network's forward pass exactly — embeddings,
 * mean-pooled entity set encoder, state torso, per-candidate scorer with
 * masked softmax, tanh value head — so no ONNX runtime or native
 * dependency is needed for a net this small. Every weights file carries a
 * `selfTest` block (real example inputs + the trainer's outputs) which
 * {@link runBcSelfTest} replays to prove the two runtimes agree; the agent
 * refuses to play when the self-test or the card-vocabulary hash fails,
 * so silent featurizer/weight drift cannot masquerade as a weak policy.
 */

import * as fs from 'fs';
import type { CardDefinition } from '@meccg/shared';
import type { Agent, AgentContext, AgentDecision } from '../types.js';
import { buildCardVocab, featurizeState, featurizeActions, FEATURE_SPEC_VERSION } from '../features/index.js';
import type { CardVocab, StateFeatures, ActionFeatures } from '../features/index.js';

/** One exported tensor: shape plus flat row-major data. */
export interface TensorJson {
  readonly shape: readonly number[];
  readonly data: readonly number[];
}

/** The weights file written by `train/train_bc.py`. */
export interface BcWeightsFile {
  readonly kind: 'meccg-bc-weights';
  readonly formatVersion: 1;
  readonly featureSpecVersion: number;
  readonly vocabSize: number;
  readonly vocabHash: string;
  readonly actionTypeCount: number;
  readonly globalWidth: number;
  readonly dims: { readonly preset: string; readonly values: readonly number[] };
  readonly training?: Readonly<Record<string, unknown>>;
  readonly weights: Readonly<Record<string, TensorJson>>;
  readonly selfTest: {
    readonly global: readonly number[];
    readonly entities: readonly (readonly number[])[];
    readonly candidates: readonly (readonly number[])[];
    readonly mask: readonly number[];
    readonly expectedProbs: readonly number[];
    readonly expectedValue: number;
  };
}

// Feature-spec v1 column layout (must match train_bc.py).
const ENTITY_ZONE_COL = 0;
const ENTITY_CARD_COL = 2;
const ENTITY_BEARER_COL = 5;
const ENTITY_NUMERIC_COLS = [1, 3, 4, 6, 7, 8, 9, 10, 11, 12] as const;
const CAND_TYPE_COL = 0;
const CAND_REF_COLS = [3, 4, 5, 6] as const;
const CAND_NUMERIC_COLS = [1, 2, 7, 8] as const;

/** Loads and structurally validates a weights file. */
export function loadBcWeights(path: string): BcWeightsFile {
  const parsed = JSON.parse(fs.readFileSync(path, 'utf-8')) as BcWeightsFile;
  if (parsed.kind !== 'meccg-bc-weights' || parsed.formatVersion !== 1) {
    throw new Error(`${path} is not a v1 meccg-bc-weights file`);
  }
  if (parsed.featureSpecVersion !== FEATURE_SPEC_VERSION) {
    throw new Error(`${path} was trained on feature spec v${parsed.featureSpecVersion}, this build speaks v${FEATURE_SPEC_VERSION}`);
  }
  for (const [name, tensor] of Object.entries(parsed.weights)) {
    const expected = tensor.shape.reduce((product, dim) => product * dim, 1);
    if (tensor.data.length !== expected) {
      throw new Error(`${path}: tensor ${name} has ${tensor.data.length} values, shape says ${expected}`);
    }
  }
  return parsed;
}

/** y = W·x + b for a torch Linear (`weight` shape [out, in], row-major). */
function linear(weight: TensorJson, bias: TensorJson, x: readonly number[]): number[] {
  const [rows, cols] = [weight.shape[0], weight.shape[1]];
  const out = new Array<number>(rows);
  for (let r = 0; r < rows; r++) {
    let sum = bias.data[r];
    const base = r * cols;
    for (let c = 0; c < cols; c++) sum += weight.data[base + c] * x[c];
    out[r] = sum;
  }
  return out;
}

function relu(x: number[]): number[] {
  for (let i = 0; i < x.length; i++) if (x[i] < 0) x[i] = 0;
  return x;
}

/** Copies embedding row `index` (clamped into range) into `out` at `offset`. */
function embedInto(table: TensorJson, index: number, out: number[], offset: number): void {
  const [rows, dim] = [table.shape[0], table.shape[1]];
  const row = Math.min(Math.max(Math.trunc(index), 0), rows - 1);
  const base = row * dim;
  for (let i = 0; i < dim; i++) out[offset + i] = table.data[base + i];
}

/** Policy distribution and value estimate for one featurized decision. */
export interface BcOutput {
  /** Probability per candidate (non-viable candidates get 0). */
  readonly probs: readonly number[];
  /** Win-probability estimate in [-1, 1] from the acting player's view. */
  readonly value: number;
}

/** Runs the forward pass — the exact mirror of `BcNet.forward`. */
export function bcForward(model: BcWeightsFile, state: StateFeatures, actions: ActionFeatures): BcOutput {
  const w = model.weights;
  const dZone = w['emb_zone.weight'].shape[1];
  const dCard = w['emb_card.weight'].shape[1];
  const dType = w['emb_type.weight'].shape[1];

  // Entity set encoder: relu(ent_lin([zone, card, bearer, numerics])), mean-pooled.
  const entWidth = dZone + 2 * dCard + ENTITY_NUMERIC_COLS.length;
  const entInput = new Array<number>(entWidth);
  const pooledWidth = w['ent_lin.weight'].shape[0];
  const pooled = new Array<number>(pooledWidth).fill(0);
  for (const row of state.entities) {
    embedInto(w['emb_zone.weight'], row[ENTITY_ZONE_COL], entInput, 0);
    embedInto(w['emb_card.weight'], row[ENTITY_CARD_COL], entInput, dZone);
    embedInto(w['emb_card.weight'], row[ENTITY_BEARER_COL], entInput, dZone + dCard);
    ENTITY_NUMERIC_COLS.forEach((col, i) => {
      entInput[dZone + 2 * dCard + i] = row[col];
    });
    const encoded = relu(linear(w['ent_lin.weight'], w['ent_lin.bias'], entInput));
    for (let i = 0; i < pooledWidth; i++) pooled[i] += encoded[i];
  }
  const denom = Math.max(state.entities.length, 1);
  for (let i = 0; i < pooledWidth; i++) pooled[i] /= denom;

  // State torso: relu(torso([glob_enc, pooled])).
  const globalEncoded = relu(linear(w['glob_lin.weight'], w['glob_lin.bias'], state.global));
  const stateVector = relu(linear(w['torso.weight'], w['torso.bias'], [...globalEncoded, ...pooled]));

  // Per-candidate scores.
  const candWidth = dType + dCard + CAND_NUMERIC_COLS.length;
  const candInput = new Array<number>(candWidth);
  const refEmbed = new Array<number>(dCard);
  const logits = actions.candidates.map(candidate => {
    embedInto(w['emb_type.weight'], candidate[CAND_TYPE_COL], candInput, 0);
    candInput.fill(0, dType, dType + dCard);
    for (const col of CAND_REF_COLS) {
      embedInto(w['emb_card.weight'], candidate[col], refEmbed, 0);
      for (let i = 0; i < dCard; i++) candInput[dType + i] += refEmbed[i] / CAND_REF_COLS.length;
    }
    CAND_NUMERIC_COLS.forEach((col, i) => {
      candInput[dType + dCard + i] = candidate[col];
    });
    const encoded = relu(linear(w['cand_lin.weight'], w['cand_lin.bias'], candInput));
    const hidden = relu(linear(w['score1.weight'], w['score1.bias'], [...stateVector, ...encoded]));
    return linear(w['score2.weight'], w['score2.bias'], hidden)[0];
  });

  // Masked softmax over viable candidates.
  let max = -Infinity;
  logits.forEach((logit, i) => {
    if (actions.mask[i] > 0.5 && logit > max) max = logit;
  });
  const exps = logits.map((logit, i) => (actions.mask[i] > 0.5 ? Math.exp(logit - max) : 0));
  const total = exps.reduce((sum, e) => sum + e, 0) || 1;
  const probs = exps.map(e => e / total);

  // Value head. Weights trained after 2026-07-26 give the head a direct
  // skip connection from the global feature vector (the shared torso is
  // dominated by the policy loss); detect that by the layer's input width
  // so older weights files keep loading unchanged.
  const valueInput = w['value1.weight'].shape[1] === stateVector.length + state.global.length
    ? [...stateVector, ...state.global]
    : stateVector;
  const valueHidden = relu(linear(w['value1.weight'], w['value1.bias'], valueInput));
  const value = Math.tanh(linear(w['value2.weight'], w['value2.bias'], valueHidden)[0]);

  return { probs, value };
}

/**
 * Replays the weights file's embedded self-test example and returns the
 * largest output deviation. Anything above ~1e-4 means the TS forward pass
 * and the trainer have drifted apart.
 */
export function runBcSelfTest(model: BcWeightsFile): number {
  const output = bcForward(
    model,
    { global: model.selfTest.global, entities: model.selfTest.entities },
    { candidates: model.selfTest.candidates, mask: model.selfTest.mask },
  );
  let worst = Math.abs(output.value - model.selfTest.expectedValue);
  model.selfTest.expectedProbs.forEach((expected, i) => {
    worst = Math.max(worst, Math.abs(output.probs[i] - expected));
  });
  return worst;
}

/** Tolerance for the runtime-parity self-test (float32 vs float64 rounding). */
const SELF_TEST_TOLERANCE = 2e-4;

/** Options for {@link createBcAgent}. */
export interface BcAgentOptions {
  /**
   * When set, sample the action from the policy distribution sharpened to
   * `probs^(1/temperature)` instead of playing the argmax. Temperature 1
   * samples the policy as-is (the exploration mode self-play RL rollouts
   * use); lower values approach argmax. Sampling draws from the agent's
   * seeded stream, so rollouts stay reproducible.
   */
  readonly temperature?: number;
}

/**
 * Creates the behavioral-cloning agent from a weights file. Plays the
 * argmax of the policy over viable candidates (or samples, see
 * {@link BcAgentOptions.temperature}); the full distribution is surfaced
 * as the considered weights for transcripts, replays, and RL training
 * data.
 */
export function createBcAgent(weightsPath: string, options?: BcAgentOptions): Agent {
  const model = loadBcWeights(weightsPath);
  const selfTestError = runBcSelfTest(model);
  if (selfTestError > SELF_TEST_TOLERANCE) {
    throw new Error(`bc weights self-test failed: max deviation ${selfTestError} > ${SELF_TEST_TOLERANCE}`);
  }
  const temperature = options?.temperature;
  if (temperature !== undefined && !(temperature > 0)) {
    throw new Error(`bc temperature must be > 0, got ${temperature}`);
  }
  let vocab: CardVocab | null = null;
  let cachedPool: Readonly<Record<string, CardDefinition>> | null = null;

  return {
    name: temperature === undefined ? 'bc' : `bc@${temperature}`,
    chooseAction(context: AgentContext): AgentDecision {
      if (vocab === null || cachedPool !== context.cardPool) {
        vocab = buildCardVocab(context.cardPool);
        cachedPool = context.cardPool;
        if (vocab.hash !== model.vocabHash) {
          throw new Error(`card vocabulary mismatch: weights ${model.vocabHash}, pool ${vocab.hash}`);
        }
      }
      const state = featurizeState(context.view, context.cardPool, vocab);
      const actions = featurizeActions(context.view, context.cardPool, vocab);
      const output = bcForward(model, state, actions);

      let bestIndex = -1;
      if (temperature === undefined) {
        output.probs.forEach((prob, i) => {
          if (context.view.legalActions[i].viable && (bestIndex === -1 || prob > output.probs[bestIndex])) {
            bestIndex = i;
          }
        });
      } else {
        // Temperature sampling over viable candidates from the seeded stream.
        const sharpened = output.probs.map((prob, i) =>
          context.view.legalActions[i].viable && prob > 0 ? Math.pow(prob, 1 / temperature) : 0,
        );
        const total = sharpened.reduce((sum, p) => sum + p, 0);
        if (total > 0) {
          let draw = context.random() * total;
          for (let i = 0; i < sharpened.length; i++) {
            draw -= sharpened[i];
            if (sharpened[i] > 0 && draw <= 0) {
              bestIndex = i;
              break;
            }
          }
          if (bestIndex === -1) {
            bestIndex = sharpened.reduce((best, p, i) => (p > 0 ? i : best), -1);
          }
        }
      }
      if (bestIndex === -1) {
        return { action: context.legalActions[0], note: 'bc: no viable candidate scored — took first legal action' };
      }
      const considered = context.view.legalActions
        .map((evaluated, i) => ({ action: evaluated.action, weight: output.probs[i] }))
        .filter((_, i) => context.view.legalActions[i].viable);
      return {
        action: context.view.legalActions[bestIndex].action,
        considered,
        note: `value ${output.value.toFixed(3)}`,
      };
    },
  };
}
