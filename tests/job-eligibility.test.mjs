import assert from "node:assert/strict";
import test from "node:test";

import { assessIndiaEligibility, expandSearchKeywords } from "../lib/job-eligibility.ts";

test("classifies India and worldwide-remote eligibility conservatively", () => {
  assert.equal(assessIndiaEligibility({ location: "Bengaluru, India", workMode: "Hybrid" }).status, "INDIA_BASED");
  assert.equal(assessIndiaEligibility({ location: "Remote - India", workMode: "Remote" }).status, "REMOTE_INDIA");
  assert.equal(assessIndiaEligibility({ location: "Worldwide", workMode: "Remote" }).status, "REMOTE_WORLDWIDE");
  assert.equal(assessIndiaEligibility({ location: "APAC", workMode: "Remote" }).status, "REMOTE_APAC");
  assert.equal(assessIndiaEligibility({ location: "Remote", workMode: "Remote", description: "We hire international contractors." }).status, "REMOTE_CONTRACTOR");
  assert.equal(assessIndiaEligibility({ location: "Remote", workMode: "Remote" }).decision, "VERIFY");
  assert.equal(assessIndiaEligibility({ location: "USA", workMode: "Remote", eligibilityHint: "USA" }).status, "REMOTE_RESTRICTED");
  assert.equal(assessIndiaEligibility({ location: "Europe only", workMode: "Remote" }).decision, "INELIGIBLE");
  assert.equal(assessIndiaEligibility({ location: "London", workMode: "On-site" }).status, "OTHER_LOCATION");
});

test("expands a resume-linked search with useful title synonyms", () => {
  const terms = expandSearchKeywords(
    ["Backend Engineer"],
    { title: "Software Development Engineer II", skills: ["Node.js", "TypeScript"], domains: ["Distributed systems", "AI voice agent"] },
  );
  assert.ok(terms.includes("Software Engineer II"));
  assert.ok(terms.includes("SDE 2"));
  assert.ok(terms.includes("Platform Engineer"));
  assert.ok(terms.includes("AI Platform Engineer"));
  assert.ok(terms.includes("Node.js Engineer"));
  assert.equal(terms.length, new Set(terms).size);
});
