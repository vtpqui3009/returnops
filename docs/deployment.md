# Deployment

## Site access model

ReturnOps is published through the managed OpenAI Sites workflow (Vinext on a
Cloudflare Worker with a D1 binding). The rollout target is link access: anyone
with the Site link may sign in with ChatGPT and use the shared synthetic demo.
The Site still requires a verified signed-in ChatGPT identity; anonymous page
and API requests remain denied. Every signed-in user is treated as a demo OWNER,
and all users operate on the same synthetic D1 fixtures.

Enable this behavior only after protected Sites ingress is verified:

```text
SITES_IDENTITY_VERIFIED=true
RETURNOPS_SIGNED_IN_DEMO=true
```

With `RETURNOPS_SIGNED_IN_DEMO` unset or `false`, the original
`OWNER_USER_IDS`/`MEMBER_USER_IDS` allowlist behavior remains active. Do not
publish the shared demo mode with public or spoofable identity headers.

The Site URL is
[returnops-nhan.loftycream129.chatgpt.site](https://returnops-nhan.loftycream129.chatgpt.site).
The last verified release was version **3** (runtime revision **5**), built from source
SHA `ffb3132fe631ae6687e52159f3fb5309ad31ea18`. The latest successful
deployment was recorded on 2026-10-31 while the Site was owner-private. The
shared-sign-in rollout version is intentionally not recorded until publishing
and post-publish checks complete.

## Hosted configuration

Configure these names in Sites server-side variables/secrets. Never commit
their values or user identifiers:

| Name | Purpose |
| --- | --- |
| `DB` | Managed D1 binding |
| `RETURNOPS_UI_MODE=api` | Selects the real same-origin API adapter |
| `SITES_IDENTITY_VERIFIED=true` | Enables trusted Sites identity checks after ingress verification |
| `RETURNOPS_SIGNED_IN_DEMO=true` | Maps every verified signed-in user to the synthetic demo OWNER role |
| `OPENAI_MODEL=gpt-6.1-terra` | Hosted provider model |
| `OPENAI_API_KEY` | Server-only provider secret |
| `OWNER_USER_IDS` | Owner allowlist when shared demo mode is disabled |

`MEMBER_USER_IDS` is used only when shared demo mode is disabled. Missing trust
or identity is rejected in both modes; with shared demo mode disabled, an
authenticated ID outside the allowlists is forbidden.

## Data and one-time setup

The hosted D1 schema was migrated and verified with the five synthetic A–E
fixtures. The temporary operator initializer was used once during version 2
provisioning, then its route and secret were removed before version 3. Do not
restore the initializer or run local seed/reset commands against the hosted DB.

All hosted workflow receipts are `SIMULATED`; no refund, message, or external
marketplace action is performed.

## Verification

The genuine signed-in owner session completed hosted A–E verification after a
compatible redeploy and page reload. Each scenario completed with HTTP 200,
the expected replay/persistence checks passed, and the five receipts remained
unchanged. Anonymous and spoofed identity requests returned 401; an owner
queue request returned 200; an unknown input field returned 400.

Local validation also passed: 34 tests, TypeScript, and build. Lint exits 0
with one pre-existing anonymous-default-export warning in a test adapter.

## Publish and rollback

For changes, use the native Sites publish flow: validate locally, save a new
version, deploy it to the existing Site, then change the Sites audience to link
access and rerun the hosted checks. This managed Site is not a raw Wrangler or
Cloudflare Pages target. Roll back to a recorded compatible Site version if
needed, set `RETURNOPS_SIGNED_IN_DEMO=false`, and restore the appropriate
allowlists; do not reset the hosted D1 database. Version 2 is not a rollback
target because it still contained the temporary initializer route.

Separate member authorization, second-account/session, mobile/recovery, and
full handoff QA remain open. The shared mode is acceptance evidence for a
simulated demo, not a production-readiness claim.
