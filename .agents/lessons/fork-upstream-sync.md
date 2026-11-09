# Fork upstream sync

date: 2026-11-09
status: verified
scope: whole repository; packages/db/drizzle; fork/
keywords: fork, upstream, merge, sync, get-bb, hmps/bb, drizzle, migration, journal, gh default, CI, Blacksmith
evidence: merge 58a4e42406 and script commit 43624b9cfd on hmps/bb main; fork/sync-upstream.sh replayed the same merge from 7415efa32f with identical results except the random migration name.
action: This repository is the hmps/bb fork of get-bb/bb; merge upstream only with fork/sync-upstream.sh and follow fork/README.md.
verify: `git remote -v` shows upstream = get-bb/bb and origin = hmps/bb, and fork/sync-upstream.sh exists.
retire-when: the fork is deleted or its changes are accepted upstream.
safeguard: fork/sync-upstream.sh (moves fork Drizzle migrations after upstream's and checks the SQL); `gh repo set-default hmps/bb` in the local clone; fork Actions workflows disabled except PR Gate.
proof: the script run on 7415efa32f reproduced the manual merge tree; without the move, upstream migrations 0153 and 0154 had older `when` values than the fork's 0153 and Drizzle would skip them.

## Details

- Upstream migrations that are older than a fork migration never run on a fork database. bb then stops at startup with "Database migration history is incomplete". The script regenerates fork migrations last.
- Always merge an upstream sync. Never rebase or squash it, or the next merge repeats old conflicts.
- Fork feature PRs go to hmps/bb (`-R hmps/bb` if gh has no default). get-bb/bb auto-closes PRs from authors that are not on its allow list.
- Fork CI cannot run (no Blacksmith runners, no secrets). Run the local checks in fork/README.md as merge evidence.
- Put fork features in new files where possible, to keep upstream conflicts small.
