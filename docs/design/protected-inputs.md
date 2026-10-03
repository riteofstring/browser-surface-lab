# Protected inputs

`receipts/protected-inputs.json` is the reviewed baseline of the measured
workload. It records the path, size, and SHA-256 of every file in the
repository except a few top-level names: Git metadata, dependency and build
output, browser test output, scratch space, the receipt directory itself, and
Code Polishy's local reports and artifacts. A change to any other file changes
the aggregate, so `pnpm integrity` fails until a reviewer accepts the new
baseline with `pnpm freeze:inputs`.

The exclusion applies only at the top level. A nested directory with an
excluded name is still protected, so a fixture cannot hide inputs by naming a
subdirectory after tool output.

The receipt is reusable evidence that the workload measured by an external
host is the one that was reviewed. It is not change detection for local
tooling, which is why tool output directories are excluded rather than frozen.
