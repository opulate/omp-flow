/**
 * Smoke test — verify core omp-flow logic works correctly.
 *
 * Run: bun run src/state-machine/smoke-test.ts
 */

import { createInitialContext, ARTIFACT_KEYS } from "./types.js";
import type { CouncilFinding, ApprovalRecord } from "./types.js";
import { loadState, writeState } from "../integrity/state-persistence.js";
import { computeHash, computeHashString, computeHashWithContent } from "../integrity/hash.js";
import {
  guardPlanningToAwaitingDesignReview,
  guardAwaitingDesignReviewToAwaitingApproval,
  guardAwaitingDesignReviewToPlanning,
  guardAwaitingApprovalToImplementing,
  guardImplementingToAwaitingCouncil,
  guardAwaitingCouncilToValidating,
  guardAwaitingCouncilToImplementing,
  guardValidatingToRetro,
  guardValidatingToImplementing,
  guardRetroToAwaitingMerge,
  guardAwaitingMergeToDone,
  guardToBlocked,
  guardBlockedToPrevious,
  validateContractStructure,
} from "./guards.js";
import { createWorkflowMachine } from "./machine.js";
import { createActor } from "xstate";
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}`);
  }
}

// Helper: create a finding with required lifecycle fields
function makeFinding(overrides: Partial<CouncilFinding> = {}): CouncilFinding {
  return {
    id: "finding-001",
    severity: "P0",
    description: "Test finding",
    trigger_conditions: "Happens when X occurs",
    artifact_path: "/src/foo.ts",
    status: "open",
    raised_at: new Date().toISOString(),
    ...overrides,
  };
}

// Helper: create an ApprovalRecord for tests
function makeApproval(approved: boolean): ApprovalRecord {
  return {
    approved,
    approved_by: "Operator",
    approved_at: new Date().toISOString(),
    method: "tool-call",
  };
}

// Ensure test directory exists
const testDir = ".omp/workflow";
if (!existsSync(testDir)) {
  mkdirSync(testDir, { recursive: true });
}

// ── 1. Types & Initial Context ────────────────────────────────────
console.log("\n1. Types & Initial Context");
const ctx = createInitialContext();
assert(ctx.schema_version === 4, "schema_version is 4 (v4 design findings)");
assert(Array.isArray(ctx.state_history), "state_history is array");
assert(ctx.state_history.length === 0, "state_history is empty initially");
assert(ctx.state === "PLANNING", "initial state is PLANNING");
assert(ctx.previous_state === null, "no previous state");
assert(Object.keys(ctx.artifacts).length === 0, "no artifacts");
assert(ctx.council_sign_off === null, "council_sign_off is null");
assert(ctx.operator_approval === null, "operator_approval is null");
assert(ctx.block_reason === null, "block_reason is null");
assert(ctx.current_issue === null, "current_issue is null (v2)");
assert(ctx.issue_board_url === null, "issue_board_url is null (v2)");
assert(ctx.prd_summary === null, "prd_summary is null (v2)");
assert(Array.isArray(ctx.findings_history), "findings_history is array");
assert(ctx.findings_history.length === 0, "findings_history is empty");
assert(Array.isArray(ctx.design_findings_open), "design_findings_open is array");
assert(ctx.design_findings_open.length === 0, "design_findings_open is empty");
assert(Array.isArray(ctx.design_findings_history), "design_findings_history is array");
assert(ctx.design_findings_history.length === 0, "design_findings_history is empty");

// ── 2. State Persistence ──────────────────────────────────────────
console.log("\n2. State Persistence");
// Save current on-disk state for later restoration
const savedState = loadState();
// Bypass writeState artifact check for test setup — write clean state directly
writeFileSync(".omp/workflow/state.json", JSON.stringify({ schema_version: 3, state: "PLANNING", state_history: [], previous_state: null, current_pr: null, feature_branch: null, artifacts: {}, council_sign_off: null, operator_approval: null, findings_open: [], findings_history: [], block_reason: null, transitioned_at: null, transitioned_by: null, current_issue: null, issue_board_url: null, prd_summary: null }, null, 2));
const loaded = loadState();
assert(loaded.state === "PLANNING", "round-trip preserves state");
assert(loaded.schema_version === 4, "round-trip preserves schema_version (migrated to v4)");
assert(loaded.artifacts !== undefined, "round-trip preserves artifacts");
assert(loaded.findings_open !== undefined, "round-trip preserves findings");
assert(loaded.block_reason === null, "round-trip preserves block_reason");
assert(Array.isArray(loaded.state_history), "round-trip preserves state_history");
assert(loaded.current_issue === null, "round-trip preserves current_issue as null");
assert(loaded.issue_board_url === null, "round-trip preserves issue_board_url as null");
assert(loaded.prd_summary === null, "round-trip preserves prd_summary as null");
assert(Array.isArray(loaded.design_findings_open), "round-trip preserves design_findings_open");
assert(loaded.design_findings_open.length === 0, "round-trip preserves design_findings_open as empty");
assert(Array.isArray(loaded.design_findings_history), "round-trip preserves design_findings_history");
 writeFileSync(".omp/workflow/state.json", JSON.stringify(savedState, null, 2));

// 2b. writeState allows artifact clearing during DONE→PLANNING reset
console.log("2b. writeState allows artifact clearing on reset");
// Simulate DONE state with artifacts on disk
const doneWithArtifacts = {
  schema_version: 4, state: "DONE", state_history: [], previous_state: "AWAITING_MERGE",
  current_pr: null, feature_branch: null,
  artifacts: { "design-doc": { path: ".omp/workflow/_fake.md", sha256: "aaaa", sealed_at: new Date().toISOString(), sealed_by: "Planner" } },
  council_sign_off: null, operator_approval: null, findings_open: [], design_findings_open: [], design_findings_history: [], findings_history: [],
  block_reason: null, transitioned_at: new Date().toISOString(), transitioned_by: "Operator",
  current_issue: null, issue_board_url: null, prd_summary: null,
};
writeFileSync(".omp/workflow/state.json", JSON.stringify(doneWithArtifacts, null, 2));
// Simulate the reset context: empty artifacts, PLANNING state, previous_state DONE
const resetCtx = { ...doneWithArtifacts, state: "PLANNING", previous_state: "DONE", artifacts: {} };
let wroteOk = false;
try {
  writeState(resetCtx as any);
  wroteOk = true;
} catch (e) {
  wroteOk = false;
}
assert(wroteOk, "writeState allows artifact clearing during DONE→PLANNING reset");
const verifyReset = JSON.parse(readFileSync(".omp/workflow/state.json", "utf-8"));
assert(Object.keys(verifyReset.artifacts ?? {}).length === 0, "reset state has empty artifacts");
// Restore
writeFileSync(".omp/workflow/state.json", JSON.stringify(savedState, null, 2));
console.log(" ✓ PASS");
 // ── 3. SHA-256 Hashing ────────────────────────────────────────────
console.log("\n3. SHA-256 Hashing");

// 3a. Basic computeHash (backward compat)
const testFile = ".omp/workflow/_test-file.txt";
writeFileSync(testFile, "hello world");
const hash = computeHash(testFile);
assert(hash !== null, "hash computed for existing file");
assert(hash!.length === 64, "SHA-256 produces 64-char hex string");
assert(hash === computeHashString("hello world"), "file hash matches string hash of content");

// 3b. Missing file
const missingHash = computeHash(".omp/workflow/_nonexistent.txt");
assert(missingHash === null, "null for nonexistent file");

// 3c. Modified file produces different hash
writeFileSync(testFile, "hello world 2");
const hash2 = computeHash(testFile);
assert(hash !== hash2, "modified file produces different hash");

// 3d. computeHashWithContent — discriminated result
const hashResult = computeHashWithContent(testFile);
assert(hashResult.status === "ok", "computeHashWithContent returns ok for existing file");
if (hashResult.status === "ok") {
  assert(hashResult.hash.length === 64, "computeHashWithContent hash is 64-char hex");
  assert(hashResult.content === "hello world 2", "computeHashWithContent returns file content");
  assert(hashResult.hash === computeHash(testFile), "computeHashWithContent hash matches computeHash");
}

// 3e. computeHashWithContent — not found
const missingResult = computeHashWithContent(".omp/workflow/_nonexistent.txt");
assert(missingResult.status === "not_found", "computeHashWithContent returns not_found for missing file");

// 3f. computeHashWithContent — error on directory
const dirResult = computeHashWithContent(".omp/workflow");
assert(dirResult.status === "error", "computeHashWithContent returns error for directory");
unlinkSync(testFile);

// ── 4. Guards ─────────────────────────────────────────────────────
console.log("\n4. Guards");

// 4a. Planning → Awaiting Design Review — blocked without design doc
const ctx4a = createInitialContext();
let result = guardPlanningToAwaitingDesignReview(ctx4a);
assert(!result.allowed, "planning→design-review: blocked without design doc");

// 4b. With design doc but no contract — blocked
const designDocPath = ".omp/workflow/_test-design.md";
writeFileSync(designDocPath, "# Design Doc\n\nPhase 1 plan.");
ctx4a.artifacts[ARTIFACT_KEYS.DESIGN_DOC] = {
  path: designDocPath,
  hash: computeHashString("# Design Doc\n\nPhase 1 plan."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardPlanningToAwaitingDesignReview(ctx4a);
assert(!result.allowed, "planning→design-review: blocked without validation contract");

// 4c. With design doc + structured contract — passes
const contractPath = ".omp/workflow/_test-contract.md";
const contractJson = JSON.stringify({
  version: 1,
  scope: { files: ["src/state-machine/types.ts", "src/state-machine/guards.ts"] },
  assertions: [{ type: "typecheck", description: "bun run typecheck" }],
});
const contractContent = "```json\n" + contractJson + "\n```\n";
writeFileSync(contractPath, contractContent);
ctx4a.artifacts[ARTIFACT_KEYS.VALIDATION_CONTRACT] = {
  path: contractPath,
  hash: computeHashString(contractContent),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardPlanningToAwaitingDesignReview(ctx4a);
assert(result.allowed, "planning→design-review: passes with design doc + contract");

// 4d. Modified design doc (hash mismatch) — blocked
writeFileSync(designDocPath, "# Design Doc\n\nModified content.");
result = guardPlanningToAwaitingDesignReview(ctx4a);
assert(!result.allowed, "planning→design-review: blocked on hash mismatch");
writeFileSync(designDocPath, "# Design Doc\n\nPhase 1 plan.");
result = guardPlanningToAwaitingDesignReview(ctx4a);
assert(result.allowed, "planning→design-review: passes after restore");

// 4e. Design Review → Awaiting Approval — blocked without council sign-off
const ctx4e = createInitialContext();
ctx4e.state = "AWAITING_DESIGN_REVIEW";
ctx4e.artifacts[ARTIFACT_KEYS.DESIGN_DOC] = {
  path: designDocPath,
  hash: computeHashString("# Design Doc\n\nPhase 1 plan."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardAwaitingDesignReviewToAwaitingApproval(ctx4e);
assert(!result.allowed, "design-review→approval: blocked without council sign-off");
assert(result.reason!.includes("pending"), "design-review→approval: message says pending for null");

// 4f. Design Review → Awaiting Approval — council sign-off denied
ctx4e.council_sign_off = makeApproval(false);
result = guardAwaitingDesignReviewToAwaitingApproval(ctx4e);
assert(!result.allowed, "design-review→approval: blocked on denied sign-off");
assert(result.reason!.includes("denied"), "design-review→approval: message says denied for false");

// 4g. Design Review → Awaiting Approval — with sign-off + design doc — passes
ctx4e.council_sign_off = makeApproval(true);
result = guardAwaitingDesignReviewToAwaitingApproval(ctx4e);
assert(result.allowed, "design-review→approval: passes with sign-off + design doc");

// 4h. Design Review → Awaiting Approval — blocked with open design P0
ctx4e.design_findings_open = [
  makeFinding({ id: "df-1", severity: "P0", description: "Design flaw in auth", trigger_conditions: "Happens when user has no email", status: "open" }),
];
result = guardAwaitingDesignReviewToAwaitingApproval(ctx4e);
assert(!result.allowed, "design-review→approval: blocked with open design P0");
assert(result.reason!.includes("open P0/P1"), "design-review→approval: message mentions open findings");

// 4i. Design Review → Awaiting Approval — passes with addressed design findings
ctx4e.design_findings_open = [
  makeFinding({ id: "df-1", severity: "P0", description: "Design flaw in auth", trigger_conditions: "Happens when user has no email", status: "addressed", addressed_at: new Date().toISOString() }),
];
result = guardAwaitingDesignReviewToAwaitingApproval(ctx4e);
assert(result.allowed, "design-review→approval: passes with addressed design findings");

// 4j. Design Review → Planning — always allowed
result = guardAwaitingDesignReviewToPlanning(createInitialContext());
assert(result.allowed, "design-review→planning: always allowed");

// Cleanup
unlinkSync(designDocPath);
unlinkSync(contractPath);

// ── Operator Approval Tests ────────────────────────────────────

// 4k. Awaiting Approval → Implementing — blocked without operator approval
const ctx4k = createInitialContext();
ctx4k.state = "AWAITING_OPERATOR_APPROVAL";
result = guardAwaitingApprovalToImplementing(ctx4k);
assert(!result.allowed, "approval→implementing: blocked without operator approval");
assert(result.reason!.includes("pending"), "approval→implementing: message says pending for null");

// 4j. Implementing → Council — blocked without impl-complete
const ctx4j = createInitialContext();
ctx4j.state = "IMPLEMENTING";
ctx4j.feature_branch = "feat/omp-flow-phase-1";
result = guardImplementingToAwaitingCouncil(ctx4j);
assert(!result.allowed, "implementing→council: blocked without impl-complete");

// 4k. With impl-complete + feature branch — passes
const implPath = ".omp/workflow/_test-impl.md";
writeFileSync(implPath, "Implementation complete.");
ctx4j.artifacts[ARTIFACT_KEYS.IMPL_COMPLETE] = {
  path: implPath,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
result = guardImplementingToAwaitingCouncil(ctx4j);
assert(result.allowed, "implementing→council: passes with impl-complete + feature branch");
unlinkSync(implPath);

// 4l. Implementing on "main" — blocked
const ctx4l = createInitialContext();
ctx4l.state = "IMPLEMENTING";
ctx4l.feature_branch = "main";
const implPath2 = ".omp/workflow/_test-impl2.md";
writeFileSync(implPath2, "Implementation complete.");
ctx4l.artifacts[ARTIFACT_KEYS.IMPL_COMPLETE] = {
  path: implPath2,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
result = guardImplementingToAwaitingCouncil(ctx4l);
assert(!result.allowed, "implementing→council: blocked on main branch");
unlinkSync(implPath2);

// 4m. Implementing on "master" — blocked
const ctx4m = createInitialContext();
ctx4m.state = "IMPLEMENTING";
ctx4m.feature_branch = "master";
const implPath3 = ".omp/workflow/_test-impl3.md";
writeFileSync(implPath3, "Implementation complete.");
ctx4m.artifacts[ARTIFACT_KEYS.IMPL_COMPLETE] = {
  path: implPath3,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
result = guardImplementingToAwaitingCouncil(ctx4m);
assert(!result.allowed, "implementing→council: blocked on master branch");
unlinkSync(implPath3);

// 4n. Implementing → Council — blocked with unaddressed P0 findings
const ctx4n = createInitialContext();
ctx4n.state = "IMPLEMENTING";
ctx4n.feature_branch = "feat/fix-findings";
const implPath4 = ".omp/workflow/_test-impl4.md";
writeFileSync(implPath4, "Implementation complete.");
ctx4n.artifacts[ARTIFACT_KEYS.IMPL_COMPLETE] = {
  path: implPath4,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
ctx4n.findings_open = [
  makeFinding({ id: "f-1", severity: "P0", description: "Critical bug", status: "open" }),
];
result = guardImplementingToAwaitingCouncil(ctx4n);
assert(!result.allowed, "implementing→council: blocked with unaddressed P0");
unlinkSync(implPath4);

// 4o. Implementing → Council — passes with addressed findings
const ctx4o = createInitialContext();
ctx4o.state = "IMPLEMENTING";
ctx4o.feature_branch = "feat/fix-findings";
const implPath5 = ".omp/workflow/_test-impl5.md";
writeFileSync(implPath5, "Implementation complete.");
ctx4o.artifacts[ARTIFACT_KEYS.IMPL_COMPLETE] = {
  path: implPath5,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
ctx4o.findings_open = [
  makeFinding({ id: "f-1", severity: "P0", description: "Critical bug", status: "addressed", addressed_at: new Date().toISOString() }),
];
result = guardImplementingToAwaitingCouncil(ctx4o);
assert(result.allowed, "implementing→council: passes with addressed P0");
unlinkSync(implPath5);

// 4p. Council → Validating — blocked with open P0
const ctx4p = createInitialContext();
ctx4p.state = "AWAITING_COUNCIL_REVIEW";
const reportPath = ".omp/workflow/_test-report.md";
writeFileSync(reportPath, "Council report: 1 P0 finding.");
ctx4p.artifacts[ARTIFACT_KEYS.COUNCIL_REPORT] = {
  path: reportPath,
  hash: computeHashString("Council report: 1 P0 finding."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Council",
};
ctx4p.findings_open = [
  makeFinding({ id: "f-1", severity: "P0", description: "Critical bug in auth", trigger_conditions: "Happens on every login with null email", artifact_path: "/src/auth.ts", status: "open" }),
];
result = guardAwaitingCouncilToValidating(ctx4p);
assert(!result.allowed, "council→validating: blocked with open P0");

// 4q. Findings resolved — passes
ctx4p.findings_open = [];
result = guardAwaitingCouncilToValidating(ctx4p);
assert(result.allowed, "council→validating: passes with no open findings");
unlinkSync(reportPath);

// 4r. Council → Validating — blocked on P1 without trigger conditions
const ctx4r = createInitialContext();
ctx4r.state = "AWAITING_COUNCIL_REVIEW";
const reportPath2 = ".omp/workflow/_test-report2.md";
writeFileSync(reportPath2, "Council report.");
ctx4r.artifacts[ARTIFACT_KEYS.COUNCIL_REPORT] = {
  path: reportPath2,
  hash: computeHashString("Council report."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Council",
};
ctx4r.findings_open = [
  makeFinding({ id: "f-2", severity: "P1", description: "Slow query", trigger_conditions: "", status: "closed" }),
];
result = guardAwaitingCouncilToValidating(ctx4r);
assert(!result.allowed, "council→validating: blocked on P1 without trigger conditions");
unlinkSync(reportPath2);

// 4s. Validating → Retro — blocked without report
const vReportPath = ".omp/workflow/_test-vreport.md";
writeFileSync(vReportPath, "Validation passed: all assertions OK.");
const ctx4s = createInitialContext();
ctx4s.state = "VALIDATING";
result = guardValidatingToRetro(ctx4s);
assert(!result.allowed, "validating→retro: blocked without validation report");

// 4t. With validation report — passes
ctx4s.artifacts[ARTIFACT_KEYS.VALIDATION_REPORT] = {
  path: vReportPath,
  hash: computeHashString("Validation passed: all assertions OK."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Validator",
};
result = guardValidatingToRetro(ctx4s);
assert(result.allowed, "validating→retro: passes with validation report");
unlinkSync(vReportPath);

// 4u. Validating → Retro — hash mismatch (report modified after sealing)
const vReportPath2 = ".omp/workflow/_test-vreport2.md";
writeFileSync(vReportPath2, "Validation passed: all assertions OK.");
const ctx4u = createInitialContext();
ctx4u.state = "VALIDATING";
ctx4u.artifacts[ARTIFACT_KEYS.VALIDATION_REPORT] = {
  path: vReportPath2,
  hash: computeHashString("Validation passed: all assertions OK."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Validator",
};
writeFileSync(vReportPath2, "Validation passed: MODIFIED AFTER SEAL.");
result = guardValidatingToRetro(ctx4u);
assert(!result.allowed, "validating→retro: blocked on hash mismatch");
unlinkSync(vReportPath2);

// 4v. Council → Validating — hash mismatch (report modified after sealing)
const councilReportPath3 = ".omp/workflow/_test-council-report3.md";
writeFileSync(councilReportPath3, "Council report: all clear.");
const ctx4v = createInitialContext();
ctx4v.state = "AWAITING_COUNCIL_REVIEW";
ctx4v.artifacts[ARTIFACT_KEYS.COUNCIL_REPORT] = {
  path: councilReportPath3,
  hash: computeHashString("Council report: all clear."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Council",
};
writeFileSync(councilReportPath3, "Council report: MODIFIED AFTER SEAL.");
result = guardAwaitingCouncilToValidating(ctx4v);
assert(!result.allowed, "council→validating: blocked on hash mismatch");
unlinkSync(councilReportPath3);

// 4w. Retro → Awaiting Merge — basic pass
const retroPath = ".omp/workflow/_test-retro.md";
writeFileSync(retroPath, "Retro: all good.");
const ctx4w = createInitialContext();
ctx4w.state = "RETRO";
result = guardRetroToAwaitingMerge(ctx4w);
assert(!result.allowed, "retro→merge: blocked without retro doc");
ctx4w.artifacts[ARTIFACT_KEYS.RETRO_DOC] = {
  path: retroPath,
  hash: computeHashString("Retro: all good."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Retro",
};
result = guardRetroToAwaitingMerge(ctx4w);
assert(result.allowed, "retro→merge: passes with sealed retro doc");

// 4x. Retro → Awaiting Merge — hash mismatch
writeFileSync(retroPath, "Retro: MODIFIED AFTER SEAL.");
result = guardRetroToAwaitingMerge(ctx4w);
assert(!result.allowed, "retro→merge: blocked on hash mismatch");
unlinkSync(retroPath);

// 4y. Awaiting Merge → Done — blocked without approval, distinct messages
const ctx4y = createInitialContext();
ctx4y.state = "AWAITING_MERGE";
result = guardAwaitingMergeToDone(ctx4y);
assert(!result.allowed, "merge→done: blocked without operator approval");
assert(result.reason!.includes("pending"), "merge→done: message says pending for null");
ctx4y.operator_approval = makeApproval(false);
result = guardAwaitingMergeToDone(ctx4y);
assert(!result.allowed, "merge→done: blocked on denied approval");
assert(result.reason!.includes("denied"), "merge→done: message says denied for false");
ctx4y.operator_approval = makeApproval(true);
result = guardAwaitingMergeToDone(ctx4y);
assert(result.allowed, "merge→done: passes with operator approval");

// 4z. Always-allowed guards
result = guardAwaitingDesignReviewToPlanning(createInitialContext());
assert(result.allowed, "design-review→planning: always allowed");
result = guardAwaitingCouncilToImplementing(createInitialContext());
assert(result.allowed, "council→implementing: always allowed");
result = guardValidatingToImplementing(createInitialContext());
result = guardToBlocked(createInitialContext());
assert(result.allowed, "any→blocked: always allowed");

// 4aa. guardBlockedToPrevious
const ctx4aa = createInitialContext();
ctx4aa.previous_state = "VALIDATING";
result = guardBlockedToPrevious(ctx4aa);
assert(result.allowed, "blocked→previous: passes with previous_state");
ctx4aa.previous_state = null;
result = guardBlockedToPrevious(ctx4aa);
assert(!result.allowed, "blocked→previous: blocked without previous_state");

// ── 5. XState Machine ────────────────────────────────────────────
console.log("\n5. XState Machine");

const testMachine = createWorkflowMachine(createInitialContext());
const actor = createActor(testMachine);
const snapshot = actor.getSnapshot();
assert(snapshot.value === "PLANNING", "machine starts in PLANNING");

// Machine with design doc + contract in context (ready for PLANNING → AWAITING_DESIGN_REVIEW)
const ctx5 = createInitialContext();
const designDocMachinePath = ".omp/workflow/_test-design-machine.md";
writeFileSync(designDocMachinePath, "# Test");
ctx5.artifacts[ARTIFACT_KEYS.DESIGN_DOC] = {
  path: designDocMachinePath,
  hash: computeHashString("# Test"),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
const contractMachinePath = ".omp/workflow/_test-contract-machine.md";
writeFileSync(contractMachinePath, "```json\n" + JSON.stringify({ version: 1, scope: { files: ["src/test.ts"] }, assertions: [{ type: "test", description: "run tests" }] }) + "\n```\n");
ctx5.artifacts[ARTIFACT_KEYS.VALIDATION_CONTRACT] = {
  path: contractMachinePath,
  hash: computeHashString(readFileSync(contractMachinePath, "utf-8")),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
const machine2 = createWorkflowMachine(ctx5);
const actor2 = createActor(machine2);
const snap2 = actor2.getSnapshot();
assert(snap2.value === "PLANNING", "machine initial state matches context state");
unlinkSync(designDocMachinePath);
unlinkSync(contractMachinePath);

// ── 6. BLOCK Event Stores block_reason ────────────────────────────
console.log("\n6. BLOCK Event Stores block_reason");
const ctx6 = createInitialContext();
const blockMachine = createWorkflowMachine(ctx6);
const blockActor = createActor(blockMachine);
blockActor.start();
let blockSnap = blockActor.getSnapshot();
assert(blockSnap.context.block_reason === null, "block_reason initially null");

blockActor.send({ type: "BLOCK", reason: "Guard failed: hash mismatch" });
blockSnap = blockActor.getSnapshot();
assert(blockSnap.value === "BLOCKED", "machine transitions to BLOCKED");
assert(blockSnap.context.block_reason === "Guard failed: hash mismatch", "block_reason stored in context");
assert(blockSnap.context.previous_state === "PLANNING", "previous_state recorded");

// ── 7. BLOCKED → RESET with guardBlockedToPrevious ────────────────
console.log("\n7. BLOCKED → RESET");

// 7a. RESET with previous_state set — guard allows, machine goes to PLANNING
// (the workflow_transition tool reads previous_state before reset to redirect)
const ctx7a = createInitialContext();
ctx7a.state = "BLOCKED";
ctx7a.previous_state = "VALIDATING";
ctx7a.block_reason = "test block";
const machine7a = createWorkflowMachine(ctx7a);
const actor7a = createActor(machine7a);
actor7a.start();
let snap7a = actor7a.getSnapshot();
assert(snap7a.value === "BLOCKED", "machine starts in BLOCKED");
assert(snap7a.context.previous_state === "VALIDATING", "previous_state preserved for tool redirect");

actor7a.send({ type: "RESET" });
snap7a = actor7a.getSnapshot();
assert(snap7a.value === "PLANNING", "BLOCKED RESET goes to PLANNING (tool redirects from here)");
assert(snap7a.context.block_reason === null, "block_reason cleared on RESET");

// 7b. RESET with previous_state null — guard blocks reset
const ctx7b = createInitialContext();
ctx7b.state = "BLOCKED";
ctx7b.previous_state = null;
ctx7b.block_reason = "test block";
const machine7b = createWorkflowMachine(ctx7b);
const actor7b = createActor(machine7b);
actor7b.start();
let snap7b = actor7b.getSnapshot();
assert(snap7b.value === "BLOCKED", "machine starts in BLOCKED (null prev)");

actor7b.send({ type: "RESET" });
snap7b = actor7b.getSnapshot();
assert(snap7b.value === "BLOCKED", "BLOCKED RESET blocked when previous_state is null");

// ── 8. Loaded State Integrity ─────────────────────────────────────
console.log("\n8. State Integrity");
const finalCtx = loadState();
assert(typeof finalCtx.state === "string", "loaded state has valid state string");
assert(Array.isArray(finalCtx.findings_open), "loaded state has findings array");
assert(Array.isArray(finalCtx.findings_history), "loaded state has findings_history array");
assert(typeof finalCtx.schema_version === "number", "loaded state has schema_version");
assert(finalCtx.block_reason === null || typeof finalCtx.block_reason === "string", "block_reason is null or string");


// ── 9. ApprovalRecord — distinct messages for null/denied/approved ───
console.log("\n9. ApprovalRecord");

// 9a. Null means pending — distinct from denied (design review guard)
const ctx9a = createInitialContext();
ctx9a.state = "AWAITING_DESIGN_REVIEW";
ctx9a.artifacts[ARTIFACT_KEYS.DESIGN_DOC] = {
  path: ".omp/workflow/_test-design-dummy.md",
  hash: computeHashString("# Test"),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
// Need a real file for hash verification
const designDoc9 = ".omp/workflow/_test-design-9.md";
writeFileSync(designDoc9, "# Test");
ctx9a.artifacts[ARTIFACT_KEYS.DESIGN_DOC]!.path = designDoc9;
ctx9a.artifacts[ARTIFACT_KEYS.DESIGN_DOC]!.hash = computeHashString("# Test");
assert(ctx9a.council_sign_off === null, "council_sign_off is null initially");
let r9a = guardAwaitingDesignReviewToAwaitingApproval(ctx9a);
assert(!r9a.allowed, "design-review→approval: blocked on null council_sign_off");
assert(r9a.reason!.includes("pending"), "null produces 'pending' message, not 'denied'");

// 9b. Denied approval record
ctx9a.council_sign_off = makeApproval(false);
r9a = guardAwaitingDesignReviewToAwaitingApproval(ctx9a);
assert(!r9a.allowed, "design-review→approval: blocked on denied council_sign_off");
assert(r9a.reason!.includes("denied"), "denied approval produces 'denied' message");

// 9c. Approved record passes
ctx9a.council_sign_off = makeApproval(true);
r9a = guardAwaitingDesignReviewToAwaitingApproval(ctx9a);
assert(r9a.allowed, "design-review→approval: passes with approved record + design doc");
unlinkSync(designDoc9);

// 9d. Operator approval — null, denied, approved messages
const ctx9d = createInitialContext();
ctx9d.state = "AWAITING_OPERATOR_APPROVAL";
let r9d = guardAwaitingApprovalToImplementing(ctx9d);
assert(!r9d.allowed, "approval→implementing: blocked on null");
assert(r9d.reason!.includes("pending"), "null operator approval says pending");

ctx9d.operator_approval = makeApproval(false);
r9d = guardAwaitingApprovalToImplementing(ctx9d);
assert(!r9d.allowed, "approval→implementing: blocked on denied");
assert(r9d.reason!.includes("denied"), "denied operator approval says denied");

// ── 10. Structured Contract Validation ─────────────────────────────
console.log("\n10. Structured Contract Validation");

// 10a. Valid contract passes (inside markdown fence)
const validJson = JSON.stringify({
  version: 1,
  scope: { files: ["src/foo.ts", "src/bar.ts"] },
  assertions: [{ type: "test", description: "Run tests" }],
});
let cr10a = validateContractStructure("```json\n" + validJson + "\n```\n", "test");
assert(cr10a === null, "valid structured contract passes validation");

// 10b. No JSON block — rejected
cr10a = validateContractStructure("# Just a comment\n\nRun tests on src/", "test");
assert(cr10a !== null, "free-text contract rejected");
assert(cr10a!.reason!.includes("structured format"), "error mentions structured format");

// 10c. Missing scope.files — rejected
cr10a = validateContractStructure("```json\n" + JSON.stringify({ version: 1, scope: {}, assertions: [] }) + "\n```", "test");
assert(cr10a !== null, "contract without scope.files rejected");

// 10d. Empty scope.files — rejected
cr10a = validateContractStructure("```json\n" + JSON.stringify({
  version: 1,
  scope: { files: [] },
  assertions: [{ type: "test", description: "Run" }],
}) + "\n```", "test");
assert(cr10a !== null, "contract with empty scope.files rejected");

// 10e. Globstar pattern — rejected
cr10a = validateContractStructure("```json\n" + JSON.stringify({
  version: 1,
  scope: { files: ["**/*.ts"] },
  assertions: [{ type: "test", description: "Run" }],
}) + "\n```", "test");
assert(cr10a !== null, "contract with globstar rejected");
assert(cr10a!.reason!.includes("repo-wide"), "error mentions repo-wide pattern");

// 10f. Catch-all pattern — rejected
cr10a = validateContractStructure("```json\n" + JSON.stringify({
  version: 1,
  scope: { files: ["all files"] },
  assertions: [{ type: "test", description: "Run" }],
}) + "\n```", "test");
assert(cr10a !== null, "contract with 'all files' rejected");

// 10g. Missing assertions — rejected
cr10a = validateContractStructure("```json\n" + JSON.stringify({
  version: 1,
  scope: { files: ["src/foo.ts"] },
  assertions: [],
}) + "\n```", "test");
assert(cr10a !== null, "contract with empty assertions rejected");

// 10h. Invalid JSON — rejected
cr10a = validateContractStructure("```json\n{ not valid json }\n```", "test");
assert(cr10a !== null, "invalid JSON rejected");
assert(cr10a!.reason!.includes("invalid JSON"), "error mentions invalid JSON");

// ── 11. BLOCKED Dynamic Target Resolution ──────────────────────────
console.log("\n11. BLOCKED Dynamic Target");

// 11a. BLOCKED with previous_state = VALIDATING — tool resets to VALIDATING
const ctx11a = createInitialContext();
ctx11a.state = "BLOCKED";
ctx11a.previous_state = "VALIDATING";
ctx11a.block_reason = "test block";
const machine11a = createWorkflowMachine(ctx11a);
const actor11a = createActor(machine11a);
actor11a.start();
let snap11a = actor11a.getSnapshot();
assert(snap11a.value === "BLOCKED", "starts in BLOCKED");
assert(snap11a.context.previous_state === "VALIDATING", "previous_state preserved for tool");

// The machine's RESET targets PLANNING (the tool handles dynamic override)
actor11a.send({ type: "RESET" });
snap11a = actor11a.getSnapshot();
assert(snap11a.value === "PLANNING", "machine RESET goes to PLANNING (tool overrides this)");

// 11b. BLOCKED with previous_state = null — guard blocks machine reset
const ctx11b = createInitialContext();
ctx11b.state = "BLOCKED";
ctx11b.previous_state = null;
ctx11b.block_reason = "test block";
const machine11b = createWorkflowMachine(ctx11b);
const actor11b = createActor(machine11b);
actor11b.start();
actor11b.send({ type: "RESET" });
const snap11b = actor11b.getSnapshot();
assert(snap11b.value === "BLOCKED", "BLOCKED RESET blocked when previous_state is null");
// Cleanup temp files
const cleanupFiles = [
  ".omp/workflow/_test-design.md",
  ".omp/workflow/_test-implementation.md",
  ".omp/workflow/_test-design-machine.md",
  ".omp/workflow/_test-contract-machine.md",
  ".omp/workflow/_test-design-dummy.md",
  ".omp/workflow/_test-file.txt",
  ".omp/workflow/_test-contract.md",
  ".omp/workflow/_test-impl.md",
  ".omp/workflow/_test-impl2.md",
  ".omp/workflow/_test-impl3.md",
  ".omp/workflow/_test-impl4.md",
  ".omp/workflow/_test-impl5.md",
  ".omp/workflow/_test-report.md",
  ".omp/workflow/_test-report2.md",
  ".omp/workflow/_test-council-report3.md",
  ".omp/workflow/_test-vreport.md",
  ".omp/workflow/_test-design-9.md",
  ".omp/workflow/_test-vreport2.md",
  ".omp/workflow/_test-retro.md",
];
for (const f of cleanupFiles) {
  if (existsSync(f)) unlinkSync(f);
}

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFAILURES DETECTED");
  process.exit(1);
} else {
  console.log("All tests passed!");
}
