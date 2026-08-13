import type { ArgueEvent, ArgueResult } from "@onevcat/argue";
import { describe, expect, it } from "vitest";
import { createOutputFormatter, resultStatusTone } from "../src/output.js";
import type { SpinnerStream } from "../src/spinner.js";

function createSpinnerStream(): SpinnerStream & { written: string[] } {
  const written: string[] = [];
  return {
    isTTY: true,
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    written
  };
}

function createIO(): { logs: string[]; errors: string[]; log: (msg: string) => void; error: (msg: string) => void } {
  const logs: string[] = [];
  const errors: string[] = [];
  return {
    logs,
    errors,
    log: (msg: string) => logs.push(msg),
    error: (msg: string) => errors.push(msg)
  };
}

function makeParticipantRespondedEvent(overrides: Record<string, unknown> = {}): ArgueEvent {
  return {
    type: "ParticipantResponded",
    at: new Date().toISOString(),
    requestId: "req-1",
    sessionId: "sess-1",
    payload: {
      phase: "debate",
      round: 1,
      participantId: "agent-a",
      summary: "I agree with the main claim.",
      taskTitle: "demo title",
      extractedClaims: 1,
      judgements: 2,
      stanceAgree: 1,
      stanceDisagree: 1,
      stanceRevise: 0,
      claimVotes: 0,
      fullResponse: "This is the full LLM response text.",
      extractedClaimsDetail: [{ title: "New finding", statement: "A newly discovered insight.", category: "pro" }],
      judgementsDetail: [
        { claimId: "c1", stance: "agree", confidence: 0.95, rationale: "Strong evidence supports this.", evidence: [] },
        { claimId: "c2", stance: "disagree", confidence: 0.7, rationale: "Contradicts prior analysis.", evidence: [] }
      ],
      ...overrides
    }
  };
}

function makeMinimalResult(): ArgueResult {
  return {
    resultVersion: 1,
    requestId: "req-1",
    sessionId: "sess-1",
    status: "consensus",
    finalClaims: [
      {
        claimId: "c1",
        title: "Main claim",
        statement: "The primary conclusion.",
        category: "pro",
        proposedBy: ["agent-a", "agent-b"],
        status: "active",
        evidence: ["src/core/engine.ts:61"]
      }
    ],
    claimResolutions: [
      {
        claimId: "c1",
        status: "resolved",
        acceptCount: 2,
        rejectCount: 0,
        totalVoters: 2,
        evidenceCount: 1,
        votes: [
          { participantId: "agent-a", claimId: "c1", vote: "accept", reason: "Correct." },
          { participantId: "agent-b", claimId: "c1", vote: "accept" }
        ]
      }
    ],
    representative: {
      participantId: "agent-a",
      reason: "top-score",
      score: 85.5,
      speech: "We reached consensus on the main claim."
    },
    scoreboard: [
      {
        participantId: "agent-a",
        total: 85.5,
        byRound: [
          { round: 0, score: 80 },
          { round: 1, score: 91 }
        ],
        breakdown: { correctness: 90, completeness: 85, actionability: 80, consistency: 87 }
      },
      {
        participantId: "agent-b",
        total: 78.2,
        byRound: [
          { round: 0, score: 75 },
          { round: 1, score: 81.4 }
        ],
        breakdown: { correctness: 80, completeness: 75, actionability: 78, consistency: 80 }
      }
    ],
    eliminations: [],
    report: {
      mode: "representative",
      traceIncluded: false,
      traceLevel: "compact",
      finalSummary: "Consensus reached.",
      representativeSpeech: "We reached consensus on the main claim."
    },
    rounds: [],
    metrics: {
      elapsedMs: 12345,
      totalRounds: 3,
      totalTurns: 6,
      retries: 0,
      waitTimeouts: 0,
      earlyStopTriggered: false,
      globalDeadlineHit: false
    }
  };
}

describe("output formatter", () => {
  describe("non-verbose mode", () => {
    it("prints each agent's own words as it responds, and only non-zero round notes", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      const handler = fmt.createEventHandler();

      handler({
        type: "RoundDispatched",
        at: "2024-01-01T00:00:00.000Z",
        sessionId: "s1",
        requestId: "r1",
        payload: { phase: "debate", round: 1, participants: ["agent-a", "agent-b"] }
      });
      handler(makeParticipantRespondedEvent());

      // The agent's own summary is the progress signal worth reading.
      const afterResponse = io.logs.join("\n");
      expect(afterResponse).toContain("agent-a");
      expect(afterResponse).toContain("I agree with the main claim.");

      handler({
        type: "RoundCompleted",
        at: "2024-01-01T00:00:01.000Z",
        sessionId: "s1",
        requestId: "r1",
        payload: { phase: "debate", round: 1, completed: 2, timedOut: 0, failed: 0, newClaims: 3, mergeCount: 0 }
      });

      const all = io.logs.join("\n");
      expect(all).toContain("debate 1");
      expect(all).toContain("+3 claims");
      // Zeros stay silent, and the raw response body belongs to --verbose.
      expect(all).not.toContain("timeout");
      expect(all).not.toContain("failed");
      expect(all).not.toContain("full response:");
      expect(all).not.toContain("Strong evidence");
      expect(all).not.toContain("judgements=");
    });

    it("prints the agent name on its own line and wraps the prose full width", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true, width: 60 });
      const handler = fmt.createEventHandler();

      handler({
        type: "ParticipantResponded",
        at: "2024-01-01T00:00:00.000Z",
        sessionId: "s1",
        requestId: "r1",
        payload: {
          phase: "debate",
          round: 1,
          participantId: "agent-a",
          summary:
            "Prefer a set for repeated membership tests on hashable keys, because conversion pays for itself at roughly the third lookup.",
          judgements: 0
        }
      });

      const lines = io.logs.join("\n").split("\n");
      expect(lines[0]).toBe("  agent-a:");
      // Prose keeps the full width at a flat two-column indent, so a long
      // agent id costs nothing; the wrap must not lose the tail of the text.
      expect(lines.length).toBeGreaterThan(2);
      for (const line of lines.slice(1)) {
        expect(line.startsWith("  ")).toBe(true);
        expect(line.startsWith("   ")).toBe(false);
      }
      for (const line of lines) {
        expect(line.length).toBeLessThanOrEqual(60);
      }
      expect(io.logs.join(" ")).toContain("third lookup.");
    });

    it("still reports an eliminated agent, because that is an exception", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      const handler = fmt.createEventHandler();

      handler({
        type: "ParticipantEliminated",
        at: "2024-01-01T00:00:00.000Z",
        sessionId: "s1",
        requestId: "r1",
        payload: { phase: "debate", round: 1, participantId: "agent-b", reason: "timeout" }
      });

      const all = io.logs.join("\n");
      expect(all).toContain("agent-b eliminated");
      expect(all).toContain("timeout");
    });

    it("digests surviving claims with their grounding and one artifacts line", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      const result = makeMinimalResult();
      const claim = result.finalClaims[0];
      const resolution = result.claimResolutions[0];
      if (!claim || !resolution) throw new Error("fixture must carry one claim and one resolution");
      claim.evidence = [];
      resolution.evidenceCount = 0;

      fmt.runCompleted(result, { resultPath: "/out/run/r.json", summaryPath: "/out/run/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("c1");
      expect(all).toContain("2/2 accept");
      expect(all).toContain("no evidence");
      // The result JSON is what gets piped onward, so name it in full; the
      // summary shares its directory and does not need its own line.
      expect(all).toContain("result: /out/run/r.json");
      expect(all).not.toContain("summary:");
    });

    it("names the summary separately when it was pointed elsewhere", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });

      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/run/r.json", summaryPath: "/elsewhere/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("result: /out/run/r.json");
      expect(all).toContain("summary: /elsewhere/s.md");
    });

    it("strips markdown emphasis the terminal cannot render", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      const result = makeMinimalResult();
      result.report.finalSummary = "Consensus reached.\n\n**agent-a**: ships it.";

      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("agent-a: ships it.");
      expect(all).not.toContain("**");
    });

    it("does not show scoreboard in runCompleted", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: false, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("consensus");
      expect(all).not.toContain("Scoreboard:");
      expect(all).not.toContain("Metrics:");
    });
  });

  describe("verbose mode", () => {
    it("shows extracted claims detail", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("extracted claims:");
      expect(all).toContain("New finding");
      expect(all).toContain("[pro]");
      expect(all).toContain("A newly discovered insight.");
    });

    it("shows judgements with stance, confidence, and rationale", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("judgements:");
      expect(all).toContain("c1");
      expect(all).toContain("95%");
      expect(all).toContain("Strong evidence supports this.");
      expect(all).toContain("c2");
      expect(all).toContain("70%");
      expect(all).toContain("Contradicts prior analysis.");
    });

    it("shows revised statement for revise stance", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(
        makeParticipantRespondedEvent({
          judgementsDetail: [
            {
              claimId: "c1",
              stance: "revise",
              confidence: 0.8,
              rationale: "Needs refinement.",
              revisedStatement: "Updated claim text."
            }
          ]
        })
      );

      const all = io.logs.join("\n");
      expect(all).toContain("revised:");
      expect(all).toContain("Updated claim text.");
    });

    it("shows claim votes in final_vote phase", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(
        makeParticipantRespondedEvent({
          phase: "final_vote",
          claimVotes: 2,
          claimVotesDetail: [
            { claimId: "c1", vote: "accept", reason: "Solid conclusion." },
            { claimId: "c2", vote: "reject", reason: "Insufficient evidence." }
          ]
        })
      );

      const all = io.logs.join("\n");
      expect(all).toContain("votes:");
      expect(all).toContain("accept");
      expect(all).toContain("Solid conclusion.");
      expect(all).toContain("reject");
      expect(all).toContain("Insufficient evidence.");
    });

    it("shows full response text", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();

      handler(makeParticipantRespondedEvent());

      const all = io.logs.join("\n");
      expect(all).toContain("full response:");
      expect(all).toContain("This is the full LLM response text.");
    });

    it("shows scoreboard with breakdown in runCompleted", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Scoreboard:");
      expect(all).toContain("agent-a: 85.50");
      expect(all).toContain("agent-b: 78.20");
      expect(all).toContain("cor=90");
      expect(all).toContain("cpl=85");
      expect(all).toContain("act=80");
      expect(all).toContain("con=87");
    });

    it("shows claims with resolution status", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Claims:");
      expect(all).toContain("c1: Main claim");
      expect(all).toContain("[pro]");
      expect(all).toContain("proposed by: agent-a, agent-b");
      expect(all).toContain("evidence: src/core/engine.ts:61");
      expect(all).toContain("resolved: 2/2 accept");
      expect(all).not.toContain("no evidence");
    });

    it("flags a claim that was voted through without any evidence", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const result = makeMinimalResult();
      const claim = result.finalClaims[0];
      const resolution = result.claimResolutions[0];
      if (!claim || !resolution) throw new Error("fixture must carry one claim and one resolution");
      claim.evidence = [];
      resolution.evidenceCount = 0;

      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("resolved (no evidence): 2/2 accept");
      expect(all).not.toContain("evidence: src");
    });

    it("shows representative speech", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Representative speech:");
      expect(all).toContain("We reached consensus on the main claim.");
    });

    it("shows metrics", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      fmt.runCompleted(makeMinimalResult(), { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Metrics:");
      expect(all).toContain("12.3s");
      expect(all).toContain("rounds=3");
      expect(all).toContain("turns=6");
    });

    it("shows disagreements when present", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const result = makeMinimalResult();
      result.disagreements = [{ claimId: "c1", participantId: "agent-b", reason: "I still disagree." }];
      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Disagreements:");
      expect(all).toContain("c1 by agent-b: I still disagree.");
    });

    it("shows action dispatched event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionDispatched",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", prompt: "Fix the bugs." }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action dispatched");
      expect(all).toContain("agent-a");
      expect(all).toContain("Fix the bugs.");
    });

    it("shows action completed event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionCompleted",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", summary: "Fixed 3 issues." }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action completed");
      expect(all).toContain("Fixed 3 issues.");
    });

    it("shows action failed event", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { noColor: true });
      const handler = fmt.createEventHandler();
      handler({
        type: "ActionFailed",
        at: new Date().toISOString(),
        requestId: "req-1",
        sessionId: "sess-1",
        payload: { actorId: "agent-a", reason: "dispatch_failed" }
      });
      const all = io.logs.join("\n");
      expect(all).toContain("action failed");
      expect(all).toContain("dispatch_failed");
    });

    it("shows eliminations when present", () => {
      const io = createIO();
      const fmt = createOutputFormatter(io, { verbose: true, noColor: true });
      const result = makeMinimalResult();
      result.eliminations = [{ participantId: "agent-c", round: 2, reason: "timeout", at: "2026-04-10T00:00:00Z" }];
      fmt.runCompleted(result, { resultPath: "/out/r.json", summaryPath: "/out/s.md" });

      const all = io.logs.join("\n");
      expect(all).toContain("Eliminations:");
      expect(all).toContain("agent-c at round 2 (timeout)");
    });
  });
});

describe("spinner integration", () => {
  it("starts the spinner with remaining participants after RoundDispatched", () => {
    const io = createIO();
    const stream = createSpinnerStream();
    const fmt = createOutputFormatter(io, { noColor: true, spinnerStream: stream, spinnerIsTTY: true });
    const handler = fmt.createEventHandler();

    handler({
      type: "RoundDispatched",
      at: new Date().toISOString(),
      requestId: "req-1",
      sessionId: "sess-1",
      payload: { phase: "debate", round: 1, participants: ["a", "b"] }
    });

    const all = stream.written.join("");
    expect(all).toContain("waiting on");
    expect(all).toContain("a");
    expect(all).toContain("b");
  });

  it("updates spinner label after each ParticipantResponded and stops on RoundCompleted", () => {
    const io = createIO();
    const stream = createSpinnerStream();
    const fmt = createOutputFormatter(io, { noColor: true, spinnerStream: stream, spinnerIsTTY: true });
    const handler = fmt.createEventHandler();

    handler({
      type: "RoundDispatched",
      at: new Date().toISOString(),
      requestId: "req-1",
      sessionId: "sess-1",
      payload: { phase: "debate", round: 1, participants: ["a", "b"] }
    });
    handler(makeParticipantRespondedEvent({ participantId: "a" }));

    // After "a" responded, the spinner should restart with only "b" in label.
    const afterA = stream.written.join("");
    expect(afterA).toMatch(/waiting on[^a-z]*b/);

    handler(makeParticipantRespondedEvent({ participantId: "b" }));
    handler({
      type: "RoundCompleted",
      at: new Date().toISOString(),
      requestId: "req-1",
      sessionId: "sess-1",
      payload: { phase: "debate", round: 1, completed: 2, timedOut: 0, failed: 0 }
    });

    // RoundCompleted must end with clear-line + cursor-show, no further animation.
    const last = stream.written[stream.written.length - 1] ?? "";
    expect(last).toContain("\x1b[?25h");
  });

  it("starts a spinner on ActionDispatched and stops on ActionCompleted", () => {
    const io = createIO();
    const stream = createSpinnerStream();
    const fmt = createOutputFormatter(io, { noColor: true, spinnerStream: stream, spinnerIsTTY: true });
    const handler = fmt.createEventHandler();

    handler({
      type: "ActionDispatched",
      at: new Date().toISOString(),
      requestId: "req-1",
      sessionId: "sess-1",
      payload: { actorId: "agent-a", prompt: "do it" }
    });
    expect(stream.written.join("")).toContain("agent-a executing action");

    handler({
      type: "ActionCompleted",
      at: new Date().toISOString(),
      requestId: "req-1",
      sessionId: "sess-1",
      payload: { actorId: "agent-a", summary: "done" }
    });

    const last = stream.written[stream.written.length - 1] ?? "";
    expect(last).toContain("\x1b[?25h");
  });
});

describe("view hint", () => {
  it("prints `→ View report: argue view <id>` after runCompleted", () => {
    const logs: string[] = [];
    const io = { log: (s: string) => logs.push(String(s)), error: () => {} };
    const formatter = createOutputFormatter(io, { isTTY: false, noColor: true });
    formatter.viewHint("argue_1712000000000_aaaaaa");
    expect(logs.join("\n")).toContain("→ View report: argue view argue_1712000000000_aaaaaa");
  });

  it("renders interrupted with a distinct non-failure status tone", () => {
    expect(resultStatusTone("consensus")).toBe("success");
    expect(resultStatusTone("failed")).toBe("failure");
    expect(resultStatusTone("interrupted")).toBe("warning");
    expect(resultStatusTone("partial_consensus")).toBe("warning");
    expect(resultStatusTone("unresolved")).toBe("warning");
  });
});
