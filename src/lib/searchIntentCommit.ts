/**
 * Ordering for Query-throttle vs search intent flags, and rail start plans.
 * Consume must succeed before clearing pending or setting one-shot auto-fire.
 */

export interface SearchIntentCommit {
  /** Clear pending recent-search intent */
  clearPending: boolean;
  /** Set deep-link / SEO one-shot auto-fire flag */
  markAutoFired: boolean;
  /** Start timetable + extras */
  runSearch: boolean;
}

/** Map throttle consume result → which intent flags may commit. */
export function searchIntentCommitAfterConsume(allowed: boolean): SearchIntentCommit {
  if (!allowed) {
    return { clearPending: false, markAutoFired: false, runSearch: false };
  }
  return { clearPending: true, markAutoFired: true, runSearch: true };
}

/** How the User initiated a TRA/HSR search. */
export type RailSearchIntent = 'manual' | 'recent' | 'autofire';

export interface RailSearchStartPlan {
  runSearch: boolean;
  showThrottleMessage: boolean;
  clearPending: boolean;
  markAutoFired: boolean;
  resetPage: boolean;
  scrollToResults: boolean;
}

/**
 * Single plan for button / recent / deep-link after a consume attempt.
 * Side effects (fetch, refs) stay in the UI; this only decides what may run.
 */
export function planRailSearchStart(
  allowed: boolean,
  intent: RailSearchIntent,
): RailSearchStartPlan {
  const commit = searchIntentCommitAfterConsume(allowed);
  if (!commit.runSearch) {
    return {
      runSearch: false,
      showThrottleMessage: true,
      clearPending: false,
      markAutoFired: false,
      resetPage: false,
      scrollToResults: false,
    };
  }
  return {
    runSearch: true,
    showThrottleMessage: false,
    clearPending: intent === 'recent' ? commit.clearPending : false,
    markAutoFired: intent === 'autofire' ? commit.markAutoFired : false,
    resetPage: intent === 'manual',
    scrollToResults: intent === 'manual',
  };
}
