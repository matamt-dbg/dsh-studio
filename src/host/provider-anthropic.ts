/** Independent Anthropic Messages codec. Transport, credentials and identity belong to the adapter. */
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, FinishReason, GenerateOptions, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';

type Json = Record<string, unknown>;
const malformed = (detail: string): never => { throw new LlmError(`Anthropic stream: ${detail}`, 'MALFORMED_RESPONSE'); };
const object = (value: unknown): Json => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Json : malformed('expected an object');
const text = (value: unknown): string => typeof value === 'string' ? value : malformed('expected text');
const textOf = (blocks: readonly ContentBlock[]) => blocks.flatMap(block => block.type === 'text' ? [block.text] : []).join('');
const replayFormat = 'studio-anthropic-messages-v1';

function toolInput(value: string): Json {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return malformed('invalid tool input JSON'); }
  return object(parsed);
}

/** Leading system messages join the system prompt; later instructions retain their history position. */
export function anthropicRequestBody(options: GenerateOptions, maxTokens: number | undefined): Json {
  const system = options.system ? [options.system] : [];
  const messages: { role: 'user' | 'assistant'; content: Json[] }[] = [];
  let leading = true;
  const append = (role: 'user' | 'assistant', content: Json[]) => {
    if (!content.length) return;
    const previous = messages.at(-1);
    if (previous?.role === role) previous.content.push(...content);
    else messages.push({ role, content });
  };
  for (const message of options.messages) {
    if (leading && message.role === 'system') {
      const value = textOf(message.content);
      if (value) system.push(value);
      continue;
    }
    leading = false;
    if (message.role === 'tool') {
      append('user', [{ type: 'tool_result', tool_use_id: message.toolCallId, content: textOf(message.content) || '(no output)', ...(message.isError ? { is_error: true } : {}) }]);
    } else if (message.role === 'assistant') {
      const replay = message.source.replayState;
      const envelope = replay !== null && typeof replay === 'object' ? replay as Json : {};
      const saved = envelope.response === replayFormat && Array.isArray(envelope.blocks) ? envelope.blocks : [];
      const content: Json[] = [];
      for (const [index, block] of message.content.entries()) {
        if (block.type === 'text' && block.text) content.push({ type: 'text', text: block.text });
        else if (block.type === 'tool-call') content.push({ type: 'tool_use', id: block.id, name: block.name, input: toolInput(block.arguments) });
        else if (block.type === 'reasoning') {
          const raw = saved[index] as Json | undefined;
          // Never invent signatures, or replay signed thinking after its visible text was edited.
          if (raw?.type === 'thinking' && raw.thinking === block.text && typeof raw.signature === 'string' && raw.signature) content.push({ type: 'thinking', thinking: block.text, signature: raw.signature });
          else if (raw?.type === 'redacted_thinking' && block.text === '' && typeof raw.data === 'string') content.push({ type: 'redacted_thinking', data: raw.data });
        }
      }
      append('assistant', content);
    } else {
      const value = textOf(message.content);
      if (value) append('user', [{ type: 'text', text: value }]);
    }
  }
  const limit = maxTokens ?? options.maxTokens ?? 4096;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new LlmError('Anthropic max_tokens must be a positive integer', 'INVALID_CONFIG');
  const tools = (options.tools ?? []).filter(tool => !tool.deferLoading);
  return {
    model: options.model, stream: true, max_tokens: limit, messages,
    ...(system.length ? { system: system.join('\n\n') } : {}),
    ...(tools.length ? { tools: tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.stop?.length ? { stop_sequences: options.stop } : {}),
  };
}

function finishReason(value: unknown): FinishReason {
  if (value === 'tool_use') return { kind: 'tool-calls' };
  if (value === 'max_tokens' || value === 'model_context_window_exceeded') return { kind: 'max-tokens' };
  if (value === 'end_turn' || value === 'stop_sequence' || value === 'pause_turn' || value === 'refusal') return { kind: 'stop' };
  return malformed(`unknown stop reason: ${String(value)}`);
}

function updateUsage(usage: TokenUsage, value: unknown): void {
  if (value === undefined) return;
  const raw = object(value);
  for (const [wire, key] of [['input_tokens', 'inputTokens'], ['output_tokens', 'outputTokens'], ['cache_read_input_tokens', 'cacheReadTokens'], ['cache_creation_input_tokens', 'cacheWriteTokens']] as const) {
    if (raw[wire] === undefined) continue;
    const count = raw[wire];
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) malformed('invalid token usage');
    usage[key] = count as number;
  }
}

type Entry = { block: ContentBlock; raw: Json; closed: boolean; partial: string; hasPartial: boolean };

/** Consume SSE data payloads (not event lines), preserving signed thinking in the public replay envelope. */
export async function* translateAnthropic(data: AsyncIterable<string | Json>): AsyncGenerator<StreamChunk> {
  const entries = new Map<number, Entry>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  let started = false;
  let reason: FinishReason | undefined;
  for await (const payload of data) {
    let parsed: unknown;
    try { parsed = typeof payload === 'string' ? JSON.parse(payload) : payload; } catch { malformed('invalid event JSON'); }
    const event = object(parsed);
    if (event.type === 'ping') continue;
    if (event.type === 'error') {
      const error = object(event.error);
      const code = error.type === 'rate_limit_error' ? 'RATE_LIMIT' : error.type === 'authentication_error' ? 'AUTH_FAILED' : error.type === 'overloaded_error' ? 'OVERLOADED' : 'PROVIDER_ERROR';
      throw new LlmError(`Anthropic: ${String(error.message ?? 'request failed')}`, code);
    }
    if (event.type === 'message_start') {
      if (started) malformed('duplicate message_start');
      started = true;
      updateUsage(usage, object(event.message).usage);
    } else if (event.type === 'content_block_start') {
      if (!started || reason) malformed('content outside message');
      const index = event.index;
      if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index !== entries.size) malformed('invalid block index');
      const raw = { ...object(event.content_block) };
      let block: ContentBlock;
      if (raw.type === 'text') block = { type: 'text', text: text(raw.text) };
      else if (raw.type === 'thinking') block = { type: 'reasoning', text: text(raw.thinking) };
      else if (raw.type === 'redacted_thinking') { text(raw.data); block = { type: 'reasoning', text: '' }; }
      else if (raw.type === 'tool_use') {
        const id = text(raw.id), name = text(raw.name);
        if (!id || !name) malformed('tool call without identity');
        block = { type: 'tool-call', id: ToolCallId(id), name, arguments: JSON.stringify(object(raw.input)) };
      } else return malformed(`unsupported block type: ${String(raw.type)}`);
      entries.set(index as number, { block, raw, closed: false, partial: '', hasPartial: false });
      yield { type: 'block-start', index: index as number, blockType: block.type };
      if (block.type === 'text' || block.type === 'reasoning') {
        if (block.text) yield { type: block.type === 'text' ? 'text-delta' : 'reasoning-delta', index: index as number, text: block.text };
      } else if (block.type === 'tool-call') yield { type: 'tool-call-delta', index: index as number, id: block.id, name: block.name, argumentsDelta: '' };
    } else if (event.type === 'content_block_delta' || event.type === 'content_block_stop') {
      const index = event.index as number;
      const entry = entries.get(index);
      if (!entry || entry.closed || reason) malformed('delta/stop without an open block');
      const current = entry!;
      const block = current.block;
      if (event.type === 'content_block_stop') {
        if (block.type === 'tool-call' && current.hasPartial) {
          toolInput(current.partial);
          block.arguments = current.partial;
        }
        current.closed = true;
        yield { type: 'block-end', index, block };
        continue;
      }
      const delta = object(event.delta);
      if (delta.type === 'text_delta' && block.type === 'text') {
        const value = text(delta.text);
        block.text += value;
        yield { type: 'text-delta', index, text: value };
      } else if (delta.type === 'thinking_delta' && block.type === 'reasoning' && current.raw.type === 'thinking') {
        const value = text(delta.thinking);
        block.text += value;
        current.raw.thinking = block.text;
        yield { type: 'reasoning-delta', index, text: value };
      } else if (delta.type === 'signature_delta' && current.raw.type === 'thinking') {
        current.raw.signature = String(current.raw.signature ?? '') + text(delta.signature);
      } else if (delta.type === 'input_json_delta' && block.type === 'tool-call') {
        const value = text(delta.partial_json);
        current.hasPartial = true;
        current.partial += value;
        yield { type: 'tool-call-delta', index, id: block.id, argumentsDelta: value };
      } else malformed(`unsupported or mismatched delta: ${String(delta.type)}`);
    } else if (event.type === 'message_delta') {
      if (!started) malformed('message_delta before message_start');
      const delta = object(event.delta);
      if (delta.stop_reason != null) reason = finishReason(delta.stop_reason);
      updateUsage(usage, event.usage);
    } else if (event.type === 'message_stop') {
      if (!started || !reason || [...entries.values()].some(entry => !entry.closed)) return malformed('incomplete message_stop');
      if (!entries.size && reason.kind === 'stop') throw new LlmError('Anthropic returned no content', 'EMPTY_RESPONSE');
      // Anthropic input_tokens excludes cached input; DSH inputTokens includes all input.
      usage.inputTokens += (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      usage.totalTokens = usage.inputTokens + usage.outputTokens;
      yield { type: 'usage', usage };
      yield { type: 'finish', reason, replayState: { response: replayFormat, blocks: [...entries.values()].map(entry => entry.raw.type === 'thinking' || entry.raw.type === 'redacted_thinking' ? entry.raw : null) } };
      return;
    }
    // Unknown top-level events are explicitly forward-compatible in the Messages protocol.
  }
  throw new LlmError('Anthropic stream ended before message_stop', 'STREAM_CLOSED');
}
