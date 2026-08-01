#!/usr/bin/env bun
// Edge entry (bun, fs allowed): the planning-lifecycle host loop, slice 5's
// capability end to end against the local markdown tracker fixture and
// phrasebook — reset the fixture (the committed default three plus the
// planning-artifact and needs-info/ready-for-human extras — see
// conformance/fixture.ts's EXTRA_TICKETS), then run each of the slice's own
// steps in order, verifying every one against the fixture files (or a
// fixture skills tree this host builds itself) rather than trusting a
// harness's claimed reply. Prints an honest per-step scoreboard and exits
// non-zero on any failure. Cleans up the tracker fixture and any scratch
// skills tree on every path.
//
// bun planning.ts [claude|codex|pi]   — defaults to claude
//
// THROWAWAY: no tests, no error handling beyond what keeps it runnable.

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  down,
  EXTRA_TICKETS,
  MILESTONE_COUNTS_SHAPE,
  milestoneCountsQuestion,
  OPEN_ISSUES_QUESTION,
  OPEN_ISSUES_SHAPE,
  readFixtureTicket,
  TICKET_FACTS_SHAPE,
  up,
} from "../conformance/fixture";
import { gatherAvailableRoles } from "../src/edges";
import { runHarness, type HarnessName } from "../src/harness";
import { askWithRetry, buildPrompt, type Runner } from "../src/askloop";
import { applyInvariants } from "../src/pick";
import { breakdown, emptyQueueReport } from "../src/queuereport";
import { ROLE_TABLE, resolveRoles } from "../src/roles";
import type { IssueState, TicketFacts } from "../src/tracker";

const DIR = import.meta.dir;
const PHRASEBOOK_PATH = join(DIR, "../conformance/phrasebook.md");

// Every id this host's fixture writes (the committed default three plus
// EXTRA_TICKETS — T-4's invisible-blocker fixture, T-6/T-7's planning
// artifacts, T-8/T-10's needs-info/ready-for-human tickets), read directly
// off disk for ground truth. Hardcoded rather than derived: bin/park.ts and
// bin/pick.ts both name their fixture ids directly the same way.
const ALL_IDS = ["T-1", "T-2", "T-3", "T-4", "T-6", "T-7", "T-8", "T-10"];
const PLANNING_ARTIFACT_IDS = ["T-6", "T-7"];
const MILESTONE = "M1";

// ───────────────────────────────────────────────────────────────── scoreboard

type Step = { name: string; status: string; ok: boolean; note?: string };

function step(name: string, status: string, ok: boolean, note?: string): Step {
  return { name, status, ok, note };
}

function printSteps(steps: Step[]): void {
  const cols = ["step", "status", "ok?", "note"];
  const rows = steps.map((s) => [s.name, s.status, s.ok ? "yes" : "no", s.note ?? ""]);
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log("\n=== scoreboard ===");
  console.log(line(cols));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) console.log(line(row));
}

// ───────────────────────────────────────────────── fixture skills tree (roles)

// Builds a scratch "home" holding every role implementation in its real
// on-disk shape — `.claude/skills/<name>` for a skill-kind one,
// `.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>` for a
// plugin-kind one — then reads it back through edges.ts's real
// gatherAvailableRoles rather than listing what it just wrote. `omit` is the
// one preferred implementation this run deliberately leaves out, so
// resolveRoles has to fall back for it.
function mkSkillsHome(omit: string): { home: string; available: string[] } {
  const home = mkdtempSync(join(tmpdir(), "factory-planning-skills-"));
  for (const spec of ROLE_TABLE) {
    for (const impl of [spec.preferred, spec.fallback]) {
      if (impl === null || impl.name === omit) continue;
      if (impl.k === "plugin") {
        const [pluginName, skillName] = impl.name.split(":");
        mkdirSync(join(home, ".claude", "plugins", "cache", "test-marketplace", pluginName, "0.0.0", "skills", skillName), {
          recursive: true,
        });
      } else {
        mkdirSync(join(home, ".claude", "skills", impl.name), { recursive: true });
      }
    }
  }
  return { home, available: gatherAvailableRoles(home) };
}

function rmSkillsHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

// ───────────────────────────────────────────────────────────────── argv

function parseHarness(argv: string[]): HarnessName {
  const name = argv[2];
  if (name === undefined) return "claude";
  if (name === "claude" || name === "codex" || name === "pi") return name;
  console.error("usage: bun planning.ts [claude|codex|pi]");
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────── main

function main(): void {
  const harness = parseHarness(process.argv);
  const phrasebook = readFileSync(PHRASEBOOK_PATH, "utf8");
  const steps: Step[] = [];

  // Captures the exact prompt string the runner is called with, for step 6's
  // prompt-inlined skill delivery check — the real string handed to
  // runHarness, not a copy independently reconstructed from buildPrompt.
  let lastPrompt = "";
  const runner: Runner = (prompt) => {
    lastPrompt = prompt;
    return runHarness(harness, prompt, DIR);
  };

  console.log(`\n=== ${harness} ===`);

  up(EXTRA_TICKETS);

  try {
    // ── step 1: tracker.openIssues — every open ticket, including the two
    // planning artifacts, with labels intact. Verified against the fixture
    // files, never against the agent's claim.
    const openIssuesShape = `${TICKET_FACTS_SHAPE}\n${OPEN_ISSUES_SHAPE}`;
    const openIssuesPrompt = buildPrompt(OPEN_ISSUES_QUESTION, phrasebook, openIssuesShape);
    const openIssuesOutcome = askWithRetry(runner, { k: "tracker.openIssues", milestone: null }, openIssuesPrompt);
    const openIssuesAskOk = openIssuesOutcome.status !== "failed" && openIssuesOutcome.answer.result === "ok";
    steps.push(
      step(
        "tracker.openIssues",
        openIssuesOutcome.status,
        openIssuesAskOk,
        openIssuesOutcome.status === "failed" ? openIssuesOutcome.whys[1] : undefined,
      ),
    );

    const openTickets: TicketFacts[] = openIssuesAskOk ? openIssuesOutcome.answer.tickets : [];
    const returnedIds = new Set(openTickets.map((t) => t.id));
    const everyTicketPresent = ALL_IDS.every((id) => returnedIds.has(id));
    steps.push(
      step(
        "verify file: every open ticket listed",
        everyTicketPresent ? "all present" : "missing some",
        everyTicketPresent,
        `expected ${ALL_IDS.join(",")}; got ${[...returnedIds].sort().join(",")}`,
      ),
    );

    const t6 = openTickets.find((t) => t.id === "T-6");
    const t7 = openTickets.find((t) => t.id === "T-7");
    const labelsIntact =
      t6 !== undefined && t6.labels.includes("wayfinder:map") && t7 !== undefined && t7.labels.includes("planning:prd");
    steps.push(
      step(
        "verify file: planning-artifact labels intact",
        labelsIntact ? "intact" : "dropped or wrong",
        labelsIntact,
        `T-6 labels=${JSON.stringify(t6?.labels)}; T-7 labels=${JSON.stringify(t7?.labels)}`,
      ),
    );

    // ── step 2: applyInvariants over the openIssues list — both planning
    // artifacts must land in `excluded`, including T-6 (deliberately ready).
    const { eligible, excluded } = applyInvariants({ candidates: openTickets, scope: { k: "everything" } });
    const excludedIds = new Set(excluded.map((e) => e.id));
    const eligibleIds = new Set(eligible.map((t) => t.id));
    const bothExcluded = PLANNING_ARTIFACT_IDS.every((id) => excludedIds.has(id) && !eligibleIds.has(id));
    steps.push(
      step(
        "applyInvariants: planning artifacts excluded",
        bothExcluded ? "excluded" : "leaked into eligible",
        bothExcluded,
        `excluded=${[...excludedIds].sort().join(",")}`,
      ),
    );

    // ── step 3: tracker.milestoneCounts — every state count matches the
    // fixture, read directly off disk (T-8 unstarted, T-10 started, both
    // milestone "M1"; nothing else carries that milestone).
    const countsPrompt = buildPrompt(milestoneCountsQuestion(MILESTONE), phrasebook, MILESTONE_COUNTS_SHAPE);
    const countsOutcome = askWithRetry(runner, { k: "tracker.milestoneCounts", milestone: MILESTONE }, countsPrompt);
    const countsAskOk = countsOutcome.status !== "failed" && countsOutcome.answer.result === "ok";
    steps.push(
      step(
        "tracker.milestoneCounts",
        countsOutcome.status,
        countsAskOk,
        countsOutcome.status === "failed" ? countsOutcome.whys[1] : undefined,
      ),
    );

    const groundTruthCounts: Record<IssueState, number> = { unstarted: 0, started: 0, parked: 0, done: 0, canceled: 0 };
    for (const id of ALL_IDS) {
      const t = readFixtureTicket(id);
      if (t.milestone === MILESTONE) groundTruthCounts[t.state]++;
    }
    const agentCounts = countsAskOk ? countsOutcome.answer.counts : null;
    const countsMatch =
      agentCounts !== null &&
      (["unstarted", "started", "parked", "done", "canceled"] as IssueState[]).every(
        (s) => agentCounts[s] === groundTruthCounts[s],
      );
    steps.push(
      step(
        "verify file: milestoneCounts match",
        countsMatch ? "match" : "mismatch",
        countsMatch,
        `fixture=${JSON.stringify(groundTruthCounts)}; agent=${JSON.stringify(agentCounts)}`,
      ),
    );

    // ── step 4: emptyQueueReport with milestone scope — the breakdown's four
    // counts, checked against a count taken directly from the fixture files
    // (not from the agent's step-1 answer).
    const groundTruthOpenIssues = ALL_IDS.map(readFixtureTicket);
    const groundTruthBreakdown = breakdown(groundTruthOpenIssues);
    const report = emptyQueueReport({
      scope: { k: "milestone", milestone: MILESTONE },
      openIssues: openTickets,
      counts: agentCounts,
      mode: "headless",
    });
    const breakdownMatches =
      report.breakdown !== null &&
      report.breakdown.open === groundTruthBreakdown.open &&
      report.breakdown.readyForHuman === groundTruthBreakdown.readyForHuman &&
      report.breakdown.needsInfo === groundTruthBreakdown.needsInfo &&
      report.breakdown.blocked === groundTruthBreakdown.blocked;
    steps.push(
      step(
        "emptyQueueReport: breakdown matches fixture",
        breakdownMatches ? "match" : "mismatch",
        breakdownMatches,
        `fixture=${JSON.stringify(groundTruthBreakdown)}; report=${JSON.stringify(report.breakdown)}`,
      ),
    );

    // ── step 5: role resolution — a fixture skills tree with "to-prd"
    // (write-spec's preferred implementation) removed, so write-spec has to
    // fall back to "to-spec". Pure: no harness call.
    const skillsHome = mkSkillsHome("to-prd");
    try {
      const resolution = resolveRoles(skillsHome.available);
      const writeSpec = resolution.resolved.find((r) => r.role === "write-spec");
      const fallbackOk =
        resolution.failures.length === 0 &&
        writeSpec !== undefined &&
        writeSpec.selected === "to-spec" &&
        writeSpec.via === "fallback";
      steps.push(
        step(
          "resolveRoles: fallback exercised",
          fallbackOk ? "fell back to to-spec" : "did not fall back as expected",
          fallbackOk,
          JSON.stringify({ writeSpec, failures: resolution.failures.length }),
        ),
      );
    } finally {
      rmSkillsHome(skillsHome.home);
    }

    // ── step 6: prompt-inlined skill delivery — the phrasebook text is
    // present, byte-identical, in the actual prompt string handed to the
    // runner for the last ask above (captured, not reconstructed).
    const phrasebookInlined = lastPrompt.includes(phrasebook);
    steps.push(
      step(
        "prompt-inlined skill delivery",
        phrasebookInlined ? "present, byte-identical" : "missing or altered",
        phrasebookInlined,
      ),
    );

    printSteps(steps);
    const allOk = steps.every((s) => s.ok);
    console.log(`\noverall: ${allOk ? "PASS" : "FAIL"}`);
    if (!allOk) process.exitCode = 1;
  } finally {
    down();
  }
}

main();
