import type { TdxTransport } from './tdxGateway';

const TOKEN_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';

export function createTdxFetchTransport(options?: {
  fetch?: typeof fetch;
  logger?: Pick<Console, 'error'>;
}): TdxTransport {
  const fetchImpl = options?.fetch ?? fetch;
  const logger = options?.logger ?? console;

  return {
    async requestToken({ clientId, clientSecret }) {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      });
      const response = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        const responseBody = await response.text().catch(() => '');
        logger.error(
          `[tdx-gateway] token endpoint responded ${response.status}: ${responseBody.slice(0, 300)}`,
        );
        return null;
      }

      const data = (await response.json()) as {
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

    async request({ url, accessToken }) {
      const response = await fetchImpl(url, {
        headers: {
          ...(accessToken
            ? { Authorization: `Bearer ${accessToken}` }
            : undefined),
          Accept: 'application/json',
        },
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    },
  };
}
