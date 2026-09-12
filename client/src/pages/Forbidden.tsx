import DashboardLayout from "@/components/DashboardLayout";
import { ShieldAlert } from "lucide-react";

/** Kept in the protected route boundary so anonymous startup never imports the dashboard shell. */
export default function Forbidden() {
  return (
    <DashboardLayout>
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="max-w-md text-center">
          <ShieldAlert className="mx-auto h-12 w-12 text-amber-500" />
          <h1 className="mt-4 text-xl font-semibold">暂无访问权限</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            当前后台角色没有访问此模块的权限，请从侧边栏选择已授权模块，或联系超级管理员调整角色。
          </p>
        </div>
      </div>
    </DashboardLayout>
  );
}
