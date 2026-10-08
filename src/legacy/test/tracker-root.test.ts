/**
 * The store tree the darius router hands the engine (0.78.0, lib/tracker-root.ts).
 *
 * With DARIUS_TRACKER_ROOT set the engine never walks up for `.tracker`, the
 * checkout comes from DARIUS_CHECKOUT_ROOT (not "the parent of .tracker"),
 * shown paths are tracker-relative and stored keys keep the `.tracker/` form.
 * Without it, git mode is unchanged.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHECKOUT_ROOT_ENV,
  TRACKER_ROOT_ENV,
  displayPath,
  findTrackerRoot,
  isStoreTree,
  projectRootOf,
  repoStylePath,
  resolvePathArg,
  resolveTreeRef,
} from "../lib/tracker-root.ts";
import { canonicalSpecRef } from "../lib/session-claims.ts";
import { toLedgerSpecPath } from "../lib/verification/ledger.ts";
import { readTrackerState } from "../lib/tracker-reader.ts";

let root: string;
let checkout: string;
let tree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "tracker-root-"));
  checkout = join(root, "checkout");
  tree = join(root, "state", "acme", "tracker");
  mkdirSync(join(checkout, "src"), { recursive: true });
  mkdirSync(join(tree, "M1-alpha"), { recursive: true });
  writeFileSync(join(tree, "00-INDEX.md"), "---\nschema_version: 9\n---\n# Index\n");
  writeFileSync(join(tree, "M1-alpha", "00-README.md"), "---\nname: Alpha\n---\n# Alpha\n");
  writeFileSync(join(tree, "M1-alpha", "01-one.md"), "---\nupdated: 2026-10-08\ndepends_on: []\nagent: a\n---\n# One\n\n## Verification Checklist\n\n- [ ] one\n");
});

afterEach(() => {
  delete process.env[TRACKER_ROOT_ENV];
  delete process.env[CHECKOUT_ROOT_ENV];
  rmSync(root, { recursive: true, force: true });
});

function storeMode(): void {
  process.env[TRACKER_ROOT_ENV] = tree;
  process.env[CHECKOUT_ROOT_ENV] = checkout;
}

describe("store mode (the router set the override)", () => {
  it("finds the store tree from anywhere and never walks up for .tracker", () => {
    storeMode();
    mkdirSync(join(checkout, ".tracker"));
    expect(findTrackerRoot(join(checkout, "src"))).toBe(tree);
    expect(findTrackerRoot(root)).toBe(tree);
    expect(isStoreTree(tree)).toBe(true);
  });

  it("the checkout is the one the router named, not the parent of the tree", () => {
    storeMode();
    expect(projectRootOf(tree)).toBe(checkout);
    expect(projectRootOf(join(root, "elsewhere", ".tracker"))).toBe(join(root, "elsewhere"));
  });

  it("shows tree paths tracker-relative and keeps stored keys in the .tracker/ form", () => {
    storeMode();
    const file = join(tree, "M1-alpha", "01-one.md");
    expect(displayPath(tree, file)).toBe("M1-alpha/01-one.md");
    expect(repoStylePath(tree, file)).toBe(".tracker/M1-alpha/01-one.md");
    expect(toLedgerSpecPath(tree, file)).toBe(".tracker/M1-alpha/01-one.md");
    const spec = readTrackerState(tree).milestones[0]?.specs[0];
    expect(spec?.relativePath).toBe("M1-alpha/01-one.md");
  });

  it("takes every path form: tracker-relative, .tracker/, absolute store and checkout paths", () => {
    storeMode();
    const file = join(tree, "M1-alpha", "01-one.md");
    for (const form of ["M1-alpha/01-one.md", ".tracker/M1-alpha/01-one.md", "./.tracker/M1-alpha/01-one.md", file, join(checkout, ".tracker", "M1-alpha", "01-one.md")]) {
      expect(resolvePathArg(form, checkout)).toBe(file);
      expect(resolveTreeRef(tree, form)).toBe(file);
      expect(canonicalSpecRef({ trackerRoot: tree, ref: form, cwd: checkout })).toBe("M1-alpha/01-one.md");
    }
    expect(resolvePathArg("../.tracker/M1-alpha/01-one.md", join(checkout, "src"))).toBe(file);
    writeFileSync(join(checkout, "README.md"), "# readme\n");
    expect(resolvePathArg("README.md", checkout)).toBe(join(checkout, "README.md"));
  });
});

describe("git mode (no override)", () => {
  it("walks up for .tracker and keeps the parent as the checkout", () => {
    const repo = join(root, "repo");
    mkdirSync(join(repo, ".tracker", "M1-x"), { recursive: true });
    mkdirSync(join(repo, "src"), { recursive: true });
    expect(findTrackerRoot(join(repo, "src"))).toBe(join(repo, ".tracker"));
    expect(projectRootOf(join(repo, ".tracker"))).toBe(repo);
    expect(isStoreTree(join(repo, ".tracker"))).toBe(false);
    expect(displayPath(join(repo, ".tracker"), join(repo, ".tracker", "M1-x", "01.md"))).toBe(".tracker/M1-x/01.md");
    expect(resolvePathArg(".tracker/M1-x/01.md", repo)).toBe(join(repo, ".tracker", "M1-x", "01.md"));
    expect(findTrackerRoot(join(root, "state"))).toBeNull();
  });
});
