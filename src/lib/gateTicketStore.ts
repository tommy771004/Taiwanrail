/**
 * Process-local Gate mint throttle + escalation (ADR-0005).
 * Best-effort under serverless multi-instance — not a global ban.
 */

import {
  allowQueryInWindow,
} from './queryThrottlePolicy.js';

export const GATE_MINT_WINDOW_MS = 60_000;
export const GATE_MINT_MAX = 10;

/** Escalation window: count abuse throttle hits. */
export const GATE_ESCALATION_WINDOW_MS = 10 * 60_000;
export const GATE_ESCALATION_HIT_THRESHOLD = 3;
/** Refuse mint/refresh for this long after escalation. */
export const GATE_ESCALATION_BLOCK_MS = 15 * 60_000;

const MAX_KEYS = 5_000;

const mintBuckets = new Map<string, number[]>();
const abuseHitBuckets = new Map<string, number[]>();
const escalatedUntil = new Map<string, number>();

function touchMap(map: Map<string, number[]>, key: string, times: number[]): void {
  if (map.size >= MAX_KEYS && !map.has(key)) {
    const first = map.keys().next().value;
    if (first !== undefined) map.delete(first);
  }
  map.set(key, times);
}

export interface GateMintDecision {
  allow: boolean;
  reason: 'ok' | 'mint_throttled' | 'escalated';
}

export function isGateEscalated(
  clientKey: string,
  now: number = Date.now(),
): boolean {
  const key = clientKey || 'unknown';
  const until = escalatedUntil.get(key);
  if (until !== undefined && now < until) return true;
  if (until !== undefined && now >= until) escalatedUntil.delete(key);
  return false;
}

/**
 * Record one API abuse throttle denial for escalation accounting.
 */
export function recordApiAbuseThrottleHit(
  clientKey: string,
  now: number = Date.now(),
): void {
  const key = clientKey || 'unknown';
  const prev = abuseHitBuckets.get(key) ?? [];
  const recent = prev.filter((t) => now - t < GATE_ESCALATION_WINDOW_MS);
  recent.push(now);
  touchMap(abuseHitBuckets, key, recent);
  if (recent.length >= GATE_ESCALATION_HIT_THRESHOLD) {
    if (escalatedUntil.size >= MAX_KEYS && !escalatedUntil.has(key)) {
      const first = escalatedUntil.keys().next().value;
      if (first !== undefined) escalatedUntil.delete(first);
    }
    escalatedUntil.set(key, now + GATE_ESCALATION_BLOCK_MS);
  }
}

export function tryConsumeGateMint(
  clientKey: string,
  now: number = Date.now(),
): GateMintDecision {
  const key = clientKey || 'unknown';
  if (isGateEscalated(key, now)) {
    return { allow: false, reason: 'escalated' };
  }
  const prev = mintBuckets.get(key) ?? [];
  const decision = allowQueryInWindow(
    prev,
    now,
    GATE_MINT_WINDOW_MS,
    GATE_MINT_MAX,
  );
  if (decision.allow || mintBuckets.has(key) || mintBuckets.size < MAX_KEYS) {
    touchMap(mintBuckets, key, decision.times);
  }
  if (!decision.allow) {
    return { allow: false, reason: 'mint_throttled' };
  }
  return { allow: true, reason: 'ok' };
}

export function resetGateStoresForTests(): void {
  mintBuckets.clear();
  abuseHitBuckets.clear();
  escalatedUntil.clear();
}
