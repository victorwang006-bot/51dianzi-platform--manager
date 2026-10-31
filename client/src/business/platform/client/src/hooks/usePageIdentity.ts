import { useBusinessScope } from "../../../../BusinessScope";

/** UI memory only: authorization remains exclusively in the BFF. */
export function usePageIdentity(): string | null {
  return useBusinessScope().storageScope;
}
