# Copilot Repo Instructions

## Project structure
- `/src` — source code
- `/src/js` — modules
- `/src/css` — styles
- `/public` — static assets
- `/dist` — build output

## Copilot rules
- Always modify files inside `/src`
- Never write into `/dist`
- When editing JS, keep modules separate
- When creating new modules, place them in `/src/js/modules`
- When generating commits:
  - Use conventional commits
  - One logical change per commit

## Commit message format
- `feat: ...`
- `fix: ...`
- `refactor: ...`
- `docs: ...`
- `chore: ...`

## Pull request rules
- PR must include description
- PR must include before/after if UI changes
- PR must pass CI
