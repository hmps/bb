# Fork upstream sync

date: 2026-11-09
status: verified
scope: whole repository; packages/db/drizzle; fork/
keywords: fork, upstream, merge, sync, get-bb, hmps/bb, drizzle, migration, journal, gh default, CI, Blacksmith
evidence: merge 58a4e42406 and script commit 43624b9cfd on hmps/bb main; fork/sync-upstream.sh replayed the same merge from 7415efa32f with identical results except the random migration name.
action: This repository is the hmps/bb fork of get-bb/bb; merge upstream only with fork/sync-upstream.sh and follow fork/README.md.
verify: `git remote -v` shows upstream = get-bb/bb and origin = hmps/bb, and fork/sync-upstream.sh exists.
retire-when: the fork is deleted or its changes are accepted upstream.
safeguard: fork/sync-upstream.sh preserves one fork migration's name and compares its SQL; packages/db/src/fork-migration-order.ts repairs eligible history before Drizzle runs.
proof: packages/db/test/fork-migration-order.test.ts covers skipped upstream SQL, fork row relocation, ambiguous hashes, upstream history holes, prerequisite order, and transaction rollback.

## Details

- Drizzle skips upstream migrations whose timestamps precede the latest applied fork migration. The script regenerates the fork migration last.
- Create new fork migrations with `drizzle-kit generate --name fork_<x>`. Tags must match `NNNN_fork_<x>` so the repair can identify them. The script stops on other names.
- Fork migrations only create fork-owned tables and indexes. Upstream table rebuilds drop fork columns on upstream tables without an error. The script stops on other statements.
- The script uses the old tag suffix when it generates the replacement. It supports one fork migration only. Extend the script before you add a second one. It stops when the regenerated SQL differs from the old SQL in more than whitespace.
- Before Drizzle runs, bb moves a uniquely identified fork ledger row from an obsolete timestamp to its current journal timestamp. The SQL hash must match exactly.
- bb applies skipped upstream entries only when every later ledger row identifies a fork migration. The relocation and all repaired entries share one transaction.
- Existing cleanup paths retain their excluded entries. Other history holes and ambiguous fork hashes remain errors. A database reset is not part of this repair.
- Always merge an upstream sync. Never rebase or squash it, or the next merge repeats old conflicts.
- Fork feature PRs go to hmps/bb (`-R hmps/bb` if gh has no default). get-bb/bb auto-closes PRs from authors that are not on its allow list.
- Fork CI cannot run (no Blacksmith runners, no secrets). Run the local checks in fork/README.md as merge evidence.
- Put fork features in new files where possible, to keep upstream conflicts small.
