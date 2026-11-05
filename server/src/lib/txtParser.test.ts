import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTxtQuestions } from "./txtParser";

describe("TXT Question Parser Engine", () => {
  it("should parse Format A with multiple sections and explanations", () => {
    const text = `
APTITUDE TEST

Q1. What is 15% of 200?

A. 20
B. 25
C. 30
D. 35

Correct Answer: C
Explanation: 15% of 200 = 30.
Marks: 1
Difficulty: Easy

Q2. A train travels 120 km in 2 hours. What is its speed?

A. 40 km/h
B. 50 km/h
C. 60 km/h
D. 80 km/h

Correct Answer: C
Explanation: Speed = Distance / Time = 60 km/h.
Marks: 1
Difficulty: Easy

TECHNICAL TEST

Q3. Which data structure follows FIFO?

A. Stack
B. Queue
C. Tree
D. Graph

Correct Answer: B
Explanation: Queue follows First In First Out.
Marks: 2
Difficulty: Easy

PROMPT ENGINEERING TEST

Q4. What is the purpose of providing context in a prompt?

A. To increase token count
B. To improve relevance and accuracy
C. To disable hallucinations completely
D. To change the programming language

Correct Answer: B
Explanation: Context helps the model understand the task.
Marks: 2
Difficulty: Medium
`;

    const res = parseTxtQuestions(text);
    assert.equal(res.totalQuestions, 4);
    assert.equal(res.validQuestions, 4);
    assert.equal(res.sectionsDetected.length, 3);
    assert.equal(res.questions[0].sectionTitle, "APTITUDE TEST");
    assert.equal(res.questions[0].correctAnswers[0], "C");
    assert.equal(res.questions[0].marks, 1);
    assert.equal(res.questions[0].difficulty, "EASY");
    assert.equal(res.questions[2].sectionTitle, "TECHNICAL TEST");
    assert.equal(res.questions[2].correctAnswers[0], "B");
    assert.equal(res.questions[3].sectionTitle, "PROMPT ENGINEERING TEST");
  });

  it("should parse Format B and Format C questions", () => {
    const text = `
1) Which protocol is connection-oriented?
a) UDP
b) TCP
c) IP
d) ICMP
Correct Answer: b

Question: Which sorting algorithm has O(n log n) average time complexity?
Options:
- Bubble Sort
- Quick Sort
- Insertion Sort
- Selection Sort
Correct: B
Marks: 2
Difficulty: Medium
`;
    const res = parseTxtQuestions(text, "Technical");
    assert.equal(res.totalQuestions, 2);
    assert.equal(res.validQuestions, 2);
    assert.equal(res.questions[0].correctAnswers[0], "B");
    assert.equal(res.questions[1].correctAnswers[0], "B");
    assert.equal(res.questions[1].marks, 2);
  });

  it("should detect malformed questions, missing answers, and duplicates", () => {
    const text = `
Q1. Broken question without options or answers?

Q2. Question with missing answer
A. Option 1
B. Option 2

Q3. Duplicate question test
A. Option A
B. Option B
Answer: A

Q4. Duplicate question test
A. Option A
B. Option B
Answer: A
`;
    const res = parseTxtQuestions(text);
    assert.equal(res.totalQuestions, 4);
    assert.equal(res.questions[1].status, "MISSING_ANSWER");
    assert.equal(res.questions[3].status, "DUPLICATE");
    assert.ok(res.invalidQuestions > 0);
  });
});

