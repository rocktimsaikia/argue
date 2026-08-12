import { describe, expect, it } from "vitest";
import { chooseRepresentative, computeParticipantScores } from "../src/core/scoring.js";
import type { Claim, ParticipantRoundOutput, ParticipantScore } from "../src/contracts/result.js";

describe("computeParticipantScores", () => {
  it("uses peer-review as correctness core signal", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [
      {
        round: 1,
        outputs: [
          {
            participantId: "p1",
            phase: "debate",
            round: 1,
            fullResponse: "p1 response",
            summary: "p1 summary",
            judgements: [
              {
                claimId: "c2",
                stance: "agree",
                confidence: 0.9,
                rationale: "agree p2",
                evidence: []
              }
            ]
          },
          {
            participantId: "p2",
            phase: "debate",
            round: 1,
            fullResponse: "p2 response",
            summary: "p2 summary",
            judgements: [
              {
                claimId: "c1",
                stance: "disagree",
                confidence: 0.9,
                rationale: "disagree p1",
                evidence: []
              }
            ]
          }
        ]
      }
    ];

    const finalClaims: Claim[] = [
      {
        claimId: "c1",
        title: "c1",
        statement: "c1",
        proposedBy: ["p1"],
        status: "active",
        evidence: []
      },
      {
        claimId: "c2",
        title: "c2",
        statement: "c2",
        proposedBy: ["p2"],
        status: "active",
        evidence: []
      }
    ];

    const correctnessHeavy = computeParticipantScores({
      participants: ["p1", "p2"],
      rounds,
      finalClaims,
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 1,
          completeness: 0,
          actionability: 0,
          consistency: 0
        }
      }
    });

    expect(correctnessHeavy[0]?.participantId).toBe("p2");
    expect(correctnessHeavy[1]?.participantId).toBe("p1");
  });

  it("falls back to default rubric weights when all weights are zero", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [
      {
        round: 1,
        outputs: [
          {
            participantId: "p1",
            phase: "debate",
            round: 1,
            fullResponse: "response",
            summary: "summary",
            judgements: [
              {
                claimId: "c1",
                stance: "agree",
                confidence: 0.9,
                rationale: "ok",
                evidence: []
              }
            ]
          }
        ]
      }
    ];

    const finalClaims: Claim[] = [
      {
        claimId: "c1",
        title: "c1",
        statement: "c1",
        proposedBy: ["p1"],
        status: "active",
        evidence: []
      }
    ];

    const scores = computeParticipantScores({
      participants: ["p1"],
      rounds,
      finalClaims,
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        rubric: {
          correctness: 0,
          completeness: 0,
          actionability: 0,
          consistency: 0
        }
      }
    });

    expect(scores[0]?.total).toBeGreaterThan(0);
    expect(Number.isNaN(scores[0]?.total ?? NaN)).toBe(false);
  });
});

describe("chooseRepresentative", () => {
  const tiedScores: ParticipantScore[] = [
    {
      participantId: "p1",
      total: 90,
      byRound: [
        { round: 1, score: 80 },
        { round: 2, score: 88 }
      ]
    },
    {
      participantId: "p2",
      total: 90,
      byRound: [
        { round: 1, score: 85 },
        { round: 2, score: 89 }
      ]
    }
  ];

  it("breaks ties by latest round score", () => {
    const chosen = chooseRepresentative({
      scores: tiedScores,
      rounds: [],
      tieBreaker: "latest-round-score"
    });

    expect(chosen.participantId).toBe("p2");
    expect(chosen.reason).toBe("tie-breaker");
  });

  it("breaks ties by least objection", () => {
    const rounds: Array<{ round: number; outputs: ParticipantRoundOutput[] }> = [
      {
        round: 1,
        outputs: [
          {
            participantId: "p1",
            phase: "debate",
            round: 1,
            fullResponse: "p1",
            summary: "p1",
            judgements: [
              { claimId: "c1", stance: "disagree", confidence: 0.8, rationale: "no", evidence: [] },
              { claimId: "c2", stance: "disagree", confidence: 0.8, rationale: "no", evidence: [] }
            ]
          },
          {
            participantId: "p2",
            phase: "debate",
            round: 1,
            fullResponse: "p2",
            summary: "p2",
            judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "yes", evidence: [] }]
          }
        ]
      }
    ];

    const chosen = chooseRepresentative({
      scores: tiedScores,
      rounds,
      tieBreaker: "least-objection"
    });

    expect(chosen.participantId).toBe("p2");
    expect(chosen.reason).toBe("tie-breaker");
  });
});

describe("grounding discount", () => {
  function mutualAgreementRounds(): Array<{ round: number; outputs: ParticipantRoundOutput[] }> {
    // p1 and p2 agree with each other's claim, so peer agreement alone
    // cannot separate them. Only grounding can.
    return [
      {
        round: 1,
        outputs: (["p1", "p2"] as const).map((participantId) => ({
          participantId,
          phase: "debate" as const,
          round: 1,
          fullResponse: `${participantId} response`,
          summary: `${participantId} summary`,
          judgements: [
            {
              claimId: participantId === "p1" ? "c2" : "c1",
              stance: "agree" as const,
              confidence: 0.9,
              rationale: "agreed",
              evidence: []
            }
          ]
        }))
      }
    ];
  }

  function claim(claimId: string, owner: string, evidence: string[]): Claim {
    return {
      claimId,
      title: claimId,
      statement: claimId,
      evidence,
      proposedBy: [owner],
      status: "active"
    };
  }

  it("ranks the participant who cited sources above the one who only asserted", () => {
    const scores = computeParticipantScores({
      participants: ["p1", "p2"],
      rounds: mutualAgreementRounds(),
      finalClaims: [claim("c1", "p1", ["src/engine.ts:42"]), claim("c2", "p2", [])],
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        // Correctness-only weighting isolates the grounding discount.
        rubric: { correctness: 1, completeness: 0, actionability: 0, consistency: 0 }
      }
    });

    const p1 = scores.find((s) => s.participantId === "p1");
    const p2 = scores.find((s) => s.participantId === "p2");

    expect(p1?.breakdown?.correctness ?? 0).toBeGreaterThan(p2?.breakdown?.correctness ?? 0);
    expect(scores[0]?.participantId).toBe("p1");
  });

  it("leaves the ranking alone when nobody cites anything", () => {
    const ungrounded = computeParticipantScores({
      participants: ["p1", "p2"],
      rounds: mutualAgreementRounds(),
      finalClaims: [claim("c1", "p1", []), claim("c2", "p2", [])],
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        // Correctness-only weighting isolates the grounding discount.
        rubric: { correctness: 1, completeness: 0, actionability: 0, consistency: 0 }
      }
    });

    // Equal peer agreement, equal (zero) grounding: the discount applies to
    // both, so it cannot invent a winner out of nothing.
    expect(ungrounded[0]?.breakdown?.correctness).toBe(ungrounded[1]?.breakdown?.correctness);
  });

  it("does not punish a participant who proposed no claims of their own", () => {
    const scores = computeParticipantScores({
      participants: ["p1", "critic"],
      rounds: [
        {
          round: 1,
          outputs: [
            {
              participantId: "critic",
              phase: "debate",
              round: 1,
              fullResponse: "critic response",
              summary: "critic summary",
              judgements: [{ claimId: "c1", stance: "agree", confidence: 0.9, rationale: "sound", evidence: [] }]
            }
          ]
        }
      ],
      // The critic proposed nothing, so it has no claims to ground.
      finalClaims: [claim("c1", "p1", ["src/engine.ts:42"])],
      scoringPolicy: {
        enabled: true,
        representativeSelection: "top-score",
        tieBreaker: "latest-round-score",
        // Correctness-only weighting isolates the grounding discount.
        rubric: { correctness: 1, completeness: 0, actionability: 0, consistency: 0 }
      }
    });

    const critic = scores.find((s) => s.participantId === "critic");
    // Grounding is neutral for a pure critic: the no-peer-judgement default of
    // 50 survives intact instead of being discounted to the floor.
    expect(critic?.breakdown?.correctness).toBe(50);
  });
});
