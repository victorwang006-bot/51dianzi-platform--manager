import PlatformLayout from "../../../../BusinessContentFrame";
import EnterpriseMembersPanel from "../components/EnterpriseMembersPanel";

export default function AddUser() {
  return (
    <PlatformLayout>
      <div className="space-y-4" data-admin-page-family="legacy-add-user-plain-heading">
        <EnterpriseMembersPanel
          pageHeading={
            <>
              <h1 className="text-lg font-semibold">用户与权限</h1>
              <p className="mt-1 text-xs text-muted-foreground">集中查看企业成员、权限与业务范围。</p>
            </>
          }
        />
      </div>
    </PlatformLayout>
  );
}
