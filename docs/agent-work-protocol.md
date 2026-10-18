# Cross-Agent Work Protocol — LIFE-LINK

This protocol is shared by Codex, Cursor, Antigravity and human contributors.

## 1. Scope and source of truth
- Work only in this repository unless the user explicitly authorizes another location.
- Never inspect or modify the user's separate Obsidian vault or unrelated sibling projects as part of LIFE-LINK work.
- Source code, SQL migrations, tests and deployment config define actual behavior. Docs are the map, not proof.
- The code graph is a navigation aid; confirm every important claim by reading source/tests.
- Do not commit secrets, real tokens, production personal data or `.env` files.

## 2. Before editing
1. Read this file and relevant pages under `docs/`.
2. Check `docs/project-status.md` and `docs/next-tasks.md`.
3. If Graphify is installed in the local clone, query it before broad grep/source reading, then use path/explain as useful. Do not assume this hosted GitHub view has the local Graphify graph.
4. Identify the active implementation path; avoid legacy Vite files unless the task explicitly concerns them.
5. Read the relevant route, service, client, migration and tests before proposing a change.
6. State assumptions and unknowns in the task summary before making risky cross-cutting edits.

## 3. During implementation
- Keep diffs focused; avoid unrelated cleanup and large rewrites.
- Preserve established auth, tenant isolation, validation, audit and transactional patterns.
- Do not trust client-provided user IDs, roles, organization IDs or ownership claims.
- Do not change SQL state transitions without checking related services and tests.
- For ML changes, preserve feature order, prevent post-outcome leakage, and verify the intended model artifact.
- Prefer existing shared UI components and design conventions.
- Add or update tests with behavior changes.

## 4. Before declaring complete
- Run relevant tests/builds when environment allows; if not, say exactly what was not run.
- Inspect the final diff and check for secrets, generated files and unrelated modifications.
- Update affected docs, status and next tasks.
- Regenerate Graphify only in a local clone after source changes, using the project's established workflow; don't fabricate a graph update from hosted source.
- Report files changed, commands run, outcomes, known gaps and the commit/branch if applicable.

## 5. Coordination between agents
Every handoff should include:
- Goal and scope
- Files inspected/changed
- Relevant decisions and constraints
- Tests run and results
- Open questions / risks
- Exact next step

Do not assume another agent remembers conversation context. Put durable decisions in `docs/decisions/` and update `docs/project-status.md`.

## 6. Suggested task handoff template
```md
## Handoff
- Goal:
- Scope:
- Source files:
- Changes:
- Tests:
- Decisions:
- Risks/open questions:
- Next step:
```
