import { readFile, writeFile, rm, realpath, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

// No remote target or user-supplied configuration is accepted by this CLI.
const action = process.argv[2];
if (
  !["migrate", "seed", "reset"].includes(action) ||
  process.argv.slice(3).some((arg) => arg !== "--confirm-local-reset")
)
  throw new Error(
    "Usage: node scripts/backend-db.mjs migrate|seed|reset [--confirm-local-reset]",
  );
if (action === "reset" && !process.argv.includes("--confirm-local-reset"))
  throw new Error("Reset requires --confirm-local-reset");
const root = await realpath(new URL("..", import.meta.url).pathname);
const hosting = JSON.parse(
  await readFile(path.join(root, ".openai/hosting.json"), "utf8"),
);
if (hosting.d1 !== "DB")
  throw new Error(
    "Expected starter DB binding; inspect configuration before continuing.",
  );
const temporary = await mkdtemp(path.join(tmpdir(), "returnops-local-"));
try {
  const configPath = path.join(temporary, "wrangler.json");
  await writeFile(
    configPath,
    JSON.stringify({
      name: "returnops-local-db",
      compatibility_date: "2026-05-15",
      d1_databases: [
        {
          binding: "DB",
          database_name: "site-creator-d1",
          database_id: "00000000-0000-4000-8000-000000000000",
          migrations_dir: path.join(root, "drizzle"),
        },
      ],
    }),
  );
  function wrangler(args) {
    const result = spawnSync(
      "npx",
      [
        "--no-install",
        "wrangler",
        ...args,
        "--config",
        configPath,
        "--local",
        "--persist-to",
        path.join(root, ".wrangler/state"),
      ],
      { cwd: root, stdio: "inherit", env: process.env },
    );
    if (result.status !== 0) throw new Error("Local D1 command failed");
  }
  if (action === "migrate") wrangler(["d1", "migrations", "apply", "DB"]);
  if (action === "seed" || action === "reset") {
    const { seedDemo } = await import("./demo-data.ts");
    const statements = [];
    // All values come from the canonical, fixed synthetic fixture factory.
    const encode = (value) =>
      value === null
        ? "NULL"
        : typeof value === "number"
          ? String(value)
          : `'${String(value).replaceAll("'", "''")}'`;
    const db = {
      prepare(sql) {
        return {
          sql,
          values: [],
          bind(...values) {
            return { ...this, values };
          },
        };
      },
      async batch(batch) {
        for (const statement of batch) {
          let index = 0;
          statements.push(
            statement.sql.replace(/\?/g, () =>
              encode(statement.values[index++]),
            ) + ";",
          );
        }
      },
    };
    await seedDemo(db);
    if (action === "reset")
      statements.unshift(
        ...[
          "receipts",
          "events",
          "rule_suggestions",
          "rules",
          "evidence",
          "demo_proofs",
        ].map((table) => `DELETE FROM ${table};`),
        "DELETE FROM operations WHERE kind='EVALUATION';",
        "DELETE FROM operations WHERE kind='REQUEST';",
        "DELETE FROM cases;",
        "DELETE FROM orders;",
        "DELETE FROM shop_policy;",
      );
    const file = path.join(temporary, "seed.sql");
    await writeFile(file, statements.join("\n"));
    wrangler(["d1", "execute", "DB", "--file", file]);
  }
  console.log(`Local D1 ${action} complete. Persistence: .wrangler/state`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
