# Quí UI lane — issue #1

Shared starting point: merged baseline `92430915e529ae12f0a7ed5c4b2842d771498e86` (PR #5). This lane ports the reviewed same-day prototype into the existing Vinext application. It preserves `sites()`, DB declarations and backend ownership. No shared contract changes, second scaffold, deployment or LIVE claim.

## Run and check

```sh
npm run install:ci
npm run build
npx tsc --noEmit
npm run lint
node scripts/check-ui.mjs
```

This review branch opens with explicitly labelled TEST mock data when no mode is configured. There are no backend routes in this UI PR. The separate real same-origin HTTP adapter is exercised in browser QA and can be selected with server configuration; failed HTTP calls never silently switch to fixtures.

For the synthetic review walkthrough, simply run `npm run dev`. To select the HTTP adapter, configure its **server-only** Worker binding before starting the dev server:

Add the following line to the local ignored `.dev.vars` file, preserving any existing settings, then restart `npm run dev`:

```dotenv
RETURNOPS_UI_MODE=api
```

Vinext runs server pages in a Cloudflare Worker: mode is read from the Worker binding, not Node shell `process.env`. Remove only this setting and restart to return to the labelled TEST review walkthrough. Hosted binding configuration belongs to Nhân/dot and is not changed here. There is no visitor-accessible mode/state/reset selector. TEST uses isolated sessionStorage fixtures so refresh can be tested; this is not D1 persistence or a product database. Production API mode does not read this storage. No credentials, actor IDs or roles are sent from UI forms.

## Architecture and integration

- `src/features/returnops/returnops-app.tsx`: React screens and reusable presentation controls; canonical data and decisions come from the adapter. Owner actions use the two permitted contract values.
- `api.ts`: typed same-origin HTTP adapter, error presentation, immutable intent snapshots/Idempotency-Key and cancellable evaluation polling. No policy or fixture fallback.
- `test-adapter.ts`: explicitly labelled synthetic contract adapter, matching `docs/scenarios.md`; no actual model, D1 or external action. Its guards are TEST behavior, not server security.
- `returnops.css`: restrained sage/neutral tokens, shared controls and responsive content-focused layout. Native modal confirmation handles Escape/Tab/focus restoration.

The API adapter uses the merged shared request/response types unchanged. The queue contract contains no product title/amount; UI loads the current page's case details rather than inventing fields. Paginated records stay bounded to server pages. Errors never become successful receipts. All references, packet/reply and server messages render through React text nodes; no raw HTML injection or automatic fetch/link of evidence references. See [exact validation results, reproduction and screenshots](ui-validation.md).

### Agreed workflows

- **A:** display the backend's decision, timeline and one SIMULATED receipt; never fabricate completion in a component.
- **B:** submit SELLER/PACKING metadata with current order/version/tracking. Submission alone stays waiting. Explicit owner review carries expected case/evidence versions and reason. Follow the returned evaluation operation and refresh detail after completion.
- **C:** current CARRIER/DELIVERY proof must be VERIFIED before the DISPUTE action is enabled. Refresh detail/versions after review. Closure retains all flags and creates no rule suggestion.
- **D:** owner case decision is separate from rule approval. A pending suggestion leaves the active catalog unchanged.
- **E:** rule accept returns its acknowledgement only. Open E and request a separate fresh evaluation with new case/catalog versions and a new intent key. Poll that operation; never treat accept/202 acknowledgement as completion.

HTTP retries retain the same frozen body/key for the same confirmed intent. Editing a draft discards the old retry. 401/403/409 require reload/review, not blind replay with new versions. Evaluation retry retains the original operation acknowledgement and resumes polling. Unmount/navigation cancels reads/polling; mutation buttons and navigation are protected synchronously against double submits while a write is in flight. Frontend disabling does not substitute for backend idempotency/authorization.

## Acceptance checklist — all Quí-assigned work

| Issue #1 criterion | UI deliverable | Verification / external dependency |
|---|---|---|
| Shared scaffold/types, no second scaffold | Vinext page + imported merged contract | Typecheck/build; no backend/config ownership changes |
| Separate API adapter, no rendering policy | HTTP adapter and isolated TEST adapter | Adapter tests and network browser checks |
| Queue, facts, proof, timeline, decision, rules | Four responsive screens | Desktop/mobile browser walkthrough |
| Loading/empty/errors/retry/403/409 | Natural request/result states, preserved drafts | Faulted HTTP browser responses; no developer state controls |
| A receipt; B wrong/stale/unverified proof | Canonical result display and review/evaluation sequence | TEST/adapter checks; true API acceptance deferred |
| C flags, owner DISPUTE, no learning | Verified-delivery gate + refreshed versions | UI/adapter negative checks; server enforcement deferred |
| D pending; E separate approval + fresh evaluate | Separate confirmations and operation polling | TEST/adapter sequence and provenance checks |
| Refresh, duplicate protection | Adapter reload; TEST session fixture retention; frozen intent key | TEST refresh and double-click tests; D1 persistence deferred |
| No browser API key; simulation disclosure | Server-only mode flag; no OpenAI client calls | Source/bundle review; browser notice |
| PR/run guide/demo evidence | This guide + exact check report and synthetic screenshots | Draft PR; human/team review pending |
| Codex contribution evidence | See below | Commit/PR link and actual check results |

## Codex contribution evidence

| Task | Codex contribution | Verification | Human review | Limits |
|---|---|---|---|---|
| Port friendly four-screen UI | Translated reviewed prototype into existing React/Vinext scaffold, consistent CSS/components, Vietnamese states | Build/typecheck/lint and browser evidence recorded in UI validation report | Pending Quí/teammate PR review | Frontend only |
| Contract workflow alignment | Separated metadata submission, evidence review, C closure, rule accept and fresh E evaluation; typed adapter and intent retry/polling | UI/adapter tests, including wrong proof, stale versions and duplicate keys | Pending | No real API or model run |
| Defect review and correction | Reproduced prototype retry validation and superseded-read bugs before port; incorporated immutable intents, cancellation and explicit review confirmation | Focused prototype checks plus final scaffold checks | Pending | Prototype checks do not certify backend |

This is evidence of Codex assisting product development, separate from any agent runtime traces. No private conversation, secret or customer data is included. The PR references issue #1 without automatically closing it while backend integration is unverified.

## Remaining cross-lane gates

Nhân owns real API routes, D1/migrations/seed and server authorization/idempotency/policy. Khoa owns full E2E/deployment/judge access and submission. Hosted role mapping, final demo policy, model/tool probe and LIVE run are not completed by this PR. TEST success cannot establish any of these. Retest the UI against real endpoints before integrated acceptance/issue closure.
