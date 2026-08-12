import { readFileSync } from 'fs';

async function main() {
  const { loadCardPool, setEngineConsoleLog } = await import('@meccg/shared');
  const { projectPlayerView } = await import('@meccg/game-server');
  const { createMcAgent } = await import('@meccg/sim');
  setEngineConsoleLog(false);

  const lines = readFileSync('/tmp/msq1wzcy-gwjpmx.jsonl', 'utf8').split('\n').filter(Boolean);
  let target;
  for (const line of lines) {
    const d = JSON.parse(line);
    if (d.stateSeq === 358) { target = d; break; }
  }
  const cardPool = loadCardPool();
  const state = { ...target.state, cardPool };
  const view = projectPlayerView(state, 'p2');
  const legalActions = view.legalActions.filter(e => e.viable).map(e => e.action);

  const mc = createMcAgent({ rollouts: 40, horizonTurns: 3, maxDecisions: 360, maxCandidates: 4 });

  let discardWins = 0, passWins = 0;
  const N = 40;
  for (let trial = 0; trial < N; trial++) {
    let s = 1000 + trial * 7919 + 13;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const context = { view, cardPool, legalActions, evaluated: view.legalActions, random: rnd };
    const decision = mc.chooseAction(context);
    if (decision.action.type === 'discard-character') discardWins++;
    else passWins++;
  }
  console.log({ discardWins, passWins, N });
}
main().catch(e => { console.error(e); process.exit(1); });
