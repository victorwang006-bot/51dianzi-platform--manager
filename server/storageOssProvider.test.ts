import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSignedUrl: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  GetObjectCommand: class GetObjectCommand {
    constructor(public readonly input: unknown) {}
  },
  PutObjectCommand: class PutObjectCommand {
    constructor(public readonly input: unknown) {}
  },
  S3Client: class S3Client {
    send = mocks.send;
  },
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const original = { ...process.env };

describe("阿里云 OSS 私有对象签名", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    process.env.BUILT_IN_FORGE_API_URL = "https://forge.example.test";
    process.env.BUILT_IN_FORGE_API_KEY = "forge-test-key";
    process.env.ALI_OSS_ACCESS_KEY_ID = "oss-test-id";
    process.env.ALI_OSS_ACCESS_KEY_SECRET = "oss-test-secret";
    process.env.ALI_OSS_BUCKET = "test-bucket";
    process.env.ALI_OSS_REGION = "oss-cn-hangzhou";
    mocks.getSignedUrl.mockResolvedValue("https://test-bucket.oss-cn-hangzhou.aliyuncs.com/licenses/test.png?signed=1");
  });

  afterEach(() => {
    process.env = { ...original };
    vi.unstubAllGlobals();
  });

  it("两种后端同时配置时，licenses 对象仍直接使用 OSS signer，不请求 Forge", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { storageGetOssSignedUrl } = await import("./storage");

    const url = await storageGetOssSignedUrl("licenses/user-42-test.png", 900);

    expect(url).toContain("oss-cn-hangzhou.aliyuncs.com");
    expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, options] = mocks.getSignedUrl.mock.calls[0];
    expect(command.input).toEqual({ Bucket: "test-bucket", Key: "licenses/user-42-test.png" });
    expect(options).toEqual({ expiresIn: 900 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝路径穿越对象键", async () => {
    const { storageGetOssSignedUrl } = await import("./storage");
    await expect(storageGetOssSignedUrl("licenses/../secret", 900)).rejects.toThrow("Invalid storage key");
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });
});
