import { getDb } from "../db";
import { createRuntimeTeamBusinessAdapter } from "../teamManagement/businessRuntime.mjs";
import { createChannelInventoryRouter } from "./channelInventory";

// The adapter is the byte-preserved original handwritten implementation. It
// registers actual creator/current-owner facts in the writer's same transaction;
// unavailable schema/parent assignments fail closed rather than returning success.
const teamBusiness = createRuntimeTeamBusinessAdapter(getDb);
export const channelInventoryRouter = createChannelInventoryRouter(
  teamBusiness.registerInsertedRecord,
);
