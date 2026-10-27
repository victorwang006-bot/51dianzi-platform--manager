import { lazy } from "react";

/**
 * Keep every screen behind an import boundary. The initial login/session shell must
 * not download administrative screens (or their dependencies) before authentication.
 */
const pageLoaders = {
  login: () => import("@/pages/Login"),
  materials: () => import("@/pages/Materials"),
  merchants: () => import("@/pages/Merchants"),
  merchantDetail: () => import("@/pages/MerchantDetail"),
  messages: () => import("@/pages/Messages"),
  portalUsers: () => import("@/pages/PortalUsers"),
  admins: () => import("@/pages/Admins"),
  orders: () => import("@/pages/Orders"),
  profile: () => import("@/pages/Profile"),
  exceptionLogs: () => import("@/pages/ExceptionLogs"),
  reviews: () => import("@/pages/Reviews"),
  analytics: () => import("@/pages/Analytics"),
  forbidden: () => import("@/pages/Forbidden"),
  notFound: () => import("@/pages/NotFound"),
} as const;

export const LazyLogin = lazy(pageLoaders.login);
export const LazyMaterials = lazy(pageLoaders.materials);
export const LazyMerchants = lazy(pageLoaders.merchants);
export const LazyMerchantDetail = lazy(pageLoaders.merchantDetail);
export const LazyMessages = lazy(pageLoaders.messages);
export const LazyPortalUsers = lazy(pageLoaders.portalUsers);
export const LazyAdmins = lazy(pageLoaders.admins);
export const LazyOrders = lazy(pageLoaders.orders);
export const LazyProfile = lazy(pageLoaders.profile);
export const LazyExceptionLogs = lazy(pageLoaders.exceptionLogs);
export const LazyReviews = lazy(pageLoaders.reviews);
export const LazyAnalytics = lazy(pageLoaders.analytics);
export const LazyForbidden = lazy(pageLoaders.forbidden);
export const LazyNotFound = lazy(pageLoaders.notFound);

export type AdminNavigationChunk =
  | "materials"
  | "merchants"
  | "messages"
  | "portalUsers"
  | "admins"
  | "orders"
  | "profile"
  | "exceptionLogs"
  | "reviews"
  | "analytics";

/**
 * Navigation intent may warm a small number of next screens after authentication.
 * The hard cap prevents hovering across the menu from turning into a background
 * download of the entire administrative console.
 */
export const MAX_ADMIN_ROUTE_PREFETCHES = 2;
const prefetchedNavigationChunks = new Set<AdminNavigationChunk>();

export function preloadAdminRoute(chunk: AdminNavigationChunk): boolean {
  if (
    prefetchedNavigationChunks.has(chunk) ||
    prefetchedNavigationChunks.size >= MAX_ADMIN_ROUTE_PREFETCHES
  ) {
    return false;
  }

  prefetchedNavigationChunks.add(chunk);
  void pageLoaders[chunk]();
  return true;
}

/** Test-only reset; it is deliberately not called by the application. */
export function resetAdminRoutePrefetchBudgetForTest() {
  prefetchedNavigationChunks.clear();
}
