import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { relative, resolve } from "node:path";

import { sha256File, sha256Text } from "./hash-lib.mjs";

const excludedTopLevelNames = new Set([
  ".git",
  "dist",
  "node_modules",
  "playwright-report",
  "receipts",
  "test-results",
  "tmp",
]);

function collectFiles(root, currentPath, files) {
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    if (currentPath === root && excludedTopLevelNames.has(entry.name)) {
      continue;
    }
    const entryPath = resolve(currentPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(root, entryPath, files);
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
}

export function readProtectedInputs(root) {
  const files = [];
  collectFiles(root, root, files);
  const entries = files
    .map((filePath) => ({
      path: relative(root, filePath),
      sha256: sha256File(filePath),
      size: statSync(filePath).size,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const aggregate = sha256Text(
    entries
      .map((entry) => `${entry.path}\0${entry.size}\0${entry.sha256}`)
      .join("\n"),
  );
  return { aggregate, entries, schemaVersion: 1 };
}

export function readProtectedReceipt(receiptPath) {
  if (!existsSync(receiptPath)) {
    throw new Error(`Protected input receipt is missing: ${receiptPath}`);
  }
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (
    receipt?.schemaVersion !== 1 ||
    typeof receipt.aggregate !== "string" ||
    !Array.isArray(receipt.entries)
  ) {
    throw new Error("Protected input receipt is invalid");
  }
  return receipt;
}
