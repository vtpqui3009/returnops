import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Miniflare } from "miniflare";
import { seedDemo } from "../scripts/demo-data";
import { handleApi } from "../src/server/api";
import type { AgentRunner } from "../src/server/workflow";

const config = { SITES_IDENTITY_VERIFIED: "true", RETURNOPS_SIGNED_IN_DEMO: "true" };
function reset(key: string, body: unknown = {confirm:"reset-shared-demo"}, identity = true) {
  return new Request("https://returnops.local/api/demo/reset", {method:"POST",headers:{
    Origin:"https://returnops.local", "Content-Type":"application/json", "Idempotency-Key":key,
    ...(identity ? {"oai-authenticated-user-id":"judge", "oai-authenticated-user-email":"judge@example.test"} : {}),
  },body:JSON.stringify(body)});
}
function post(path:string,key:string,body:unknown) {
 return new Request(`https://returnops.local${path}`,{method:"POST",headers:reset(key).headers,body:JSON.stringify(body)});
}
const runner: AgentRunner = async()=>({reply:"SIMULATED: test reply",providerResponseId:"test-response",model:"test-model",executionMode:"TEST",toolFacts:[]});
async function database() {
  const runtime = new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",d1Databases:{DB:`reset-${crypto.randomUUID()}`}});
  try {
    const db = await runtime.getD1Database("DB");
    const sql = await readFile(new URL("../drizzle/0001_returnops.sql",import.meta.url),"utf8");
    for(const s of sql.trim().match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;/g)??[])await db.prepare(s.trim()).run();
    await seedDemo(db);return{db,runtime};
  }catch(error){await runtime.dispose();throw error;}
}
test("reset requires signed-in shared mode and exact confirmation",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 assert.equal((await handleApi(reset("anonymous",undefined,false),db,config)).status,401);
 assert.equal((await handleApi(reset("disabled"),db,{...config,RETURNOPS_SIGNED_IN_DEMO:"false",OWNER_USER_IDS:"judge"})).status,404);
 assert.equal((await handleApi(reset("invalid",{confirm:"wrong"}),db,config)).status,400);
 assert.equal((await handleApi(reset("extra",{confirm:"reset-shared-demo",reset:true}),db,config)).status,400);
 const noOrigin=reset("no-origin");const originHeaders=new Headers(noOrigin.headers);originHeaders.delete("Origin");
 assert.equal((await handleApi(new Request(noOrigin,{headers:originHeaders}),db,config)).status,403);
 const noKey=reset("no-key");const keyHeaders=new Headers(noKey.headers);keyHeaders.delete("Idempotency-Key");
 assert.equal((await handleApi(new Request(noKey,{headers:keyHeaders}),db,config)).status,400);
 assert.equal((await db.prepare("SELECT count(*) n FROM cases").first<{n:number}>())?.n,0);
});
test("reset creates five fresh unevaluated cases, refreshes dates and replays without deleting progress",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 await db.prepare("UPDATE shop_policy SET active_rules_version=7").run();
 await db.prepare("UPDATE orders SET delivered_at=1").run();
 assert.equal((await handleApi(reset("first"),db,config)).status,200);
 const first=await db.prepare("SELECT id,status,pending_evaluation_operation_id FROM cases ORDER BY order_id").all<{id:string;status:string;pending_evaluation_operation_id:string|null}>();
 assert.equal(first.results.length,5);assert.ok(first.results.every(x=>x.status==="NEW"&&x.pending_evaluation_operation_id===null));
 assert.equal((await db.prepare("SELECT active_rules_version v FROM shop_policy").first<{v:number}>())?.v,1);
 assert.ok((await db.prepare("SELECT min(delivered_at) n FROM orders").first<{n:number}>())!.n>Math.floor(Date.now()/1000)-172800);
 await db.prepare("UPDATE cases SET claim='keep this progress' WHERE id=?").bind(first.results[0].id).run();
 assert.equal((await handleApi(reset("first"),db,config)).status,200);
 assert.equal((await db.prepare("SELECT claim FROM cases WHERE id=?").bind(first.results[0].id).first<{claim:string}>())?.claim,"keep this progress");
 assert.equal((await handleApi(reset("second"),db,config)).status,200);
 const second=await db.prepare("SELECT id FROM cases").all<{id:string}>();
 assert.ok(second.results.every(x=>!first.results.some(y=>y.id===x.id)));
 assert.equal((await handleApi(reset("first"),db,config)).status,200);
 assert.deepEqual((await db.prepare("SELECT id FROM cases").all()).results,second.results);
 assert.equal((await db.prepare("SELECT count(*) n FROM receipts").first<{n:number}>())?.n,0);
});
test("reset refuses a non-demo database atomically",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 await db.prepare("INSERT INTO shop_policy(shop_id) VALUES('other-shop')").run();
 assert.equal((await handleApi(reset("wrong-db"),db,config)).status,409);
 assert.equal((await db.prepare("SELECT count(*) n FROM shop_policy").first<{n:number}>())?.n,2);
 assert.equal((await db.prepare("SELECT count(*) n FROM orders").first<{n:number}>())?.n,5);
});
test("reset removes completed history and learned rules in foreign-key order",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 await handleApi(reset("prepare"),db,config);
 const c=await db.prepare("SELECT id,case_version FROM cases WHERE order_id='demo-a'").first<{id:string;case_version:number}>();
 const evaluated=await handleApi(post(`/api/cases/${c!.id}/evaluate`,"eval",{expectedCaseVersion:c!.case_version,expectedActiveRulesVersion:1}),db,config,runner);
 assert.equal(evaluated.status,202);
 assert.equal((await db.prepare("SELECT count(*) n FROM receipts").first<{n:number}>())?.n,1);
 await db.prepare("INSERT INTO rules(id,shop_id,version,source_case_id,decision,reason_group,item_condition) VALUES('learned','demo-shop',2,?,'RETURN_THEN_REFUND','FIT_ISSUE','UNUSED_TAGS_INTACT')").bind(c!.id).run();
 await db.prepare("INSERT INTO rule_suggestions(id,shop_id,source_case_id,source_snapshot,status,reason_group,item_condition,owner_reason,rule_id) VALUES('suggestion','demo-shop',?,'{}','ACCEPTED','FIT_ISSUE','UNUSED_TAGS_INTACT','test','learned')").bind(c!.id).run();
 assert.equal((await handleApi(reset("clear-history"),db,config)).status,200);
 for(const table of ["receipts","events","rule_suggestions"])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table}`).first<{n:number}>())?.n,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM rules").first<{n:number}>())?.n,2);
 assert.equal((await db.prepare("SELECT count(*) n FROM operations WHERE kind='EVALUATION'").first<{n:number}>())?.n,0);
});
test("an evaluation already in flight cannot write into a reset run",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 await handleApi(reset("prepare"),db,config);
 const c=await db.prepare("SELECT id FROM cases WHERE order_id='demo-a'").first<{id:string}>();
 let started!:()=>void,release!:()=>void;
 const ready=new Promise<void>(resolve=>{started=resolve;});
 const wait=new Promise<void>(resolve=>{release=resolve;});
 const delayed:AgentRunner=async(ctx,cfg)=>{started();await wait;return runner(ctx,cfg);};
 const pending=handleApi(post(`/api/cases/${c!.id}/evaluate`,"in-flight",{expectedCaseVersion:1,expectedActiveRulesVersion:1}),db,config,delayed);
 await Promise.race([ready,pending.then(r=>{throw new Error(`Evaluation ended before runner: ${r.status}`);})]);
 try{assert.equal((await handleApi(reset("interrupt"),db,config)).status,200);}finally{release();}
 await pending;
 assert.equal((await db.prepare("SELECT count(*) n FROM receipts").first<{n:number}>())?.n,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM cases WHERE status='NEW'").first<{n:number}>())?.n,5);
 assert.equal(await db.prepare("SELECT id FROM cases WHERE id=?").bind(c!.id).first(),null);
});
test("concurrent identical reset requests commit one reset acknowledgement",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 const responses=await Promise.all([handleApi(reset("same"),db,config),handleApi(reset("same"),db,config)]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert.equal((await db.prepare("SELECT count(*) n FROM operations WHERE action='demo-reset'").first<{n:number}>())?.n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM cases").first<{n:number}>())?.n,5);
});
test("a failed seed rolls the entire destructive reset back",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 await handleApi(reset("before-failure"),db,config);
 await db.prepare("UPDATE shop_policy SET active_rules_version=7").run();
 const previous=(await db.prepare("SELECT id FROM cases ORDER BY id").all()).results;
 await db.prepare("CREATE TRIGGER fail_reset_seed BEFORE INSERT ON orders WHEN NEW.id='demo-c' BEGIN SELECT RAISE(ABORT,'test failure'); END;").run();
 assert.equal((await handleApi(reset("failed"),db,config)).status,500);
 assert.deepEqual((await db.prepare("SELECT id FROM cases ORDER BY id").all()).results,previous);
 assert.equal((await db.prepare("SELECT active_rules_version v FROM shop_policy").first<{v:number}>())?.v,7);
 assert.equal((await db.prepare("SELECT count(*) n FROM orders").first<{n:number}>())?.n,5);
 assert.equal((await db.prepare("SELECT count(*) n FROM operations WHERE action='demo-reset'").first<{n:number}>())?.n,1);
});
test("concurrent different reset intents cannot erase the winning fresh run",async(t)=>{
 const {db,runtime}=await database();t.after(()=>runtime.dispose());
 let reads=0,release!:()=>void;
 const bothRead=new Promise<void>(resolve=>{release=resolve;});
 // Synchronize only the timing of real D1 reads; all SQL still executes on D1.
 const gated=new Proxy(db,{get(target,property){
   if(property==='prepare')return(sql:string)=>{
     const statement=target.prepare(sql);
     if(sql.startsWith('SELECT count(*) n,min(shop_id)'))return new Proxy(statement,{get(s,key){
       if(key==='first')return async()=>{const row=await s.first();if(++reads===2)release();await bothRead;return row;};
       const value=Reflect.get(s,key);return typeof value==='function'?value.bind(s):value;
     }});
     return statement;
   };
   const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const results=await Promise.all([handleApi(reset('concurrent-a'),gated,config),handleApi(reset('concurrent-b'),gated,config)]);
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await db.prepare("SELECT count(*) n FROM operations WHERE action='demo-reset'").first<{n:number}>())?.n,1);
 assert.equal((await db.prepare("SELECT count(*) n FROM cases").first<{n:number}>())?.n,5);
});
