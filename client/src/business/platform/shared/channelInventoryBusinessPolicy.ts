/**
 * Fixed Channel Inventory procedures that the admin business BFF may invoke.
 *
 * This is deliberately a closed, typed list.  It is consumed by the front
 * internal-business bridge; the admin router registers the same individual
 * procedures rather than accepting a browser supplied procedure name.
 */
export const CHANNEL_INVENTORY_BUSINESS_METHOD_IDS = [
  "channelInventory.listChannels",
  "channelInventory.getChannel",
  "channelInventory.createChannel",
  "channelInventory.updateChannel",
  "channelInventory.setChannelActive",
  "channelInventory.listMaterials",
  "channelInventory.exportChannelMaterials",
  "channelInventory.listTeamMaterials",
  "channelInventory.listTeamSourceOptions",
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
  Readonly<{ mode: ChannelInventoryBusinessMethodMode; permission: "inventory.manage" }>
>> = {
  "channelInventory.listChannels": { mode: "read", permission: "inventory.manage" },
  "channelInventory.getChannel": { mode: "read", permission: "inventory.manage" },
  "channelInventory.createChannel": { mode: "write", permission: "inventory.manage" },
  "channelInventory.updateChannel": { mode: "write", permission: "inventory.manage" },
  "channelInventory.setChannelActive": { mode: "write", permission: "inventory.manage" },
  "channelInventory.listMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.exportChannelMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.listTeamMaterials": { mode: "read", permission: "inventory.manage" },
  "channelInventory.listTeamSourceOptions": { mode: "read", permission: "inventory.manage" },
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
