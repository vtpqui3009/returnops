import { env } from "cloudflare:workers";
import { signedInIdentity } from "@/src/server/hosted-setup";

export function GET(request: Request) {
  return signedInIdentity(request, env);
}
