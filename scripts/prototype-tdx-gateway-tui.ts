/** PROTOTYPE — throwaway terminal shell for the TDX gateway state model. */

import {
  describeCurrentPrototypeRequest,
  initialTdxGatewayPrototypeState,
  reduceTdxGatewayPrototype,
  type TdxGatewayPrototypeAction,
} from '../src/lib/prototypeTdxGatewayState.ts';

const bold = '\x1b[1m';
const dim = '\x1b[2m';
const cyan = '\x1b[36m';
const yellow = '\x1b[33m';
const reset = '\x1b[0m';

let state = initialTdxGatewayPrototypeState();

function json(value: unknown): string {
  return JSON.stringify(value);
}

function cacheSummary(): string[] {
  const entries = Object.entries(state.cache);
  if (entries.length === 0) return ['  (empty)'];
  return entries.map(([key, value]) => {
    const freshness = value.expiresAt > state.nowMs ? 'fresh' : 'stale';
    return `  ${freshness.padEnd(5)} expires=${value.expiresAt}  ${key}`;
  });
}

function render(): void {
  const request = describeCurrentPrototypeRequest(state);
  const decision = state.lastDecision;
  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(`${bold}${cyan}TDX Gateway State Prototype${reset}\n`);
  process.stdout.write(`${dim}問題：單一共享流程能否涵蓋 Alert、cache、booking、token 與去重？${reset}\n\n`);

  process.stdout.write(`${bold}目前輸入${reset}\n`);
  process.stdout.write(`  nowMs:          ${state.nowMs}\n`);
  process.stdout.write(`  request:        ${state.requestKind}\n`);
  process.stdout.write(`  inputPath:      ${request.inputPath}\n`);
  process.stdout.write(`  correctedPath:  ${request.correctedPath}\n`);
  process.stdout.write(`  rawQuery:       ${request.rawQuery}\n`);
  process.stdout.write(`  cacheKey:       ${request.cacheKey}\n`);
  process.stdout.write(`  token:          ${state.token}\n`);
  process.stdout.write(`  upstream:       ${state.upstream}\n\n`);

  process.stdout.write(`${bold}Cache${reset}\n${cacheSummary().join('\n')}\n\n`);

  process.stdout.write(`${bold}最後決策${reset}\n`);
  if (!decision) {
    process.stdout.write('  (尚未送出，或輸入剛變更)\n');
  } else {
    process.stdout.write(`  status:         ${decision.status}\n`);
    process.stdout.write(`  body:           ${json(decision.body)}\n`);
    process.stdout.write(`  headers:        ${json(decision.headers)}\n`);
    process.stdout.write(`  outboundUrl:    ${decision.outboundUrl ?? '(none)'}\n`);
    process.stdout.write(`  note:           ${decision.note}\n`);
  }

  process.stdout.write(`\n${bold}計數${reset}\n`);
  process.stdout.write(`  token operations:     ${state.metrics.tokenOperations}\n`);
  process.stdout.write(`  upstream operations:  ${state.metrics.upstreamOperations}\n`);
  process.stdout.write(`  coalesced requests:   ${state.metrics.coalescedRequests}\n`);

  process.stdout.write(`\n${bold}最近狀態轉換${reset}\n`);
  for (const line of state.history) process.stdout.write(`  ${dim}${line}${reset}\n`);

  process.stdout.write(`\n${bold}${yellow}操作${reset}\n`);
  process.stdout.write('  [1] standard  [2] Alert  [3] booking\n');
  process.stdout.write('  [o] upstream 200  [r] 429  [e] 500  [n] network error\n');
  process.stdout.write('  [k] token valid  [v] token expired  [m] credentials missing  [x] auth backoff\n');
  process.stdout.write('  [d] 送出一次  [p] 同 key 並行兩次  [t] +61 分鐘\n');
  process.stdout.write('  [c] 清 cache  [z] reset  [q] quit\n');
}

function dispatch(action: TdxGatewayPrototypeAction): void {
  state = reduceTdxGatewayPrototype(state, action);
  render();
}

if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
  process.stderr.write('這個 prototype 需要互動式終端。請直接執行 npm run prototype:tdx-gateway\n');
  process.exit(1);
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
render();

process.stdin.on('data', (key: string) => {
  if (key === 'q' || key === '\u0003') {
    process.stdin.setRawMode(false);
    process.stdout.write('\n');
    process.exit(0);
  }

  const action: Record<string, TdxGatewayPrototypeAction> = {
    '1': { type: 'select-request', kind: 'standard' },
    '2': { type: 'select-request', kind: 'alert' },
    '3': { type: 'select-request', kind: 'booking' },
    o: { type: 'set-upstream', upstream: 'ok' },
    r: { type: 'set-upstream', upstream: '429' },
    e: { type: 'set-upstream', upstream: '500' },
    n: { type: 'set-upstream', upstream: 'network-error' },
    k: { type: 'set-token', token: 'valid' },
    v: { type: 'set-token', token: 'expired' },
    m: { type: 'set-token', token: 'missing' },
    x: { type: 'set-token', token: 'backoff' },
    d: { type: 'send' },
    p: { type: 'send', concurrent: true },
    t: { type: 'advance-time' },
    c: { type: 'clear-cache' },
    z: { type: 'reset' },
  };

  if (action[key]) dispatch(action[key]);
});
