import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { staffOrganizationCreateTeamInput, staffOrganizationSetMemberInput } from "../shared/staffOrganization";

export const SOURCE_TASK_NOTE = "reviewed migration window: native staff grouping only; fixed plan; no permission/template/session mutation or historical rollback";
export const RECEIPT_PREFIX = "STAFF_TEAM_CONFIGURATION_RECEIPT=";
const MAX_BYTES = 1024 * 1024;
// omit removes the original team/role pair refinement; role must be non-null here.
export const staffPlanMemberSchema = staffOrganizationSetMemberInput.omit({ teamId: true }).strict().extend({ role: z.enum(["leader", "member"]) });
export const staffTeamPlanSchema = z.object({
  actor: z.object({ adminUserId: z.number().int().positive().max(2147483647), sessionVersion: z.number().int().positive().safe() }).strict(),
  team: staffOrganizationCreateTeamInput,
  members: z.array(staffPlanMemberSchema).max(100),
}).strict().superRefine((plan, ctx) => {
  const ids = [plan.team.requestId, ...plan.members.map(item => item.requestId)];
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Request IDs must be unique across all operations" });
});
export type StaffTeamPlan = z.infer<typeof staffTeamPlanSchema>;
export type ConfigurationServices = Pick<typeof import("../server/services/staffOrganization"), "createStaffOrganizationTeam" | "setStaffOrganizationMember">;
export type Emit = (receipt: Record<string, unknown>) => Promise<void>;
class PlanError extends Error {}
export function assertSafePlanStat(stat: { isFile(): boolean; isSymbolicLink(): boolean; uid: number; mode: number; size: number }, uid = process.getuid?.()): void {
  if (uid === undefined || !stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || stat.size > MAX_BYTES)
    throw new PlanError("Unsafe plan");
}
export async function readSecurePlan(path: string): Promise<unknown> {
  const before = await lstat(path);
  assertSafePlanStat(before);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assertSafePlanStat(stat);
    if (stat.dev !== before.dev || stat.ino !== before.ino) throw new PlanError("Plan changed");
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    assertSafePlanStat(after);
    if (length > MAX_BYTES || length !== after.size || stat.size !== after.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs)
      throw new PlanError("Plan changed");
    return JSON.parse(buffer.subarray(0, length).toString("utf8"));
  } finally { await handle.close(); }
}
export function safeError(error: unknown): { code: string; message: string } {
  const allowed = new Set(["BAD_REQUEST", "FORBIDDEN", "UNAUTHORIZED", "CONFLICT", "NOT_FOUND", "SERVICE_UNAVAILABLE"]);
  const candidate = error && typeof error === "object" && "code" in error ? error.code : undefined;
  const code = typeof candidate === "string" && allowed.has(candidate) ? candidate : error instanceof PlanError || error instanceof SyntaxError || error instanceof z.ZodError ? "INVALID_PLAN" : "CONFIGURATION_FAILED";
  return { code, message: "Configuration stopped; review the fixed plan and audit receipts before retrying." };
}
function mutationResult(result: Awaited<ReturnType<ConfigurationServices["createStaffOrganizationTeam"]>>) {
  return { targetId: result.targetId, revision: result.revision, requestId: result.requestId, idempotent: result.idempotent };
}
export async function applyStaffTeamPlan(raw: unknown, services: ConfigurationServices, emit: Emit): Promise<boolean> {
  const plan = staffTeamPlanSchema.parse(raw);
  const base = { sourceTaskNote: SOURCE_TASK_NOTE, actorAdminUserId: plan.actor.adminUserId };
  let team;
  try { team = mutationResult(await services.createStaffOrganizationTeam(structuredClone(plan.actor), structuredClone(plan.team))); }
  catch (error) {
    await emit({ ...base, requestId: plan.team.requestId, action: "createStaffOrganizationTeam", targetUserId: null, success: false, idempotent: false, result: null, error: safeError(error) });
    return false;
  }
  await emit({ ...base, requestId: plan.team.requestId, action: "createStaffOrganizationTeam", targetUserId: null, success: true, idempotent: team.idempotent, result: team });
  if (!Number.isSafeInteger(team.targetId) || team.targetId < 1) {
    await emit({ ...base, action: "runner", success: false, error: safeError(null) });
    return false;
  }
  for (const member of plan.members) {
    let result;
    try { result = mutationResult(await services.setStaffOrganizationMember(structuredClone(plan.actor), { ...structuredClone(member), teamId: team.targetId })); }
    catch (error) {
      await emit({ ...base, teamId: team.targetId, requestId: member.requestId, action: "setStaffOrganizationMember", targetUserId: member.adminUserId, success: false, idempotent: false, result: null, error: safeError(error) });
      return false;
    }
    await emit({ ...base, teamId: team.targetId, requestId: member.requestId, action: "setStaffOrganizationMember", targetUserId: member.adminUserId, success: true, idempotent: result.idempotent, result });
  }
  await emit({ ...base, teamId: team.targetId, action: "complete", success: true, completedSteps: 1 + plan.members.length });
  return true;
}
const writeLine = (line: string) => new Promise<void>((resolve, reject) => process.stdout.write(line + "\n", error => error ? reject(error) : resolve()));
export async function main(args = process.argv.slice(2), loadServices: () => Promise<ConfigurationServices> = async () => {
  const { createStaffOrganizationTeam, setStaffOrganizationMember } = await import("../server/services/staffOrganization");
  return { createStaffOrganizationTeam, setStaffOrganizationMember };
}, output = writeLine): Promise<number> {
  if (!args.includes("--apply")) {
    await output('Usage: node <runner.mjs> --apply --plan <owner-only.json>\nPlan: {actor:{adminUserId,sessionVersion},team:{name,notes?,requestId},members:[{adminUserId,role:"leader"|"member",expectedRevision,requestId}]}; max 100 members; unique requestIds; no DB connection without --apply.');
    return 0;
  }
  const emit: Emit = receipt => output(RECEIPT_PREFIX + JSON.stringify(receipt));
  try {
    if (args.length !== 3 || args[0] !== "--apply" || args[1] !== "--plan" || !args[2] || args[2].startsWith("--")) throw new PlanError("Explicit flags required");
    const plan = staffTeamPlanSchema.parse(await readSecurePlan(args[2]));
    const services = await loadServices();
    return await applyStaffTeamPlan(plan, services, emit) ? 0 : 1;
  } catch (error) {
    await emit({ sourceTaskNote: SOURCE_TASK_NOTE, action: "runner", success: false, error: safeError(error) });
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // All service transactions and stdout callbacks settle before ending any open pool.
  void main().then(code => process.exit(code), () => process.exit(1));
}
