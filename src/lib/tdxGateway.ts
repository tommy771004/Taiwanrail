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
  requestToken?(input: {
    clientId: string;
    clientSecret: string;
  }): Promise<{ token: string; expiresInSeconds: number } | null>;
  request(input: { url: string; accessToken?: string }): Promise<{
    status: number;
    body: unknown;
  }>;
}

export interface TdxClock {
  now(): number;
}

/**
 * Product allowlist for authenticated TDX proxy paths (after known rewrites).
 * Anything outside this set must not consume TDX credentials or upstream quota.
 */
const ALLOWED_TDX_PATH = [
  /^basic\/v[23]\/Rail\/TRA(?:\/|$)/i,
  /^basic\/v[23]\/Rail\/THSR(?:\/|$)/i,
  /^basic\/v2\/Rail\/Metro(?:\/|$)/i,
  /^advanced\/v2\/Bus\/Station\/NearBy(?:\/|$)/i,
  /^maas\/routing$/i,
  /^maas\/booking\/deeplink\//i,
];

function isAllowedTdxPath(path: string): boolean {
  if (!path || path.includes('..') || path.includes('\\') || path.includes('\0')) {
    return false;
  }
  if (path.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(path)) {
    return false;
  }
  return ALLOWED_TDX_PATH.some((pattern) => pattern.test(path));
}

export function createTdxGateway(dependencies: {
  tdx: TdxTransport;
  clock?: TdxClock;
  credentials?: () => {
    clientId?: string;
    clientSecret?: string;
  };
  logger?: Pick<Console, 'error' | 'warn'>;
  sleep?: (milliseconds: number) => Promise<void>;
}): {
  execute(input: TdxGatewayRequest): Promise<TdxGatewayResponse>;
} {
  const cache = new Map<
    string,
    { status: number; body: unknown; expiresAt: number }
  >();
  const inFlight = new Map<
    string,
    Promise<{ status: number; body: unknown }>
  >();
  let credentialsWarningLogged = false;
  let cachedAccessToken: string | null = null;
  let accessTokenExpiresAt = 0;
  let tokenInFlight: Promise<string | null> | null = null;
  let tokenFailedUntil = 0;

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

      if (!isAllowedTdxPath(path)) {
        return {
          status: 403,
          body: { error: 'Forbidden path' },
          headers: { 'X-Gateway': 'PATH_DENIED' },
        };
      }

      const isAlert = /\/Rail\/(?:TRA|THSR)\/Alert/i.test(path);
      const isBooking = /maas\/booking\/deeplink\//i.test(path);
      const normalizedQuery = new URLSearchParams(input.rawQuery);
      normalizedQuery.sort();
      const cacheKey = `${path}?${normalizedQuery.toString()}`;
      const now = dependencies.clock?.now() ?? Date.now();
      const cached = cache.get(cacheKey);

      if (!isBooking && cached && cached.expiresAt > now) {
        return {
          status: cached.status,
          body: cached.body,
          headers: { 'X-Cache': 'HIT' },
        };
      }

      let accessToken: string | undefined;
      if (dependencies.credentials) {
        const rawCredentials = dependencies.credentials();
        const clientId = rawCredentials.clientId?.trim();
        const clientSecret = rawCredentials.clientSecret?.trim();

        if (!clientId || !clientSecret) {
          if (!credentialsWarningLogged) {
            credentialsWarningLogged = true;
            dependencies.logger?.error(
              '[tdx-gateway] Missing TDX_CLIENT_ID / TDX_CLIENT_SECRET',
            );
          }
          if (isAlert) {
            return {
              status: 200,
              body: [],
              headers: { 'X-Fallback': 'ALERT_EMPTY_NO_TOKEN' },
            };
          }
          if (!isBooking && cached) {
            return {
              status: 200,
              body: cached.body,
              headers: { 'X-Cache': 'STALE' },
            };
          }
          return {
            status: 503,
            body: { error: 'Token Error', reason: 'missing_credentials' },
            headers: { 'Retry-After': '15' },
          };
        }

        if (cachedAccessToken && now < accessTokenExpiresAt) {
          accessToken = cachedAccessToken;
        } else {
          if (now < tokenFailedUntil) {
            accessToken = undefined;
          } else if (!tokenInFlight) {
            tokenInFlight = (async () => {
              for (let attempt = 0; attempt < 2; attempt += 1) {
                try {
                  const tokenResult = dependencies.tdx.requestToken
                    ? await dependencies.tdx.requestToken({
                        clientId,
                        clientSecret,
                      })
                    : null;
                  if (tokenResult) {
                    cachedAccessToken = tokenResult.token;
                    accessTokenExpiresAt =
                      (dependencies.clock?.now() ?? Date.now()) +
                      Math.max(0, tokenResult.expiresInSeconds - 60) * 1_000;
                    return tokenResult.token;
                  }
                } catch (error) {
                  dependencies.logger?.warn(
                    '[tdx-gateway] token request error:',
                    error instanceof Error ? error.message : String(error),
                  );
                }
                if (attempt === 0) {
                  if (dependencies.sleep) {
                    await dependencies.sleep(500);
                  } else {
                    await new Promise<void>((resolve) =>
                      setTimeout(resolve, 500),
                    );
                  }
                }
              }
              tokenFailedUntil =
                (dependencies.clock?.now() ?? Date.now()) + 15_000;
              return null;
            })().finally(() => {
              tokenInFlight = null;
            });
          }
          const token = tokenInFlight ? await tokenInFlight : null;
          if (!token) {
            if (isAlert) {
              return {
                status: 200,
                body: [],
                headers: { 'X-Fallback': 'ALERT_EMPTY_NO_TOKEN' },
              };
            }
            if (!isBooking && cached) {
              return {
                status: 200,
                body: cached.body,
                headers: { 'X-Cache': 'STALE' },
              };
            }
            return {
              status: 503,
              body: { error: 'Token Error', reason: 'auth_failed' },
              headers: { 'Retry-After': '15' },
            };
          }
          accessToken = token;
        }
      }

      let upstream: { status: number; body: unknown };

      try {
        let pending = isBooking ? undefined : inFlight.get(cacheKey);
        if (!pending) {
          pending = dependencies.tdx.request({
            url: `https://tdx.transportdata.tw/api/${path}${input.rawQuery}`,
            accessToken,
          });
          if (!isBooking) {
            pending = pending.finally(() => inFlight.delete(cacheKey));
            inFlight.set(cacheKey, pending);
          }
        }
        upstream = await pending;
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

      if (
        !isBooking &&
        cached &&
        (upstream.status === 429 || upstream.status >= 500)
      ) {
        return {
          status: 200,
          body: cached.body,
          headers: { 'X-Cache': 'STALE' },
        };
      }

      if (!isBooking && upstream.status >= 200 && upstream.status < 300) {
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
        headers: isBooking
          ? { 'Cache-Control': 'no-store', 'X-Cache': 'MISS' }
          : { 'X-Cache': 'MISS' },
      };
    },
  };
}
