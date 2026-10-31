# QA evidence

Each Playwright execution writes a summary to `tests/artifacts/runs/<runId>/summary.json`. The run directory also contains the JSON evidence referenced by that summary. Archive this directory when handing off evidence. The latest summary for each selected project set is also available at `tests/artifacts/<selected-projects>/summary.json`. Attachment paths in both summaries are relative to the respective summary file. Discovery with `--list` leaves execution evidence intact.

The reporter retains selected fields from the `fixture-run`, `terminal-case` and `consistency-check` attachments, including mode, operation, case and rule identifiers, versions, flags and outcomes. Consistency evidence also records the variant, HTTP outcomes, error codes and selected D1 counts. It omits provider messages, HTTP headers, raw response bodies and Playwright error-context files. Review even these selected synthetic fields before sharing. Browser traces, screenshots and deployment logs require separate handling when their test layers become available.

For API runs using the checked-in local PR #8 adapter, the reporter reads Git HEAD and dirty state directly from `RETURNOPS_BACKEND_ROOT` into `metadata.backendCommit` and `backendDirty`. It labels the local dispatcher, synthetic ingress, Miniflare D1 and TEST agent scope. `metadata.commit` and `metadata.dirty` describe the QA checkout. The report omits the backend path and environment values. Record any uncommitted patch with the handoff if a checkout is dirty.

Read `runnerStatus` and `matrix[].layers` together. A setup blocker can make the command exit nonzero while its product assertions remain NOT RUN. Harness self-tests produce harness results. An API PASS applies to that executed API case. Full UI, D1, deployment and judge access each need their own evidence. Test discovery and skipped or interrupted runs do not establish product acceptance.

`ui-local` is a separate layer for the real UI component in API mode, using synthetic local sessions, the backend dispatcher and Miniflare D1. Its metadata records `uiCommit`. It does not cover Vinext/Sites route wiring. `relatedMatrixIds` links a partial probe to its matrix requirement without granting that ID a full-layer PASS. Read those passing observations alongside the remaining hosted/UI requirements.

A runtime observation requires a valid fixture record and a complete case outcome or an explicit screen-state observation. Missing or incomplete evidence records NOT RUN and makes the run fail. Matrix PASS additionally requires every registered `matrix-variant` in `support/catalog.ts`. Filtered runs retain their individual results, while `matrix[].coverage` records missing variants and the full requirement stays NOT RUN. Duplicate or unknown variant names cannot fill a missing variant.

UI evidence includes the asserted decision, completion label and rule provenance text. Read-state variants record loading, the injected HTTP error and the successful recovery response. These fields are selected separately from provider reply content.

DATA-N01 remains partial. Persistence and reset of the disposable fixture have local evidence. The application's reset CLI and preservation of records outside demo scope require a separate run with a protected sentinel. Fixture reset alone cannot grant DATA-N01 a full API or browser PASS.

Successful local fixtures also attach bounded terminal snapshots for up to 50 cases from the final queue before disposing D1. The reporter selects only case/operation/version/receipt fields. Agent fault probes use the real validator with a synthetic provider transport, including when the backend records its default LIVE failure label.
