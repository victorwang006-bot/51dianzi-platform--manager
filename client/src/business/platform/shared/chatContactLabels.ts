export type ChatContactLabelInput = Readonly<{
  companyName?: unknown;
  personName?: unknown;
  username?: unknown;
  remarkName?: unknown;
}>;

export type ChatContactLabels = Readonly<{
  originalName: string;
  displayName: string;
  contactPersonName: string;
  companyName: string | null;
}>;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function chatContactLabels(input: ChatContactLabelInput): ChatContactLabels {
  const companyName = clean(input.companyName);
  const personName = clean(input.personName) || clean(input.username) || "未知联系人";
  const originalName = companyName || personName;
  return {
    originalName,
    displayName: clean(input.remarkName) || originalName,
    contactPersonName: personName,
    companyName: companyName || null,
  };
}
