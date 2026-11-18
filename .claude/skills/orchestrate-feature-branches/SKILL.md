---
name: orchestrate-feature-branches
description: Run a large multi-feature build with parallel subagents, one git worktree branch per feature, and a gated merge and push by the orchestrator. Use when the user asks to "work on all of those", to use subagents for several features at once, or to orchestrate merges of parallel branches. Portable across projects.
---

# Orchestrating parallel feature branches

You plan, brief, verify, merge and push. Subagents write the code. This is the
process that built ten features plus a QA pass and a security-fix pass on one
branch without a broken push after the gate was fixed.

## 1. Plan the waves before spawning anything

- List the features and their dependencies. Features that share a schema or a
  contract go in a later wave than the thing they depend on.
- Hand out the shared scarce resources up front, in the brief, so agents never
  collide:
  - **migration numbers** (one fixed number per feature, reserve the next one
    for late fixes),
  - **dev server ports** (one distinct port per agent),
  - **names** of new scopes, routes, tables and settings.
- Decide which branch is the integration branch. Agents never push; only you do.

## 2. Brief each agent as a peer

A brief is the agent's whole context. Include:

- the goal and what "done" means (tests, docs, screenshots if UI),
- the files and docs to read first (point at them, do not retype them),
- the resources reserved for it (migration number, port),
- the base: "fetch the integration branch and reset your worktree branch to its
  tip before starting" — worktree agents otherwise start from a stale default
  branch,
- house rules: package manager, never bypass the pre-commit hook, no deploys,
  no real external services, nothing pushed,
- the hand-back format: what changed, test counts, what was not verified,
  decisions left for the user.

Launch independent agents in one message so they run concurrently, each with
`isolation: "worktree"`.

## 3. Merge gate — every check must pass before the push

Run each check separately and gate the push on **all** exit codes. A chain like
`a; b; c && push` only gates on the last command and will push a red tree.

```bash
git merge --no-ff -q <branch> -m "Merge <branch>: <summary>"
<install>; <clear local state caches>
<lint>      > lint.log 2>&1;  L=$?
<typecheck> > tc.log 2>&1;    T=$?
<tests>     > test.log 2>&1;  R=$?
<build>     > build.log 2>&1; B=$?
echo "lint=$L tc=$T test=$R build=$B"
if [ $L -eq 0 ] && [ $T -eq 0 ] && [ $R -eq 0 ] && [ $B -eq 0 ]; then
  git push -u origin <integration-branch>
  git worktree remove --force <worktree>   # `git worktree unlock` first if locked
fi
```

- Merge one branch at a time. After each merge the base has moved.
- **Trivial conflicts** (docs, lists) you resolve yourself. **Code conflicts** go
  back to the owning agent: "merge the updated base into your branch, resolve,
  re-run the checks, report the numbers". It knows its own intent.
- Whichever branch lands second must merge the new base and re-verify before
  you merge it. Tell a still-running agent the base moved as soon as it does,
  including which new tests or conventions its work must now satisfy.
- Later branches adopt what earlier ones introduced (logging helpers, settings
  registry, telemetry hooks) instead of inventing parallel mechanisms. Say so in
  the brief.

## 4. Things that went wrong, and the fix

| Symptom | Cause | Fix |
|---|---|---|
| Lint fails right after a merge | The linter scans agent worktrees | Add the worktree directory to the linter's ignores and to `.gitignore` |
| A stop hook demands committing files you did not write | They are a running agent's in-progress work | Do not commit them; ignore the worktree directory |
| UI tests time out only when several agents run | Per-keystroke typing under CPU load; a timed-out test's typing leaks into the next test | A `fill()` helper that sets the value in one event, and `userEvent.setup({ delay: null })` |
| Push happened with failing tests | Gate only checked the last command | The explicit exit-code gate above; tell the user plainly when it happens |
| Agent built on the wrong base | Worktree created from the default branch | "Fetch and reset to the branch tip" in every brief |
| An agent chose the wrong platform | Requirements changed mid-flight | Stop it, revert its dependency changes, relaunch with a new brief rather than patching |

## 5. Closing passes (after the last feature merges)

Run these two in parallel, then a third:

1. **Whole-app QA and docs** (worktree): one user journey across every feature
   on the real local stack, fix what it finds with regression tests, add
   consistency tests that fail when a new table/scope/route/action is not
   covered everywhere, bring the docs and version in line.
2. **Independent security review** (read-only, no worktree): give it the code
   and the threat surface, not your opinion of it. Ask for a working proof of
   concept per finding and a list of what it found sound.
3. **Security fixes** (worktree): the fixer must reproduce each finding first,
   add a regression test that fails on the base, and re-run the reviewer's
   proof of concept after the fix. Ask it to list behaviour changes and the
   tests it changed on purpose.

Report behaviour-changing fixes to the user before they land, in one line each,
so they can object.

## 6. Reporting

- State test counts from the merged result, not from an agent's report.
- Keep "verified", "verified locally only" and "not verified" separate. Local
  emulators and fakes do not prove production behaviour; say which it was.
- Relay an agent's product decisions to the user as decisions, not as done.
