# Fork maintenance

This fork (`hmps/bb`) adds features on top of `get-bb/bb`. This folder holds the tools to merge upstream changes into the fork.

## Setup in a new clone

1. Add upstream: `git remote add upstream https://github.com/get-bb/bb.git`.
2. Point `gh` at the fork: `gh repo set-default hmps/bb`. Otherwise `gh pr create` targets `get-bb/bb`, and `get-bb/bb` closes PRs from authors that are not on its allow list.

## Merge upstream

1. Start from a clean fork `main` with `upstream` set to `https://github.com/get-bb/bb.git`.
2. Run `fork/sync-upstream.sh`.
3. Resolve the conflicts that the script lists. Then run `git add` on each file.
4. Run the checks below.
5. Run `git commit --no-edit` and push to `origin main`.

Always merge. Do not rebase or squash an upstream sync. The merge commit records which upstream commits the fork has, so the next merge contains only new changes.

## What the script does

- It turns on `git rerere`, so git replays a conflict resolution that you made before.
- It merges `upstream/main` without a commit.
- It moves the fork database migration after upstream's migrations. It takes upstream's Drizzle journal and snapshots, removes the old fork migration, and generates it again.
- It preserves the fork migration name with `drizzle-kit generate --name <old suffix>`. Then it compares the new SQL with the old SQL.
- It stops with an error if more than one fork migration needs regeneration. Regenerate each separately to preserve its SQL hash.

## Why the migrations move

Drizzle applies only migrations that are newer than the last applied migration. This can skip an upstream migration whose timestamp precedes an applied fork migration.

Create new fork migrations with `drizzle-kit generate --name fork_<x>`. Every fork migration tag must match `NNNN_fork_<x>`. The repair uses this marker to identify fork migrations.

Before Drizzle runs, bb moves an applied fork migration's ledger row to its new timestamp when its SQL hash identifies one migration. The old timestamp must be absent from the current journal. This prevents Drizzle from running the same fork SQL again. Ambiguous hashes remain unchanged.

bb also applies skipped upstream migrations when every later ledger row identifies a fork migration. Each repaired entry runs in a transaction with its ledger insert. This supplies prerequisites before Drizzle runs newer migrations. Existing cleanup paths still own their excluded migrations. Other history errors still stop startup.

## Checks

```sh
pnpm exec turbo run typecheck --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/thread-view --filter=@bb/cli --filter=@get-bb/plugin-sdk
pnpm exec turbo run test --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/thread-view --filter=@bb/cli --filter=@get-bb/plugin-sdk --continue
```

Some timing tests fail under full-suite load. Run a failed test file alone before you treat the failure as real.

## Fork CI

The upstream workflows need Blacksmith runners or deploy secrets. The fork has neither, so all workflows except PR Gate are off in the fork's Actions settings. Run the checks above on your machine instead.

## Keep merges small

- Put fork features in new files where possible. Keep edits to upstream files short.
- Merge upstream often. Small merges have fewer conflicts.
