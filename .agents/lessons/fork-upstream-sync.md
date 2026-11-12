# Fork upstream sync

date: 2026-11-09
status: verified
scope: whole repository; fork/
keywords: fork, upstream, merge, sync, get-bb, hmps/bb, protocol, gh default, CI, Blacksmith
evidence: merge 58a4e42406 and script commit 43624b9cfd on hmps/bb main; protocol guard from 4ad575271d; ported after the 2026-11 history reset.
action: This repository is the hmps/bb fork of get-bb/bb; merge upstream only with fork/sync-upstream.sh and follow fork/README.md.
verify: `git remote -v` shows upstream = get-bb/bb and origin = hmps/bb, and fork/sync-upstream.sh exists.
retire-when: the fork is deleted or its changes are accepted upstream.
safeguard: fork/sync-upstream.sh stops when the merged daemon protocol is not above upstream.
proof: packages/host-daemon-contract/test/contract.test.ts checks the current protocol and rejects old versions.

## Details

- Always merge an upstream sync. Never rebase or squash it, or the next merge repeats old conflicts.
- Fork feature PRs go to hmps/bb (`-R hmps/bb` if gh has no default). get-bb/bb auto-closes PRs from authors that are not on its allow list.
- Fork CI cannot run (no Blacksmith runners, no secrets). Run the local checks in fork/README.md as merge evidence.
- Put fork features in new files where possible, to keep upstream conflicts small.
