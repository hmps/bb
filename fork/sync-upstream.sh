#!/usr/bin/env bash
set -euo pipefail

upstream_remote="${UPSTREAM_REMOTE:-upstream}"
upstream_ref="${upstream_remote}/${UPSTREAM_BRANCH:-main}"
drizzle_dir="packages/db/drizzle"
journal="${drizzle_dir}/meta/_journal.json"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "error: the working tree is not clean" >&2
  exit 1
fi

git config rerere.enabled true
git config rerere.autoupdate true

git fetch "$upstream_remote"

journal_tags() {
  node -e '
    const entries = JSON.parse(require("fs").readFileSync(0, "utf8")).entries;
    for (const entry of entries) console.log(`${entry.idx}\t${entry.tag}`);
  '
}

ours_tags="$(git show "HEAD:${journal}" | journal_tags)"
theirs_tags="$(git show "${upstream_ref}:${journal}" | journal_tags)"
fork_only="$(comm -23 <(cut -f2 <<<"$ours_tags" | sort) <(cut -f2 <<<"$theirs_tags" | sort))"
upstream_new="$(comm -13 <(cut -f2 <<<"$ours_tags" | sort) <(cut -f2 <<<"$theirs_tags" | sort))"

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

if [[ -n "$fork_only" && -n "$upstream_new" ]]; then
  echo "Fork migrations to regenerate after upstream's:"
  sed 's/^/  /' <<<"$fork_only"

  fork_sql="$(mktemp)"
  while read -r tag; do
    git show "HEAD:${drizzle_dir}/${tag}.sql" >>"$fork_sql"
  done <<<"$fork_only"

  theirs_max_idx="$(tail -n1 <<<"$theirs_tags" | cut -f1)"
  git checkout "$upstream_ref" -- "$drizzle_dir"
  while IFS=$'\t' read -r idx tag; do
    if grep -qxF "$tag" <<<"$fork_only"; then
      git rm -q -f --ignore-unmatch "${drizzle_dir}/${tag}.sql"
      if (( idx > theirs_max_idx )); then
        git rm -q -f --ignore-unmatch "$(printf '%s/meta/%04d_snapshot.json' "$drizzle_dir" "$idx")"
      fi
    fi
  done <<<"$ours_tags"

  pnpm --filter @bb/db exec drizzle-kit generate
  git add -A "$drizzle_dir"

  new_tags="$(comm -13 <(cut -f2 <<<"$theirs_tags" | sort) <(git show ":${journal}" | journal_tags | cut -f2 | sort))"
  new_sql="$(mktemp)"
  while read -r tag; do
    cat "${drizzle_dir}/${tag}.sql" >>"$new_sql"
  done <<<"$new_tags"

  if diff -q <(tr -d '[:space:]' <"$fork_sql") <(tr -d '[:space:]' <"$new_sql") >/dev/null; then
    echo "Regenerated SQL matches the old fork migrations: ${new_tags//$'\n'/, }"
  else
    echo "warning: regenerated SQL differs from the old fork migrations. Review it:" >&2
    diff "$fork_sql" "$new_sql" >&2 || true
  fi
  rm -f "$fork_sql" "$new_sql"
fi

unresolved="$(git diff --name-only --diff-filter=U)"
if [[ -n "$unresolved" ]]; then
  echo
  echo "Resolve these conflicts, then run 'git add' and 'git commit --no-edit':"
  sed 's/^/  /' <<<"$unresolved"
  exit 1
fi

echo
echo "No conflicts are left. Run the checks in fork/README.md, then 'git commit --no-edit'."
