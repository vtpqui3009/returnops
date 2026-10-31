declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    AGENT_MAX_TOOL_STEPS?: string;
    AGENT_MAX_MODEL_ROUNDS?: string;
    AGENT_TIMEOUT_MS?: string;
    SITES_IDENTITY_VERIFIED?: string;
    OWNER_USER_IDS?: string;
    MEMBER_USER_IDS?: string;
  }
}
