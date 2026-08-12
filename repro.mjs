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
  console.log('viable actions:', JSON.stringify(legalActions, null, 2));

  const mc = createMcAgent({ rollouts: 300, horizonTurns: 3, maxDecisions: 360, maxCandidates: 4 });
  const context = {
    view,
    cardPool,
    legalActions,
    evaluated: view.legalActions,
    random: (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })(),
  };
  const decision = mc.chooseAction(context);
  console.log('DECISION:', JSON.stringify(decision, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
