import { lazy, Suspense, useContext } from "react";
import { QueryClientContext } from "@tanstack/react-query";

const VerifiedBadge = lazy(() => import("../../business/BusinessWorkbenchPage").then(module => ({
  default: module.BusinessReceptionNavigationBadge,
})));

/** Mounted only for the parent-authorized inquiry.receive item. It uses the
 * exact BusinessWorkbenchSession context/domain resources; no personal unread,
 * inventory permission or admin account is used as a front actor. */
export default function InquiryReceptionNavigationBadge() {
  const root = useContext(QueryClientContext);
  if (!root) return null;
  return <Suspense fallback={null}><VerifiedBadge /></Suspense>;
}
