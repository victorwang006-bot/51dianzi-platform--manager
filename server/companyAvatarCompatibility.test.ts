import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

describe("company avatar compatibility", () => {
  const database = read("server/db.ts");
  const panel = read("client/src/components/admin/MerchantCompanyWallPanel.tsx");

  it("returns the selected avatar to the admin company wall", () => {
    expect(database).toContain("SELECT id, userId, avatarPhotoId");
    expect(database).toContain("avatarPhotoId: company.avatarPhotoId === null ? null");
    expect(panel).toContain("当前头像");
    expect(panel).toContain("photo.id === wallQuery.data?.avatarPhotoId");
  });

  it("clears the avatar reference when an admin hides or deletes its source photo", () => {
    expect(database.match(/SET avatarPhotoId = NULL, avatarUpdatedBy = NULL, avatarUpdatedAt = NOW\(\)/g)?.length).toBe(2);
    expect(database.match(/AND avatarPhotoId = \$\{input\.photoId\}/g)?.length).toBe(2);
  });
});
