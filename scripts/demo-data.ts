/** One canonical synthetic dataset, mapped directly from docs/scenarios.md. */
export async function seedDemo(db: D1Database) {
  const statements = [
    db.prepare("INSERT INTO shop_policy(shop_id) VALUES('demo-shop')"),
  ];
  const fixtures = [
    {
      id: "a",
      amount: 189000,
      reason: "SIZE_MISMATCH",
      condition: "WRONG_SIZE",
      flags: [],
      source: "SELLER",
      type: "PACKING",
      verified: true,
    },
    {
      id: "b",
      amount: 245000,
      reason: "DAMAGE",
      condition: "DAMAGED",
      flags: [],
      source: null,
      type: null,
      verified: false,
    },
    {
      id: "c",
      amount: 1250000,
      reason: "DENIED_RECEIPT",
      condition: "DELIVERY_DISPUTED",
      flags: ["DELIVERY_CONFLICT", "REPEATED_COMPLAINTS"],
      source: "CARRIER",
      type: "DELIVERY",
      verified: false,
    },
    {
      id: "d",
      amount: 199000,
      reason: "FIT_ISSUE",
      condition: "UNUSED_TAGS_INTACT",
      flags: [],
      source: "BUYER",
      type: "ITEM_CONDITION",
      verified: true,
    },
    {
      id: "e",
      amount: 279000,
      reason: "FIT_ISSUE",
      condition: "UNUSED_TAGS_INTACT",
      flags: [],
      source: "BUYER",
      type: "ITEM_CONDITION",
      verified: true,
    },
  ];
  for (const f of fixtures) {
    statements.push(
      db
        .prepare(
          `INSERT INTO orders(id,shop_id,amount_vnd,delivered_at,tracking,order_version,reason_group,item_condition,risk_flags)
 VALUES(?,'demo-shop',?,unixepoch()-86400,?,1,?,?,?)`,
        )
        .bind(
          `demo-${f.id}`,
          f.amount,
          `trk-${f.id}`,
          f.reason,
          f.condition,
          JSON.stringify(f.flags),
        ),
    );
    if (f.source)
      statements.push(
        db
          .prepare(
            "INSERT INTO demo_proofs(id,order_id,type,source,reference,review_status) VALUES(?,?,?,?,?,?)",
          )
          .bind(
            `proof-${f.id}`,
            `demo-${f.id}`,
            f.type,
            f.source,
            `demo-proof-${f.id}`,
            f.verified ? "VERIFIED" : "SUBMITTED",
          ),
      );
  }
  for (const [id, reason, condition] of [
    ["size", "SIZE_MISMATCH", "WRONG_SIZE"],
    ["damage", "DAMAGE", "DAMAGED"],
  ])
    statements.push(
      db
        .prepare(
          "INSERT INTO rules(id,shop_id,version,decision,reason_group,item_condition) VALUES(?,'demo-shop',1,'RETURN_THEN_REFUND',?,?)",
        )
        .bind(`builtin-${id}`, reason, condition),
    );
  await db.batch(statements);
}
