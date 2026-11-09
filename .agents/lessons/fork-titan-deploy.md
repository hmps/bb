# Fork deployment on Ethereal-Titan

date: 2026-11-09
status: verified
scope: deployment of the hmps/bb fork; Ethereal-Titan launchd job app.getbb.server
keywords: deploy, Ethereal-Titan, launchd, pnpm start, source checkout, corepack, host daemon, auto-update
evidence: 2026-11-09 switch from npm bb-app 0.48.1 to fork main 45014b99cf; server reports installKind source 0.49.0; MSI and Silicon Knight daemons auto-updated to protocol 264.
action: Ethereal-Titan runs the fork from ~/dev/forks/bb with `pnpm start` under launchd; update it with git pull, pnpm install, pnpm build, then restart the job.
verify: `curl -s http://127.0.0.1:38886/api/v1/system/version` on Titan shows "installKind":"source".
retire-when: Titan stops running the fork.
safeguard: none; the plist and the backups folder hold the setup.
proof: the switch ran from a detached script on Titan and kept the 0.48.1 plist and database copy in ~/.bb/backups/pre-fork-main-2026-11-09.

## Details

- The mise `pnpm` shim on Titan has no version. Use the corepack pnpm in `~/.local/share/bb-fork-bin`. The plist puts that folder first on PATH and sets `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- Run `pnpm build` once after `pnpm install`. `pnpm start -- --dryrun` fails on a fresh clone because generated modules are missing.
- Run restarts from a detached script on Titan (`nohup`). A protocol change makes the client daemons update and restart, which can end the agent session that started the switch.
- Do not use `sqlite3 .backup` on the live 8.5 GB database. Server writes restart it. Stop the job, then copy `bb.db*`.
- Client daemons with `--auto-update` take the new package from the server. No action is needed on MSI or Silicon Knight. The desktop app loads the UI from the server.
- Rollback: copy the old plist back from the backups folder, then `launchctl bootout` and `launchctl bootstrap` the job.
