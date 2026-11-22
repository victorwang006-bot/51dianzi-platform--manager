# Offline incremental backend assembly

Status: offline-assembled-not-deployed.

Run from any directory: `node /home/ubuntu/work/customer-unread-notification-repair-release-20261122-1724/backend-native.mjs`. Default is **admin only**. For reference-only compile use `--compile-only`. To handle front's single customerPicker import in this builder, append `--customer-runtime /absolute/path/customerPicker.SHA.runtime.mjs`. Parent may instead assemble front independently. Output directory is restricted to this window's backend-candidate. Rerun only after source owner reports stable; all before/after source and capture hashes are pinned and drift is fatal.

Runtime: `newInformation.admin.1239d4b93447da6dee2e949ea32293a199af59355728d26038cac36dc323f875.runtime.mjs`. The only admin API hunk changes the actual `__createNewInformationAdmin` import. No main API blocks, HTML, facts contract, native injection list, native fence lease pool, original router/store/schema/permission declarations, or factory return are rebuilt. All original native properties are required and provided.

## Actual source sections deployed

- /home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformation.ts: createAdminNewInformationService
- /home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationSources.ts: prove
- /home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationSources.ts: createAdminNewInformationSourceForContext
- /home/ubuntu/work/channel-release-20261121-1837/manager/server/platformOrderApi.ts: ["getConfig","PlatformOrderNewInformationError","callPlatformOrderNewInformation","getPlatformOrderNewInformationFacts"]
- /home/ubuntu/work/channel-release-20261121-1837/manager/server/services/adminNewInformationDiagnostics.ts: "complete single compiled module"

Reference compiler may read other source dependencies for mapping, but their output is not deployed. Bound symbols are AST-renamed by module/imported name (externals) and complete source-module suffix/declaration (locals). Any undefined alias fails closed. `exactinverse.json` and both delta files contain exact patch preimages; outside spans have matching SHA-256.

Diagnostics is one actual-source module and uses native injected fence exclusively. The old public order stats/list/detail transport remains in the captured main API; only newInformationFacts uses its dedicated private source transport. Source diagnostic storage/sink instances are taken unchanged from the real diagnostics source. No synthetic business implementation is handwritten.

## Checks and limits

TypeScript parse, Node syntax, symbol resolution, unchanged original route graph, exact inverse/outside bytes, native ABI, and stable source/capture pins passed. No old API execution, database, browser, SSH, Git, production operation, migration, permission write, or real mark was performed. Tests of business behavior are the source owner's responsibility. This does not claim to fix or determine the underlying historical sales 503 cause.

Front: not handled; parent front assembler may operate independently.
