/**
 * Resolve GATE_SECRET for signing/verifying tickets.
 * Production: fail closed when unset (empty string).
 * Non-production: prefer GATE_SECRET; else derive a stable secret from
 * TDX_CLIENT_SECRET so multi-instance preview shares the same key; else
 * process-ephemeral secret for pure local work.
 */

let ephemeralDevSecret: string | null = null;

function isProductionEnv(env: NodeJS.ProcessEnv): boolean {
  const vercelEnv = (env.VERCEL_ENV || '').toLowerCase();
  if (vercelEnv === 'production') return true;
  if (vercelEnv === 'preview' || vercelEnv === 'development') return false;
  return (env.NODE_ENV || '').toLowerCase() === 'production';
}

export function resolveGateSecret(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env.GATE_SECRET || '').trim();
  if (configured) return configured;

  if (isProductionEnv(env)) {
    return '';
  }

  const derived = (env.TDX_CLIENT_SECRET || '').trim();
  if (derived) {
    return `gate-derived:${derived}`;
  }

  if (!ephemeralDevSecret) {
    ephemeralDevSecret = `dev-ephemeral-gate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
  return ephemeralDevSecret;
}

/** Test helper to clear ephemeral secret between suites if needed. */
export function resetEphemeralGateSecretForTests(): void {
  ephemeralDevSecret = null;
}
