import type { Project } from "./store.ts";

export interface VigilImportResult {
  imported: string[];
  unchanged: string[];
  closed: number;
  problems: string[];
}

/** Copy a legacy `.tracker/vigils/` into the store's vigil items. Filled in by the vigil step. */
export function importLegacyVigils(_project: Project, _trackerDir: string, _options: { dryRun: boolean; who?: string }): VigilImportResult {
  throw new Error("importLegacyVigils: not implemented");
}
