import type { SQL } from "drizzle-orm";
import type { RegisterTeamRecord } from "../services/channelInventory";

type SqlExecutor = { execute(statement: SQL): Promise<unknown> };

/** Typed view of the unchanged handwritten runtime's registration method. */
export declare function createRuntimeTeamBusinessAdapter(
  getDb: () => Promise<SqlExecutor | null>,
): { registerInsertedRecord: RegisterTeamRecord };
