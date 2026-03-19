import { spawn } from "child_process";

// Limit concurrent claude subprocesses to avoid session contention
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

const MODEL_MAP: Record<string, string> = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus:   "claude-opus-4-6",
};

export async function callClaude(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<string> {
  const modelId = options?.model
    ? (MODEL_MAP[options.model] ?? options.model)
    : MODEL_MAP.haiku!;

  await acquireSlot();

  return new Promise((resolve, reject) => {
    const args = [
      "--print", prompt,
      "--output-format", "stream-json",
      "--verbose",
      "--model", modelId,
    ];

    const proc = spawn("claude", args, { env: process.env, stdio: ["ignore", "pipe", "pipe"] });

    // Kill and reject if no response after 45s
    const timeout = setTimeout(() => {
      proc.kill();
      releaseSlot();
      reject(new Error("claude CLI timed out after 45s"));
    }, 45_000);
    let fullText = "";
    let stderr = "";
    let buf = "";

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.stdout.on("data", (data: Buffer) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;

          // Token-level streaming (mirrors raw Anthropic API events)
          if (
            event.type === "content_block_delta" &&
            (event.delta as Record<string, unknown>)?.type === "text_delta"
          ) {
            const chunk = (event.delta as Record<string, unknown>).text as string;
            fullText += chunk;
            options?.onChunk?.(chunk);

          // Full assistant message event — extract text blocks
          } else if (event.type === "assistant") {
            const msg = event.message as Record<string, unknown>;
            const content = msg?.content as Array<Record<string, unknown>>;
            for (const block of content ?? []) {
              if (block.type === "text") {
                const chunk = block.text as string;
                // Avoid double-counting if we already got it via deltas
                if (!fullText.includes(chunk)) {
                  fullText += chunk;
                  options?.onChunk?.(chunk);
                }
              }
            }

          // Final result field as last-resort fallback
          } else if (event.type === "result" && !fullText && event.result) {
            fullText = event.result as string;
          }
        } catch {
          // non-JSON line — ignore
        }
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

export async function callClaudeJSON<T>(
  prompt: string,
  options?: { model?: string; onChunk?: (chunk: string) => void },
): Promise<T> {
  const raw = await callClaude(prompt, options);

  let jsonStr = raw.trim();
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

    let retryStr = retryRaw.trim();
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
