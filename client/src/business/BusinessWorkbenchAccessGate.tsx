import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  BUSINESS_WORKBENCH_CAPABILITIES,
  type BusinessWorkbenchCapability,
} from "../lib/businessWorkbenchCapabilities";

const KNOWN_CAPABILITIES = new Set<string>(BUSINESS_WORKBENCH_CAPABILITIES);

type BusinessWorkbenchAccess = {
  merchantId: number;
  canWrite: boolean;
  readCapabilities: readonly BusinessWorkbenchCapability[];
  writeCapabilities: readonly BusinessWorkbenchCapability[];
};

const BusinessWorkbenchAccessContext = createContext<BusinessWorkbenchAccess | null>(null);

function capabilityList(value: unknown): BusinessWorkbenchCapability[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((capability): capability is BusinessWorkbenchCapability =>
    typeof capability === "string" && KNOWN_CAPABILITIES.has(capability),
  )));
}

/**
 * The BFF's `context.merchant` must prove that this response belongs to the
 * merchant selected by the URL. This prevents a capability projection for one
 * merchant from being reused for another selected merchant.
 */
export function businessContextMatchesMerchant(
  selectedMerchantId: number,
  merchant: unknown,
): boolean {
  if (!merchant || typeof merchant !== "object") return false;
  const merchantId = (merchant as { id?: unknown }).id;
  return Number.isSafeInteger(selectedMerchantId)
    && selectedMerchantId > 0
    && merchantId === selectedMerchantId;
}

export function BusinessWorkbenchAccessProvider({
  merchantId,
  merchantCanWrite,
  workbenchCapabilities,
  writeCapabilities,
  children,
}: {
  merchantId: number;
  /** Exact current-merchant BFF projection; absent is deliberately read-only. */
  merchantCanWrite: boolean;
  workbenchCapabilities: unknown;
  writeCapabilities: unknown;
  children: ReactNode;
}) {
  const readCapabilities = capabilityList(workbenchCapabilities);
  const scopedWriteCapabilities = capabilityList(writeCapabilities);
  const value = useMemo<BusinessWorkbenchAccess>(() => ({
    merchantId,
    canWrite: merchantCanWrite,
    readCapabilities,
    // A stale/partial BFF response cannot become writable simply because it
    // happens to include a capability list. Both fields are required.
    writeCapabilities: merchantCanWrite ? scopedWriteCapabilities : [],
  }), [merchantCanWrite, merchantId, readCapabilities, scopedWriteCapabilities]);

  return (
    <BusinessWorkbenchAccessContext.Provider value={value}>
      {children}
    </BusinessWorkbenchAccessContext.Provider>
  );
}

export function useBusinessWorkbenchAccess(): BusinessWorkbenchAccess {
  const access = useContext(BusinessWorkbenchAccessContext);
  if (!access) {
    throw new Error("BusinessWorkbenchAccessProvider is required before rendering a workbench route");
  }
  return access;
}

function AccessDenied({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <section className="m-5 max-w-3xl rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950" role="status">
      <h1 className="text-base font-semibold">{title}</h1>
      <p className="mt-2 leading-6">{detail}</p>
    </section>
  );
}

/**
 * UI availability only. It never grants a front/native permission: every BFF
 * command and original front procedure remains independently authoritative.
 */
export function BusinessWorkbenchRouteGate({
  capability,
  requiresWrite = false,
  children,
}: {
  capability: BusinessWorkbenchCapability;
  requiresWrite?: boolean;
  children: ReactNode;
}) {
  const access = useBusinessWorkbenchAccess();
  if (!access.readCapabilities.includes(capability)) {
    return (
      <AccessDenied
        title="当前商户未获该业务模块访问范围"
        detail="业务工作台只使用 BFF 对当前选中商户重新核验后的可读能力；不会合并其他商户、后台原生角色或权限。"
      />
    );
  }
  if (requiresWrite && (!access.canWrite || !access.writeCapabilities.includes(capability))) {
    return (
      <AccessDenied
        title="当前商户仅可查看该业务范围"
        detail="该发布或修改入口需要当前商户的 BFF 可写范围及真实前台细粒度能力；系统不会以只读范围默认授予写入。"
      />
    );
  }
  return <>{children}</>;
}
