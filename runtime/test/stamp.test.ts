import { test, expect } from "bun:test";
import { detectStamp, LOOP_SECTION_HEADING } from "../src/stamp";

const V1_DOC = `# Issue tracker: Linear

Some prose.

${LOOP_SECTION_HEADING}

How the loop talks to this tracker.
`;

const NO_SECTION_DOC = `# Issue tracker: GitHub

Some prose, but no loop section.
`;

test("a config carrying a stampVersion means the repo is stamped for v2", () => {
  expect(detectStamp({ configVersion: "2.0.0", adapterDoc: null })).toEqual({ k: "v2", version: "2.0.0" });
});

test("a v2 stamp is detected regardless of whether the version is current", () => {
  expect(detectStamp({ configVersion: "1.5.0", adapterDoc: V1_DOC })).toEqual({ k: "v2", version: "1.5.0" });
  expect(detectStamp({ configVersion: "9.9.9", adapterDoc: null })).toEqual({ k: "v2", version: "9.9.9" });
});

test("the config wins over the adapter doc when both are present", () => {
  expect(detectStamp({ configVersion: "2.0.0", adapterDoc: V1_DOC })).toEqual({ k: "v2", version: "2.0.0" });
});

test("no config plus an adapter doc carrying the loop section is a legacy v1 stamp", () => {
  expect(detectStamp({ configVersion: null, adapterDoc: V1_DOC })).toEqual({ k: "legacy-v1" });
});

test("an adapter doc WITHOUT the loop section is unstamped, not v1", () => {
  expect(detectStamp({ configVersion: null, adapterDoc: NO_SECTION_DOC })).toEqual({ k: "unstamped" });
});

test("no config and no adapter doc is unstamped", () => {
  expect(detectStamp({ configVersion: null, adapterDoc: null })).toEqual({ k: "unstamped" });
});

test("the loop section is matched as a heading, not as prose mentioning it", () => {
  const prose = `# Issue tracker: GitHub\n\nThis repo has no ${LOOP_SECTION_HEADING.replace(/^#+ /, "")} yet.\n`;
  expect(detectStamp({ configVersion: null, adapterDoc: prose })).toEqual({ k: "unstamped" });
});

test("the loop section heading is exactly what PROTOCOL names", () => {
  expect(LOOP_SECTION_HEADING).toBe("## Factory loop operations");
});
