import "dotenv/config";
import express from "express";
import { registerZhijieRoutes } from "./router";

const port = Number.parseInt(process.env.PORT || "3019", 10);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("invalid PORT");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "128kb" }));
app.get("/health", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    ok: true,
    service: "zhijie-access",
    businessBridge: "disconnected",
  });
});
registerZhijieRoutes(app);

app.listen(port, host, () => {
  console.log(`Zhijie access sidecar listening on http://${host}:${port}`);
});
