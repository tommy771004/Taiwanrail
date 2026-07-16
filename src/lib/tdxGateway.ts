export interface TdxGatewayRequest {
  path: string;
  rawQuery: string;
}

export interface TdxGatewayResponse {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface TdxTransport {
  request(input: { url: string }): Promise<{
    status: number;
    body: unknown;
  }>;
}

export interface TdxClock {
  now(): number;
}

export function createTdxGateway(dependencies: {
  tdx: TdxTransport;
  clock?: TdxClock;
}): {
  execute(input: TdxGatewayRequest): Promise<TdxGatewayResponse>;
} {
  const cache = new Map<
    string,
    { status: number; body: unknown; expiresAt: number }
  >();

  return {
    async execute(input) {
      let path = input.path;
      if (path.includes('TRA/Alert')) {
        path = 'basic/v3/Rail/TRA/Alert';
      } else if (path.includes('TRA/LiveBoard')) {
        const station = path.match(/Station\/(\d+)/);
        path = station
          ? `basic/v2/Rail/TRA/LiveBoard/Station/${station[1]}`
          : 'basic/v2/Rail/TRA/LiveBoard';
      } else if (path.includes('Bus/Station/NearBy')) {
        path = `advanced/${path.replace(/^(?:basic|advanced)\//, '')}`;
      }
      const isAlert = /\/Rail\/(?:TRA|THSR)\/Alert/i.test(path);
      const normalizedQuery = new URLSearchParams(input.rawQuery);
      normalizedQuery.sort();
      const cacheKey = `${path}?${normalizedQuery.toString()}`;
      const now = dependencies.clock?.now() ?? Date.now();
      const cached = cache.get(cacheKey);

      if (cached && cached.expiresAt > now) {
        return {
          status: cached.status,
          body: cached.body,
          headers: { 'X-Cache': 'HIT' },
        };
      }

      let upstream: { status: number; body: unknown };

      try {
        upstream = await dependencies.tdx.request({
          url: `https://tdx.transportdata.tw/api/${path}${input.rawQuery}`,
        });
      } catch (error) {
        if (!isAlert) {
          throw error;
        }

        return {
          status: 200,
          body: [],
          headers: { 'X-Fallback': 'ALERT_EMPTY_UPSTREAM' },
        };
      }

      if (
        isAlert &&
        (!Array.isArray(upstream.body) ||
          upstream.status === 404 ||
          upstream.status === 429 ||
          upstream.status >= 500)
      ) {
        return {
          status: 200,
          body: [],
          headers: { 'X-Fallback': 'ALERT_EMPTY_UPSTREAM' },
        };
      }

      if (upstream.status >= 200 && upstream.status < 300) {
        let ttl = 120_000;
        if (path.includes('LiveBoard')) ttl = 30_000;
        else if (path.includes('Alert')) ttl = 5 * 60_000;
        else if (
          path.includes('DailyTimetable') ||
          path.includes('DailyTrainTimetable')
        ) {
          ttl = 60 * 60_000;
        } else if (path.includes('ODFare') || path.includes('Station')) {
          ttl = 24 * 60 * 60_000;
        } else if (path.includes('maas/routing')) {
          ttl = 60_000;
        }

        cache.set(cacheKey, {
          status: upstream.status,
          body: upstream.body,
          expiresAt: now + ttl,
        });
      }

      return {
        status: upstream.status,
        body: upstream.body,
        headers: { 'X-Cache': 'MISS' },
      };
    },
  };
}
