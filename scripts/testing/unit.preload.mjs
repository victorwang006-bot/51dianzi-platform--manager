import { sanitizeUnitProcessEnvironment } from "./test-isolation.mjs";
import { installUnitNetworkGuard } from "./unit-network-guard.mjs";

sanitizeUnitProcessEnvironment();
installUnitNetworkGuard();
