import type { AgentTaskInput } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { buildTaskPrompt } from "../src/runtime/prompt.js";

function makeRoundTask(): AgentTaskInput {
  return {
    kind: "round",
    sessionId: "s1",
    requestId: "r1",
    participantId: "a1",
    phase: "debate",
    round: 1,
    prompt: "Round prompt",
    claimCatalog: []
  };
}

describe("buildTaskPrompt", () => {
  it("includes role/system/task context and json schema when enabled", () => {
    const text = buildTaskPrompt({
      task: makeRoundTask(),
      agent: {
        id: "a1",
        provider: "mock",
        model: "fake",
        providerName: "mock",
        providerConfig: { type: "mock", models: { fake: {} } },
        modelConfig: {},
        providerModel: "fake",
        role: "architect",
        systemPrompt: "Be strict"
      },
      includeJsonSchema: true
    });

    expect(text).toContain("Role: architect");
    expect(text).toContain("System instructions:");
    expect(text).toContain("Round prompt");
    expect(text).toContain("Task context JSON:");
    expect(text).toContain("Expected output JSON schema:");
  });

  it("does not repeat the prompt or output schema inside the task context JSON", () => {
    const task = makeRoundTask();
    task.prompt = "UNIQUE_ROUND_PROMPT_MARKER";
    task.metadata = {
      participantSessionKey: "argue:s1:a1",
      outputSchema: { ref: "argue.round.debate.output-content.v1", jsonSchema: { type: "object" } }
    };

    const text = buildTaskPrompt({
      task,
      agent: {
        id: "a1",
        provider: "mock",
        model: "fake",
        providerName: "mock",
        providerConfig: { type: "mock", models: { fake: {} } },
        modelConfig: {},
        providerModel: "fake"
      },
      includeJsonSchema: true
    });

    const context = JSON.parse(text.match(/Task context JSON:\n(.*)\n/)?.[1] ?? "{}");
    expect(context.prompt).toBeUndefined();
    expect(context.metadata.outputSchema).toBeUndefined();
    expect(context.metadata.participantSessionKey).toBe("argue:s1:a1");
    expect(context.claimCatalog).toEqual([]);

    // Prompt text itself still reaches the agent exactly once.
    expect(text.match(/UNIQUE_ROUND_PROMPT_MARKER/g)).toHaveLength(1);
  });

  it("omits schema section when includeJsonSchema is false", () => {
    const text = buildTaskPrompt({
      task: makeRoundTask(),
      agent: {
        id: "a1",
        provider: "mock",
        model: "fake",
        providerName: "mock",
        providerConfig: { type: "mock", models: { fake: {} } },
        modelConfig: {},
        providerModel: "fake"
      },
      includeJsonSchema: false
    });

    expect(text).not.toContain("Expected output JSON schema:");
  });
});
