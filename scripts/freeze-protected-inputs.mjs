import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readProtectedInputs } from "./protected-inputs-lib.mjs";

const root = resolve(import.meta.dirname, "..");
const receiptDirectory = resolve(root, "receipts");
const receiptPath = resolve(receiptDirectory, "protected-inputs.json");
const receipt = readProtectedInputs(root);
mkdirSync(receiptDirectory, { recursive: true });
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
process.stdout.write(`${receipt.aggregate}\n`);
