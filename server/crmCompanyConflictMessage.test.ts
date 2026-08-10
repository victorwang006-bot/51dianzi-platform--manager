import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CRM_COMPANY_ALREADY_ENABLED_MESSAGE,
  getCrmCompanyConflictMessage,
} from "./db";

const DB_SOURCE = readFileSync(
  fileURLToPath(new URL("./db.ts", import.meta.url)),
  "utf8",
);

describe("CRM 重复企业提示文案", () => {
  it("已开通企业使用用户指定的新提示", () => {
    expect(CRM_COMPANY_ALREADY_ENABLED_MESSAGE).toBe(
      "该公司已经开通CRM，请联系CEM管理员。",
    );
    expect(
      getCrmCompanyConflictMessage("enabled", "不应返回的旧提示"),
    ).toBe(CRM_COMPANY_ALREADY_ENABLED_MESSAGE);
  });

  it("审核中和其他绑定状态保持原有语义", () => {
    expect(
      getCrmCompanyConflictMessage("pending", "不应返回的兜底提示"),
    ).toBe("该企业的 CRM 开通申请正在审核中");
    expect(
      getCrmCompanyConflictMessage(
        "rejected",
        "该企业已绑定其他前台账号，请联系企业管理员或平台客服",
      ),
    ).toBe("该企业已绑定其他前台账号，请联系企业管理员或平台客服");
    expect(
      getCrmCompanyConflictMessage("disabled", "该企业已绑定其他前台账号"),
    ).toBe("该企业已绑定其他前台账号");
  });

  it("提交申请与CRM状态查询都使用同一文案函数", () => {
    expect(
      DB_SOURCE.match(/message:\s*getCrmCompanyConflictMessage\(/g),
    ).toHaveLength(2);
    expect(
      DB_SOURCE.match(/"CRM_COMPANY_ALREADY_ENABLED"/g),
    ).toHaveLength(2);
  });
});
