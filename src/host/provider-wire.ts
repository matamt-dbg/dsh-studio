/** Request bodies and SSE stream translation for SettingsX provider protocols. Pure: no network, no Cordis.
 * The adapter (provider-adapter.ts) owns fetch, headers, and cancellation; tests drive these with fixed frames.
 */
import { LlmError, ToolCallId } from '@deepseek-ai/dsh-llm';
import type { ContentBlock, FinishReason, GenerateOptions, RequestMessage, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm';
import type { ProviderProtocol } from '../provider-contract.ts';

type Json = Record<string, unknown>;
const malformed = (detail: string): never => { throw new LlmError(`Provider stream: ${detail}`, 'MALFORMED_RESPONSE'); };
const object = (value: unknown): Json => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : malformed('expected an object');
const textOf = (content: readonly ContentBlock[]) => content.flatMap(block => block.type === 'text' ? [block.text] : []).join('');

/** Leading system messages become the instructions; later system and developer text stays at its position. */
function instructions(options: GenerateOptions): { system: string; rest: RequestMessage[] } {
  const parts = options.system ? [options.system] : [];
  let start = 0;
  for (const message of options.messages) {
    if (message.role !== 'system') break;
    const text = textOf(message.content);
    if (text) parts.push(text);
    start++;
  }
  return { system: parts.join('\n\n'), rest: options.messages.slice(start) };
}

const tools = (options: GenerateOptions) => (options.tools ?? []).filter(tool => !tool.deferLoading);

/** Build one OpenAI Responses (`/responses`) streaming body. Stateless: `store: false`, full history every call. */
export function responsesBody(options: GenerateOptions, maxTokens: number | undefined): Json {
  const { system, rest } = instructions(options);
  const input: Json[] = [];
  for (const message of rest) {
    if (message.role === 'system' || message.role === 'developer') { const text = textOf(message.content); if (text) input.push({ role: 'developer', content: [{ type: 'input_text', text }] }); }
    else if (message.role === 'user') { const text = textOf(message.content); if (text) input.push({ role: 'user', content: [{ type: 'input_text', text }] }); }
    else if (message.role === 'assistant') {
      const text = textOf(message.content);
      if (text) input.push({ role: 'assistant', content: [{ type: 'output_text', text }] });
      for (const block of message.content) if (block.type === 'tool-call') input.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: block.arguments });
    } else if (message.role === 'tool') input.push({ type: 'function_call_output', call_id: message.toolCallId, output: textOf(message.content) || '(no output)' });
  }
  const declared = tools(options);
  return {
    // Some Responses servers (ChatGPT's Codex backend) require instructions; an empty string satisfies the rest.
    model: options.model, stream: true, store: false, input, instructions: system,
    ...(declared.length ? { tools: declared.map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters })) } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
    ...(maxTokens ? { max_output_tokens: maxTokens } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
  };
}

/** Build one OpenAI Chat Completions (`/chat/completions`) streaming body. */
export function chatBody(options: GenerateOptions, maxTokens: number | undefined): Json {
  const { system, rest } = instructions(options);
  const messages: Json[] = system ? [{ role: 'system', content: system }] : [];
  for (const message of rest) {
    if (message.role === 'system' || message.role === 'developer') { const text = textOf(message.content); if (text) messages.push({ role: 'system', content: text }); }
    else if (message.role === 'user') messages.push({ role: 'user', content: textOf(message.content) });
    else if (message.role === 'assistant') {
      const calls = message.content.flatMap(block => block.type === 'tool-call' ? [{ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } }] : []);
      messages.push({ role: 'assistant', content: textOf(message.content) || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (message.role === 'tool') messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: textOf(message.content) || '(no output)' });
  }
  const declared = tools(options);
  return {
    model: options.model, stream: true, stream_options: { include_usage: true }, messages,
    ...(declared.length ? { tools: declared.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })) } : {}),
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    ...(options.stop?.length ? { stop: options.stop } : {}),
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
  };
}

export function requestBody(protocol: ProviderProtocol, options: GenerateOptions, maxTokens: number | undefined): Json {
  return protocol === 'openai-responses' ? responsesBody(options, maxTokens) : chatBody(options, maxTokens);
}

/** Split an SSE byte stream into `data:` payloads. `[DONE]` ends the stream. */
export async function* sseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<Json> {
  const decoder = new TextDecoder();
  let buffer = '';
  const frames = function* (final: boolean) {
    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = final ? '' : parts.pop() ?? '';
    for (const frame of parts) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield data;
    }
  };
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    for (const data of frames(false)) {
      if (data === '[DONE]') return;
      try { yield object(JSON.parse(data)); } catch (error) { if (error instanceof LlmError) throw error; malformed('invalid JSON'); }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) buffer += '\n\n';
  for (const data of frames(true)) {
    if (data === '[DONE]') return;
    try { yield object(JSON.parse(data)); } catch (error) { if (error instanceof LlmError) throw error; malformed('invalid JSON'); }
  }
}

/** Ordered blocks keyed by the provider's identity; emits the harness chunk protocol. */
class Blocks {
  private open = new Map<string, { index: number; block: ContentBlock }>();
  private count = 0;
  hasContent = false;
  start(key: string, block: ContentBlock): { index: number; chunks: StreamChunk[] } {
    const index = this.count++;
    this.open.set(key, { index, block });
    if (block.type !== 'reasoning') this.hasContent = true;
    const chunks: StreamChunk[] = [{ type: 'block-start', index, blockType: block.type }];
    if (block.type === 'tool-call') chunks.push({ type: 'tool-call-delta', index, id: block.id, name: block.name, argumentsDelta: '' });
    return { index, chunks };
  }
  get(key: string) { return this.open.get(key); }
  end(key: string): StreamChunk[] {
    const entry = this.open.get(key);
    if (!entry) return [];
    this.open.delete(key);
    return [{ type: 'block-end', index: entry.index, block: { ...entry.block } }];
  }
  /** Close every open block whose key starts with `prefix`, in opening order. */
  endWhere(match: (key: string) => boolean): StreamChunk[] { return [...this.open.entries()].filter(([key]) => match(key)).sort((a, b) => a[1].index - b[1].index).flatMap(([key]) => this.end(key)); }
  endAll(): StreamChunk[] { return this.endWhere(() => true); }
}

const count = (value: unknown): number | undefined => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;

function usageOf(raw: unknown, input: string, output: string, cachedPath: [string, string], reasoningPath: [string, string]): TokenUsage | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const fields = raw as Json;
  const prompt = count(fields[input]) ?? 0;
  const completion = count(fields[output]) ?? 0;
  const cached = count((fields[cachedPath[0]] as Json | undefined)?.[cachedPath[1]]) ?? 0;
  const reasoning = count((fields[reasoningPath[0]] as Json | undefined)?.[reasoningPath[1]]);
  // Harness counts are disjoint: OpenAI folds cached tokens into the prompt total.
  return { inputTokens: Math.max(0, prompt - cached), outputTokens: completion, totalTokens: prompt + completion,
    ...(cached ? { cacheReadTokens: cached } : {}), ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }) };
}

/** Translate an OpenAI Responses event stream. Text and reasoning stream as deltas; function calls stream their arguments. */
export async function* translateResponses(events: AsyncIterable<Json>): AsyncGenerator<StreamChunk> {
  const blocks = new Blocks();
  let usage: TokenUsage | undefined;
  let reason: FinishReason | undefined;
  for await (const event of events) {
    const type = event.type;
    if (type === 'response.output_item.added') {
      const item = object(event.item);
      const key = String(event.output_index);
      if (item.type === 'function_call') {
        if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || !item.call_id || !item.name) malformed('function call without identity');
        yield* blocks.start(key, { type: 'tool-call', id: ToolCallId(item.call_id as string), name: item.name as string, arguments: '' }).chunks;
      }
    } else if (type === 'response.output_text.delta' || type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') {
      const kind = type === 'response.output_text.delta' ? 'text' : 'reasoning';
      const key = `${kind}:${String(event.output_index)}:${String(event.content_index ?? event.summary_index ?? 0)}`;
      const delta = typeof event.delta === 'string' ? event.delta : malformed('delta is not text');
      let entry = blocks.get(key);
      if (!entry) { yield* blocks.start(key, { type: kind, text: '' }).chunks; entry = blocks.get(key)!; }
      (entry.block as { text: string }).text += delta;
      yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: entry.index, text: delta };
    } else if (type === 'response.function_call_arguments.delta') {
      const entry = blocks.get(String(event.output_index));
      if (!entry || entry.block.type !== 'tool-call') malformed('arguments without a function call');
      const delta = typeof event.delta === 'string' ? event.delta : malformed('arguments delta is not text');
      entry!.block = { ...entry!.block, arguments: (entry!.block as { arguments: string }).arguments + delta } as ContentBlock;
      yield { type: 'tool-call-delta', index: entry!.index, id: (entry!.block as { id: ToolCallId }).id, argumentsDelta: delta };
    } else if (type === 'response.output_item.done') {
      const key = String(event.output_index);
      const item = object(event.item);
      const entry = blocks.get(key);
      if (entry && entry.block.type === 'tool-call' && typeof item.arguments === 'string') entry.block = { ...entry.block, arguments: item.arguments };
      yield* blocks.end(key);
      // Text and reasoning parts close with their item.
      yield* blocks.endWhere(open => open.startsWith('text:' + key + ':') || open.startsWith('reasoning:' + key + ':'));
    } else if (type === 'response.completed' || type === 'response.incomplete') {
      const response = object(event.response);
      usage = usageOf(response.usage, 'input_tokens', 'output_tokens', ['input_tokens_details', 'cached_tokens'], ['output_tokens_details', 'reasoning_tokens']);
      const incomplete = type === 'response.incomplete' && (response.incomplete_details as Json | undefined)?.reason === 'max_output_tokens';
      reason = incomplete ? { kind: 'max-tokens' } : (response.output as Json[] | undefined)?.some(item => item?.type === 'function_call') ? { kind: 'tool-calls' } : { kind: 'stop' };
      break;
    } else if (type === 'response.failed' || type === 'error') {
      const error = object(type === 'error' ? event : object(event.response).error ?? {});
      throw new LlmError(`Provider error: ${String(error.message ?? 'request failed')}`, String(error.code ?? '') === 'rate_limit_exceeded' ? 'RATE_LIMIT' : 'PROVIDER_ERROR');
    }
  }
  if (!reason) throw new LlmError('Provider stream ended before response.completed', 'STREAM_CLOSED');
  yield* blocks.endAll();
  if (!blocks.hasContent && reason.kind === 'stop') throw new LlmError('Provider returned no content', 'EMPTY_RESPONSE');
  yield { type: 'usage', usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
  yield { type: 'finish', reason };
}

/** Translate an OpenAI Chat Completions event stream. */
export async function* translateChat(events: AsyncIterable<Json>): AsyncGenerator<StreamChunk> {
  const blocks = new Blocks();
  let usage: TokenUsage | undefined;
  let finish: string | undefined;
  for await (const event of events) {
    if (event.error) { const error = object(event.error); throw new LlmError(`Provider error: ${String(error.message ?? 'request failed')}`, 'PROVIDER_ERROR'); }
    if (event.usage) usage = usageOf(event.usage, 'prompt_tokens', 'completion_tokens', ['prompt_tokens_details', 'cached_tokens'], ['completion_tokens_details', 'reasoning_tokens']);
    for (const raw of Array.isArray(event.choices) ? event.choices : []) {
      const choice = object(raw);
      if (choice.index !== undefined && choice.index !== 0) continue;
      const delta = choice.delta === undefined || choice.delta === null ? {} : object(choice.delta);
      for (const [field, kind] of [['reasoning_content', 'reasoning'], ['reasoning', 'reasoning'], ['content', 'text']] as const) {
        const value = delta[field];
        if (typeof value !== 'string' || !value) continue;
        // A text part closes any open reasoning part, matching provider order.
        if (kind === 'text') yield* blocks.end('reasoning');
        let entry = blocks.get(kind);
        if (!entry) { yield* blocks.start(kind, { type: kind, text: '' }).chunks; entry = blocks.get(kind)!; }
        (entry.block as { text: string }).text += value;
        yield { type: kind === 'text' ? 'text-delta' : 'reasoning-delta', index: entry.index, text: value };
      }
      for (const rawCall of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const call = object(rawCall);
        const key = `tool:${String(call.index ?? 0)}`;
        const fn = call.function === undefined ? {} : object(call.function);
        let entry = blocks.get(key);
        if (!entry) {
          if (typeof call.id !== 'string' || typeof fn.name !== 'string' || !call.id || !fn.name) malformed('tool call without identity');
          yield* blocks.end('text'); yield* blocks.end('reasoning');
          yield* blocks.start(key, { type: 'tool-call', id: ToolCallId(call.id as string), name: fn.name as string, arguments: '' }).chunks;
          entry = blocks.get(key)!;
        }
        if (typeof fn.arguments === 'string' && fn.arguments) {
          entry.block = { ...entry.block, arguments: (entry.block as { arguments: string }).arguments + fn.arguments } as ContentBlock;
          yield { type: 'tool-call-delta', index: entry.index, id: (entry.block as { id: ToolCallId }).id, argumentsDelta: fn.arguments };
        }
      }
      if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
    }
  }
  if (finish === undefined) throw new LlmError('Provider stream ended without a finish reason', 'STREAM_CLOSED');
  yield* blocks.endAll();
  const reason: FinishReason = finish === 'length' ? { kind: 'max-tokens' } : finish === 'tool_calls' ? { kind: 'tool-calls' } : { kind: 'stop' };
  if (!blocks.hasContent && reason.kind === 'stop') throw new LlmError('Provider returned no content', 'EMPTY_RESPONSE');
  yield { type: 'usage', usage: usage ?? { inputTokens: 0, outputTokens: 0 } };
  yield { type: 'finish', reason };
}

export function translate(protocol: ProviderProtocol, events: AsyncIterable<Json>): AsyncGenerator<StreamChunk> {
  return protocol === 'openai-responses' ? translateResponses(events) : translateChat(events);
}
