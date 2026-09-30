/**
 * Test helper: plant a raw `status:` line in a milestone README's frontmatter.
 *
 * `addMilestone` no longer stamps `status:` — on a milestone README the field
 * is a terminal OVERRIDE (Complete / Skipped / Deferred / Closed), not a
 * default, so a freshly created README simply doesn't carry one. Tests that
 * need an arbitrary raw value (including unrecognized ones `setStatus` would
 * reject on purpose) use this text helper rather than the public API.
 */
export function withReadmeStatus(raw: string, status: string): string {
  if (/^status:.*$/m.test(raw)) {
    return raw.replace(/^status:.*$/m, `status: ${status}`);
  }
  const injected = raw.replace(/^(owner:.*)$/m, `$1\nstatus: ${status}`);
  if (injected === raw) {
    throw new Error("withReadmeStatus: no `owner:` line to anchor the status after");
  }
  return injected;
}
