import { resolve } from "node:path";

import {
  readProtectedInputs,
  readProtectedReceipt,
} from "./protected-inputs-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const receiptPath = resolve(root, "receipts", "protected-inputs.json");
const expected = readProtectedReceipt(receiptPath);
const actual = readProtectedInputs(root);
if (expected.aggregate !== actual.aggregate) {
  throw new Error(
    `Protected inputs changed: expected ${expected.aggregate}, received ${actual.aggregate}`,
  );
}
process.stdout.write(`${actual.aggregate}\n`);
