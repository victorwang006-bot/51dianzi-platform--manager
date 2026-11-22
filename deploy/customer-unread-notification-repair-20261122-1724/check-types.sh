#!/usr/bin/env bash
set -u
W="$(cd "$(dirname "$0")" && pwd)"
M=/home/ubuntu/work/channel-release-20261121-1837/manager
mkdir -p "$W/types"
printf '%s\n' 'MANAGER_STANDARD_CHECK_START'
(cd "$M" && pnpm check --pretty false --incremental false) >"$W/types/manager-standard.log" 2>&1
standard=$?
printf '%s\n' "MANAGER_STANDARD_CHECK_DONE rc=$standard"
printf '%s\n' 'MANAGER_ES2020_CHECK_START'
(cd "$M" && pnpm exec tsc --noEmit --target ES2020 --incremental false --pretty false) >"$W/types/manager-es2020.log" 2>&1
es2020=$?
printf '%s\n' "MANAGER_ES2020_CHECK_DONE rc=$es2020"
python3 - "$W" "$standard" "$es2020" <<'PY'
import json,sys
from pathlib import Path
w=Path(sys.argv[1]);s=(w/'types/manager-standard.log').read_text();e=(w/'types/manager-es2020.log').read_text()
errors=[l for l in s.splitlines()if 'error TS' in l]
r={'managerStandardExitCode':int(sys.argv[2]),'managerES2020ExitCode':int(sys.argv[3]),'standardErrors':errors,'ES2020Errors':[l for l in e.splitlines()if 'error TS' in l],'configChanged':False}
(w/'types/results.json').write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print(json.dumps(r,ensure_ascii=False))
PY
if [ "$es2020" -ne 0 ]; then exit 1; fi
