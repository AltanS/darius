// This file is a scan fixture — intentionally contains debug artifacts.
// Do NOT remove these lines; they are used by scan-fixture-detection tests.

export function processData(data: unknown): string {
  console.log("Processing data:", data); // planted artifact
  return String(data);
}

export function debugHelper(value: unknown): void {
  console.debug("Debug value:", value); // another artifact
}
