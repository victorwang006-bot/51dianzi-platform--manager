import { useCallback, useSyncExternalStore } from "react";

// One owned module/factory instance is shared by the native writer and dialog.
// No QueryClient, provider, mutation cache, transport or business variables here.
const operations = new Map<symbol, { demandId: number; session?: object }>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Call synchronously from the original native mutation's onMutate. */
export function registerDemandQuotePending(demandId: number, session?: object): symbol {
  const token = Symbol("demand-quote-operation");
  operations.set(token, { demandId, session });
  notify();
  return token;
}

/** Always settle this operation, even if its UI receipt is no longer current. */
export function settleDemandQuotePending(token?: symbol): void {
  if (token !== undefined && operations.delete(token)) notify();
}

/** Exact object ownership; a new session never inherits the same demand's lock. */
export function getDemandQuotePending(demandId?: number, session?: object): boolean {
  if (demandId === undefined) return false;
  return Array.from(operations.values()).some(operation =>
    operation.demandId === demandId && (session === undefined || operation.session === session));
}

const serverSnapshot = () => false;

/** Observe owned native callbacks without another request or context provider. */
export function useDemandQuotePending(demandId?: number, session?: object): boolean {
  const snapshot = useCallback(() => getDemandQuotePending(demandId, session), [demandId, session]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
