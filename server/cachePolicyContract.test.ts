import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const expressEntry = readFileSync("server/_core/index.ts", "utf8");
const expressStatic = readFileSync("server/_core/vite.ts", "utf8");
const subdomainNginx = readFileSync(
  "deploy/nginx/dianzi51-admin-subdomain.conf.example",
  "utf8"
);
const adminNginx = readFileSync(
  "deploy/nginx/dianzi51-admin.inc.example",
  "utf8"
);

describe("生产缓存策略契约", () => {
  it("Express 仅对哈希 Vite 资源长期 immutable，HTML 与无哈希资源始终不得缓存", () => {
    expect(expressStatic).toContain("HASHED_VITE_ASSET");
    expect(expressStatic).toContain("public, max-age=31536000, immutable");
    expect(expressStatic).toContain(
      'const HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate"'
    );
    expect(expressStatic).toContain('app.get("/index.html"');
    expect(expressStatic).toContain('app.use("/assets"');
    expect(expressStatic).toContain("sendIndexHtml(res, indexPath)");
  });

  it("Express API 与上传响应在任何代理或浏览器中均不可公开缓存", () => {
    expect(expressEntry).toContain('app.use("/api"');
    expect(expressEntry).toContain("PRIVATE_NO_STORE_CACHE_CONTROL");
    expect(expressEntry).toContain('app.use("/uploads"');
    expect(expressEntry).toContain("express.static(getUploadRoot(), {");
    expect(expressEntry).toContain("setHeaders: setPrivateNoStoreHeaders");
    expect(expressEntry).not.toContain('maxAge: "7d"');
  });

  it("Nginx 子域仅长期缓存哈希资源，HTML、上传文件和 API 均不可公开缓存", () => {
    expect(subdomainNginx).toContain('location ~ "^/assets/');
    expect(subdomainNginx).toContain(
      'Cache-Control "public, max-age=31536000, immutable"'
    );
    expect(subdomainNginx).toContain(
      'Cache-Control "no-cache, no-store, must-revalidate"'
    );
    expect(subdomainNginx).toMatch(
      /location \^~ \/api\/ \{[\s\S]*?Cache-Control "private, no-store, max-age=0"/
    );
    expect(subdomainNginx).toMatch(
      /location \^~ \/uploads\/ \{[\s\S]*?Cache-Control "private, no-store, max-age=0"/
    );
    expect(subdomainNginx).not.toContain("public, max-age=604800");
    expect(subdomainNginx).toMatch(
      /location \/ \{[\s\S]*?try_files \$uri \/index\.html;/
    );
  });

  it("Nginx /admin 反向代理同样仅长期缓存哈希资源", () => {
    expect(adminNginx).toContain('location ~ "^/admin/assets/');
    expect(adminNginx).toContain(
      'Cache-Control "public, max-age=31536000, immutable"'
    );
    expect(adminNginx).toMatch(
      /location \^~ \/admin\/uploads\/ \{[\s\S]*?Cache-Control "private, no-store, max-age=0"/
    );
    expect(adminNginx).toContain("location ^~ /admin/api/");
    expect(adminNginx).toContain(
      'Cache-Control "private, no-store, max-age=0"'
    );
    expect(adminNginx).toContain("location = /admin/index.html");
    expect(adminNginx).toContain(
      'Cache-Control "no-cache, no-store, must-revalidate"'
    );
    expect(adminNginx).not.toContain("public, max-age=604800");
  });
});
