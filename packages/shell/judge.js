// src/host/judge-tool.ts
import { dirname as dirname3, join as join3 } from "node:path";

// src/pixie-contracts.ts
var DEFAULT_PIXIE_SETTINGS = {
  contextMode: "fresh",
  systemPrompt: "You are Pixie, a concise side assistant. Answer the user directly. You are not the session agent and cannot act on its workspace.",
  allowThreadModel: true
};
var DEFAULT_JUDGE_SYSTEM_PROMPT = [
  "You are a judgment component. Evaluate the given state against each question independently.",
  'Reply with exactly one JSON object and nothing else: {"answers": {<question id>: <answer>}}.',
  "Each question has instructions (what to decide) and criteria: choice criteria map option names to descriptions; score criteria list ordered level descriptions; noul criteria optionally describe what true and false mean.",
  'choice answer: {"choice": <option name>, "probabilities": {<every option name>: number}} \u2014 probabilities sum to 1.',
  'score answer: {"score": number from 0 to levels-1 (fractional allowed), "probabilities": [one number per level, in order]} \u2014 probabilities sum to 1.',
  'noul answer: {"noul": probability from 0 to 1 that the answer is yes}.'
].join("\n");
var JudgeValidationError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
function validateJudgeRequest(value) {
  if (!value || typeof value !== "object") throw new Error("Judge request must be an object");
  const { state, questions } = value;
  if (state === void 0) throw new Error("Judge request needs a state");
  if (!questions || typeof questions !== "object" || Array.isArray(questions)) throw new Error("Judge request needs questions by id");
  const entries = Object.entries(questions);
  if (entries.length === 0) throw new JudgeValidationError("questions", "Judge request needs at least one question");
  for (const [id, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id)) throw new JudgeValidationError("questionId", `Invalid judge question id: ${id}`);
    const question = raw;
    if (!question || typeof question !== "object" || Array.isArray(question)) throw new JudgeValidationError("questionType", `Question "${id}" must be choice, score, or noul`);
    if (!["choice", "score", "noul"].includes(question.type)) throw new JudgeValidationError("questionType", `Question "${id}" must be choice, score, or noul`);
    if (typeof question.instructions !== "string" || !question.instructions.trim()) throw new JudgeValidationError("instructions", `Question "${id}" needs instructions`);
    const criteria = question.criteria;
    if (question.type === "choice") {
      const names = criteria && typeof criteria === "object" && !Array.isArray(criteria) ? Object.keys(criteria) : [];
      if (names.length < 2 || names.length > 255 || names.some((name) => !name.trim() || typeof criteria[name] !== "string")) throw new JudgeValidationError("criteria", `Choice "${id}" needs 2\u2013255 named options with string descriptions`);
    } else if (question.type === "score") {
      if (!Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10 || criteria.some((item) => typeof item !== "string" || !item.trim())) throw new JudgeValidationError("criteria", `Score "${id}" needs 2\u201310 level descriptions`);
    } else if (criteria !== void 0 && (!criteria || typeof criteria !== "object" || Array.isArray(criteria) || Object.entries(criteria).some(([key, value2]) => !["true", "false"].includes(key) || typeof value2 !== "string"))) {
      throw new JudgeValidationError("criteria", `Invalid noul criteria: ${id}`);
    }
  }
  return { state, questions };
}

// src/host/pixie-runtime.ts
async function* untilAborted(stream, signal) {
  const iterator = stream[Symbol.asyncIterator]();
  let onAbort = () => {
  };
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason ?? new Error("aborted"));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  aborted.catch(() => {
  });
  try {
    while (true) {
      const next = await Promise.race([iterator.next(), aborted]);
      if (next.done) return;
      yield next.value;
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    void Promise.resolve(iterator.return?.()).catch(() => {
    });
  }
}

// src/host/pixie-judge.ts
var TOLERANCE = 0.02;
var isProbability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
var sumsToOne = (values) => Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) <= TOLERANCE;
function checkAnswer(id, question, raw) {
  const answer = raw;
  if (!answer || typeof answer !== "object") throw new Error(`Missing answer for "${id}"`);
  if (question.type === "choice") {
    const names = Object.keys(question.criteria);
    const probabilities = answer.probabilities;
    if (typeof answer.choice !== "string" || !names.includes(answer.choice)) throw new Error(`Answer "${id}" chose an unknown option`);
    if (!probabilities || names.some((name) => !isProbability(probabilities[name])) || Object.keys(probabilities).some((name) => !names.includes(name))) throw new Error(`Answer "${id}" needs a probability per option`);
    const values = names.map((name) => probabilities[name]);
    if (!sumsToOne(values)) throw new Error(`Answer "${id}" probabilities must sum to 1`);
    return { type: "choice", choice: answer.choice, probabilities: Object.fromEntries(names.map((name) => [name, probabilities[name]])), confidence: isProbability(answer.confidence) ? answer.confidence : Math.max(...values) };
  }
  if (question.type === "score") {
    const probabilities = answer.probabilities;
    const top = question.criteria.length - 1;
    if (typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 || answer.score > top) throw new Error(`Answer "${id}" score must be within 0..${top}`);
    if (!Array.isArray(probabilities) || probabilities.length !== question.criteria.length || !probabilities.every(isProbability) || !sumsToOne(probabilities)) throw new Error(`Answer "${id}" needs one probability per level summing to 1`);
    return { type: "score", score: answer.score, probabilities, confidence: isProbability(answer.confidence) ? answer.confidence : Math.max(...probabilities) };
  }
  if (!isProbability(answer.noul)) throw new Error(`Answer "${id}" noul must be a probability in 0..1`);
  return { type: "noul", noul: answer.noul };
}
function parseJudgeOutput(text, questions) {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  let parsed;
  try {
    parsed = JSON.parse(fenced ? fenced[1] : text.trim());
  } catch {
    throw new Error("Judge model did not return JSON");
  }
  const answers = parsed?.answers;
  if (!answers || typeof answers !== "object") throw new Error("Judge model output has no answers object");
  return Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, checkAnswer(id, question, answers[id])]));
}
var LlmJudgeEngine = class {
  constructor(llm, model, system = DEFAULT_JUDGE_SYSTEM_PROMPT) {
    this.llm = llm;
    this.model = model;
    this.system = system;
  }
  kind = "judge";
  label = "llm";
  async judge(request, signal) {
    let usage;
    try {
      const { state, questions } = validateJudgeRequest(request);
      const prompt = `State:
${typeof state === "string" ? state : JSON.stringify(state, null, 2)}

Questions:
${JSON.stringify(questions, null, 2)}`;
      let text = "";
      let finished = false;
      for await (const chunk of untilAborted(this.llm.stream({
        provider: this.model.provider,
        model: this.model.model,
        ...this.model.reasoningEffort ? { reasoningEffort: this.model.reasoningEffort } : {},
        ...this.model.maxTokens ? { maxTokens: this.model.maxTokens } : {},
        system: this.system,
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        signal
      }), signal)) {
        if (chunk.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
        if (chunk.type === "usage" && chunk.usage && typeof chunk.usage === "object") {
          const raw = chunk.usage;
          usage = { inputTokens: typeof raw.inputTokens === "number" ? raw.inputTokens : 0, outputTokens: typeof raw.outputTokens === "number" ? raw.outputTokens : 0 };
          for (const key of ["cacheReadTokens", "cacheWriteTokens", "reasoningTokens"]) if (typeof raw[key] === "number") usage[key] = raw[key];
        }
        if (chunk.type === "finish") {
          const reason = chunk.reason;
          if (reason?.kind !== "stop") throw new Error(reason?.failure?.message ?? `Judge model ended with ${reason?.kind ?? "unknown"}`);
          finished = true;
        }
      }
      signal.throwIfAborted();
      if (!finished) throw new Error("Judge model stream ended without a finish");
      return { ok: true, answers: parseJudgeOutput(text, questions), ...usage ? { usage } : {} };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error), ...usage ? { usage } : {} };
    }
  }
};

// src/host/jev-judge.ts
var JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
var JEV_KEY_REF = "TYPESAFE_API_KEY";
var DEFAULT_JEV_MODEL = "jev-latest";
var RETRIES = 2;
var MAX_WAIT_MS = 4e3;
function fromWire(question, raw) {
  if (question.type !== "score" || !raw || typeof raw !== "object") return raw;
  const answer = raw;
  const probabilities = answer.probabilities;
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return raw;
  const keyed = probabilities;
  if (Object.keys(keyed).length !== question.criteria.length) return { ...answer, probabilities: void 0 };
  return { ...answer, probabilities: question.criteria.map((_, index) => keyed[String(index)]) };
}
var wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason);
    return;
  }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", abort);
    resolve();
  }, ms);
  const abort = () => {
    clearTimeout(timer);
    reject(signal.reason);
  };
  signal.addEventListener("abort", abort, { once: true });
});
function retryDelay(retryAfter, attempt) {
  const seconds = retryAfter === null ? NaN : Number(retryAfter);
  return Math.min(Number.isFinite(seconds) && seconds >= 0 ? seconds * 1e3 : 500 * 2 ** attempt, MAX_WAIT_MS);
}
var JevJudgeEngine = class {
  constructor(deps) {
    this.deps = deps;
  }
  kind = "judge";
  label = "jev";
  async judge(request, signal) {
    let usage;
    try {
      const { state, questions } = validateJudgeRequest(request);
      if (!this.deps.credentials) throw new Error("DSH credentials service is unavailable");
      const key = (await this.deps.credentials.resolve(JEV_KEY_REF))?.value;
      if (!key) throw new Error(`Jev API key is not configured (${JEV_KEY_REF})`);
      signal.throwIfAborted();
      const send = this.deps.fetch ?? globalThis.fetch;
      const body = JSON.stringify({ model: this.deps.model, state, questions });
      for (let attempt = 0; ; attempt++) {
        const response = await send(JEV_ENDPOINT, {
          method: "POST",
          signal,
          body,
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }
        });
        const text = await response.text();
        if ((response.status === 429 || response.status === 529) && attempt < RETRIES) {
          await wait(retryDelay(response.headers.get("retry-after"), attempt), signal);
          continue;
        }
        if (response.status !== 200) throw new Error(`Jev request failed: HTTP ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`);
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error("Jev response is not JSON");
        }
        const raw = parsed.usage;
        if (raw && typeof raw.input_tokens === "number" && typeof raw.output_tokens === "number") usage = { inputTokens: raw.input_tokens, outputTokens: raw.output_tokens };
        const answers = parsed.answers;
        if (!answers || typeof answers !== "object") throw new Error("Jev response has no answers object");
        const typed = Object.fromEntries(Object.entries(questions).map(([id, question]) => [id, checkAnswer(id, question, fromWire(question, answers[id]))]));
        return { ok: true, answers: typed, ...usage ? { usage } : {} };
      }
    } catch (error) {
      const message = signal.aborted ? String(signal.reason instanceof Error ? signal.reason.message : signal.reason ?? "aborted") : error instanceof Error ? error.message : String(error);
      return { ok: false, error: message, ...usage ? { usage } : {} };
    }
  }
};
function judgeEngineFor(settings, deps) {
  if (settings.judgeEngine === "jev") return new JevJudgeEngine({ credentials: deps.credentials, model: settings.jevModel ?? DEFAULT_JEV_MODEL, ...deps.fetch ? { fetch: deps.fetch } : {} });
  const model = settings.judgeModel ?? settings.model;
  return model ? new LlmJudgeEngine(deps.llm, model, settings.judgeSystemPrompt || void 0) : void 0;
}

// src/host/pixie-store.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
function parsePixieSettings(value) {
  const raw = value;
  if (!raw || typeof raw !== "object") throw new Error("Pixie settings must be an object");
  if (raw.contextMode !== "fresh" && raw.contextMode !== "fork") throw new Error("Pixie settings contextMode must be fresh or fork");
  if (typeof raw.systemPrompt !== "string") throw new Error("Pixie settings systemPrompt must be a string");
  if (typeof raw.allowThreadModel !== "boolean") throw new Error("Pixie settings allowThreadModel must be a boolean");
  const settings = { contextMode: raw.contextMode, systemPrompt: raw.systemPrompt, allowThreadModel: raw.allowThreadModel };
  if (raw.model !== void 0) settings.model = parsePixieModel(raw.model);
  if (raw.judgeModel !== void 0) settings.judgeModel = parsePixieModel(raw.judgeModel);
  if (raw.judgeSystemPrompt !== void 0) {
    if (typeof raw.judgeSystemPrompt !== "string") throw new Error("Pixie settings judgeSystemPrompt must be a string");
    settings.judgeSystemPrompt = raw.judgeSystemPrompt;
  }
  if (raw.judgeEngine !== void 0) {
    if (raw.judgeEngine !== "llm" && raw.judgeEngine !== "jev") throw new Error("Pixie settings judgeEngine must be llm or jev");
    settings.judgeEngine = raw.judgeEngine;
  }
  if (raw.jevModel !== void 0) {
    if (typeof raw.jevModel !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw.jevModel)) throw new Error("Pixie settings jevModel must be a model ID");
    settings.jevModel = raw.jevModel;
  }
  return settings;
}
function parsePixieModel(value) {
  const raw = value;
  if (!raw || typeof raw !== "object") throw new Error("Pixie model must be an object");
  if (typeof raw.provider !== "string" || !raw.provider) throw new Error("Pixie model provider is required");
  if (typeof raw.model !== "string" || !raw.model) throw new Error("Pixie model id is required");
  const model = { provider: raw.provider, model: raw.model };
  if (raw.reasoningEffort !== void 0) {
    if (typeof raw.reasoningEffort !== "string" || !raw.reasoningEffort) throw new Error("Pixie model reasoningEffort must be a non-empty string");
    model.reasoningEffort = raw.reasoningEffort;
  }
  if (raw.maxTokens !== void 0) {
    if (!Number.isInteger(raw.maxTokens) || raw.maxTokens <= 0) throw new Error("Pixie model maxTokens must be a positive integer");
    model.maxTokens = raw.maxTokens;
  }
  return model;
}
var PixieSettingsStore = class {
  constructor(file) {
    this.file = file;
  }
  tail = Promise.resolve();
  async read() {
    try {
      return parsePixieSettings(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return structuredClone(DEFAULT_PIXIE_SETTINGS);
      throw error;
    }
  }
  save(value) {
    const run = this.tail.catch(() => {
    }).then(async () => {
      const settings = parsePixieSettings(value);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(settings, null, 2));
      await rename(temporary, this.file);
      return settings;
    });
    this.tail = run;
    return run;
  }
};

// src/package-name.ts
var PACKAGE_NAME = "@matamt-dbg/dsh-studio";
var POLICY_PLUGIN = `${PACKAGE_NAME}/policy`;
var ROLE_PLUGIN = `${PACKAGE_NAME}/roles`;
var BATCH_PLUGIN = `${PACKAGE_NAME}/batch`;
var JUDGE_PLUGIN = `${PACKAGE_NAME}/judge`;

// src/delegation.ts
var LEGACY_ROLE_TOOL = "studio_role";
var GENERIC_DELEGATION_TOOLS = ["subagent", "subagent_fork", "list_subagent_models"];

// src/optimized-preset.ts
var OPTIMIZED_TOOLS = [
  "read_batch",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "job_output",
  "job_list",
  "job_kill",
  "skill",
  "ask_user_question",
  "web_search",
  "web_fetch",
  "present",
  "bash",
  "read_image",
  "exit_plan_mode",
  "send_message",
  "interrupt_agent",
  "list_agents",
  "workflow",
  "subagent_role"
];
var ALLOWED_TOOLS = /* @__PURE__ */ new Set([...OPTIMIZED_TOOLS, ...GENERIC_DELEGATION_TOOLS, LEGACY_ROLE_TOOL]);

// src/host/preset-store.ts
import { createScope } from "@deepseek-ai/dsh-scope";

// src/host/preset-policy.ts
import { scopeChainOf, scopeOf } from "@deepseek-ai/dsh-scope";
var POLICY_SECTION_ORDERS = Object.freeze({
  "tool:jobs": "TOOL_JOBS",
  "tool:bash": "TOOL_BASH",
  "tool:pwsh": "TOOL_PWSH",
  "tool:read": "TOOL_READ",
  "tool:write": "TOOL_WRITE",
  "tool:edit": "TOOL_EDIT",
  "tool:glob": "TOOL_GLOB",
  "tool:grep": "TOOL_GREP",
  "tool:web_fetch": "TOOL_WEB_FETCH",
  "tool:web_search": "TOOL_WEB_SEARCH",
  "tool:goal": "TOOL_GOAL",
  "tool:workflow": "TOOL_WORKFLOW"
});

// src/config-overrides.ts
var LEGACY_DROPPED_PACKAGES = Object.freeze([
  "@deepseek-ai/dsh-agent-instructions",
  "@deepseek-ai/dsh-time-context",
  "@deepseek-ai/dsh-skill-filesystem",
  "@deepseek-ai/dsh-compaction-basic",
  "@deepseek-ai/dsh-command-compact",
  "@deepseek-ai/dsh-compaction-tool-result-pruner"
]);
var CONFIG_REQUIRES = Object.freeze({
  "@deepseek-ai/dsh-command-compact": "@deepseek-ai/dsh-compaction-basic"
});

// src/host/preset-store.ts
import { dirname as dirname2, join as join2 } from "node:path";
import { dump } from "js-yaml";
import { entryListSchema as entryListSchema2 } from "@deepseek-ai/cordis-plugin-include";

// src/provider-fields.ts
var field = (key, type, value, minimum) => ({ key, type, ...value === void 0 ? {} : { value }, ...minimum === void 0 ? {} : { minimum } });
var providerFields = {
  "@deepseek-ai/dsh-compaction-basic": [field("thresholdRatio", "number", 0.8, 0), field("headroomTokens", "number", 65536, 1), field("retainRatio", "number", 0.16, 0), field("retainTokens", "number", void 0, 0), field("summarizationProvider", "string", ""), field("summarizationModel", "string", ""), field("maxTokens", "number", void 0, 1), field("compactionRetries", "number", 1, 0), field("maxOverflowRetries", "number", 1, 0), field("auto", "boolean", true)],
  "@deepseek-ai/dsh-compaction-tool-result-pruner": [field("thresholdChars", "number", 8192, 1), field("headChars", "number", 4096, 0), field("tailChars", "number", 1024, 0)],
  "@deepseek-ai/dsh-agent-tool-presentation": [{ key: "mode", type: "string", options: ["native", "ptc"] }],
  "@deepseek-ai/dsh-persona": [field("prefix", "string"), field("suffix", "string", ""), field("includeRuntimeContext", "boolean", true)],
  "@deepseek-ai/dsh-agent-instructions": [field("maxBytes", "number", 65536), field("maxSourceBytes", "number", void 0, 1), field("projectRootMarkers", "string[]"), field("instructionFileCandidates", "string[]"), field("localInstructionFileCandidates", "string[]")],
  "@deepseek-ai/dsh-time-context": [field("timeZone", "string"), field("refreshIntervalMs", "number", void 0, 0)],
  "@deepseek-ai/dsh-skill-filesystem": [field("providerName", "string", "filesystem"), field("includeDefaultRoots", "boolean", true), field("dshHome", "string"), field("agentsHome", "string"), field("customSkillDirs", "string[]", []), field("bundledSkillDir", "string"), field("watch", "boolean", true), field("watchUsePolling", "boolean", false), field("watchStabilityThresholdMs", "number", 200, 0), field("watchPollIntervalMs", "number", 100, 1), field("watchMaxProjects", "number", 128, 1), field("watchFollowSymlinks", "boolean", true)]
};

// src/host/composition-plan.ts
import { load } from "js-yaml";
import { entryListSchema } from "@deepseek-ai/cordis-plugin-include";

// src/host/role-validation.ts
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";

// src/host/preset-store.ts
function studioStorePath(env = process.env, profile) {
  const directory = profile?.dir ?? env.DSH_PROFILE_DIR;
  if (!directory) throw new Error("Studio preset persistence requires a profile");
  return join2(directory, "studio-data", "presets.json");
}

// src/host/tool-lifetime.ts
function createLifetime() {
  const controller = new AbortController();
  const pending = /* @__PURE__ */ new Set();
  let closing;
  return {
    signal: controller.signal,
    run(body) {
      controller.signal.throwIfAborted();
      const promise = Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return body(controller.signal);
      });
      pending.add(promise);
      void promise.then(() => pending.delete(promise), () => pending.delete(promise));
      return promise;
    },
    dispose() {
      if (closing) return closing;
      controller.abort(new Error("Studio tool scope disposed"));
      closing = Promise.allSettled([...pending]).then(() => {
      });
      return closing;
    }
  };
}

// src/host/judge-tool.ts
var JUDGE_TOOL = "judge";
var TEXT = { type: "string", minLength: 1 };
var JUDGE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["state", "questions"],
  properties: {
    state: { description: "What to judge: text, or a JSON object/array. Name its fields in instructions with backticks, e.g. `source`.", anyOf: [{ type: "string" }, { type: "object" }, { type: "array" }] },
    questions: {
      type: "object",
      minProperties: 1,
      description: "Questions by id. The id is never shown to the judge, so instructions must carry the full meaning. Questions are judged independently and cannot see each other.",
      additionalProperties: { oneOf: [
        { type: "object", additionalProperties: false, required: ["type", "instructions"], properties: {
          type: { const: "noul" },
          instructions: TEXT,
          criteria: { type: "object", additionalProperties: false, properties: { true: TEXT, false: TEXT }, description: "What yes and no mean." }
        }, description: "Yes/no: returns the probability of yes." },
        { type: "object", additionalProperties: false, required: ["type", "instructions", "criteria"], properties: {
          type: { const: "choice" },
          instructions: TEXT,
          criteria: { type: "object", minProperties: 2, maxProperties: 255, additionalProperties: TEXT, description: "Option name \u2192 description. Include a no-match option when nothing may fit." }
        }, description: "Pick one option: returns the choice, probabilities, and confidence." },
        { type: "object", additionalProperties: false, required: ["type", "instructions", "criteria"], properties: {
          type: { const: "score" },
          instructions: TEXT,
          criteria: { type: "array", minItems: 2, maxItems: 10, items: TEXT, description: "Level descriptions, lowest first." }
        }, description: "Rate on ordered levels: returns a fractional score from 0, probabilities, and confidence." }
      ] }
    }
  }
};
var DESCRIPTION = 'Judge text with the decision engine (TypeSafe Jev or an LLM, set in DSH Studio). Returns typed answers with probabilities instead of prose: noul for yes/no, choice to pick one option, score to rate on levels. Use it to rank, filter, or verify; it does not write or rewrite text. Ask several independent questions over the same state in one call. Probabilities are calibrated signals, not proof; a failed judgment is an error, never a "no".';
async function runJudge(engine, raw, signal) {
  const request = validateJudgeRequest(raw);
  if (!engine) throw new Error("No decision engine is configured: set a Pixie model or choose Jev in DSH Studio \u2192 Pixie \u2192 Gates \u2192 Decision engine");
  const result = await engine.judge(request, signal);
  if (!result.ok) throw new Error(result.error);
  return { ...result, engine: engine.label };
}
function installJudge(ctx, life, settings) {
  const tools = ctx.get("tools");
  if (!tools) throw new Error("Studio judge tool requires tools");
  return tools.register({
    name: JUDGE_TOOL,
    description: DESCRIPTION,
    parameters: JUDGE_PARAMETERS,
    output: { schema: { type: "object" }, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(raw, exec) {
      return life.run(async (owned) => {
        const signal = AbortSignal.any([owned, exec.signal]);
        const llm = ctx.get("llm");
        const engine = judgeEngineFor(await settings(), {
          llm: llm ?? { stream: () => {
            throw new Error("DSH llm service is unavailable");
          } },
          credentials: ctx.get("credentials")
        });
        const { answers, usage, engine: label } = await runJudge(engine, raw, signal);
        return JSON.parse(JSON.stringify({ answers, engine: label, ...usage ? { usage } : {} }));
      });
    }
  });
}
var inject = ["tools"];
function apply(ctx) {
  const store = new PixieSettingsStore(join3(dirname3(studioStorePath(process.env, ctx.get("profileContext"))), "pixie-settings.json"));
  const life = createLifetime();
  ctx.effect(() => installJudge(ctx, life, () => store.read()));
  ctx.effect(() => () => life.dispose());
}
export {
  JUDGE_PARAMETERS,
  JUDGE_TOOL,
  apply,
  inject,
  installJudge,
  runJudge
};
