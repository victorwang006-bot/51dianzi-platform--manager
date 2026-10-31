import { eq, or, sql } from "drizzle-orm";
import {
  accountSecurityEvents,
  passwordResetCodes,
  users,
  wechatAccountBindings,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  consumeSecurityCode,
  type SecurityAuditContext,
} from "../passwordReset";

const INVALID_CODE_MESSAGE = "验证码错误或已失效，请重新获取";

function isDuplicateEntryError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { errno?: number; code?: string; cause?: unknown };
    if (candidate.errno === 1062 || candidate.code === "ER_DUP_ENTRY") return true;
    current = candidate.cause;
  }
  return false;
}

export type ConfirmWechatRebindInput = {
  userId: number;
  oldOpenid: string;
  newOpenid: string;
  newUnionId: string | null;
  smsCode: string;
};

/**
 * 原子更换当前账号的小程序微信绑定。
 *
 * 安全边界：
 * - 账号行锁串行化换绑、改密等会话撤销操作；
 * - 同时锁定当前账号绑定和目标 openid，禁止覆盖其他账号；
 * - 短信验证码与绑定更新在同一事务内完成；
 * - 成功后递增 sessionVersion，使原微信和其他设备的旧会话立即失效；
 * - 审计只记录用户、渠道和脱敏客户端信息，不保存 openid 或验证码。
 */
export async function confirmWechatAccountRebind(
  input: ConfirmWechatRebindInput,
  audit?: SecurityAuditContext,
) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，请稍后再试");

  let result;
  try {
    result = await db.transaction(async tx => {
    const userRows = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1)
      .for("update");
    const user = userRows[0];
    if (!user || !user.phone || !/^1[3-9]\d{9}$/.test(user.phone)) {
      throw new Error("该账号未绑定可验证手机号，请联系客服");
    }

    const bindingRows = await tx
      .select()
      .from(wechatAccountBindings)
      .where(
        or(
          eq(wechatAccountBindings.userId, input.userId),
          eq(wechatAccountBindings.openid, input.newOpenid),
        ),
      )
      .for("update");
    const currentBinding = bindingRows.find(binding => binding.userId === input.userId);
    const targetBinding = bindingRows.find(binding => binding.openid === input.newOpenid);

    if (!currentBinding || currentBinding.openid !== input.oldOpenid) {
      throw new Error("绑定状态已变化，请重新登录后再试");
    }
    if (targetBinding && targetBinding.userId !== input.userId) {
      throw new Error("当前微信已绑定其他51电子网账号");
    }
    if (targetBinding && targetBinding.id !== currentBinding.id) {
      throw new Error("当前微信已绑定其他51电子网账号");
    }

    const verified = await consumeSecurityCode(tx, {
      userId: input.userId,
      purpose: "rebindWechat",
      channel: "phone",
      target: user.phone,
      code: input.smsCode,
    });
    if (!verified) {
      await tx.insert(accountSecurityEvents).values({
        userId: input.userId,
        eventType: "wechat_rebind_failed_code",
        channel: "phone",
        clientType: audit?.clientType ?? "unknown",
        ipHash: audit?.ipHash ?? null,
        userAgent: audit?.userAgent ?? null,
        success: false,
      });
      return { ok: false as const };
    }

    await tx
      .update(wechatAccountBindings)
      .set({
        openid: input.newOpenid,
        unionId: input.newUnionId,
        boundPhone: user.phone,
        lastLoginAt: sql`NOW()` as any,
        updatedAt: sql`NOW()` as any,
      })
      .where(eq(wechatAccountBindings.id, currentBinding.id));

    const nextSessionVersion = user.sessionVersion + 1;
    await tx
      .update(users)
      .set({ sessionVersion: nextSessionVersion })
      .where(eq(users.id, input.userId));
    await tx
      .delete(passwordResetCodes)
      .where(eq(passwordResetCodes.userId, input.userId));
    await tx.insert(accountSecurityEvents).values({
      userId: input.userId,
      eventType: "wechat_rebound",
      channel: "phone",
      clientType: audit?.clientType ?? "unknown",
      ipHash: audit?.ipHash ?? null,
      userAgent: audit?.userAgent ?? null,
      success: true,
    });

    return {
      ok: true as const,
      user: { ...user, sessionVersion: nextSessionVersion },
    };
    });
  } catch (error) {
    // “目标 openid 尚无记录”的并发窗口最终由数据库唯一索引仲裁。
    // 落败请求必须返回可理解的业务冲突，且整个事务（包括验证码消费）会回滚。
    if (isDuplicateEntryError(error)) {
      throw new Error("当前微信已绑定其他51电子网账号");
    }
    throw error;
  }

  if (!result.ok) throw new Error(INVALID_CODE_MESSAGE);
  return result.user;
}
