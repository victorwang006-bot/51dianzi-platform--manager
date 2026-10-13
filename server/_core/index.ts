import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic } from "./vite";
import { getUploadRoot } from "../localUpload";
import { startExceptionLogCleanup } from "../exceptionLogCleanup";

const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store, max-age=0";

function setPrivateNoStoreHeaders(res: {
  setHeader(name: string, value: string): void;
}) {
  res.setHeader("Cache-Control", PRIVATE_NO_STORE_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // API responses can contain sessions, permissions, and tenant data. Never allow
  // browser or intermediary public caches to retain them, including OAuth callbacks.
  app.use("/api", (_req, res, next) => {
    setPrivateNoStoreHeaders(res);
    next();
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  startExceptionLogCleanup();
  // Upload URLs can identify tenant resources. Do not let browsers or intermediaries
  // retain them; a missing upload must not fall through to the SPA HTML response.
  app.use(
    "/uploads",
    (_req, res, next) => {
      setPrivateNoStoreHeaders(res);
      next();
    },
    express.static(getUploadRoot(), {
      setHeaders: setPrivateNoStoreHeaders,
    })
  );
  app.use("/uploads", (_req, res) => res.sendStatus(404));
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    // 动态导入：避免 esbuild 生产 bundle 内联 vite 依赖（生产环境未安装 vite）
    const { setupVite } = await import("./vite-dev");
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
