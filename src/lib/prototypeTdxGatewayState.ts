/**
 * PROTOTYPE — throwaway TDX gateway state model.
 *
 * Question: can one runtime-neutral decision flow clearly cover Alert degradation,
 * fresh/stale cache, booking no-store, raw OData forwarding, token failure, and
 * request coalescing without Vercel/Express branches?
 *
 * The reducer is pure and has no terminal or network I/O. If the model is validated,
 * only the decisions should be lifted into production; this prototype file should not ship.
 */

export type PrototypeRequestKind = 'standard' | 'alert' | 'booking';
export type PrototypeUpstream = 'ok' | '429' | '500' | 'network-error';
export type PrototypeToken = 'valid' | 'expired' | 'missing' | 'backoff';

interface PrototypeRequest {
  kind: PrototypeRequestKind;
  inputPath: string;
  correctedPath: string;
  rawQuery: string;
  cacheKey: string;
  cacheable: boolean;
  ttlMs: number;
}

interface PrototypeCacheEntry {
  body: unknown;
  expiresAt: number;
}

export interface PrototypeDecision {
  status: number;
  body: unknown;
  headers: Record<string, string>;
  outboundUrl: string | null;
  note: string;
}

export interface TdxGatewayPrototypeState {
  nowMs: number;
  requestKind: PrototypeRequestKind;
  upstream: PrototypeUpstream;
  token: PrototypeToken;
  cache: Record<string, PrototypeCacheEntry>;
  metrics: {
    tokenOperations: number;
    upstreamOperations: number;
    coalescedRequests: number;
  };
  lastDecision: PrototypeDecision | null;
  history: string[];
}

export type TdxGatewayPrototypeAction =
  | { type: 'select-request'; kind: PrototypeRequestKind }
  | { type: 'set-upstream'; upstream: PrototypeUpstream }
  | { type: 'set-token'; token: PrototypeToken }
  | { type: 'advance-time' }
  | { type: 'send'; concurrent?: boolean }
  | { type: 'clear-cache' }
  | { type: 'reset' };

const TDX_ORIGIN = 'https://tdx.transportdata.tw/api/';
const AUTH_BACKOFF_SECONDS = '15';

function describeRequest(kind: PrototypeRequestKind): PrototypeRequest {
  if (kind === 'alert') {
    const inputPath = 'basic/v2/Rail/TRA/Alert';
    const correctedPath = 'basic/v3/Rail/TRA/Alert';
    const rawQuery = '?$format=JSON';
    return {
      kind,
      inputPath,
      correctedPath,
      rawQuery,
      cacheKey: buildCacheKey(correctedPath, rawQuery),
      cacheable: true,
      ttlMs: 5 * 60_000,
    };
  }

  if (kind === 'booking') {
    const inputPath = 'maas/booking/deeplink/direct/tra';
    const rawQuery = '?train_number=123&train_date=2026-07-16';
    return {
      kind,
      inputPath,
      correctedPath: inputPath,
      rawQuery,
      cacheKey: buildCacheKey(inputPath, rawQuery),
      cacheable: false,
      ttlMs: 0,
    };
  }

  const inputPath = 'basic/v3/Rail/TRA/DailyTrainTimetable/OD/1000/to/1020/2026-07-16';
  const rawQuery = "?$filter=DailyTrainInfo/TrainNo eq '123'&$format=JSON";
  return {
    kind,
    inputPath,
    correctedPath: inputPath,
    rawQuery,
    cacheKey: buildCacheKey(inputPath, rawQuery),
    cacheable: true,
    ttlMs: 60 * 60_000,
  };
}

function buildCacheKey(path: string, rawQuery: string): string {
  const normalized = new URLSearchParams(rawQuery.replace(/^\?/, ''));
  normalized.sort();
  return `${path}?${normalized.toString()}`;
}

function appendHistory(state: TdxGatewayPrototypeState, message: string): string[] {
  return [...state.history, message].slice(-6);
}

function cloneState(state: TdxGatewayPrototypeState): TdxGatewayPrototypeState {
  return {
    ...state,
    cache: { ...state.cache },
    metrics: { ...state.metrics },
    history: [...state.history],
  };
}

function upstreamBody(request: PrototypeRequest): unknown {
  if (request.kind === 'alert') return [{ AlertID: 'A-1', Title: 'Prototype alert' }];
  if (request.kind === 'booking') return { url: 'traapp://prototype-booking-link' };
  return [{ TrainNo: '123', DepartureTime: '09:00', ArrivalTime: '09:42' }];
}

function alertFallback(reason: string): PrototypeDecision {
  return {
    status: 200,
    body: [],
    headers: { 'X-Fallback': reason },
    outboundUrl: null,
    note: 'Alert 是非關鍵資料，失敗時統一降級為空陣列。',
  };
}

function execute(
  state: TdxGatewayPrototypeState,
  concurrent: boolean,
): TdxGatewayPrototypeState {
  const next = cloneState(state);
  const request = describeRequest(next.requestKind);
  const cached = next.cache[request.cacheKey];
  const isFresh = request.cacheable && cached && cached.expiresAt > next.nowMs;

  if (isFresh) {
    next.lastDecision = {
      status: 200,
      body: cached.body,
      headers: { 'X-Cache': 'HIT' },
      outboundUrl: null,
      note: 'fresh cache 直接回應，不接觸 token 或 TDX。',
    };
    next.history = appendHistory(next, `${request.kind}: fresh cache HIT`);
    return next;
  }

  if (next.token === 'missing' || next.token === 'backoff') {
    if (request.kind === 'alert') {
      next.lastDecision = alertFallback('ALERT_EMPTY_NO_TOKEN');
      next.history = appendHistory(next, 'alert: token 不可用 → 200 []');
      return next;
    }

    if (request.cacheable && cached) {
      next.lastDecision = {
        status: 200,
        body: cached.body,
        headers: { 'X-Cache': 'STALE' },
        outboundUrl: null,
        note: 'token 暫時不可用，但過期 cache 仍優於 503。',
      };
      next.history = appendHistory(next, `${request.kind}: token 不可用 → STALE`);
      return next;
    }

    next.lastDecision = {
      status: 503,
      body: {
        error: 'Token Error',
        reason: next.token === 'missing' ? 'missing_credentials' : 'auth_failed',
      },
      headers: { 'Retry-After': AUTH_BACKOFF_SECONDS },
      outboundUrl: null,
      note: '沒有可用 token 或 stale cache，回傳暫時不可用。',
    };
    next.history = appendHistory(next, `${request.kind}: token 不可用 → 503`);
    return next;
  }

  if (next.token === 'expired') {
    next.metrics.tokenOperations += 1;
    next.token = 'valid';
    next.history = appendHistory(next, 'expired token → shared auth operation 1 次');
  }

  const coalesced = concurrent && request.cacheable;
  next.metrics.upstreamOperations += concurrent && !request.cacheable ? 2 : 1;
  if (coalesced) next.metrics.coalescedRequests += 1;

  const outboundUrl = `${TDX_ORIGIN}${request.correctedPath}${request.rawQuery}`;
  if (next.upstream === 'ok') {
    const body = upstreamBody(request);
    if (request.cacheable) {
      next.cache[request.cacheKey] = { body, expiresAt: next.nowMs + request.ttlMs };
    }
    next.lastDecision = {
      status: 200,
      body,
      headers: request.cacheable
        ? { 'X-Cache': 'MISS' }
        : { 'Cache-Control': 'no-store' },
      outboundUrl,
      note: coalesced
        ? '兩個同 key 的同時請求共用一次 TDX operation。'
        : request.cacheable
          ? '成功回應寫入 fresh cache。'
          : concurrent
            ? '兩個 booking 請求各自呼叫 TDX，且都不寫入 cache。'
            : 'booking 直接回應且永不寫入 cache。',
    };
    next.history = appendHistory(
      next,
      `${request.kind}: upstream 200${coalesced ? '（2→1 去重）' : concurrent ? '（2 次、不去重）' : ''}`,
    );
    return next;
  }

  if (request.kind === 'alert') {
    next.lastDecision = {
      ...alertFallback('ALERT_EMPTY_UPSTREAM'),
      outboundUrl,
    };
    next.history = appendHistory(next, `alert: upstream ${next.upstream} → 200 []`);
    return next;
  }

  if (request.cacheable && cached) {
    next.lastDecision = {
      status: 200,
      body: cached.body,
      headers: { 'X-Cache': 'STALE' },
      outboundUrl,
      note: `upstream ${next.upstream}，改回傳過期 cache。`,
    };
    next.history = appendHistory(next, `${request.kind}: upstream ${next.upstream} → STALE`);
    return next;
  }

  const status = next.upstream === '429' ? 429 : 500;
  next.lastDecision = {
    status,
    body: { error: next.upstream },
    headers: request.kind === 'booking' ? { 'Cache-Control': 'no-store' } : {},
    outboundUrl,
    note: '沒有 fallback 可用，保留上游失敗結果。',
  };
  next.history = appendHistory(next, `${request.kind}: upstream ${next.upstream} → ${status}`);
  return next;
}

export function initialTdxGatewayPrototypeState(): TdxGatewayPrototypeState {
  return {
    nowMs: 0,
    requestKind: 'standard',
    upstream: 'ok',
    token: 'expired',
    cache: {},
    metrics: {
      tokenOperations: 0,
      upstreamOperations: 0,
      coalescedRequests: 0,
    },
    lastDecision: null,
    history: ['prototype ready'],
  };
}

export function describeCurrentPrototypeRequest(
  state: TdxGatewayPrototypeState,
): PrototypeRequest {
  return describeRequest(state.requestKind);
}

export function reduceTdxGatewayPrototype(
  state: TdxGatewayPrototypeState,
  action: TdxGatewayPrototypeAction,
): TdxGatewayPrototypeState {
  if (action.type === 'reset') return initialTdxGatewayPrototypeState();

  if (action.type === 'send') return execute(state, action.concurrent === true);

  const next = cloneState(state);
  if (action.type === 'select-request') {
    next.requestKind = action.kind;
    next.history = appendHistory(next, `選擇 ${action.kind} request`);
  } else if (action.type === 'set-upstream') {
    next.upstream = action.upstream;
    next.history = appendHistory(next, `upstream 設為 ${action.upstream}`);
  } else if (action.type === 'set-token') {
    next.token = action.token;
    next.history = appendHistory(next, `token 設為 ${action.token}`);
  } else if (action.type === 'advance-time') {
    next.nowMs += 61 * 60_000;
    next.history = appendHistory(next, '時間前進 61 分鐘');
  } else if (action.type === 'clear-cache') {
    next.cache = {};
    next.history = appendHistory(next, '清除 cache');
  }
  next.lastDecision = null;
  return next;
}
