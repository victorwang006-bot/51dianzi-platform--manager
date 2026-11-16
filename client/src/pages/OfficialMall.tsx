import DashboardLayout from "@/components/DashboardLayout";
import MallMaterials from "@/business/MallMaterials";

/** Native local-admin page: no front-workbench context, merchant selection or staff binding. */
export default function OfficialMall() {
  return <DashboardLayout><MallMaterials /></DashboardLayout>;
}
