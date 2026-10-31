import ReturnOpsApp from "../src/features/returnops/returnops-app";
import { env } from "cloudflare:workers";
import { requireChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const mode = (env as Cloudflare.Env & { RETURNOPS_UI_MODE?: string }).RETURNOPS_UI_MODE;
  const sharedDemo = env.RETURNOPS_SIGNED_IN_DEMO === "true";
  if (mode === "api" && sharedDemo) await requireChatGPTUser("/");
  return <ReturnOpsApp testMode={mode !== "api"} sharedDemo={sharedDemo} />;
}
