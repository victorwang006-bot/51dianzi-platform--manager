import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const buildVerifier = readFileSync("scripts/verify-subdomain-build.sh", "utf8");
const legacyBuildVerifier = readFileSync("scripts/verify-admin-build.sh", "utf8");
const htmlTemplate = readFileSync("client/index.html", "utf8");
const clientEntry = readFileSync("client/src/main.tsx", "utf8");
const legacyNginx = readFileSync(
  "deploy/nginx/dianzi51-admin.inc.example",
  "utf8",
);
const subdomainNginx = readFileSync(
  "deploy/nginx/dianzi51-admin-subdomain.conf.example",
  "utf8",
);

describe("阶段 D 后台子域构建契约", () => {
  it("保留旧 /admin/ 构建并新增独立根路径构建", () => {
    expect(packageJson.scripts["build:admin"]).toContain("VITE_BASE_PATH=/admin/");
    expect(packageJson.scripts["verify:admin-build"]).toContain(
      "verify-admin-build.sh",
    );
    expect(packageJson.scripts["build:subdomain"]).toContain("VITE_BASE_PATH=/");
    expect(packageJson.scripts["verify:subdomain-build"]).toContain(
      "verify-subdomain-build.sh",
    );
  });

  it("根路径产物门禁拒绝 /admin/ 资源、API 或路由残留", () => {
    expect(buildVerifier).toContain("/assets/");
    expect(buildVerifier).toContain("/api/trpc");
    expect(buildVerifier).toContain('admin_asset_refs != 0');
    expect(buildVerifier).toContain('admin_base_refs != 0');
    expect(buildVerifier).toContain('root_base_refs < 1');
    expect(buildVerifier).toContain('admin_api_refs != 0');
  });

  it("分析脚本仅在配置完整时加载，双制品门禁拒绝 Vite 占位符", () => {
    expect(htmlTemplate).not.toContain("%VITE_ANALYTICS_ENDPOINT%");
    expect(htmlTemplate).not.toContain("%VITE_ANALYTICS_WEBSITE_ID%");
    expect(clientEntry).toContain("analyticsEndpoint && analyticsWebsiteId");
    expect(clientEntry).toContain("document.head.appendChild(analyticsScript)");
    expect(buildVerifier).toContain("unresolved_vite_placeholders");
    expect(legacyBuildVerifier).toContain("unresolved_vite_placeholders");
  });
});

describe("阶段 D 后台子域 Nginx 契约", () => {
  it("为精确后台主机名使用独立证书和独立静态制品", () => {
    expect(subdomainNginx).toContain("server_name admin.51dianzi.com;");
    expect(subdomainNginx).toContain(
      "ssl_certificate /etc/nginx/ssl/admin.51dianzi.com.pem;",
    );
    expect(subdomainNginx).toContain(
      "ssl_certificate_key /etc/nginx/ssl/admin.51dianzi.com.key;",
    );
    expect(subdomainNginx).toContain(
      "root /opt/apps/dianzi51-admin-subdomain/dist/public;",
    );
    expect(subdomainNginx).not.toContain("ssl_certificate /etc/nginx/ssl/51dianzi.com.pem;");
  });

  it("HTTP 只重定向 HTTPS，且灰度期禁止索引而不设置 HSTS", () => {
    expect(subdomainNginx).toContain("listen 80;");
    expect(subdomainNginx).toContain(
      "return 301 https://admin.51dianzi.com$request_uri;",
    );
    expect(subdomainNginx).toContain(
      'X-Robots-Tag "noindex, nofollow, noarchive"',
    );
    expect(subdomainNginx).toContain('return 200 "User-agent: *\\nDisallow: /\\n";');
    expect(subdomainNginx.toLowerCase()).not.toContain("strict-transport-security");
  });

  it("复用现有 3001 API 与上传目录，不新增业务进程或数据库", () => {
    expect(subdomainNginx).toContain("proxy_pass http://127.0.0.1:3001;");
    expect(subdomainNginx).toContain(
      "alias /opt/apps/dianzi51-admin/uploads/;",
    );
    expect(subdomainNginx).toContain("proxy_set_header X-Forwarded-Proto $scheme;");
    expect(subdomainNginx).not.toContain("proxy_pass http://127.0.0.1:3002");
  });

  it("区分哈希资源 404、HTML 不缓存与 SPA 深链接回退", () => {
    expect(subdomainNginx).toMatch(
      /location \^~ \/assets\/ \{[\s\S]*?try_files \$uri =404;/,
    );
    expect(subdomainNginx).toContain(
      'Cache-Control "public, max-age=31536000, immutable"',
    );
    expect(subdomainNginx).toMatch(
      /location = \/index\.html \{[\s\S]*?Cache-Control "no-cache, no-store, must-revalidate"/,
    );
    expect(subdomainNginx).toMatch(
      /location \/ \{[\s\S]*?try_files \$uri \/index\.html;/,
    );
  });

  it("旧主站仍保留 /admin/ 去前缀回滚入口", () => {
    expect(legacyNginx).toContain("location = /admin");
    expect(legacyNginx).toContain("location ^~ /admin/");
    expect(legacyNginx).toContain("proxy_pass http://127.0.0.1:3001/;");
    expect(subdomainNginx).not.toContain("location ^~ /admin/");
  });
});
