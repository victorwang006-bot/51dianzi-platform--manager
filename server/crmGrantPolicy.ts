export type MerchantCrmStatus = "none" | "pending" | "enabled" | "disabled" | "rejected";

const CRM_STATUS_TRANSITIONS: Record<MerchantCrmStatus, readonly MerchantCrmStatus[]> = {
  none: ["pending", "enabled"],
  pending: ["enabled", "rejected"],
  enabled: ["disabled"],
  disabled: ["enabled"],
  rejected: ["pending", "enabled"],
};

export function assertMerchantCrmStatusTransition(
  fromStatus: MerchantCrmStatus,
  toStatus: MerchantCrmStatus,
) {
  if (fromStatus === toStatus) return;
  if (!CRM_STATUS_TRANSITIONS[fromStatus].includes(toStatus)) {
    throw new Error(`ERP 状态不能从 ${fromStatus} 直接变更为 ${toStatus}`);
  }
}

export function crmStatusAction(
  fromStatus: MerchantCrmStatus,
  toStatus: MerchantCrmStatus,
) {
  if (fromStatus === toStatus) return "noop" as const;
  if (toStatus === "enabled" && fromStatus === "disabled") return "resume" as const;
  if (toStatus === "enabled") return "enable" as const;
  if (toStatus === "disabled") return "suspend" as const;
  if (toStatus === "rejected") return "reject" as const;
  return "pending" as const;
}

export type MerchantCrmGrantState = {
  crmOwnerPortalUserId?: string | null;
  crmStatus: MerchantCrmStatus | string;
};

export type MerchantCrmGrantInput = {
  crmStatus: MerchantCrmStatus;
  portalUserId?: string | null;
};

export type MerchantCrmGrantDecision =
  | {
      kind: "enable";
      ownerToBind: string;
      expectedExistingOwner: string | null;
    }
  | {
      kind: "status-only";
      existingOwner: string | null;
    };

export function normalizeCrmPortalUserId(value?: string | null) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function decideMerchantCrmGrant(
  current: MerchantCrmGrantState,
  input: MerchantCrmGrantInput,
): MerchantCrmGrantDecision {
  const existingOwner = normalizeCrmPortalUserId(current.crmOwnerPortalUserId);
  if (input.crmStatus !== "enabled") {
    return { kind: "status-only", existingOwner };
  }

  const requestedOwner = normalizeCrmPortalUserId(input.portalUserId);
  if (!existingOwner && !requestedOwner) {
    throw new Error("开通 ERP 前必须填写前台用户 ID");
  }
  if (existingOwner && requestedOwner && existingOwner !== requestedOwner) {
    throw new Error("该商户已绑定其他前台账号，不能通过开通操作直接换绑");
  }

  return {
    kind: "enable",
    ownerToBind: existingOwner || requestedOwner!,
    expectedExistingOwner: existingOwner,
  };
}

export function isEquivalentEnabledBinding(
  current: MerchantCrmGrantState | null | undefined,
  ownerToBind: string,
) {
  return Boolean(
    current
      && current.crmStatus === "enabled"
      && normalizeCrmPortalUserId(current.crmOwnerPortalUserId) === ownerToBind,
  );
}
