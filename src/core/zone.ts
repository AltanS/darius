export function isZone(tz: string): boolean { try { Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } }
