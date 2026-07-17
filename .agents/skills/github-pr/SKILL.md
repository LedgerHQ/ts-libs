---
name: github-pr
description: Create a well-formed draft PR for ts-libs. Covers changeset, commit check, PR body, and gh CLI invocation.
disable-model-invocation: true
---

# Create PR

## Before Creating

1. Load `/git-workflow` — verify branch name and commit format
2. Run `git diff develop..HEAD --stat` — confirm scope of changes
3. Run `/create-changeset` — add a changeset if any `libs/*` package changed
4. Commit the changeset

## PR Body Template

```markdown
### ✅ Checklist

- [x] Changeset attached (`pnpm changelog`)
- [{{TEST_CHECKBOX}}] Covered by automatic tests{{TEST_NOTE}}
- [x] Impact: {{IMPACT}}

### 📝 Description

{{DESCRIPTION}}

### ❓ Context

{{CONTEXT}}

---

### 🧐 For Reviewers

- Code aligns with requirements described in context
- No undocumented trade-offs or technical debt introduced
- Tests cover the meaningful cases
- Public API changes are intentional and backward-compatible (or breaking change documented)
```

## Fill Rules

- `TEST_CHECKBOX`: `x` if tests exist, ` ` if not (explain why in `TEST_NOTE`)
- `IMPACT`: one-line description of what could regress
- `DESCRIPTION`: problem → solution, include code examples for API changes
- `CONTEXT`: Jira/GitHub link or plain description

## Create the PR

```bash
git push -u origin HEAD

gh pr create --draft \
  --base develop \
  --title "<type>(<scope>): <description>" \
  --body "$(cat <<'EOF'
<generated body>
EOF
)"
```

Always use `--draft`. Always target `develop`.
