// Preparation policy only; it does not guarantee that a warning is currently valid.
export const NAV_WARNING_STALE_AFTER_SECONDS = 3 * 60 * 60;
export const NAV_WARNING_MEMORY_CACHE_MS = 60 * 1000;
// Hourly collection plus allowance for scheduling/build/CDN propagation.
export const NAV_WARNING_UPDATE_DELAY_SECONDS = 75 * 60;
