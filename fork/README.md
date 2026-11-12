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
- It checks that the fork daemon protocol stays above upstream.

The fork carries no fork database migrations. The decisions feature lives in `plugins/decisions`.

## History reset (2026-11)

On 2026-11-12 the fork started again from upstream main 030b1b729f. The decision cards moved from core into the `bb--decisions` plugin. The old history is on `backup/decisions-in-core` (3f6369763e).

The `bb updates app` updater accepts only fast-forwards of `origin/main`. After a history reset, run this one time on Ethereal-Titan before the next update:

```sh
cd ~/dev/forks/bb && git fetch origin && git reset --hard origin/main
```

The old `thread_decisions` table stays in the database. Nothing reads it.

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

## Checks

```sh
pnpm exec turbo run typecheck --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/thread-view --filter=@bb/host-daemon-contract --filter=@bb/cli --filter=@get-bb/plugin-sdk
pnpm exec turbo run lint lint:type-aware --filter=@bb/app --filter=@bb/cli --filter=@bb/host-daemon-contract
pnpm exec turbo run test --filter=@bb/db --filter=@bb/server --filter=@bb/app --filter=@bb/thread-view --filter=@bb/host-daemon-contract --filter=@bb/cli --filter=@get-bb/plugin-sdk --continue
```

Some timing tests fail under full-suite load. Run a failed test file alone before you treat the failure as real.

## Fork CI

The upstream workflows need Blacksmith runners or deploy secrets. The fork has neither, so all workflows except PR Gate are off in the fork's Actions settings. Run the checks above on your machine instead.

## Keep merges small

- Put fork features in new files where possible. Keep edits to upstream files short.
- Merge upstream often. Small merges have fewer conflicts.
