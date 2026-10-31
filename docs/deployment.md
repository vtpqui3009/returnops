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
The current verified release is version **4** (runtime revision **6**), built
from source SHA `e49c9e41e77071b91b7589abdde8ae8aae72a6ee`, deployment
`appgdep_6ae5adfec4e08191b09041a462ecf72b`. Sites audience is public/link
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
release's additional prepared case, and the accepted rule catalog. The UI's **Làm mới dữ
liệu demo** button is the only supported hosted refresh: it requires a verified
signed-in shared-demo OWNER, confirms a global irreversible erase, and
atomically restores five fresh synthetic A–E cases. Do not use a raw CLI,
drop/reseed command, or the removed initializer against the hosted DB.

All hosted workflow receipts are `SIMULATED`; no refund, message, or external
marketplace action is performed.

## Verification

The current genuine signed-in Chrome session, with no owner/member allowlists,
loaded the public-link Site and used the shared demo OWNER role. Anonymous root
access redirected to ChatGPT sign-in (307); anonymous and spoofed API requests
returned 401. The owner queue returned 200, a new C intake returned 201, and
owner-only carrier review returned 200. The prepared C evaluation completed
LIVE on `gpt-6.1-terra` as `NEEDS_OWNER_REVIEW` with three risk flags and no
receipt, ready for judge review. Prior completed cases and learned rule state
persisted in that verification snapshot; the supported manual refresh may
intentionally return the shared database to five fresh cases.

Local validation also passed: 36 tests, TypeScript, and build. Lint exits 0
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
