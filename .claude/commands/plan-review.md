---
description: Adversarially review an implementation plan before building it
argument-hint: [path to plan file, or blank to use the current plan]
allowed-tools: Read, Write, Glob, Grep, Bash, Agent
---

Review the current implementation plan before any of it gets built. A plan
reviewed inside the context that produced it is rationalization, not review —
so the entire point of this command is that the reviewers do not see your
reasoning.

## 1. Externalize the plan

If `$1` is a path, use it. Otherwise flatten the current plan verbatim — every
step, every file it names, every claim it makes about how the code works today.
Do not summarize it and do not repair it on the way out: a plan that is only
coherent in your head is a finding, and flattening it is how that surfaces.

Write it to `.plan-review/plan.md`, and the user's original request to
`.plan-review/request.md`.

**If writes are blocked** — you are in plan mode, which is read-only, and this
is the normal case — do not try to work around it and do not leave plan mode to
get around it. Pass the plan and the request inline in each reviewer's prompt
instead. Everything below works the same way; the files are a convenience, not
the mechanism.

## 2. Fan out

Spawn three `plan-reviewer` subagents **in parallel, in a single message**.
Give each one the plan, the original request, and its lens — nothing else. Do
not paste your reasoning, your confidence, or which parts you think are risky.
That framing is exactly the bias being controlled for.

- lens `factual-grounding` — verify every claim the plan makes about existing
  code against the actual files
- lens `adversarial` — assume the plan fails; find the step where it breaks
- lens `invariants` — check it against CLAUDE.md's hard rules

## 3. Merge

Collect the JSON verdicts and write them to `.plan-review/findings.json` if you
can write; otherwise just hold them.

- **Drop** any finding with no `file` and no concrete `failure_scenario`. That
  is the filter that removes plausible-sounding noise.
- **Do not average.** Two reviewers disagreeing is not a tie — open the file
  yourself and settle it. Say which way you settled and why.
- **Treat `unverifiable` as amber, not green.** A claim nobody could confirm is
  a claim the implementation will discover the hard way.

## 4. Report

Revise the plan against what survived, then show the user:

1. **What changed** in the plan, and which finding drove each change.
2. **What you rejected**, and why — including anything you overruled a reviewer
   on.
3. **Surviving assumptions** — anything still unverified, stated plainly, so
   approving the plan is an informed decision rather than a hopeful one.

Then stop and let the user approve. Do not start implementing, and if you are
in plan mode do not exit it — the point of reviewing a plan before building is
that throwing it away is still cheap.
