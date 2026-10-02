import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}
