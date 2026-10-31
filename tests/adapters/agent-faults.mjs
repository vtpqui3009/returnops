// Exercise the backend's real runAgent validation. Only the Responses transport is synthetic.
export async function runFault(mode, context, runAgent) {
  const config = { OPENAI_API_KEY: 'synthetic-test-value', OPENAI_MODEL: 'local-fault-probe' };
  const call = (name, args, id = 'call-1') => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
  const output = items => Response.json({ id: 'test-fault-response', status: 'completed', output: items });
  let transport;
  switch (mode) {
    case 'missing-key':
      delete config.OPENAI_API_KEY;
      transport = async () => { throw new Error('Unexpected transport call without provider configuration'); };
      break;
    case 'provider-error':
      transport = async () => new Response('synthetic-private-provider-body', { status: 503 });
      break;
    case 'timeout':
      config.AGENT_TIMEOUT_MS = '25';
      transport = async (_url, init) => new Promise((_, reject) => {
        const abort = () => reject(new Error('Synthetic timeout'));
        if (init.signal.aborted) abort(); else init.signal.addEventListener('abort', abort, { once: true });
      });
      break;
    case 'tool-budget':
      config.AGENT_MAX_TOOL_STEPS = '1';
      transport = async () => output([call('check_policy', {}), call('read_order', {}, 'call-2')]);
      break;
    case 'round-budget':
      config.AGENT_MAX_MODEL_ROUNDS = '1';
      transport = async () => output([call('check_policy', {})]);
      break;
    case 'refusal':
      transport = async () => output([{ type: 'message', content: [{ type: 'refusal', text: 'Synthetic refusal' }] }]);
      break;
    case 'invalid-args':
      transport = async () => output([call('draft_reply', { text: 'Test', overrideHardCap: true })]);
      break;
    case 'unauthorized-tool':
      transport = async () => output([call('approve_rule', { decision: 'REFUND_NOW' })]);
      break;
    default:
      throw new Error('Unknown TEST provider fault mode');
  }
  // A transport is supplied on every path, including missing-key. No real provider request occurs.
  const result = await runAgent(context, config, transport);
  return { ...result, executionMode: 'TEST' };
}
