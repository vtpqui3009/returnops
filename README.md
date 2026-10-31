# ReturnOps

ReturnOps is a one-shop simulated return/refund workflow. This branch contains the Phase 1 baseline proposal: the ChatGPT Sites Vinext starter, local D1 binding declaration, shared TypeScript contract, and A–E scenario specification. API, agent, migrations, seed, UI, LIVE run, and hosted deployment remain pending.

## Source and scope

- Sites plugin 1.1.2 `vinext-starter`; Vinext 1.0.0-beta.5. `sites()` stays in `vite.config.ts`.
- Shared contract: `src/shared/contracts.ts` and [API contract](docs/api-contract.md). Proposed fixtures: [scenarios](docs/scenarios.md). Nhân, Quí, and Khoa must review these before splitting lanes.
- `DB` is the D1 binding declared in `.openai/hosting.json`. Local D1 is separate from hosted D1. R2 is unused. Proof is metadata only; receipt, packet, and reply are always SIMULATED. No buyer send, marketplace submission, or payment occurs.
- Planned provider: OpenAI Responses API only. Model ID and real tool-calling probe await team approval. The example environment template contains names and placeholders only; never commit secrets.
- The source scaffold was added during the hackathon. The brainstorm context and plan were prepared earlier; no rehearsal implementation was copied.

## Local baseline

Requires Node.js 22.13.0 or newer. The starter uses npm and its committed lockfile.

```sh
npm run install:ci
npm run build
npx tsc --noEmit
```

After building, query the local D1 binding:

```sh
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --command 'SELECT 1 AS binding_ok'
```

For future schema work, update `db/schema.ts`, run `npm run db:generate`, inspect and commit generated SQL and metadata, and apply each pending migration to local D1. Seed/reset must be separate and refuse hosted targets. There is no app schema migration or seed/reset script at this baseline.

`npm run dev` starts local Vinext. The portable starter's loopback sign-in simulation is local only. Hosted Sites sign-in uses protected ingress and `app/chatgpt-auth.ts`; this baseline exposes no authorized app API.

## Gate before backend work

1. Confirm the single intended Site, D1 binding, protected identity ingress, and owner/member user ID allowlists. The Sites account visible in this session listed no existing Site.
2. Team approves an exact OpenAI model ID, real tool-call probe, proposed DEMO policy (300,000 VND and 7 days inclusive), metadata proof scope, A/B rules, and owner actions for other decisions.
3. Nhân, Quí, and Khoa review the contract/scenarios; merge the baseline; record the same commit SHA in issues #1, #2, and #3. Only then split `feat/nhan-agent`, `feat/qui-ui`, and `feat/khoa-integration` from it.
4. Nhân owns initial scaffold configuration, server/API/domain, shared types, migrations, and seed/reset. Quí owns UI. Khoa owns scenario sign-off, integration/E2E, and deployment configuration after explicit handoff.

See [Issue #2](https://github.com/vtpqui3009/returnops/issues/2). LIVE and hosted checks remain NOT RUN until independently proven.
