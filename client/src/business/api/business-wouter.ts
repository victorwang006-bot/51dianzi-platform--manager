import { useCallback } from "react";
import { useBrowserLocation } from "wouter/use-browser-location";
import { buildBusinessNavigationTarget } from "@/lib/businessNavigation";

type BrowserNavigate = ReturnType<typeof useBrowserLocation>[1];
type BrowserNavigateOptions = Parameters<BrowserNavigate>[1];

type BusinessNavigate = (target: string, options?: BrowserNavigateOptions) => void;

function currentBrowserLocation(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

/**
 * Router hook for the migrated business application. It keeps a BFF-verified
 * merchant selection only while navigating between workbench paths.
 */
export function useBusinessLocation(): [string, BusinessNavigate] {
  const [location, navigate] = useBrowserLocation();
  const navigateWithMerchant = useCallback<BusinessNavigate>((target, options) => {
    const destination = buildBusinessNavigationTarget(currentBrowserLocation(), target);
    if (destination !== null) navigate(destination, options);
  }, [navigate]);

  return [location, navigateWithMerchant];
}

/** Formats rendered internal Link hrefs with the same narrow navigation rule. */
export function businessNavigationHrefs(href: string): string {
  return buildBusinessNavigationTarget(currentBrowserLocation(), href) ?? "#";
}
