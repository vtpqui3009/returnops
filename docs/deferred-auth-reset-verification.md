# Deferred AUTH-N03 and DATA-N01 verification

This execution checklist tracks the remaining clauses of [issue #3](https://github.com/vtpqui3009/returnops/issues/3). The [test matrix](test-matrix.md) and [latest local evidence](evidence/local-suite-latest.json) retain the current results. Both cases have partial local evidence. This checklist has no new runtime results.

## Environment handoff

Complete these fields when the deployment coordinator supplies the environment. Keep credentials in approved session storage.

| Field | Value for the next run |
| --- | --- |
| Deployed source SHA and version | Pending |
| Hosted URL and access level | Pending |
| Verified Sites ingress and server role mapping | Pending |
| Approved OWNER and MEMBER session mechanism | Pending |
| Disposable test shop and resource scope | Pending |
| Hosted D1 binding and persistence target | Pending |
| Actual agent execution mode | Pending |
| Supported reset entry point and its documented scope | Pending |
| Protected non-demo sentinel in the reset target | Pending |

Nhân/dot coordinates Site configuration and deployment. Khoa records execution and evidence. Use the existing Site and its agreed audience. The application's local D1 CLI targets local storage. Hosted lifecycle operations require the coordinator's supported procedure.

## AUTH-N03

Local evidence already covers anonymous API denial, MEMBER proof-review denial and disabled ingress trust. The remaining work verifies the deployed ingress and its authenticated identities.

1. Confirm that the URL serves the deployed application routes and the intended D1 binding. Obtain legitimate OWNER and MEMBER sessions through the approved login mechanism.
2. Prepare a fresh synthetic case with a valid owner-only action. Record its versions, evidence state, receipt, timeline and rule catalog before each negative request. Use a second fresh case for the OWNER positive control.
3. Send an anonymous read and an anonymous owner-only write. When the request reaches the API handler, assert `401 UNAUTHENTICATED`, an ApiError envelope and a nonempty requestId. If private ingress redirects to login first, record that edge behavior separately and retain NOT RUN for the API-envelope clause until a supported test path is available.
4. With the legitimate MEMBER session, attempt proof review, owner decision and rule accept/reject on valid resources. Assert `403 FORBIDDEN` and unchanged domain state. Use fresh expected versions so another validation error cannot mask the authorization result.
5. Repeat anonymous and MEMBER attempts with client-supplied `oai-authenticated-user-id` and `oai-authenticated-user-email` claiming the approved test OWNER. Verify that these headers cannot grant OWNER privileges. Compare case, evidence, receipt, timeline and catalog state after each attempt.
6. Confirm that local fixture session cookies or client-selected TEST identity cannot authenticate against the hosted application. Inspect the deployed entry point and exercise any documented override mechanism. Record the tested mechanism or evidence of its absence, rather than inventing a production override route.
7. Run the legitimate OWNER positive control through the same deployed route and verify the intended single mutation. This distinguishes authorization denial from an unavailable route or broken fixture.

Retain the deployed SHA, ingress configuration attestation, actor roles, request method/path, HTTP outcome, redacted error envelope and before/after domain snapshots. Record header names and test variants. Keep session values, credentials and raw identity values out of the report.

### Completion checklist

- [ ] Legitimate role sessions and OWNER positive control verified.
- [ ] Anonymous handler behavior and MEMBER denials verified.
- [ ] Forged identity headers fail to grant privileges through the real ingress.
- [ ] Local test identity cannot grant hosted access.
- [ ] Negative requests preserve domain state.
- [ ] Evidence archived with the deployed SHA and reviewer sign-off.

## DATA-N01

Local evidence already covers receipt persistence after reopening Miniflare and reset of a disposable fixture. The remaining clauses concern the application's supported reset operation, its data scope and the deployed persistence path.

1. Identify the supported application reset command and its target. Record the exact command or coordinator operation, source SHA and reset scope. Use an isolated target containing synthetic demo data and a protected non-demo sentinel in the **same D1 database**.
2. Capture the demo records, protected sentinel, schema and binding before reset. Include relationships and row contents needed to detect unintended deletion or mutation. A sentinel in a different database does not establish preservation within the reset target.
3. Exercise the application's supported reset entry point once. Verify that canonical demo fixtures are restored, schema remains usable and the protected sentinel is unchanged. If the operation changes non-demo records, record FAIL and retain the before/after evidence for the backend owner.
4. Process a fresh synthetic case after reset. Verify that it can create a new single simulated receipt and that subsequent reads return the saved result.
5. On the deployed environment, save a synthetic case and receipt, refresh the real UI and compare the saved IDs and versions with API/D1 observations.
6. Have the coordinator perform the supported Worker restart or redeploy while retaining the same D1 binding. Reopen the case and verify the same receipt and domain state. Record the deployed versions and binding before and after.
7. Record local CLI and hosted lifecycle results separately. Complete the hosted reset clause only if a supported hosted reset procedure and designated scope are available.

Retain the supported operation, target scope, protected sentinel snapshots, demo/schema observations, case and receipt IDs, versions and persistence results. Record fixtures and the actual execution mode. Keep fixture-adapter reset evidence labelled as a partial probe.

### Completion checklist

- [ ] Supported application reset entry point exercised on an isolated target.
- [ ] Protected non-demo records in that target remain unchanged.
- [ ] Canonical fixtures and schema remain usable after reset.
- [ ] Fresh case produces one simulated receipt.
- [ ] Real UI refresh preserves the saved result.
- [ ] Supported deployed restart/redeploy preserves the result and D1 binding.
- [ ] Evidence archived with source SHAs and reviewer sign-off.

## Result recording

Keep AUTH-N03 and DATA-N01 partial until every required clause has execution evidence. Record FAIL for an observed contradiction and NOT RUN for a missing prerequisite. Record each executed layer separately.

For automated checks, use the registered variant and evidence rules in [QA reporting](../tests/reporting.md). Add full-layer coverage to the manifest only when its assertions and environment adapter are implemented. The local synthetic ingress cannot establish hosted identity behavior.

After execution, update the matrix result, evidence links, exact SHAs, remaining blockers and this PR checklist together. Record the outcome in a new commit. Keep issue #3 open for its other integration and submission requirements.
