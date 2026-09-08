# Tibo Alerts engineering notes

- Product scope: no SMS or paid fallback. Preserve the approved free limits and separate launch gates.
- This is a Sites project. The Site-owning agent alone edits the checkout, pushes Sites source and publishes. Keep `.openai/hosting.json` binding metadata; no secrets there.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:mutations`, Node build/bundle budget and hosted build with `npm run verify:hosted`. CI also verifies Docker startup and the source reader’s no-network import check.
- `npm run build:node` and `npm run build` both write `dist/`; run them sequentially. Bundle validation starts a Node production server and must immediately follow the Node build. Hosted packaging must follow the hosted build.
- Source collector executes as JavaScript inside a pinned external TypeScript checkout through tsx. Its pure guards have TypeScript tests; the import smoke verifies the actual upstream binding. Do not enable source logs or pass unrelated secrets into the child.
- Preserve the eight mutation tests and add a regression test before changing critical guards. Never treat fake source fixtures, provider acceptance, or Docker health as live notification proof.
- New SQL must work on both D1 and Node SQLite. Do not modify an applied migration. Keep all quota reservation/authorization writes in one transaction.
- Maintain README, operations, decisions, learnings and PLAN with behavior/setup changes. Do not claim operational status until the pending live acceptance steps pass.
- CI is wired, so application/backend/CI changes require branch + PR + green checks + squash merge, then return to main. Docs-only updates can land directly. Do not add AI co-author trailers.
