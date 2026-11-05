/**
 * Version of the browser's live-API behaviour, shared by the bundle and /api/gate.
 * Bump it when already-open tabs must stop calling live endpoints: the gate then reports
 * the new number, and any tab built with an older one stops and asks for a reload.
 * Data deploys never need a bump, which is why this is not the commit SHA.
 */
export const LIVE_CLIENT_VERSION = 1;
