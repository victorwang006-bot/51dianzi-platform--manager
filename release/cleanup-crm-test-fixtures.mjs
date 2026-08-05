import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const checkOnly = process.env.CHECK_ONLY === "1";
const creditCodes = [
  "91TEST31R000000001",
  "91TEST33R000000001",
  "91CRMBIND000000001",
  "91CRMBIND000000002",
  "91CRMBIND000000003",
  "91CRMBIND000000004",
  "91CRMBIND000000005",
  "91CRMBIND000000006",
  "91CRMBIND000000007",
];
const subjectPatterns = [
  "【测试】R31%",
  "平台通知 - 【测试】R33CRM操作电子有限公司%",
];

const connection = await mysql.createConnection(databaseUrl);
try {
  const placeholders = creditCodes.map(() => "?").join(", ");
  const [merchantRows] = await connection.query(
    `SELECT id, crmThreadNo FROM merchants WHERE businessLicense IN (${placeholders})`,
    creditCodes,
  );
  const merchantThreadNos = merchantRows
    .map(row => row.crmThreadNo)
    .filter(value => typeof value === "string" && value.length > 0);

  const subjectClause = subjectPatterns.map(() => "subject LIKE ?").join(" OR ");
  const threadClauses = [subjectClause];
  const threadParams = [...subjectPatterns];
  if (merchantThreadNos.length > 0) {
    threadClauses.push(`threadNo IN (${merchantThreadNos.map(() => "?").join(", ")})`);
    threadParams.push(...merchantThreadNos);
  }

  const [threadRows] = await connection.query(
    `SELECT id FROM message_threads WHERE ${threadClauses.join(" OR ")}`,
    threadParams,
  );

  if (checkOnly) {
    if (merchantRows.length !== 0 || threadRows.length !== 0) {
      throw new Error(
        `CRM release test fixtures already exist: merchants=${merchantRows.length}, threads=${threadRows.length}`,
      );
    }
    console.log("crm_test_fixture_precheck=empty");
  } else {
    await connection.beginTransaction();
    try {
      if (threadRows.length > 0) {
        const threadIds = threadRows.map(row => row.id);
        await connection.query(
          `DELETE FROM messages WHERE threadId IN (${threadIds.map(() => "?").join(", ")})`,
          threadIds,
        );
        await connection.query(
          `DELETE FROM message_threads WHERE id IN (${threadIds.map(() => "?").join(", ")})`,
          threadIds,
        );
      }
      await connection.query(
        `DELETE FROM merchants WHERE businessLicense IN (${placeholders})`,
        creditCodes,
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const [remainingMerchants] = await connection.query(
      `SELECT COUNT(*) AS count FROM merchants WHERE businessLicense IN (${placeholders})`,
      creditCodes,
    );
    const [remainingThreads] = await connection.query(
      `SELECT COUNT(*) AS count FROM message_threads WHERE ${subjectClause}`,
      subjectPatterns,
    );
    const merchantCount = Number(remainingMerchants[0]?.count ?? -1);
    const threadCount = Number(remainingThreads[0]?.count ?? -1);
    if (merchantCount !== 0 || threadCount !== 0) {
      throw new Error(
        `CRM release test fixture cleanup incomplete: merchants=${merchantCount}, threads=${threadCount}`,
      );
    }
    console.log(`crm_test_fixture_cleanup=ok merchants=${merchantRows.length} threads=${threadRows.length}`);
  }
} finally {
  await connection.end();
}
