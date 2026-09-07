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

test("expands a resume-linked search with useful title synonyms for an engineering profile", () => {
  const terms = expandSearchKeywords(
    ["Backend Engineer"],
    { title: "Software Development Engineer II", skills: ["Node.js", "TypeScript", "Kubernetes", "AWS"], domains: [] },
  );
  assert.ok(terms.includes("Software Engineer II"));
  assert.ok(terms.includes("SDE 2"));
  // Skills span both the backend and cloud/DevOps taxonomy categories, so titles
  // from both should show up as synonyms.
  assert.ok(terms.some((term) => /software engineer|backend engineer/i.test(term)));
  assert.ok(terms.some((term) => /devops engineer|site reliability engineer|cloud engineer/i.test(term)));
  assert.equal(terms.length, new Set(terms).size);
});

test("expands a resume-linked search with useful title synonyms for a non-engineering profile", () => {
  // This is the generalization guarantee: a marketing resume should get marketing
  // title synonyms, not the engineering-only defaults the scorer used to assume.
  const terms = expandSearchKeywords(
    [],
    { title: "Digital Marketing Manager", skills: ["SEO", "Google Ads", "Content Marketing", "Google Analytics"], domains: [] },
  );
  assert.ok(terms.includes("Digital Marketing Manager"));
  assert.ok(terms.some((term) => /marketing manager|growth marketer|seo specialist|brand manager/i.test(term)));
  assert.ok(!terms.some((term) => /backend engineer|software engineer/i.test(term)));
  assert.equal(terms.length, new Set(terms).size);
});
