import { describe, it } from "node:test";
import assert from "node:assert/strict";
process.env.JWT_SECRET = process.env.JWT_SECRET || "mock-secret-for-testing-purposes-123456789";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";

import {
  generateRandomSessionCode,
  hashSessionCode,
  normalizeSessionCode,
} from "./sessions";

describe("Session Code Security & Hashing Engine", () => {
  it("should generate unpredictable, well-formatted codes with prefix", () => {
    const code = generateRandomSessionCode("ZG-TECH");
    assert.match(code, /^ZG-TECH-[A-Z0-9]{3}-[A-Z0-9]{3}$/);

    const code2 = generateRandomSessionCode("APTI");
    assert.notEqual(code, code2);
  });

  it("should normalize and hash codes securely and deterministically", () => {
    const raw = " zg-tech-8472 ";
    const normalized = normalizeSessionCode(raw);
    assert.equal(normalized, "ZG-TECH-8472");

    const hash1 = hashSessionCode(normalized);
    const hash2 = hashSessionCode("ZG-TECH-8472");
    assert.equal(hash1, hash2);
    assert.equal(hash1.length, 64); // sha256 hex length
  });

  it("should generate unique hashes for different codes", () => {
    const hashA = hashSessionCode("ZANVAR2026");
    const hashB = hashSessionCode("APTI2026");
    assert.notEqual(hashA, hashB);
  });
});
