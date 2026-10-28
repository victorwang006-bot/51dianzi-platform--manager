# Source closure checkpoint — UNAPPROVED / NOT FOR DEPLOYMENT

This branch restores existing behavior only. It is not a production release or a claim of whole-site equivalence. No product feature, page, control, or user-facing copy is added. Main and production are not updated.

## Verified in isolation

- Fixed Node 22.22.0 and pnpm 10.4.1: typecheck, 153 targeted Vitest tests, and the normal production build passed.
- Real MySQL 8 integration uses synthetic fixtures only, loopback networking, and explicit datadir validation. Engine 8.0.46 is not claimed byte-identical to production MySQL 8.0.36.
- Formal-owner authorization is repeated after the merchant row lock for CN/HK ERP transitions and HK review.
- Generic review requires exactly one affected row and records audit in the same transaction; audit failure rolls the state change back.
- Initial and repeat CN reviews validate both documents against the existing authenticated private-upload producer and the in-lock review version. Same-value legacy sales-owner snapshots are preserved; owner changes are rejected.
- Seven real MySQL transaction/race/rollback checks pass. A nonexistent unused SELECT field found by the first native run was removed; the initial two failures remain in the external evidence bundle.
- No client files differ from the fixed main baseline. The earlier experimental recovery panel is excluded.

## Not accepted

Historical public URLs, older private key formats, missing evidence, full production UI/overlay parity, production object existence/ACL, and full browser review flows remain unaccepted. No new migration or resubmission workflow is introduced. Do not deploy this branch or the full rebuilt frontend.
