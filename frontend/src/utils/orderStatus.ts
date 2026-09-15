// EMSX status groupings shared by the Fill Status table and the Trade Recap.
// Explicit sets avoid substring matches (e.g. /CANCEL/i would unintentionally
// match a status string like "FULLFILL_CANCEL" if Bloomberg ever uses one).
export const DEAD_STATUSES = new Set(['CANCEL', 'CANCELED', 'CANCELLED', 'CXLPENDING', 'REJECTED'])
export const FILLED_STATUSES = new Set(['FILLED', 'FULLFILL'])
