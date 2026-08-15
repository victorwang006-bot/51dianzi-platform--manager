/**
 * dianzi51-admin 生产 PM2 配置。
 *
 * 设计要点：
 * 1. 凭据不写在本文件内，而是运行时从 /opt/config/dianzi51-admin/runtime.env 读取。
 *    这样本文件可安全提交到 Git 仓库，凭据只存在于服务器。
 * 2. admin 独立于前台：独立仓库、独立端口(3001)、独立主库(dianzi51_admin)、
 *    独立 PM2 应用。前台部署（reload dianzi51*）绝不会波及 admin，反之亦然。
 * 3. cwd 指向稳定软链 /opt/apps/dianzi51-admin，而非具体 release 目录。
 *    历史故障根因正是进程 cwd 直接绑定了某个 release 目录，
 *    该目录被清理后进程虽存活但代码已失效（cwd 显示 "(deleted)"），
 *    表现为 online 但全部请求 404，且重启即彻底失败。
 */
const fs = require("fs");

/** 从 runtime.env 读取环境变量。文件缺失时立即抛错，避免用错配置静默启动。 */
function loadRuntimeEnv(file) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `缺少配置文件 ${file}。请先执行 deploy/extract-admin-runtime-env.sh 生成。`
    );
  }
  const env = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    env[line.slice(0, i).trim()] = v;
  }
  return env;
}

const sharedEnv = loadRuntimeEnv("/opt/config/dianzi51-admin/runtime.env");

// 关键变量缺失时拒绝启动：JWT_SECRET 缺失会导致所有管理员登录态失效，
// 静默启动比启动失败危险得多。
for (const key of ["PORT", "DATABASE_URL", "JWT_SECRET"]) {
  if (!sharedEnv[key]) {
    throw new Error(`runtime.env 缺少必需变量 ${key}，拒绝启动`);
  }
}

module.exports = {
  apps: [
    {
      name: "dianzi51-admin",
      cwd: "/opt/apps/dianzi51-admin",
      script: "dist/index.js",
      instances: 2,
      exec_mode: "cluster",
      autorestart: true,
      max_memory_restart: "450M",
      // 启动失败时不无限重启刷日志，便于暴露问题而非掩盖
      max_restarts: 10,
      min_uptime: "20s",
      env: { ...sharedEnv, NODE_ENV: "production" },
    },
  ],
};
