/** The harness adapters darius knows, by id (docs/concept.md, "Harnesses, profiles and surfaces"). */

import { claudeHarness } from "./claude.ts";
import type { HarnessAdapter } from "./contract.ts";

const HARNESSES: readonly HarnessAdapter[] = [claudeHarness];

export const HARNESS_IDS: readonly string[] = HARNESSES.map((harness) => harness.id);

export function harnessById(id: string): HarnessAdapter | undefined {
  return HARNESSES.find((harness) => harness.id === id);
}
