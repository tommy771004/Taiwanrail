import { createHmac, randomUUID } from 'node:crypto';

type TelemetryValue = string | number | boolean | null;

/**
 * Forward a minimized server-side product event to the central admin console.
 * This must remain best-effort: analytics failures never affect a journey search.
 */
export function sendTelemetry(name: string, properties: Record<string, TelemetryValue> = {}): void {
  const url = process.env.TELEMETRY_INGEST_URL;
  const project = process.env.TELEMETRY_PROJECT_KEY;
  const key = process.env.TELEMETRY_INGEST_KEY;
  if (!url || !project || !key) return;

  const event = {
    id: randomUUID(),
    name,
    source: 'server' as const,
    occurredAt: new Date().toISOString(),
    properties,
  };
  const raw = JSON.stringify({ events: [event] });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', key).update(`${timestamp}.`).update(raw).digest('hex')}`;

  void fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-telemetry-project': project,
      'x-telemetry-timestamp': timestamp,
      'x-telemetry-signature': signature,
    },
    body: raw,
  }).catch((err) => console.warn('[telemetry] forward failed:', err instanceof Error ? err.message : String(err)));
}
