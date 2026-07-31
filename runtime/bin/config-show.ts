#!/usr/bin/env bun
// Edge entry (bun, fs + git allowed): reads `.factory/config.json` from the
// current directory, detects git facts, resolves effective settings via
// config.ts's pure `effective()`, and prints them as a setting/value/source
// table. Missing config prints the not-stamped message and exits 1 — no
// pure logic lives here, only gathering facts and handing them to config.ts.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { effective, parseConfig } from "../src/config";
import type { Detected, Effective, EffectiveSettings } from "../src/config";

const CONFIG_PATH = ".factory/config.json";

// ───── git facts

function detectDefaultBranch(): string {
  try {
    const ref = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const branch = ref.split("/").pop();
    if (branch) return branch;
  } catch {
    // no origin remote, no HEAD symref, or not a git repo at all — fall
    // through to the default below.
  }
  return "main";
}

function detect(): Detected {
  return {
    defaultBranch: detectDefaultBranch(),
    // No harness beyond Claude Code is wired up yet in this slice, and no
    // notification channel exists to detect — fixed until a later task
    // defines real detection for these.
    harnessKind: "claude-code",
    notificationChannel: "none",
  };
}

// ───── output

function printNotStamped(): void {
  console.error(`${CONFIG_PATH} not found — this repo is not stamped for the loop.`);
  console.error(`Fix: run the Factory stamp skill to create ${CONFIG_PATH}.`);
}

interface Row {
  setting: string;
  value: string;
  source: string;
}

function row(setting: string, entry: Effective<unknown> | undefined): Row | null {
  if (entry === undefined) return null;
  const value = typeof entry.value === "object" ? JSON.stringify(entry.value) : String(entry.value);
  return { setting, value, source: entry.source };
}

function printTable(settings: EffectiveSettings): void {
  const rows = [
    row("stampVersion", settings.stampVersion),
    row("tracker", settings.tracker),
    row("mergePolicy", settings.mergePolicy),
    row("mergeMethod", settings.mergeMethod),
    row("attackSurface", settings.attackSurface),
    row("maxWorkers", settings.maxWorkers),
    row("answerWindowMinutes", settings.answerWindowMinutes),
    row("contextBudget", settings.contextBudget),
    row("notifierCommand", settings.notifierCommand),
    row("trackerTokenVar", settings.trackerTokenVar),
    row("defaultBranch", settings.defaultBranch),
    row("notificationChannel", settings.notificationChannel),
    { setting: "lockPath", value: settings.lockPath, source: "fixed" },
    { setting: "journalPath", value: settings.journalPath, source: "fixed" },
  ].filter((r): r is Row => r !== null);

  console.table(rows);
}

// ───── main

function main(): void {
  if (!existsSync(CONFIG_PATH)) {
    printNotStamped();
    process.exit(1);
  }

  const raw = readFileSync(CONFIG_PATH, "utf8");
  const result = parseConfig(raw);
  if (!result.ok) {
    console.error(`${CONFIG_PATH} is invalid:`);
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  printTable(effective(result.config, detect()));
}

main();
