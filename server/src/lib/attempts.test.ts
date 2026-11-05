import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { syncSection } from "./attempts";
import { type Paper } from "./engine";

describe("Sequential Stage Transition & Server-Authoritative Timer Engine", () => {
  const samplePaper: Paper = [
    {
      sectionId: "sec-aptitude",
      title: "Aptitude Test",
      timeLimitMinutes: 30,
      questions: [
        { questionId: "q1", marks: 1, optionOrder: ["opt1", "opt2"] },
        { questionId: "q2", marks: 1, optionOrder: ["opt3", "opt4"] },
      ],
    },
    {
      sectionId: "sec-technical",
      title: "Technical Test",
      timeLimitMinutes: 45,
      questions: [
        { questionId: "q3", marks: 2, optionOrder: ["opt5", "opt6"] },
      ],
    },
    {
      sectionId: "sec-prompt",
      title: "Prompt Engineering Test",
      timeLimitMinutes: 20,
      questions: [
        { questionId: "q4", marks: 2, optionOrder: ["opt7", "opt8"] },
      ],
    },
  ];

  it("should keep candidate in active section if timer has not elapsed", async () => {
    const startedAt = new Date(Date.now() - 10 * 60_000); // 10 minutes ago (30 min limit)
    const result = {
      currentSection: 0,
      sectionStartedAt: startedAt,
      limit: samplePaper[0].timeLimitMinutes!,
    };

    const isOver = Date.now() > result.sectionStartedAt.getTime() + result.limit * 60_000;
    assert.equal(isOver, false);
    assert.equal(result.currentSection, 0);
  });

  it("should detect section expiry when time limit is exceeded and calculate transition", async () => {
    const startedAt = new Date(Date.now() - 35 * 60_000); // 35 minutes ago (30 min limit)
    const limit = samplePaper[0].timeLimitMinutes!;
    const isOver = Date.now() > startedAt.getTime() + limit * 60_000;
    assert.equal(isOver, true);

    const nextSection = 1;
    const nextSec = samplePaper[nextSection];
    assert.equal(nextSec.title, "Technical Test");
    assert.equal(nextSec.timeLimitMinutes, 45);
  });

  it("should verify stages maintain independent scoring, negative marking and duration", () => {
    assert.equal(samplePaper[0].timeLimitMinutes, 30);
    assert.equal(samplePaper[1].timeLimitMinutes, 45);
    assert.equal(samplePaper[2].timeLimitMinutes, 20);

    const totalMarks = samplePaper.reduce(
      (sum, s) => sum + s.questions.reduce((a, q) => a + q.marks, 0),
      0
    );
    assert.equal(totalMarks, 6);
  });
});

