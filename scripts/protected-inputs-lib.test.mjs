import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import {
  readProtectedInputs,
  readProtectedReceipt,
} from "./protected-inputs-lib.mjs";

let root;

function write(relativePath, contents) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "protected-inputs-"));
  write("workload-manifest.json", "{}\n");
  write("src/fixtures/dom.ts", "export const rows = 18;\n");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

test("records every protected file with its size, sorted by path", () => {
  const receipt = readProtectedInputs(root);
  assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(
    receipt.entries.map(({ path, size }) => ({ path, size })),
    [
      { path: "src/fixtures/dom.ts", size: 24 },
      { path: "workload-manifest.json", size: 3 },
    ],
  );
});

test("local tool output at the top level does not change the baseline", () => {
  const before = readProtectedInputs(root).aggregate;
  for (const name of [
    ".code-polishy-artifacts",
    ".code-polishy-reports",
    ".git",
    "dist",
    "node_modules",
    "playwright-report",
    "receipts",
    "test-results",
    "tmp",
  ]) {
    write(`${name}/output.json`, "{}\n");
  }
  assert.equal(readProtectedInputs(root).aggregate, before);
});

test("an excluded name below the top level remains protected", () => {
  const before = readProtectedInputs(root).aggregate;
  write("src/.code-polishy-reports/output.json", "{}\n");
  const after = readProtectedInputs(root);
  assert.notEqual(after.aggregate, before);
  assert.ok(
    after.entries.some(
      (entry) => entry.path === "src/.code-polishy-reports/output.json",
    ),
  );
});

test("changing a workload input changes the aggregate", () => {
  const before = readProtectedInputs(root).aggregate;
  write("src/fixtures/dom.ts", "export const rows = 9;\n");
  assert.notEqual(readProtectedInputs(root).aggregate, before);
});

test("a missing or malformed receipt is rejected", () => {
  const receiptPath = join(root, "receipts", "protected-inputs.json");
  assert.throws(() => readProtectedReceipt(receiptPath), /missing/u);
  write("receipts/protected-inputs.json", '{"schemaVersion":2}\n');
  assert.throws(() => readProtectedReceipt(receiptPath), /invalid/u);
  const receipt = readProtectedInputs(root);
  write("receipts/protected-inputs.json", JSON.stringify(receipt));
  assert.deepEqual(readProtectedReceipt(receiptPath), receipt);
});
