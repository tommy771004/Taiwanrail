import type { TdxTransport } from './tdxGateway';

const TOKEN_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

/**
 * TDX's token endpoint can hang for ~30 s while the data API still answers at once
 * (2026-11-18: every un-cached proxy call returned 503 auth_failed). Without a limit the
 * gateway's two token attempts held a Function for about a minute before failing anyway.
 */
export const TDX_TOKEN_TIMEOUT_MS = 8_000;
/** Covers the body too; the largest body read here is the ~4 MB TRA daily timetable. */
export const TDX_REQUEST_TIMEOUT_MS = 15_000;

/**
 * An AbortController with our own timer rather than AbortSignal.timeout: Node's timeout
 * signal is unref'd and weakly held, and under the test runner it never fired. The timer is
 * cleared once the body has been read.
 */
async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`timed out after ${ms} ms`, 'TimeoutError')),
    ms,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
  );
}

export function createTdxFetchTransport(options?: {
  fetch?: typeof fetch;
  logger?: Pick<Console, 'error'>;
  tokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}): TdxTransport {
  const fetchImpl = options?.fetch ?? fetch;
  const logger = options?.logger ?? console;
  const tokenTimeoutMs = options?.tokenTimeoutMs ?? TDX_TOKEN_TIMEOUT_MS;
  const requestTimeoutMs = options?.requestTimeoutMs ?? TDX_REQUEST_TIMEOUT_MS;

  return {
    // A timeout throws here; the gateway catches it, retries once, then answers 503
    // (or the stale cache) and holds off token requests for 15 s.
    async requestToken({ clientId, clientSecret }) {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const reply = await withTimeout(tokenTimeoutMs, async (signal) => {
        const response = await fetchImpl(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal,
        });
        if (!response.ok) {
          const responseBody = await response.text().catch(() => '');
          return { ok: false as const, status: response.status, responseBody };
        }
        return { ok: true as const, data: await response.json() };
      });

      if (!reply.ok) {
        logger.error(
          `[tdx-gateway] token endpoint responded ${reply.status}: ${reply.responseBody.slice(0, 300)}`,
        );
        return null;
      }

      const data = reply.data as {
        access_token?: unknown;
        expires_in?: unknown;
      };
      if (
        typeof data.access_token !== 'string' ||
        typeof data.expires_in !== 'number'
      ) {
        logger.error('[tdx-gateway] token endpoint returned an invalid payload');
        return null;
      }
      return {
        token: data.access_token,
        expiresInSeconds: data.expires_in,
      };
    },

    // A timeout or network failure becomes a 5xx status rather than a throw, so the
    // gateway serves its stale copy (it only does that for 429/5xx) and never caches it.
    async request({ url, accessToken }) {
      try {
        return await withTimeout(requestTimeoutMs, async (signal) => {
          const response = await fetchImpl(url, {
            headers: {
              ...(accessToken
                ? { Authorization: `Bearer ${accessToken}` }
                : undefined),
              Accept: 'application/json',
            },
            signal,
          });
          return {
            status: response.status,
            body: await response.json(),
          };
        });
      } catch (error) {
        if (isTimeout(error)) {
          logger.error(`[tdx-gateway] upstream timed out after ${requestTimeoutMs} ms`);
          return { status: 504, body: { error: 'Upstream Timeout' } };
        }
        logger.error(
          '[tdx-gateway] upstream request failed:',
          error instanceof Error ? error.message : String(error),
        );
        return { status: 502, body: { error: 'Upstream Error' } };
      }
    },
  };
}
