import { describe, expect, it } from "vitest";
import { channelInventoryListBusinessInputSchema as schema } from "./channelInventoryListBusinessInput";

describe("fixed channel inventory filter BFF contract", () => {
  it("preserves the complete authorized filter intersection and sort before upstream pagination", () => {
    expect(schema.parse({ expectedEnterpriseId:31, expectedActorUserId:7, channelId:11, uploadBatchId:12,
      partNumber:"  ＬＭ３５８  ", brand:" TI ", industryCode:"automotive", page:4,pageSize:20,sortBy:"qty",sortDirection:"desc" }))
      .toEqual({ expectedEnterpriseId:31,expectedActorUserId:7,channelId:11,uploadBatchId:12,
        partNumber:"LM358",brand:"TI",industryCode:"automotive",page:4,pageSize:20,sortBy:"qty",sortDirection:"desc" });
  });
  it("allows unset and omitted industry without inventing grants", () => {
    expect(schema.parse({industryCode:"unset"})).toEqual({industryCode:"unset",page:1,pageSize:20});
    expect(schema.parse({})).toEqual({page:1,pageSize:20});
  });
  it.each([{industryCode:"unknown-internal"},{industryCode:null},{industryCode:"all"},{pageSize:101},
    {channelId:0},{sortDirection:"random"},{canManageAll:true},{actorUserId:99},{method:"inventory.remove"}])
    ("fails closed on invalid or authority-bearing parameters: %j", input => { expect(schema.safeParse(input).success).toBe(false); });
});
