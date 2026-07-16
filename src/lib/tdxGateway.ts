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

export function createTdxGateway(dependencies: { tdx: TdxTransport }): {
  execute(input: TdxGatewayRequest): Promise<TdxGatewayResponse>;
} {
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
      const upstream = await dependencies.tdx.request({
        url: `https://tdx.transportdata.tw/api/${path}${input.rawQuery}`,
      });
      const isAlert = /\/Rail\/(?:TRA|THSR)\/Alert/i.test(path);

      if (
        isAlert &&
        (upstream.status === 404 ||
          upstream.status === 429 ||
          upstream.status >= 500)
      ) {
        return {
          status: 200,
          body: [],
          headers: { 'X-Fallback': 'ALERT_EMPTY_UPSTREAM' },
        };
      }

      return {
        status: upstream.status,
        body: upstream.body,
        headers: {},
      };
    },
  };
}
