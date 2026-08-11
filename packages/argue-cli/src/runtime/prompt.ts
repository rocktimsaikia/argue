import type { ActionTaskInput, AgentTaskInput } from "@onevcat/argue";
import type { ResolvedAgentRuntime } from "./types.js";
import { getTaskOutputJsonSchema } from "./task-output.js";

export function buildTaskPrompt(args: {
  task: AgentTaskInput;
  agent: ResolvedAgentRuntime;
  includeJsonSchema: boolean;
}): string {
  const { task, agent, includeJsonSchema } = args;

  if (task.kind === "action") {
    return buildActionPrompt(task, agent);
  }

  const sections: string[] = [
    "You are executing one task in the argue CLI host.",
    "Return one JSON object only. Do not add markdown, code fences, or commentary."
  ];

  if (agent.role) {
    sections.push(`Role: ${agent.role}`);
  }

  if (agent.systemPrompt) {
    sections.push("", "System instructions:", agent.systemPrompt);
  }

  sections.push("", "Task prompt:", task.prompt);

  sections.push("", "Task context JSON:", JSON.stringify(buildTaskContext(task, includeJsonSchema)));

  if (includeJsonSchema) {
    sections.push("", "Expected output JSON schema:", JSON.stringify(getTaskOutputJsonSchema(task)));
  }

  return sections.join("\n");
}

/**
 * The task is echoed to the agent as context, but two of its fields are
 * already spelled out elsewhere in the same prompt: `prompt` is printed
 * verbatim above, and `metadata.outputSchema` is printed below as the
 * expected-output block. Sending them twice costs input tokens on every
 * turn of every round, and providers that resume a session replay the
 * whole transcript, so each duplicated byte is re-billed in later rounds.
 */
function buildTaskContext(task: AgentTaskInput, outputSchemaPrintedSeparately: boolean): Record<string, unknown> {
  const context: Record<string, unknown> = { ...task };
  delete context.prompt;

  const metadata = context.metadata;
  if (outputSchemaPrintedSeparately && metadata && typeof metadata === "object") {
    const trimmed = { ...(metadata as Record<string, unknown>) };
    delete trimmed.outputSchema;

    if (Object.keys(trimmed).length > 0) {
      context.metadata = trimmed;
    } else {
      delete context.metadata;
    }
  }

  return context;
}

function buildActionPrompt(task: ActionTaskInput, agent: ResolvedAgentRuntime): string {
  const sections: string[] = [
    "You are executing an action based on a completed argue debate session.",
    "The debate has concluded and you are now tasked with performing real-world operations based on the outcome."
  ];

  if (agent.role) {
    sections.push(`Role: ${agent.role}`);
  }

  if (agent.systemPrompt) {
    sections.push("", "System instructions:", agent.systemPrompt);
  }

  sections.push("", "Action instructions:", task.prompt);

  sections.push(
    "",
    "Debate result:",
    `Status: ${task.argueResult.status}`,
    "",
    "Summary:",
    task.argueResult.finalSummary,
    "",
    "Representative statement:",
    task.argueResult.representativeSpeech
  );

  if (task.argueResult.claims.length > 0) {
    sections.push("", "Claims:");
    for (const claim of task.argueResult.claims) {
      const resolution = task.argueResult.claimResolutions.find((r) => r.claimId === claim.claimId);
      const voteStr = resolution ? ` (${resolution.acceptCount}/${resolution.totalVoters} accept)` : "";
      sections.push(`- ${claim.claimId}: ${claim.title}${voteStr}`);
      sections.push(`  ${claim.statement}`);
    }
  }

  if (task.fullResult) {
    sections.push("", "Full result JSON:", JSON.stringify(task.fullResult));
  }

  return sections.join("\n");
}
