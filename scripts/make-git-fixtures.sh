#!/usr/bin/env bash
# Build git fixtures covering every state GRID's pane header can render.
set -e
ROOT="$1"
rm -rf "$ROOT"
mkdir -p "$ROOT"
cd "$ROOT"

export GIT_AUTHOR_NAME=grid GIT_AUTHOR_EMAIL=grid@example.com
export GIT_COMMITTER_NAME=grid GIT_COMMITTER_EMAIL=grid@example.com

git init --bare -q remote.git

# --- atlas-api: a busy branch, ahead of upstream, dirty + untracked ---------
git clone -q remote.git atlas-api
cd atlas-api
echo base > README.md && git add . && git commit -qm "base"
git push -q origin HEAD:main && git branch -q --set-upstream-to=origin/main main 2>/dev/null || true
git checkout -qb feat/webhook-retry
for i in 1 2 3; do echo "line $i" > "file$i.ts"; done
git add . && git commit -qm "webhook retry"
git push -q -u origin feat/webhook-retry
echo "ahead 1" >> file1.ts && git commit -qam "ahead one"
echo "ahead 2" >> file2.ts && git commit -qam "ahead two"
# staged + unstaged + untracked
echo staged > staged.ts && git add staged.ts
echo modified >> file3.ts
echo new1 > untracked1.ts
echo new2 > untracked2.ts
mkdir -p sub && echo new3 > sub/untracked3.ts
cd ..

# --- ledger-cli: clean, in sync --------------------------------------------
git clone -q remote.git ledger-cli
cd ledger-cli
git checkout -qb fix/tz-parse
echo clean > a.txt && git add . && git commit -qm "clean tree"
git push -q -u origin fix/tz-parse
cd ..

# --- mercury-web: behind upstream ------------------------------------------
git clone -q remote.git mercury-web
cd mercury-web
git checkout -q main 2>/dev/null || git checkout -qb main origin/main
echo x > x.txt && git add . && git commit -qm "one" && git push -q origin main
git reset -q --hard HEAD~1
echo dirty >> README.md
cd ..

# --- conflicted: a merge left half-done ------------------------------------
git clone -q remote.git conflicted
cd conflicted
git checkout -q main 2>/dev/null || git checkout -qb main origin/main
echo one > both.txt && git add . && git commit -qm "one"
git checkout -qb other HEAD~1 2>/dev/null || git checkout -qb other
echo two > both.txt && git add . && git commit -qm "two"
git merge main -q 2>/dev/null || true
cd ..

# --- plain-folder: not a repo at all ---------------------------------------
mkdir -p plain-folder && echo hello > plain-folder/notes.txt

echo "--- fixtures built ---"
for d in atlas-api ledger-cli mercury-web conflicted; do
  echo "== $d"
  git -C "$d" --no-optional-locks status --porcelain=v2 --branch --untracked-files=all | head -8
done
