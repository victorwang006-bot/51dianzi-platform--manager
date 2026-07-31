/**
 * 生产使用前先在服务器进程环境或密钥管理系统中设置必需变量。
 * 本模板不保存数据库、前台对接或阿里云短信凭证。
 */
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
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        UPLOAD_DIR: "/opt/apps/dianzi51-admin/uploads",
        PLATFORM_DB_NAME: "dianzi51",
        DATABASE_URL: process.env.DATABASE_URL,
        JWT_SECRET: process.env.JWT_SECRET,
        PORTAL_API_KEY: process.env.PORTAL_API_KEY,
        SMS_ACCESS_KEY_ID: process.env.SMS_ACCESS_KEY_ID,
        SMS_ACCESS_KEY_SECRET: process.env.SMS_ACCESS_KEY_SECRET,
        SMS_SIGN_NAME: process.env.SMS_SIGN_NAME,
        SMS_TEMPLATE_CODE: process.env.SMS_TEMPLATE_CODE,
      },
    },
  ],
};
