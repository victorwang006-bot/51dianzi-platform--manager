#!/usr/bin/env python3
# Add active non-super admins holding officialInventory.read to official team 1 as member.
import json, os, subprocess, sys, time, hashlib, urllib.parse
OUT = "/opt/ops/official-team-members-20261125"
os.makedirs(OUT, exist_ok=True)
procs = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
url = None
for p in procs:
    if p.get("name") == "dianzi51-admin":
        e = p.get("pm2_env", {})
        url = e.get("DATABASE_URL") or e.get("env", {}).get("DATABASE_URL")
assert url, "no admin DATABASE_URL"
u = urllib.parse.urlparse(url)
cnf = f"{OUT}/.w.cnf"
with open(cnf, "w") as f:
    f.write(f"[client]\nuser={urllib.parse.unquote(u.username)}\npassword={urllib.parse.unquote(u.password)}\nhost={u.hostname}\nport={u.port or 3306}\n")
os.chmod(cnf, 0o600)
DB = u.path.lstrip("/").split("?")[0]
def q(sql):
    r = subprocess.run(["mysql", f"--defaults-extra-file={cnf}", DB, "-N", "-B", "-e", sql], text=True, capture_output=True)
    if r.returncode: raise SystemExit(r.stderr)
    return [l.split("\t") for l in r.stdout.splitlines() if l]
try:
    before = q("select id,adminUserId,teamId,role,revision from official_channel_team_members")
    json.dump(before, open(f"{OUT}/before-members.json", "w"))
    targets = q("""select u.id,u.username,coalesce(u.displayName,'') from admin_users u
      where u.status='active' and u.adminRole<>'super_admin'
      and exists(select 1 from admin_user_permissions p where p.adminUserId=u.id and p.permission='officialInventory.read')
      and not exists(select 1 from official_channel_team_members m where m.adminUserId=u.id) order by u.id""")
    print("targets", targets)
    team = q("select id,name,status from official_channel_teams where id=1")
    assert team and team[0][2] == "active", team
    stmts = ["start transaction"]
    for tid, uname, dname in targets:
        rid = f"manus-official-member-20261125-{tid}"
        payload = json.dumps({"action": "setMember", "adminUserId": int(tid), "teamId": 1, "role": "member", "expectedRevision": 0}, sort_keys=True, separators=(",", ":"))
        ph = hashlib.sha256(payload.encode()).hexdigest()
        after = json.dumps({"member": {"adminUserId": int(tid), "teamId": 1, "role": "member", "revision": 1}, "source": "ops-backfill"})
        stmts.append(f"insert into official_channel_team_members(adminUserId,teamId,role,revision,updatedByAdminUserId) values({int(tid)},1,'member',1,30004)")
        stmts.append(f"insert into official_channel_audits(action,targetId,actorAdminUserId,requestId,payloadHash,beforeData,afterData) values('official.team-member.set','{int(tid)}',30004,'{rid}','{ph}',null,'{after}')")
    stmts.append("commit")
    if len(targets):
        q(";".join(stmts))
    afterm = q("select id,adminUserId,teamId,role,revision from official_channel_team_members order by id")
    ids = [t[0] for t in targets]
    rec = {"time": time.strftime("%F %T"), "targets": targets, "before": before, "after": afterm,
           "rollback": f"delete from official_channel_team_members where teamId=1 and role='member' and adminUserId in ({','.join(ids) or 'NULL'}); delete from official_channel_audits where requestId like 'manus-official-member-20261125-%';"}
    json.dump(rec, open(f"{OUT}/receipt.json", "w"), ensure_ascii=False, indent=1)
    print(json.dumps(rec, ensure_ascii=False))
finally:
    os.remove(cnf)
