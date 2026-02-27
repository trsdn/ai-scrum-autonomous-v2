/**
 * Shared helpers for sprint ceremony modules.
 */

/** Replace `{{KEY}}` placeholders in a template string. */
export function substitutePrompt(
  template: string,
  vars: Record<string, string>,
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}

/**
 * Sanitize user-provided content before substituting into prompts.
 * Mitigates prompt injection by wrapping content in delimiters.
 */
export function sanitizePromptInput(input: string): string {
  return `<user_content>\n${input}\n</user_content>`;
}

/**
 * Extract the first JSON object or array from a string that may contain
 * markdown fenced code blocks or plain text around it.
 */
export function extractJson<T = unknown>(text: string): T {
  // Try fenced code block first (```json ... ``` or ``` ... ```)
  const fencedMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]) as T;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse JSON from response: ${msg}. Input (first 200 chars): ${text.slice(0, 200)}`);
    }
  }

  // Fall back to finding a top-level { or [
  const start = text.search(/[{[]/);
  if (start === -1) {
    throw new Error("No JSON found in response");
  }

  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === open) depth++;
    else if (ch === close) depth--;

    if (depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1)) as T;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to parse JSON from response: ${msg}. Input (first 200 chars): ${text.slice(0, 200)}`);
      }
    }
  }

  throw new Error("No complete JSON found in response");
}
