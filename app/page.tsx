import ReturnOpsApp from "../src/features/returnops/returnops-app";
import { env } from "cloudflare:workers";

export default function Home() {
  // This review branch intentionally opens on labelled synthetic data, not unavailable backend routes.
  const mode = (env as Cloudflare.Env & { RETURNOPS_UI_MODE?: string }).RETURNOPS_UI_MODE;
  return <ReturnOpsApp testMode={mode !== "api"} />;
}
