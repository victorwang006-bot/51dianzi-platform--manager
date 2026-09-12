import express, { type Express, type Response } from "express";
import fs from "fs";
import path from "path";

const HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate";
const HASHED_VITE_ASSET = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

function setNoCacheHeaders(res: Response) {
  res.setHeader("Cache-Control", HTML_CACHE_CONTROL);
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function sendIndexHtml(res: Response, indexPath: string) {
  setNoCacheHeaders(res);
  res.sendFile(indexPath);
}

/**
 * Browser cache policy for the production SPA:
 * - content-hashed build assets are immutable for one year;
 * - HTML is always revalidated so a release can reference new hashes immediately;
 * - unversioned static files are never treated as immutable.
 */
export function serveStatic(app: Express) {
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(import.meta.dirname, "../..", "dist", "public")
      : path.resolve(import.meta.dirname, "public");
  const indexPath = path.resolve(distPath, "index.html");
  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }

  app.get("/index.html", (_req, res) => sendIndexHtml(res, indexPath));
  app.use(
    express.static(distPath, {
      setHeaders(res, filePath) {
        if (
          path.dirname(filePath).endsWith(`${path.sep}assets`) &&
          HASHED_VITE_ASSET.test(path.basename(filePath))
        ) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        setNoCacheHeaders(res);
      },
    })
  );

  // A stale or malformed hashed resource must be a 404, never an HTML document
  // accidentally cached as immutable by a reverse proxy.
  app.use("/assets", (_req, res) => res.sendStatus(404));

  // Fall through to the current release's index.html for SPA deep links.
  app.use("*", (_req, res) => sendIndexHtml(res, indexPath));
}
