import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChannelReferenceSource } from "../../shared/channelReference";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const directory = join(tmpdir(), "51-channel-reference-rate-v1");
const chains: Record<ChannelReferenceSource, Promise<void>> = { lcsc: Promise.resolve(), ickey: Promise.resolve() };
/** The worker owns the provider kernel flock; all ordinary resources and robots
 * share a serialized, cross-process timestamp strictly below 2 requests/second. */
export async function waitReferenceRequestPermit(source: ChannelReferenceSource, deadline: number): Promise<void> {
  const run = chains[source].catch(() => {}).then(async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const state = join(directory, source + ".rate.json");
    const last = Number(await readFile(state, "utf8").catch(() => "0"));
    if (!Number.isFinite(last) || last > Date.now()) throw new Error("Invalid rate state");
    const wait = Math.max(0, 560 - (Date.now() - last));
    if (Date.now() + wait >= deadline) throw new Error("Page deadline");
    if (wait) await sleep(wait);
    const temporary = state + "." + randomUUID();
    await writeFile(temporary, String(Date.now()), { mode: 0o600, flag: "wx" });
    await rename(temporary, state);
  });
  chains[source] = run;
  await run;
}
