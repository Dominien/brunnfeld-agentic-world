import { spawn } from "child_process";

// ─── Concurrency semaphore ────────────────────────────────────

const MAX_CONCURRENT = parseInt(process.env.CLAUDE_CONCURRENCY ?? "4");
let activeProcs = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeProcs < MAX_CONCURRENT) {
    activeProcs++;
    return Promise.resolve();
  }
  return new Promise(resolve => waitQueue.push(resolve));
}

function releaseSlot(): void {
  const next = waitQueue.shift();
  if (next) {
    next();
  } else {
    activeProcs--;
  }
}

let totalCalls = 0;
let totalTokensEstimated = 0;

export function getLLMStats() {
  return { totalCalls, totalTokensEstimated };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Model resolution ─────────────────────────────────────────

// Short aliases → Claude Code CLI model IDs
const CLI_MODEL_MAP: Record<string, string> = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-6",
};

// Short aliases → OpenRouter default model IDs (overridable via env)
// Set OPENROUTER_MODEL to use one model for everything,
// or OPENROUTER_MODEL_HAIKU / _SONNET / _OPUS for per-tier overrides.
// Any full model ID (contains "/") is passed through as-is.
function resolveOpenRouterModel(shortOrFull?: string): string {
  const global = process.env.OPENROUTER_MODEL;
  if (!shortOrFull) return global ?? "anthropic/claude-haiku-4-5-20251001";

  // Already a full model ID
  if (shortOrFull.includes("/")) return shortOrFull;

  // Per-tier env override
  const envKey = `OPENROUTER_MODEL_${shortOrFull.toUpperCase()}`;
  if (process.env[envKey]) return process.env[envKey]!;

  // Global override (applies to all tiers unless per-tier is set)
  if (global) return global;

  // Built-in defaults
  const defaults: Record<string, string> = {
    haiku:  "anthropic/claude-haiku-4-5-20251001",
    sonnet: "anthropic/claude-sonnet-4-6",
    opus:   "anthropic/claude-opus-4-6",
  };
  return defaults[shortOrFull] ?? shortOrFull;
}

// ─── Shared OpenAI-compatible streaming fetch ──────────────────

async function callOpenAICompat(
  baseUrl: string,
  modelId: string,
  prompt: string,
  extraHeaders: Record<string, string>,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      stream: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LLM ${res.status}: ${err.slice(0, 200)}`);
  }

  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;

      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        const choices = event.choices as Array<Record<string, unknown>>;
        const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
        const content = delta?.content as string | undefined;
        if (content) {
          fullText += content;
          onChunk?.(content);
        }
      } catch { /* non-JSON line */ }
    }
  }

  const result = fullText.trim();
  if (!result) throw new Error("Empty response from LLM");
  return result;
}

// ─── Local LLM backend (LM Studio, Ollama, etc.) ──────────────

async function callLocalLLM(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<string> {
  const baseUrl = process.env.LOCAL_LLM_BASE_URL!.replace(/\/$/, "");
  const modelId = options?.model ?? process.env.LOCAL_LLM_MODEL ?? "local-model";

  await acquireSlot();
  try {
    const result = await callOpenAICompat(baseUrl, modelId, prompt, {}, options?.onChunk);
    totalCalls++;
    totalTokensEstimated += estimateTokens(prompt) + estimateTokens(result);
    return result;
  } finally {
    releaseSlot();
  }
}

// ─── OpenRouter backend ───────────────────────────────────────

async function callOpenRouter(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<string> {
  const modelId = resolveOpenRouterModel(options?.model);
  await acquireSlot();

  try {
    const result = await callOpenAICompat(
      "https://openrouter.ai/api/v1",
      modelId,
      prompt,
      {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "X-Title": "Brunnfeld Simulation",
      },
      options?.onChunk,
    );

    totalCalls++;
    totalTokensEstimated += estimateTokens(prompt) + estimateTokens(result);
    return result;
  } finally {
    releaseSlot();
  }
}

// ─── Claude Code CLI backend ──────────────────────────────────

async function callCLI(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<string> {
  const modelId = options?.model
    ? (CLI_MODEL_MAP[options.model] ?? options.model)
    : CLI_MODEL_MAP.haiku!;

  await acquireSlot();

  return new Promise((resolve, reject) => {
    const args = [
      "--print", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--model", modelId,
    ];

    const proc = spawn("claude", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    const timeout = setTimeout(() => {
      proc.kill();
      releaseSlot();
      reject(new Error("claude CLI timed out after 45s"));
    }, 45_000);

    let fullText = "";
    let stderr = "";
    let buf = "";

    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

    proc.stdout.on("data", (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          if (
            event.type === "content_block_delta" &&
            (event.delta as Record<string, unknown>)?.type === "text_delta"
          ) {
            const chunk = (event.delta as Record<string, unknown>).text as string;
            fullText += chunk;
            options?.onChunk?.(chunk);

          } else if (event.type === "assistant") {
            const msg = event.message as Record<string, unknown>;
            const content = msg?.content as Array<Record<string, unknown>>;
            for (const block of content ?? []) {
              if (block.type === "text") {
                const chunk = block.text as string;
                if (!fullText.includes(chunk)) {
                  fullText += chunk;
                  options?.onChunk?.(chunk);
                }
              }
            }

          } else if (event.type === "result" && !fullText && event.result) {
            fullText = event.result as string;
          }
        } catch { /* non-JSON line */ }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      releaseSlot();
      totalCalls++;
      totalTokensEstimated += estimateTokens(prompt) + estimateTokens(fullText);
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.trim()}`));
      } else {
        const result = fullText.trim();
        if (!result) reject(new Error("Empty response from claude CLI"));
        else resolve(result);
      }
    });

    proc.on("error", (err) => { clearTimeout(timeout); releaseSlot(); reject(err); });
  });
}

// ─── Public API ───────────────────────────────────────────────

export function usingOpenRouter(): boolean {
  return !process.env.LOCAL_LLM_BASE_URL && !!process.env.OPENROUTER_API_KEY;
}

export function usingLocalLLM(): boolean {
  return !!process.env.LOCAL_LLM_BASE_URL;
}

export async function callClaude(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<string> {
  if (usingLocalLLM()) return callLocalLLM(prompt, options);
  if (usingOpenRouter()) return callOpenRouter(prompt, options);
  return callCLI(prompt, options);
}

// Strip <think>...</think> blocks (MiniMax M2.x, DeepSeek R1, etc.)
function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function callClaudeJSON<T>(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<T> {
  const raw = await callClaude(prompt, options);

  let jsonStr = stripThinkTags(raw).trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
  }
  const jsonStart = jsonStr.indexOf("{");
  if (jsonStart > 0) jsonStr = jsonStr.substring(jsonStart);
  const lastBrace = jsonStr.lastIndexOf("}");
  if (lastBrace >= 0 && lastBrace < jsonStr.length - 1) jsonStr = jsonStr.substring(0, lastBrace + 1);

  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    const retryPrompt = `The following was supposed to be valid JSON but isn't. Return ONLY the corrected JSON object, no markdown:\n\n${raw}`;
    const retryRaw = await callClaude(retryPrompt, { model: options?.model });

    let retryStr = stripThinkTags(retryRaw).trim();
    if (retryStr.startsWith("```")) {
      retryStr = retryStr.replace(/^```[a-z]*\n?/i, "").replace(/\n?```\s*$/, "");
    }
    const retryStart = retryStr.indexOf("{");
    if (retryStart > 0) retryStr = retryStr.substring(retryStart);
    const retryBrace = retryStr.lastIndexOf("}");
    if (retryBrace >= 0) retryStr = retryStr.substring(0, retryBrace + 1);

    return JSON.parse(retryStr) as T;
  }
}
