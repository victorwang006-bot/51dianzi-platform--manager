import { useEffect, useRef } from "react";

/** A missing customerId is allowed only for the backward-compatible standalone route. */
export function customerMatches(
  record: { customerId?: number } | null | undefined,
  customerId?: number
): boolean {
  return (
    customerId === undefined ||
    Boolean(record && record.customerId === customerId)
  );
}

/** Refuse the entire response; never turn a full-company result into a locally filtered customer list. */
export function customerPageMatches(
  page: { items: Array<{ customerId?: number }> } | null | undefined,
  customerId?: number
): boolean {
  return (
    page == null ||
    customerId === undefined ||
    page.items.every(record => customerMatches(record, customerId))
  );
}

/** Keyed customer sessions discard drafts synchronously on identity/access changes. */
export function useSalesOrderSession(writable: boolean) {
  const alive = useRef(true);
  const writeAllowed = useRef(writable);
  writeAllowed.current = writable;
  useEffect(() => {
    alive.current = true;
    writeAllowed.current = writable;
    return () => {
      alive.current = false;
      writeAllowed.current = false;
    };
  }, []);
  const session = useRef({
    isWritable: () => alive.current && writeAllowed.current,
  });
  return session.current;
}
