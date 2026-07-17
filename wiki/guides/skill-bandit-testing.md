---
title: Testing Claude skills with a multi-armed bandit
summary: How the git-span-v2 skill was selected — five SKILL.md variants raced with two-level Thompson sampling over headless haiku trials in deterministic scenario repos, graded pass/fail by terminal-state graders and scored by inverse transcript size — plus the methodology corrections (scenario-matched blocks, transcript-autopsy breeding, pooled sign tests) and how to rerun the archived harness for the next skill experiment.
aliases: [skill bandit, bandit skill testing, git-span-v2 methodology, skill A/B testing]
---

# Testing Claude skills with a multi-armed bandit

This guide documents the experiment that produced
[plugins-claude/git-span/skills/git-span-v2](../../plugins-claude/git-span/skills/git-span-v2/SKILL.md),
and how to run the same kind of experiment again. The complete harness — variant skills
(including retired ones), scenario environments, runner, bandit, all 69 trial records with
their session IDs, and every haiku session transcript — is archived in
`wiki/attachments/git-span-skill-bandit.zip` (the wiki link checker does not index
binary files, so this is a plain path, not a link).

## The method in one pass

1. **Author variants in isolation.** Each candidate is a self-contained `SKILL.md` (plus
   optional `sections/`) under a private directory; test agents receive only the file path
   and are instructed to read nothing else except `git span --help`. Author variants from a
   shared research brief, but verify every flag claim against the installed binary — the
   historical usage report described a larger CLI surface than the shipped 1.0.134 build.
2. **Build deterministic scenario environments.** Each scenario is `setup.sh <dest>`
   (builds a fixture git repo with a `.span/` corpus), `task-prompt.md` (skill-agnostic
   end-state instructions with a `{{SKILL_PATH}}` placeholder), and `grade.sh <env>`
   (terminal-state grader: exit 0/1, never inspects transcripts). Verify each scenario
   three ways before trusting it: solve it by hand and grade (must pass), grade the
   untouched env (must fail), and check that a *plausibly wrong* solution — e.g. a
   duplicate span under a new name — also fails.
3. **Run headless trials.** One trial = fresh env → `claude -p "<prompt>" --model haiku
   --output-format json --dangerously-skip-permissions` with cwd inside the env → grade →
   measure the session's main + subagent transcript bytes under
   `~/.claude/projects/<encoded-cwd>/` → append one JSON record to `results/trials.jsonl`.
   Reward is `0` on failure, else `1 / total_transcript_chars`.
4. **Allocate with two-level Thompson sampling, but block by scenario.** Success is a
   Beta posterior; efficiency is a Normal posterior on `log(chars)` of passes; sampled
   reward is `p · exp(−logc)`. After phase 1, allocation switched to scenario-matched
   complete blocks — every active arm runs the same scenario in each block — with the
   posterior aggregated at equal scenario weight.
5. **Breed, then confirm.** Retire failing arms, autopsy real transcripts to find the
   expensive behaviors, encode the fixes into new hybrid variants, and re-race. Judge the
   final pairing with paired sign tests across pooled blocks, not with raw posterior leads.

## Rerunning the harness

```bash
unzip git-span-skill-bandit.zip && cd git-span-skill-bandit
bash envs/scenarios/reconcile-drift/setup.sh /tmp/probe   # smoke one scenario
python3 runner/bandit.py next          # or next2/next3/next4 for the block-based rounds
bash runner/run-trial.sh variant-a reconcile-drift        # one manual trial
python3 runner/bandit.py report        # posteriors + significance
python3 -m pytest runner/tests/        # 47 tests over allocation, caps, retirement
```

`runner/NOTES.md` documents the transcript-path convention and the ~15 `CLAUDECODE*` env
vars that must be neutralized (`env -u`) for nested `claude` invocation. Trial artifacts
must land in a sibling `.meta/` directory, never inside the env repo — graders that
require a clean tree will otherwise fail correct work (this was a live bug; see
`results/invalid-trials.jsonl`).

## Methodology lessons (what phase 1 got wrong)

- **Ceiling effect.** 15/15 passes meant success carried zero signal; only scenarios that
  a real agent can plausibly fail (mixed-drift triage with a dead-coupling trap, coupled
  code+doc value updates) separate variants on anything but cost.
- **Scenario-mix confound.** Thompson allocation plus arm-independent scenario rotation
  gave arms unbalanced scenario diets, biasing raw char comparisons. Fix: complete blocks
  and equal-scenario-weight aggregation. Compare arms *within* a block, never across
  pooled raw means.
- **Regression toward the mean.** The round-3 leader entered the confirmation round at
  5-1 in block wins and finished it 7-3 / 6-4 (sign test p = 0.34 / 0.75). Picking a
  leader on a small sample and then re-measuring reliably shrinks the lead; budget a
  confirmation round before believing one.
- **Grade the failure modes you saw.** Both variant deaths were the same wrong-line
  re-anchoring trap; graders were tightened mid-experiment (exact span counts, name sets)
  after an autopsy found a passing trial that had created a duplicate span. Grader
  strictness changes between rounds are a validity caveat — record them.
- **Teach-to-test asymmetry.** The winning variant's author had direct exposure to the
  triage fixture that later discriminated hardest. Keep authors blind to fixtures, or
  note the asymmetry in the conclusion.
- **Transcript autopsies beat intuition.** The measurable cost drivers were
  trust-boundary violations (re-verifying `stale` output via `git log`/`git show`,
  ~50k wasted chars per occurrence), unbatched history calls, and silent router misses in
  multi-file skills. The bred-in countermeasures are visible in the winner's dispatch
  block — [SKILL.md § Where to go next](../../plugins-claude/git-span/skills/git-span-v2/SKILL.md#L71-L103) —
  which routes on countable conditions with a catch-all else-branch.

## Outcome

Variant-e won on pooled record (7-3 and 6-4 in paired blocks, 10/10 passes) but without
statistical separation from the two other survivors — all three were perfectly reliable
and within ~6% on mean transcript cost. It was adopted as
[git-span-v2](../../plugins-claude/git-span/skills/git-span-v2/SKILL.md) on design grounds:
bounded 82-line core, section files loaded only on observable triggers
([triage](../../plugins-claude/git-span/skills/git-span-v2/sections/triage.md),
[inspect](../../plugins-claude/git-span/skills/git-span-v2/sections/inspect.md)), and the
bred-in anchor discipline (grep the `why`'s symbol before writing line ranges; trust
`stale` output and stop) whose absence killed both retired variants on the identical trap.
The incumbent [git-span skill](../../plugins-claude/git-span/skills/git-span/SKILL.md)
remains in place; v2 sits beside it.

After adoption, the incumbent's long-tail sections (hooks, terminal statuses, LFS,
candidate mining, CI, command reference — content the experiment never exercised) were
grafted into v2 as additional dispatch routes. Only the *experiment-tested* artifact is
the core recipes plus the triage/inspect sections; the grafted routes were instead
verified claim-by-claim against the installed binary, which surfaced real incumbent-doc
errors (a `MERGE_CONFLICT` status that is actually `CONFLICT`, a falsely claimed
concurrent-`add` file lock, swapped section numbering in the mining reference).

Every trial's haiku `session_id` is in the archive's `results/trials.jsonl`, and the
matching transcripts are under `transcripts/` keyed by the encoded env path.
