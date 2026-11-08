import { describe, expect, it } from "vitest";
import { materialUploadBatchAssociation } from "./management";

describe("material upload batch association projection", () => {
  it("labels the real service null/false combination as unlinked", () => {
    expect(materialUploadBatchAssociation({ uploadBatchId: null, canViewUploadBatch: false })).toEqual({ state: "unlinked" });
    expect(materialUploadBatchAssociation({ uploadBatchId: null })).toEqual({ state: "unlinked" });
  });
  it("does not infer unlinked from missing legacy metadata", () => {
    expect(materialUploadBatchAssociation({})).toEqual({ state: "unknown" });
    expect(materialUploadBatchAssociation({ canViewUploadBatch: false })).toEqual({ state: "unknown" });
  });
  it("keeps known but unreadable source batches unavailable", () => {
    expect(materialUploadBatchAssociation({ uploadBatchId: 81, canViewUploadBatch: false })).toEqual({ state: "unavailable" });
    expect(materialUploadBatchAssociation({ uploadBatchId: 81 })).toEqual({ state: "unknown" });
  });
  it("links only a valid batch with explicit read projection", () => {
    expect(materialUploadBatchAssociation({ uploadBatchId: 81, canViewUploadBatch: true })).toEqual({ state: "linked", id: 81 });
    for (const uploadBatchId of [0, -1, 0.5, NaN, Infinity]) {
      expect(materialUploadBatchAssociation({ uploadBatchId, canViewUploadBatch: true })).toEqual({ state: "unknown" });
      expect(materialUploadBatchAssociation({ uploadBatchId, canViewUploadBatch: false })).toEqual({ state: "unknown" });
    }
  });
});
