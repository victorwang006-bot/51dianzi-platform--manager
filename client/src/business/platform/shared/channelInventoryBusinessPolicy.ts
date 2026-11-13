/**
 * Fixed Channel Inventory procedures that the admin business BFF may invoke.
 *
 * This is deliberately a closed, typed list.  It is consumed by the front
 * internal-business bridge; the admin router registers the same individual
 * procedures rather than accepting a browser supplied procedure name.
 */
export const CHANNEL_INVENTORY_BUSINESS_METHOD_IDS = [
  "channelInventory.publishFactoryMaterial",
  "channelInventory.previewFactoryMaterialReception",
  "channelInventory.deleteMaterials",
  "channelInventory.listDeletedMaterials",
  "channelInventory.restoreMaterial",
  "channelInventory.createUploadBatch",
  "channelInventory.listUploadBatches",
  "channelInventory.updateUploadBatch",
  "channelInventory.previewDeleteUploadBatch",
  "channelInventory.deleteUploadBatch",
  "channelInventory.customerSupplySummary",
  "channelInventory.customerSupplyContext",
  "channelInventory.createCustomerUploadBatch",
  "channelInventory.createCustomerMaterial",
  "channelInventory.listChannels",
  "channelInventory.getChannel",
  "channelInventory.createChannel",
  "channelInventory.updateChannel",
  "channelInventory.setChannelActive",
  "channelInventory.listMaterials",
  "channelInventory.exportChannelMaterials",
  "channelInventory.listTeamMaterials",
  "channelInventory.listTeamSourceOptions",
  "channelInventory.getTeamMaterialSource",
  "channelInventory.getTeamMaterialForEdit",
  "channelInventory.updateTeamMaterial",
  "channelInventory.collaborationNotesList",
  "channelInventory.collaborationNotesAdd",
  "channelInventory.collaborationNotesEdit",

  "channelInventory.getMaterial",
  "channelInventory.createMaterial",
  "channelInventory.updateMaterial",
  "channelInventory.listSharedMaterials",
  "channelInventory.setMaterialShare",
  "channelInventory.notesList",
  "channelInventory.notesAdd",
  "channelInventory.notesEdit",
] as const;

export type ChannelInventoryBusinessMethodId = (typeof CHANNEL_INVENTORY_BUSINESS_METHOD_IDS)[number];
export type ChannelInventoryBusinessMethodMode = "read" | "write";

export const CHANNEL_INVENTORY_BUSINESS_METHOD_POLICIES: Readonly<Record<
  ChannelInventoryBusinessMethodId,
  Readonly<{ mode: ChannelInventoryBusinessMethodMode; permission: "inventory.manage" | "inventory.publish" }>
>> = {
  "channelInventory.publishFactoryMaterial": { mode: "write", permission: "inventory.publish" },
  "channelInventory.previewFactoryMaterialReception": { mode: "read", permission: "inventory.publish" },
  "channelInventory.deleteMaterials": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listDeletedMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.restoreMaterial": { mode: "write", permission: "inventory.manage" },
  "channelInventory.createUploadBatch": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listUploadBatches": { mode: "read", permission: "inventory.manage" },
  "channelInventory.updateUploadBatch": { mode: "write", permission: "inventory.manage" },
  "channelInventory.previewDeleteUploadBatch": { mode: "write", permission: "inventory.manage" },
  "channelInventory.deleteUploadBatch": { mode: "write", permission: "inventory.manage" },
  "channelInventory.customerSupplySummary": { mode: "read", permission: "inventory.manage" },
  "channelInventory.customerSupplyContext": { mode: "read", permission: "inventory.manage" },
  "channelInventory.createCustomerUploadBatch": { mode: "write", permission: "inventory.manage" },
  "channelInventory.createCustomerMaterial": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listChannels": { mode: "read", permission: "inventory.manage" },
  "channelInventory.getChannel": { mode: "read", permission: "inventory.manage" },
  "channelInventory.createChannel": { mode: "write", permission: "inventory.manage" },
  "channelInventory.updateChannel": { mode: "write", permission: "inventory.manage" },
  "channelInventory.setChannelActive": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.exportChannelMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.listTeamMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.listTeamSourceOptions": { mode: "read", permission: "inventory.manage" },
  "channelInventory.getTeamMaterialSource": { mode: "read", permission: "inventory.manage" },
  "channelInventory.getTeamMaterialForEdit": { mode: "write", permission: "inventory.manage" },
  "channelInventory.updateTeamMaterial": { mode: "write", permission: "inventory.manage" },
  "channelInventory.collaborationNotesList": { mode: "read", permission: "inventory.manage" },
  "channelInventory.collaborationNotesAdd": { mode: "read", permission: "inventory.manage" },
  "channelInventory.collaborationNotesEdit": { mode: "read", permission: "inventory.manage" },

  "channelInventory.getMaterial": { mode: "read", permission: "inventory.manage" },
  "channelInventory.createMaterial": { mode: "write", permission: "inventory.manage" },
  "channelInventory.updateMaterial": { mode: "write", permission: "inventory.manage" },
  "channelInventory.setMaterialShare": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listSharedMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.notesList": { mode: "read", permission: "inventory.manage" },
  "channelInventory.notesAdd": { mode: "write", permission: "inventory.manage" },
  "channelInventory.notesEdit": { mode: "write", permission: "inventory.manage" },
};

export function isChannelInventoryBusinessMethodId(value: string): value is ChannelInventoryBusinessMethodId {
  return (CHANNEL_INVENTORY_BUSINESS_METHOD_IDS as readonly string[]).includes(value);
}
