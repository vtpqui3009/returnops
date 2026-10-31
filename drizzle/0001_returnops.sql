CREATE TABLE shop_policy (
 shop_id TEXT PRIMARY KEY, active_rules_version INTEGER NOT NULL DEFAULT 1 CHECK(active_rules_version>0),
 hard_cap_vnd INTEGER NOT NULL DEFAULT 300000 CHECK(hard_cap_vnd BETWEEN 1 AND 300000),
 window_seconds INTEGER NOT NULL DEFAULT 604800 CHECK(window_seconds BETWEEN 1 AND 604800), config_version INTEGER NOT NULL DEFAULT 1 CHECK(config_version>0)
);
CREATE TABLE orders (
 id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id), amount_vnd INTEGER NOT NULL CHECK(typeof(amount_vnd)='integer' AND amount_vnd>0),
 delivered_at INTEGER, tracking TEXT NOT NULL, order_version INTEGER NOT NULL CHECK(order_version>0),
 reason_group TEXT NOT NULL, item_condition TEXT NOT NULL, risk_flags TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE cases (
 id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id), order_id TEXT NOT NULL REFERENCES orders(id), claim TEXT NOT NULL,
 case_version INTEGER NOT NULL DEFAULT 1 CHECK(case_version>0), evidence_version INTEGER NOT NULL DEFAULT 0 CHECK(evidence_version>=0),
 status TEXT NOT NULL CHECK(status IN ('NEW','WAITING_EVIDENCE','NEEDS_OWNER_REVIEW','COMPLETED','TECHNICAL_ERROR')),
 flags TEXT NOT NULL DEFAULT '[]', reasons TEXT NOT NULL DEFAULT '[]', missing_evidence TEXT NOT NULL DEFAULT '[]', decision TEXT,
 applied_rule_id TEXT, applied_rule_version INTEGER, source_case_id TEXT, pending_evaluation_operation_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE evidence (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id),
 order_id TEXT NOT NULL, order_version INTEGER NOT NULL CHECK(order_version>0), tracking TEXT NOT NULL,
 type TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('SELLER','BUYER','CARRIER')), reference TEXT NOT NULL, observed_at INTEGER NOT NULL,
 evidence_version INTEGER NOT NULL DEFAULT 1 CHECK(evidence_version>0), review_status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK(review_status IN ('SUBMITTED','VERIFIED','REJECTED')),
 verified_by TEXT, verified_at INTEGER, review_reason TEXT
);
CREATE TABLE operations (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('REQUEST','EVALUATION')), shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id),
 actor_id TEXT, method TEXT, action TEXT, resource_id TEXT, idempotency_key TEXT, payload_hash TEXT, http_status INTEGER, response_body TEXT,
 parent_request_id TEXT UNIQUE REFERENCES operations(id), case_id TEXT REFERENCES cases(id), snapshot TEXT,
 status TEXT NOT NULL CHECK(status IN ('PENDING','RUNNING','COMPLETED','FAILED')), expected_case_version INTEGER, expected_rules_version INTEGER,
 attempt_token TEXT, lease_until INTEGER, execution_mode TEXT CHECK(execution_mode IN ('LIVE','TEST','REPLAY')), provider_response_id TEXT, model TEXT,
 result TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 CHECK(kind!='REQUEST' OR (actor_id IS NOT NULL AND idempotency_key IS NOT NULL AND http_status IS NOT NULL AND response_body IS NOT NULL)),
 UNIQUE(shop_id,actor_id,method,action,resource_id,idempotency_key)
);
CREATE TABLE events (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id),
 operation_id TEXT NOT NULL REFERENCES operations(id), sequence INTEGER NOT NULL DEFAULT 0,
 type TEXT NOT NULL, actor_id TEXT, payload TEXT NOT NULL, occurred_at INTEGER NOT NULL, UNIQUE(operation_id,sequence)
);
CREATE TABLE receipts (
 id TEXT PRIMARY KEY, case_id TEXT NOT NULL UNIQUE REFERENCES cases(id), operation_id TEXT NOT NULL REFERENCES operations(id),
 completion_mode TEXT NOT NULL CHECK(completion_mode IN ('AUTO','MANUAL')), agent_run_id TEXT REFERENCES operations(id),
 decision TEXT NOT NULL CHECK(decision IN ('RETURN_THEN_REFUND','DISPUTE')), packet TEXT NOT NULL, reply TEXT NOT NULL,
 applied_rule_id TEXT, applied_rule_version INTEGER, source_case_id TEXT,
 CHECK(completion_mode!='MANUAL' OR agent_run_id IS NULL)
);
CREATE TABLE rules (
 id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id), version INTEGER NOT NULL CHECK(version>0),
 source_case_id TEXT REFERENCES cases(id), decision TEXT NOT NULL CHECK(decision='RETURN_THEN_REFUND'), reason_group TEXT NOT NULL, item_condition TEXT NOT NULL,
 UNIQUE(shop_id,reason_group,item_condition,decision)
);
CREATE TABLE rule_suggestions (
 id TEXT PRIMARY KEY, shop_id TEXT NOT NULL REFERENCES shop_policy(shop_id), source_case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
 source_snapshot TEXT NOT NULL, suggestion_version INTEGER NOT NULL DEFAULT 1 CHECK(suggestion_version>0),
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACCEPTED','REJECTED')),
 reason_group TEXT NOT NULL, item_condition TEXT NOT NULL, owner_reason TEXT NOT NULL, rule_id TEXT REFERENCES rules(id)
);
CREATE TABLE demo_proofs (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), type TEXT NOT NULL, source TEXT NOT NULL,
 reference TEXT NOT NULL, review_status TEXT NOT NULL CHECK(review_status IN ('SUBMITTED','VERIFIED'))
);
CREATE TABLE commit_guards (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE INDEX cases_shop_updated ON cases(shop_id,updated_at DESC,id DESC);
CREATE INDEX evidence_case ON evidence(shop_id,case_id);
CREATE INDEX events_case ON events(shop_id,case_id,occurred_at,id);
CREATE INDEX evaluations_case ON operations(shop_id,case_id,kind,created_at);
CREATE INDEX suggestions_shop ON rule_suggestions(shop_id,status);
CREATE TRIGGER request_ack_immutable BEFORE UPDATE ON operations WHEN OLD.kind='REQUEST'
BEGIN SELECT RAISE(ABORT,'immutable request acknowledgement'); END;
