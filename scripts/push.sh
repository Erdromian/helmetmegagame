#!/usr/bin/env bash
# npm run push -- "Subject" "note" "note" [--hidden]
#
# Stage everything, write the changelog entry into the same commit, push, then
# announce that entry to Discord. The first argument is the heading; every plain
# argument after it is one changelog note, in plain language for the GMs.
#
#   npm run push -- "Laboring wears the good spots out" \
#     "The best labor Locations now drift down as they are worked" \
#     "+A Labor? button in #turns"
#
# --hidden writes nothing and announces nothing. --tell-gms overrides the lore /
# antagonist hold-back. See scripts/changelog/log.js.
#
# The push refuses when db/prisma/migrations/ holds an untracked directory.
# --allow-untracked-migrations overrides that.
#
# It also refuses when committed code imports a @lifeweb/db module that is not
# itself in git. --allow-untracked-imports overrides that.
set -euo pipefail
cd "$(dirname "$0")/.."

subject=""
notes=()
flags=()
allow_untracked_migrations=0
allow_untracked_imports=0

for arg in "$@"; do
  case "$arg" in
    --hidden|--secret|--tell-gms) flags+=("$arg") ;;
    --allow-untracked-migrations) allow_untracked_migrations=1 ;;
    --allow-untracked-imports) allow_untracked_imports=1 ;;
    *)
      if [ -z "$subject" ]; then subject="$arg"; else notes+=(--note "$arg"); fi
      ;;
  esac
done

subject="${subject:-wip}"

# A migration that reaches the database but never reaches GitHub leaves
# production's schema ahead of the code Railway builds, which is how
# Structure.linkId took the whole site down. Catch it before the push.
if [ "$allow_untracked_migrations" -eq 0 ]; then
  untracked_migrations=$(git ls-files --others --exclude-standard \
    --directory db/prisma/migrations/)
  if [ -n "$untracked_migrations" ]; then
    echo "push.sh: these migrations are not in git:" >&2
    echo "$untracked_migrations" >&2
    echo "Commit them first, or pass --allow-untracked-migrations." >&2
    exit 1
  fi
fi

# A GameConfig column with no registry entry is a knob nobody can reach.
node db/scripts/ops/check-config-registry.js || exit 1

git add -A

# A shared module that never reaches GitHub fails the WEB BUILD outright --
# "Can't resolve '@lifeweb/db/lib/dmKinds'" -- and Railway answers a failed
# build by keeping the old container alive. So the site silently serves stale
# code while every push looks like it worked. That is what happened on
# 2026-09-08: twelve consecutive failed web builds over 25 minutes, three
# separate files that existed on disk and were never committed. Several
# sessions share this checkout, and a hand-run `git commit <paths>` in one of
# them is all it takes to commit the importer and leave the import behind.
#
# Checked AFTER `git add -A`, so what is measured is the tree being pushed.
if [ "$allow_untracked_imports" -eq 0 ]; then
  missing_imports=""
  for spec in $(grep -rhoE '@lifeweb/db/lib/[A-Za-z0-9_/-]+' \
      web bot db --include='*.js' 2>/dev/null | sort -u); do
    file="db/${spec#@lifeweb/db/}.js"
    if [ ! -f "$file" ] || ! git ls-files --error-unmatch "$file" >/dev/null 2>&1; then
      missing_imports="$missing_imports  $spec -> $file"$'\n'
    fi
  done
  if [ -n "$missing_imports" ]; then
    echo "push.sh: this tree imports modules git does not have:" >&2
    printf '%s' "$missing_imports" >&2
    echo "The web build fails on these and Railway keeps serving the old container." >&2
    echo "Commit them first, or pass --allow-untracked-imports." >&2
    exit 1
  fi
fi
node scripts/changelog/log.js --staged --message "$subject" \
  ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
git add CHANGELOG.md
git diff --cached --quiet || git commit -m "$subject"
git push -u origin master
node scripts/changelog/log.js --announce --message "$subject" \
  ${flags[@]+"${flags[@]}"} ${notes[@]+"${notes[@]}"}
