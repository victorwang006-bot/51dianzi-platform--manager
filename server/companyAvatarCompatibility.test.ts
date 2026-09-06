import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

describe("company display image compatibility", () => {
  const database = read("server/db.ts");
  const panel = read(
    "client/src/components/admin/MerchantCompanyWallPanel.tsx"
  );

  it("returns the home cover, search display image and search crop to the admin wall", () => {
    expect(database).toContain(
      "SELECT id, userId, homeCoverPhotoId, avatarPhotoId, avatarDisplayMode"
    );
    expect(database).toContain(
      "homeCoverPhotoId: company.homeCoverPhotoId === null ? null"
    );
    expect(database).toContain(
      "avatarPhotoId: company.avatarPhotoId === null ? null"
    );
    expect(database).toContain("avatarCrop:");
    expect(panel).toContain("首页展示图");
    expect(panel).toContain("搜索展示图");
    expect(panel).toContain("photo.id === homeCoverPhotoId");
    expect(panel).toContain("photo.id === avatarPhotoId");
  });

  it("clears both display references when an admin hides or deletes their source photo", () => {
    expect(
      database.match(
        /SET avatarPhotoId = NULL, avatarUpdatedBy = NULL, avatarUpdatedAt = NOW\(\)/g
      )?.length
    ).toBe(2);
    expect(
      database.match(/AND avatarPhotoId = \$\{input\.photoId\}/g)?.length
    ).toBe(2);
    expect(
      database.match(
        /SET homeCoverPhotoId = NULL, homeCoverUpdatedBy = NULL, homeCoverUpdatedAt = NOW\(\)/g
      )?.length
    ).toBe(2);
    expect(
      database.match(/AND homeCoverPhotoId = \$\{input\.photoId\}/g)?.length
    ).toBe(2);
  });
});
