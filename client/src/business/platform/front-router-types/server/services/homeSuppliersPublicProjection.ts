import type { HomepageSupplierLists } from "./companyPublicProfile";

/** One audited public contract for both the tRPC homepage and the HTTP cache endpoint. */
export function projectPublicHomeSupplierLists(lists: HomepageSupplierLists) {
  const publicItems = (items: HomepageSupplierLists["featuredItems"]) => items.map(item => ({
    companyId: item.companyId,
    supplierId: item.supplierId,
    companyName: item.companyName,
    photoUrl: item.photoUrl,
    displayMode: item.displayMode,
    cropZoom: item.cropZoom,
    cropX: item.cropX,
    cropY: item.cropY,
  }));
  return {
    featuredItems: publicItems(lists.featuredItems),
    residentItems: publicItems(lists.residentItems),
    residentRotation: { date: lists.residentRotation.date },
  };
}
