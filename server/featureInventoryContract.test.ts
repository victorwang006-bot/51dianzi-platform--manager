/**
 * 管理端「功能清单闸门」契约测试
 * ============================================================================
 *
 * 【为什么存在这个文件】
 *
 * 管理端历史上发生过严重的源码与生产脱节：
 *
 *   - GitHub 仓库最新提交停在 2026-08-07（46ce47a）
 *   - 生产实际运行的是 2026-08-13 构建的 2736887，该 commit 在仓库中不存在
 *   - 2026-08-11 之后的发布只上传编译产物、不再上传源码
 *   - `client/src/lib/bomInquiryMessage.ts` 一度成为「孤儿文件」：
 *     GitHub 没有、服务器 25 个发布目录全都没有，只剩编译产物
 *
 * 后果是：一旦有人从 GitHub 拉源码构建部署管理端，销售人员管理、个人信息页、
 * BOM 询价单渲染等功能会被整体抹掉，而**构建成功、部署成功、页面能打开、
 * 测试全绿**，没有任何机制能发现功能没了。
 *
 * 本文件就是补上那个缺失的机制：把「管理端应该有哪些功能」逐项钉成断言。
 * 任何人以后从任何来源构建部署，少了任一项，测试立即失败。
 *
 * 【维护规则】
 *
 * 1. 断言只检查「功能是否存在」这种粗粒度事实，不检查实现细节，
 *    以免正常重构频繁误报，最终导致没人相信这个文件。
 *    细粒度行为由各功能自己的契约测试负责。
 *
 * 2. 删除断言必须是**有意识的产品决策**（该功能确实要下线），
 *    绝不能因为「测试挂了」就删断言让它变绿——那样这道闸门会在
 *    几次维护后自己失效，回到事故发生前的状态。
 *
 * 3. 新增重要功能时，应同步在此追加断言。
 */
import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("管理端功能清单闸门", () => {
  describe("销售身份与数据权限体系（2026-08-13 新增，曾仅存在于生产产物）", () => {
    it("schema 必须定义 salesStaff 与 adminUserSalesScopes 两张表", () => {
      const schema = read("drizzle/schema.ts");
      expect(schema).toContain("salesStaff");
      expect(schema).toContain("adminUserSalesScopes");
      expect(schema).toContain("sales_staff");
      expect(schema).toContain("admin_user_sales_scopes");
    });

    it("salesStaff 表必须有 adminUserId 唯一索引", () => {
      // 缺失会导致同一后台用户产生多个销售身份：
      // 下拉里出现重复人名，商户归属分叉
      const schema = read("drizzle/schema.ts");
      expect(schema).toContain("sales_staff_admin_user_unique");
    });

    it("adminUserSalesScopes 表必须有 (adminUserId, staffCode) 唯一索引", () => {
      // 缺失会导致同一授权重复写入，范围查询产生重复行
      const schema = read("drizzle/schema.ts");
      expect(schema).toContain("admin_user_sales_scopes_admin_staff_unique");
    });

    it("merchants 表必须有 salesOwnerCode 字段", () => {
      const schema = read("drizzle/schema.ts");
      expect(schema).toContain("salesOwnerCode");
    });

    it("db 层必须提供销售身份的完整函数集", () => {
      const db = read("server/db.ts");
      for (const fn of [
        "listSalesStaff",
        "getSalesStaffByCode",
        "syncAdminUserSalesIdentity",
        "getAdminUserSalesScopeCodes",
        "replaceAdminUserSalesScopes",
        "getScopedMerchantCreditCodes",
      ]) {
        expect(db, `缺少 db.${fn}`).toContain(fn);
      }
    });

    it("前台销售负责人下拉的数据源接口 portal.listSalesStaff 必须存在", () => {
      // 前台企业资料页的「销售负责人」下拉依赖此接口；
      // 缺失会导致前台下拉为空、企业资料无法保存
      const routers = read("server/routers.ts");
      expect(routers).toContain("listSalesStaff");
    });

    it("salesStaff 路由必须是只读的（不得提供 create/update/delete）", () => {
      // 销售身份完全由后台用户生命周期驱动。若允许单独增删，
      // 会产生「销售身份存在但对应后台用户已停用」的幽灵记录，
      // 其名下商户将成为无人可见的孤岛
      const routers = read("server/routers.ts");
      const section = routers.slice(
        routers.indexOf("salesStaff: router({"),
        routers.indexOf("adminUser: router({"),
      );
      expect(section).toContain("list:");
      expect(section).not.toContain("create:");
      expect(section).not.toContain("delete:");
      expect(section).not.toContain("remove:");
    });

    it("商户列表与详情必须接入销售数据范围隔离", () => {
      // 缺失会导致任意后台用户看到全部商户，属严重越权
      const routers = read("server/routers.ts");
      expect(routers).toContain("getAdminSalesStaffCodes");
      expect(routers).toMatch(/getMerchants\(input,\s*await getAdminSalesStaffCodes\(ctx\)\)/);
      expect(routers).toMatch(/getMerchantById\(input\.id,\s*await getAdminSalesStaffCodes\(ctx\)\)/);
    });

    it("销售范围必须保留 undefined 与空数组的三态语义", () => {
      // undefined = 不限制（超管）；空数组 = 什么都看不到。
      // 两者混同处理会让「无任何范围的普通用户」看到全部商户，权限完全反转
      const db = read("server/db.ts");
      // 空数组必须短路为「无结果」，而不是跳过过滤
      expect(db).toMatch(/salesStaffCodes !== undefined && salesStaffCodes\.length === 0/);
      expect(db).toMatch(/if \(salesStaffCodes !== undefined\) conditions\.push/);
      const routers = read("server/routers.ts");
      expect(routers).toContain("Promise<string[] | undefined>");
    });

    it("无效或停用工号必须被拒绝并映射为可读错误", () => {
      const db = read("server/db.ts");
      expect(db).toContain("INVALID_SALES_STAFF_CODE");
      const routers = read("server/routers.ts");
      expect(routers).toContain("mapSalesScopeError");
      expect(routers).toContain("销售权限包含无效或已停用员工");
    });

    it("adminUser 创建与更新必须支持 salesStaffCodes 入参", () => {
      const routers = read("server/routers.ts");
      const section = routers.slice(routers.indexOf("adminUser: router({"));
      expect(section.match(/salesStaffCodes/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });
  });

  describe("个人信息页（2026-08-13 新增，曾仅存在于生产产物）", () => {
    it("Profile 页面文件必须存在且包含三大区块", () => {
      const profile = read("client/src/pages/Profile.tsx");
      expect(profile).toContain("个人信息");
      expect(profile).toContain("登录用户名");
      expect(profile).toContain("绑定手机号");
      expect(profile).toContain("绑定邮箱");
      expect(profile).toContain("更改密码");
    });

    it("必须注册 /profile 路由并受 profile.manage 权限保护", () => {
      const app = read("client/src/App.tsx");
      expect(app).toContain('path={"/profile"}');
      expect(app).toContain('permission="profile.manage"');
    });

    it("侧边栏必须有「个人信息」菜单项", () => {
      const layout = read("client/src/components/DashboardLayout.tsx");
      expect(layout).toContain("个人信息");
      expect(layout).toContain("/profile");
    });

    it("profile.manage 权限必须存在，且普通用户拥有该权限", () => {
      // 缺失会导致个人信息页做出来了却进不去
      const perms = read("shared/adminPermissions.ts");
      expect(perms).toContain("profile.manage");
      const merchantMgrLine = perms
        .split("\n")
        .find(line => line.trimStart().startsWith("merchant_mgr:"));
      expect(merchantMgrLine).toBeTruthy();
      expect(merchantMgrLine).toContain("profile.manage");
    });

    it("后端必须提供 auth.profile 与 auth.updateProfile", () => {
      const routers = read("server/routers.ts");
      expect(routers).toContain("profile: adminProcedure");
      expect(routers).toContain("updateProfile:");
    });

    it("改密码必须校验「新密码不能与当前密码相同」", () => {
      // 缺失会让用户以为改了密码其实没变；
      // 若其本意是因怀疑泄露而改密，会误以为已恢复安全
      const routers = read("server/routers.ts");
      expect(routers).toContain("新密码不能与当前密码相同");
      const profile = read("client/src/pages/Profile.tsx");
      expect(profile).toContain("新密码不能与当前密码相同");
    });
  });

  describe("销售权限设置 UI（后台用户管理）", () => {
    it("用户列表必须有「销售权限」列", () => {
      const admins = read("client/src/pages/Admins.tsx");
      expect(admins).toContain("销售权限");
    });

    it("必须从 salesStaff.list 拉取名单且包含已停用工号", () => {
      // 只拉启用的会导致编辑时历史范围内的已停用工号静默消失，
      // 保存后等于悄悄缩小了该主管的可见范围
      const admins = read("client/src/pages/Admins.tsx");
      expect(admins).toContain("salesStaff.list.useQuery");
      expect(admins).toContain("includeInactive: true");
    });

    it("用户变更后必须同时失效 adminUser.list 与 salesStaff.list 缓存", () => {
      const admins = read("client/src/pages/Admins.tsx");
      expect(admins).toContain("utils.salesStaff.list.invalidate()");
    });

    it("切换到超级管理员时必须清空已选销售范围", () => {
      const admins = read("client/src/pages/Admins.tsx");
      expect(admins).toMatch(/salesStaffCodes:\s*v === "super_admin" \? \[\]/);
    });
  });

  describe("BOM 询价单消息渲染（曾为孤儿文件，源码全网仅剩产物）", () => {
    it("bomInquiryMessage 解析模块必须存在", () => {
      const mod = read("client/src/lib/bomInquiryMessage.ts");
      expect(mod).toContain("parseBomInquiryMessage");
    });

    it("必须保留完整的格式与规模校验链", () => {
      const mod = read("client/src/lib/bomInquiryMessage.ts");
      expect(mod).toContain("BOM询价");
      // 声明数量与实际行数必须一致 —— 防截断与防注入
      expect(mod).toContain("rows.length !== totalItems");
      // 项数上限，防伪造超大表格
      expect(mod).toContain("MAX_ITEMS");
    });

    it("Excel 下载链接必须保留完整的白名单校验", () => {
      // 管理端消息由前台用户发来。若不校验，攻击者可在询价消息里塞入
      // 外部链接伪装成「下载询价Excel」，客服点击即中招
      const mod = read("client/src/lib/bomInquiryMessage.ts");
      expect(mod).toContain("https:");
      expect(mod).toContain("51dianzi.com");
      expect(mod).toContain("/manus-storage/bom-inquiries/");
    });

    it("消息中心必须引用该模块渲染询价单", () => {
      const messages = read("client/src/pages/Messages.tsx");
      expect(messages).toContain("parseBomInquiryMessage");
    });
  });

  describe("消息幂等键（前台「发送失败点击重试」的基础）", () => {
    it("messages 表必须定义 clientMessageId", () => {
      // 生产库该列带唯一索引，是防重复发送的最后一道保险；
      // 源码此前从未包含该字段定义
      const schema = read("drizzle/schema.ts");
      expect(schema).toContain("clientMessageId");
    });
  });

  describe("前台用户管理页（2026-08-11 新增，曾未回流仓库）", () => {
    it("PortalUsers 页面与接口必须存在", () => {
      const page = read("client/src/pages/PortalUsers.tsx");
      expect(page.length).toBeGreaterThan(0);
      const app = read("client/src/App.tsx");
      expect(app).toContain('path={"/portal-users"}');
    });
  });
});
