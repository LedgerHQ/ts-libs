---
name: pre-review
description: Multi-agent code review before opening a PR. Surfaces critical issues, suggestions, and improvements.
disable-model-invocation: true
---

# Pre-Review

## Process

1. Run `git diff develop..HEAD` to get the full diff.

2. Launch 3 `code-reviewer` agents **in parallel**, each focused differently:

   - **A** — Correctness & edge cases: null/undefined handling, error states, off-by-one, async races
   - **B** — TypeScript quality: avoid `any`/`!`, correct types, missing exports, API design
   - **C** — Library conventions: `catalog:` devDeps, build outputs, changeset needed, tests missing, DX

   Each agent prompt: _"Review this diff against develop. Focus on [FOCUS]. Return findings with file:line, severity, and suggested fix."_

3. Merge and deduplicate findings. Present grouped by severity:

   ```
   🔴 Critical   — path/to/file.ts:42 — issue → fix
   🟡 Suggestion — ...
   🟢 Nice to have — ...

   Summary: X critical, Y suggestions, Z nice-to-haves
   ```

4. Ask which items to fix: **"all criticals"**, **"all"**, **"#1,#3"**, or **"skip"** → then `/github-pr`
