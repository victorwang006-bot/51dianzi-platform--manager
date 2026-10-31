import EnterpriseMembersPanel from "./platform/client/src/components/EnterpriseMembersPanel";

/** The source component already owns the genuine enterprise.userRecords query. */
export default function BusinessUserRecordsPage() {
  return <EnterpriseMembersPanel initialView="records" />;
}
