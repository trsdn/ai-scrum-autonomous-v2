import { describe, it, expect } from "vitest";
import { extractJson } from "../../src/ceremonies/helpers.js";

describe("extractJson", () => {
  it("throws descriptive error for malformed JSON", () => {
    expect(() => extractJson("```json\n{invalid}\n```")).toThrow(
      "Failed to parse JSON",
    );
  });

  it("throws for garbage text with braces", () => {
    expect(() => extractJson("{not json at all}")).toThrow(
      "Failed to parse JSON",
    );
  });

  it("throws for empty string", () => {
    expect(() => extractJson("")).toThrow("No JSON found");
  });

  it("throws for truncated JSON", () => {
    expect(() => extractJson('{"key": "val')).toThrow();
  });

  it("handles valid JSON in fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("handles valid JSON without fence", () => {
    expect(extractJson('some text {"a":1} more text')).toEqual({ a: 1 });
  });
});
