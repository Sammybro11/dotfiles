---
name: report
description: Generate a cited technical report auditing a codebase, subsystem, or
  paper — findings with file:line citations, severity-graded issues, comparison
  against standard practice. Use for "audit my repo", "review this subsystem",
  "is this implementation correct" tasks.
user-invocable: true
---

# Cited technical report

Produce a markdown report on the target (repo, subsystem, directory, or paper
+ its code). Default output: `reports/<slug>.md` with a `.provenance.md` sidecar.

## Procedure
1. Read the target code end-to-end before writing anything. Trace the real
   execution flow, not the README's description of it.
2. Compare against standard practice: for physics code, that means published
   reference implementations, standard libraries doing the same job (e.g.
   `emcee` vs hand-rolled MCMC, `pymatching` vs lookup decoder), and the
   papers the code cites.
3. Findings, each with:
   - **Citation**: `path/file.py:LINE` — every claim traceable, no exceptions
   - **Severity**: `critical` (wrong results) / `bug` (will fail in real use) /
     `smell` (maintainability) / `polish`
   - **Why it matters** in one sentence, and the smallest fix
4. Hunt for the second bug — one finding means keep looking. Check the usual
   suspects deliberately: path-case sensitivity, dead code, duplicated
   definitions drifting apart, unstated assumptions (seeds, shot counts,
   directory-relative imports), Python-version-dependent syntax.
5. Verify before publishing: re-read every cited line; confirm line numbers
   and quotes are accurate. Run any check that is runnable.
6. Structure: Summary → What the code does well (be honest) → Findings by
   severity → Comparison to standard practice → Recommended order of fixes.

## Rules
- Never report a bug you haven't traced to a line and reasoned through; show
  the failing input or condition, not a hunch.
- Distinguish "wrong" from "not what I would have written". Taste is not
  severity.
- If the report claims something is correct, that claim needs evidence too.
