import { readChannelMaterialPublications } from "./channelFactoryPublication";

/** Production composition boundary only; pure service/DI never discovers a DB. */
export async function readMainChannelMaterialPublications() {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("CHANNEL_PUBLICATION_DATABASE_UNAVAILABLE");
  return readChannelMaterialPublications(db);
}
