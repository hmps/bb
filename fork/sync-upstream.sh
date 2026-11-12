#!/usr/bin/env bash
set -euo pipefail

upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_ref="${upstream_remote}/${UPSTREAM_BRANCH:-main}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: the working tree is not clean" >&2
  exit 1
fi

git config rerere.enabled true
git config rerere.autoupdate true

git fetch "$upstream_remote"

echo "Merging ${upstream_ref} ($(git rev-parse --short "$upstream_ref")) into $(git rev-parse --abbrev-ref HEAD)"
merge_status=0
git merge --no-ff --no-commit "$upstream_ref" || merge_status=$?

if ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  if [[ "$merge_status" -ne 0 ]]; then
    echo "error: git merge failed" >&2
    exit "$merge_status"
  fi
  echo "Already up to date with ${upstream_ref}."
  exit 0
fi

protocol_file="packages/host-daemon-contract/src/protocol.ts"
protocol_version() {
  sed -n 's/^export const HOST_DAEMON_PROTOCOL_VERSION = \([0-9][0-9]*\) as const;$/\1/p'
}
upstream_protocol="$(git show "${upstream_ref}:${protocol_file}" | protocol_version)"

unresolved="$(git diff --name-only --diff-filter=U)"
if grep -qx "$protocol_file" <<<"$unresolved"; then
  echo "Set HOST_DAEMON_PROTOCOL_VERSION in ${protocol_file} above upstream ${upstream_protocol}, and update packages/host-daemon-contract/test/contract.test.ts."
else
  merged_protocol="$(protocol_version <"$protocol_file")"
  if [[ -z "$merged_protocol" || -z "$upstream_protocol" || "$merged_protocol" -le "$upstream_protocol" ]]; then
    echo "error: the fork HOST_DAEMON_PROTOCOL_VERSION (${merged_protocol:-unknown}) must be above upstream (${upstream_protocol:-unknown})." >&2
    echo "Set it above upstream in ${protocol_file}, update packages/host-daemon-contract/test/contract.test.ts, then run the checks in fork/README.md." >&2
    exit 1
  fi
fi
if [[ -n "$unresolved" ]]; then
  echo
  echo "Resolve these conflicts, then run 'git add' and 'git commit --no-edit':"
  sed 's/^/  /' <<<"$unresolved"
  exit 1
fi

echo
echo "No conflicts are left. Run the checks in fork/README.md, then 'git commit --no-edit'."
