import type { Express } from "express";
import { readFileSync, writeFileSync } from "node:fs";
import {
  beijingResidentRotationDate,
  listFeaturedSuppliers,
  type HomepageSupplierLists,
} from "./services/companyPublicProfile";
import { projectPublicHomeSupplierLists } from "./services/homeSuppliersPublicProjection";

export const HOME_SUPPLIERS_PUBLIC_PATH = "/api/public/home-suppliers";
export const HOME_SUPPLIERS_FRESH_TTL_MS = 60_000;
export const HOME_SUPPLIERS_STALE_TTL_MS = 10 * 60_000;

type CacheEntry = {
  data: HomepageSupplierLists;
  savedAt: number;
  generation: string;
};

let cacheEntry: CacheEntry | null = null;
let refreshPromise: Promise<HomepageSupplierLists> | null = null;

function generationFile() {
  return process.env.HOME_SUPPLIERS_CACHE_GENERATION_FILE?.trim()
    || "/tmp/dianzi51-home-suppliers-generation";
}

function readHomeSuppliersGeneration() {
  try {
    return readFileSync(generationFile(), "utf8");
  } catch {
    return "";
  }
}

/** 后台勾选优质/展示商家后立刻失效各进程内存缓存。 */
export function invalidateHomeSuppliersPublicCache() {
  cacheEntry = null;
  refreshPromise = null;
  try {
    writeFileSync(generationFile(), `${Date.now()}\n`, { encoding: "utf8" });
  } catch (error) {
    console.warn("[home-suppliers] cache generation write failed:", (error as Error).message);
  }
}

function cacheMatchesToday(entry: CacheEntry, now: number) {
  return entry.data.residentRotation.date === beijingResidentRotationDate(new Date(now));
}

async function refreshHomeSuppliers(now = Date.now()) {
  if (!refreshPromise) {
    refreshPromise = listFeaturedSuppliers(20)
      .then(data => {
        cacheEntry = { data, savedAt: now, generation: readHomeSuppliersGeneration() };
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export async function getCachedHomeSuppliers(now = Date.now()): Promise<HomepageSupplierLists> {
  const entry = cacheEntry;
  if (entry && cacheMatchesToday(entry, now) && entry.generation === readHomeSuppliersGeneration()) {
    const age = now - entry.savedAt;
    if (age < HOME_SUPPLIERS_FRESH_TTL_MS) return entry.data;
    if (age < HOME_SUPPLIERS_STALE_TTL_MS) {
      void refreshHomeSuppliers(now).catch(error => {
        console.warn("[home-suppliers] background refresh failed:", (error as Error).message);
      });
      return entry.data;
    }
  }
  return refreshHomeSuppliers(now);
}

/**
 * 首页展示只包含公开公司名、公开企业主页ID和审核通过的缩略图。
 * 路由注册在共享MySQL频控中间件之前，避免一次公开首页展示同步等待两次计数写入；
 * UA守卫仍在它之前，Nginx exact location仍提供跨PM2实例的每IP限流。
 */
export function registerHomeSuppliersPublicRoute(app: Express) {
  app.get(HOME_SUPPLIERS_PUBLIC_PATH, async (_req, res) => {
    try {
      const data = await getCachedHomeSuppliers();
      res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
      res.json(projectPublicHomeSupplierLists(data));
    } catch (error) {
      console.error("[home-suppliers] public route failed:", error);
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "首页商家暂时无法加载" });
    }
  });
}

export function warmHomeSuppliersPublicCache() {
  return getCachedHomeSuppliers();
}

export function __resetHomeSuppliersPublicCacheForTests() {
  cacheEntry = null;
  refreshPromise = null;
}
