import InquiryReception from "../../../../InquiryReception";

/** BFF/BusinessScope remain the sole actor, enterprise and authorization boundary. */
export default function EnterpriseInquiryInbox({ canReply = false }: { canReply?: boolean }) {
  return <InquiryReception canReply={canReply} />;
}
