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
- It preserves the fork migration name with `drizzle-kit generate --name <old suffix>`. Then it compares the new SQL with the old SQL. When only whitespace differs, it restores the old bytes. Any other difference stops the script, because fork databases identify the migration by its exact SQL hash.
- It stops with an error when a fork migration breaks the rules in "Fork migrations".

## Fork migrations

- Name each fork migration `NNNN_fork_<x>`. Create it with `pnpm --filter @bb/db exec drizzle-kit generate --name fork_<x>`, not with `pnpm db:generate`.
- A fork migration must only contain `CREATE TABLE` and `CREATE INDEX` statements for fork-owned tables. Do not alter upstream tables. Upstream migrations rebuild their tables and copy only the columns that upstream knows, so a fork column on an upstream table loses its data.
- The script supports one fork migration. drizzle-kit puts all fork schema changes into one generated migration, so the script cannot regenerate two migrations separately. Extend the script before you add a second fork migration.

## Deploy the fork

Ethereal-Titan runs bb from its source checkout, so `bb updates app` uses source mode. Source mode pulls `origin/main` (this fork), installs, builds, and restarts bb. It never installs the npm release.

- Run `bb updates app apply --when-idle` to deploy merged fork changes. bb updates once no thread runs. This needs the `updateWhenIdle` experiment.
- Use `bb updates app apply --yes` only when an interrupted thread is acceptable.
- Machine daemons and their `bb` CLI update only after a protocol bump. See the next section.

## Daemon protocol version

Machine daemons update themselves only when `HOST_DAEMON_PROTOCOL_VERSION` changes. Bump it in the fork to ship a daemon or `bb` CLI change to the machines.

- Keep the fork value above upstream's value. An equal number tells a daemon that two different contracts match.
- On a merge conflict, set the value above both sides. Update `packages/host-daemon-contract/test/contract.test.ts`.
- The script stops when the merged value is not above upstream's value.

## Why the migrations move

Drizzle applies only migrations that are newer than the last applied migration. This can skip an upstream migration whose timestamp precedes an applied fork migration.

Create new fork migrations with `drizzle-kit generate --name fork_<x>`. Every fork migration tag must match `NNNN_fork_<x>`. The repair uses this marker to identify fork migrations.

Before Drizzle runs, bb moves an applied fork migration's ledger row to its new timestamp when its SQL hash identifies one migration. The old timestamp must be absent from the current journal. This prevents Drizzle from running the same fork SQL again. Ambiguous hashes remain unchanged.

bb also applies skipped upstream migrations when every later ledger row identifies a fork migration. The relocation and all repaired entries run in one transaction. This supplies prerequisites before Drizzle runs newer migrations. Existing cleanup paths still own their excluded migrations. Other history errors still stop startup.

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
