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
The current release is version **7** (runtime revision **6**), built
from source SHA `16d6666496e878a98e9a270280457dfa0b560c48`, deployment
`appgdep_6ae5b524864c8191aa71c443dc823a8f`. Native Sites publication
succeeded on 2026-10-31. This release makes **Add replacement reference**
scroll to the evidence form and focus its reference field. The user confirmed
the local fix; TypeScript, targeted lint, and the packaging build passed.
Hosted browser interaction was not rerun. Version 6 is the previous compatible
English shared-demo release. Sites audience is public/link
access, while ChatGPT sign-in remains required. Version 3 (runtime revision 5)
was the prior owner-private release.

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

The current shared release has no `OWNER_USER_IDS` or `MEMBER_USER_IDS` values;
they are not needed while `RETURNOPS_SIGNED_IN_DEMO=true`. Missing trust or
identity is rejected in both modes. With shared demo mode disabled, restore the
appropriate allowlists before publishing and an authenticated ID outside them
is forbidden.

## Data and one-time setup

The hosted D1 schema was migrated and verified with the shared synthetic
fixtures. The temporary operator initializer was used once during version 2
provisioning, then its route and secret were removed before version 3. The v4
verification snapshot preserved the prior five completed cases, the shared
release's additional prepared case, and the accepted rule catalog. The UI's **Reset demo data** button is the only supported hosted refresh: it requires a verified
signed-in shared-demo OWNER, confirms a global irreversible erase, and
atomically restores five fresh synthetic A–E cases. The final v5 reset left
five `NEW` cases with fresh IDs, no evaluations, receipts, or suggestions,
catalog version 1, and the two built-in rules. Do not use a raw CLI, drop/reseed
command, or the removed initializer against the hosted DB.

All hosted workflow receipts are `SIMULATED`; no refund, message, or external
marketplace action is performed.

## Verification

The current genuine signed-in Chrome session, with no owner/member allowlists,
loaded the public-link Site and used the shared demo OWNER role. Anonymous root
access redirected to ChatGPT sign-in (307), anonymous reset POST returned 401,
and spoofed API requests returned 401. The UI cancel path made no POST and
preserved prior state. The confirmed reset returned five fresh `NEW` cases in
811 ms; a subsequent A evaluation completed LIVE on `gpt-6.1-terra` with a
simulated receipt, and the final UI reset/reload returned the shared state to
five fresh cases. Concurrent reset protection and durable idempotency
acknowledgements were verified. No real side effect occurred.

Local validation also passed: 44 tests, TypeScript, and build. Lint exits 0
with one pre-existing anonymous-default-export warning in a test adapter.

## Publish and rollback

For changes, use the native Sites publish flow: validate locally, save a new
version, deploy it to the existing Site, then change the Sites audience to link
access and rerun the hosted checks. This managed Site is not a raw Wrangler or
Cloudflare Pages target. Roll back to a recorded compatible Site version if
needed, restore the appropriate `OWNER_USER_IDS`/`MEMBER_USER_IDS` values first,
set `RETURNOPS_SIGNED_IN_DEMO=false`, and change the Sites audience back to
custom/private access if desired. The shared refresh button is unavailable after
that flag change; do not substitute a raw hosted D1 reset. Version 2 is not a rollback
target because it still contained the temporary initializer route.

Independent second-account testing, mobile/recovery, and full handoff QA remain
open. The old hosted MEMBER-403 criterion is not applicable in shared mode;
restricted-role tests remain covered by the default flag-off behavior. This is
acceptance evidence for a simulated demo, not a production-readiness claim.

## English release validation

Version 6: 44 root tests and 14 harness tests passed, including desktop/mobile
owner controls. TypeScript, lint and build passed (existing lint and punycode
warnings only). The Sites packaging build also passed and the production
deployment returned `succeeded` at the existing URL. Hosted browser workflows
were not rerun for this release. Existing stored Vietnamese demo content requires
an intentional **Reset demo data** action; deployment did not erase shared data.
