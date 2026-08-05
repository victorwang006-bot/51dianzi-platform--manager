import { sql } from "drizzle-orm";
import { createMaterial, getDb } from "../server/db";
import { PLATFORM_MATERIAL_CODE_PATTERN } from "../server/materialCode";

const CREATE_COUNT = 50;

async function main() {
  const db = await getDb();
  if (!db) throw new Error("TEST_DATABASE_NOT_AVAILABLE");

  const nonce = Date.now();
  const created = await Promise.all(
    Array.from({ length: CREATE_COUNT }, (_, index) =>
      createMaterial({
        partNumber: `CONCURRENCY-${nonce}-${String(index + 1).padStart(2, "0")}`,
        name: `平台码并发测试物料 ${index + 1}`,
        brand: "ConcurrencyTest",
        category: "测试分类",
      }),
    ),
  );

  const codes = created.map(row => row?.materialNo).filter((code): code is string => Boolean(code));
  const uniqueCodes = new Set(codes);
  const sortedCodes = [...codes].sort();
  const expectedCodes = Array.from(
    { length: CREATE_COUNT },
    (_, index) => `51E-${String(index + 1).padStart(8, "0")}`,
  );
  const [sequenceResult] = await db.execute(
    sql`SELECT nextValue FROM material_number_sequences WHERE sequenceKey = 'platform_material'`,
  );
  const nextValue = Number((sequenceResult as Array<{ nextValue: number }>)[0]?.nextValue);

  if (codes.length !== CREATE_COUNT) throw new Error(`EXPECTED_${CREATE_COUNT}_ROWS_GOT_${codes.length}`);
  if (uniqueCodes.size !== CREATE_COUNT) throw new Error("DUPLICATE_PLATFORM_CODES");
  if (!codes.every(code => PLATFORM_MATERIAL_CODE_PATTERN.test(code))) {
    throw new Error("INVALID_PLATFORM_CODE_FORMAT");
  }
  if (JSON.stringify(sortedCodes) !== JSON.stringify(expectedCodes)) {
    throw new Error("PLATFORM_CODE_SEQUENCE_GAP_OR_REORDER");
  }
  if (nextValue !== CREATE_COUNT + 1) throw new Error(`EXPECTED_NEXT_${CREATE_COUNT + 1}_GOT_${nextValue}`);

  process.stdout.write(JSON.stringify({
    created: codes.length,
    unique: uniqueCodes.size,
    first: sortedCodes[0],
    last: sortedCodes.at(-1),
    nextValue,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
