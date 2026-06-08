/**
 * Smoke test — verify core omp-flow logic works correctly.
 *
 * Run: bun run src/state-machine/smoke-test.ts
 */

import { createInitialContext } from "./types.js";
import { loadState, writeState } from "../integrity/state-persistence.js";
import { computeHash, computeHashString } from "../integrity/hash.js";
import {
  guardPlanningToAwaitingApproval,
  guardAwaitingApprovalToImplementing,
  guardImplementingToAwaitingCouncil,
  guardAwaitingCouncilToValidating,
  guardValidatingToRetro,
  guardRetroToAwaitingMerge,
  guardAwaitingMergeToDone,
} from "./guards.js";
import { createWorkflowMachine } from "./machine.js";
import { createActor } from "xstate";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";

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

// ── 1. Types & Initial Context ────────────────────────────────────
console.log("\n1. Types & Initial Context");
const ctx = createInitialContext();
assert(ctx.state === "PLANNING", "initial state is PLANNING");
assert(ctx.previous_state === null, "no previous state");
assert(Object.keys(ctx.artifacts).length === 0, "no artifacts");
assert(ctx.council_sign_off === null, "council_sign_off is null");
assert(ctx.operator_approval === null, "operator_approval is null");

// ── 2. State Persistence ──────────────────────────────────────────
console.log("\n2. State Persistence");
writeState(ctx);
const loaded = loadState();
assert(loaded.state === "PLANNING", "round-trip preserves state");
assert(loaded.artifacts !== undefined, "round-trip preserves artifacts");
assert(loaded.findings_open !== undefined, "round-trip preserves findings");

// ── 3. SHA-256 Hashing ────────────────────────────────────────────
console.log("\n3. SHA-256 Hashing");
const testFile = ".omp/workflow/_test-file.txt";
writeFileSync(testFile, "hello world");
const hash = computeHash(testFile);
assert(hash !== null, "hash computed for existing file");
assert(hash!.length === 64, "SHA-256 produces 64-char hex string");
assert(hash === computeHashString("hello world"), "file hash matches string hash of content");

const missingHash = computeHash(".omp/workflow/_nonexistent.txt");
assert(missingHash === null, "null for nonexistent file");

writeFileSync(testFile, "hello world 2");
const hash2 = computeHash(testFile);
assert(hash !== hash2, "modified file produces different hash");
unlinkSync(testFile);

// ── 4. Guards ─────────────────────────────────────────────────────
console.log("\n4. Guards");

// 4a. Planning → Awaiting Approval — blocked without council sign-off
const ctx4a = createInitialContext();
let result = guardPlanningToAwaitingApproval(ctx4a);
assert(!result.allowed, "planning→approval: blocked without council sign-off");

// 4b. With council sign-off but no design doc
ctx4a.council_sign_off = true;
result = guardPlanningToAwaitingApproval(ctx4a);
assert(!result.allowed, "planning→approval: blocked without design doc");

// 4c. With sealed design doc and council sign-off
const designDocPath = ".omp/workflow/_test-design.md";
writeFileSync(designDocPath, "# Design Doc\n\nPhase 1 plan.");
ctx4a.artifacts["design-doc"] = {
  path: designDocPath,
  hash: computeHashString("# Design Doc\n\nPhase 1 plan."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardPlanningToAwaitingApproval(ctx4a);
assert(result.allowed, "planning→approval: passes with design doc + council sign-off");

// 4d. Modified design doc (hash mismatch)
writeFileSync(designDocPath, "# Design Doc\n\nModified content.");
result = guardPlanningToAwaitingApproval(ctx4a);
assert(!result.allowed, "planning→approval: blocked on hash mismatch");

// Restore correct content
writeFileSync(designDocPath, "# Design Doc\n\nPhase 1 plan.");
result = guardPlanningToAwaitingApproval(ctx4a);
assert(result.allowed, "planning→approval: passes after restore");
unlinkSync(designDocPath);

// 4e. Awaiting Approval → Implementing — blocked without operator approval
const ctx4e = createInitialContext();
ctx4e.state = "AWAITING_OPERATOR_APPROVAL";
result = guardAwaitingApprovalToImplementing(ctx4e);
assert(!result.allowed, "approval→implementing: blocked without operator approval");

// 4f. With operator approval but no contract
ctx4e.operator_approval = true;
result = guardAwaitingApprovalToImplementing(ctx4e);
assert(!result.allowed, "approval→implementing: blocked without contract");

// 4g. With contract — passes
const contractPath = ".omp/workflow/_test-contract.md";
writeFileSync(contractPath, "Contract: validate touched files only.");
ctx4e.artifacts["validation-contract"] = {
  path: contractPath,
  hash: computeHashString("Contract: validate touched files only."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardAwaitingApprovalToImplementing(ctx4e);
assert(result.allowed, "approval→implementing: passes with approval + contract");
unlinkSync(contractPath);

// 4h. Delta-scope check — repo-wide contract blocked
const ctx4h = createInitialContext();
ctx4h.state = "AWAITING_OPERATOR_APPROVAL";
ctx4h.operator_approval = true;
const wideContractPath = ".omp/workflow/_test-wide-contract.md";
writeFileSync(wideContractPath, "Run tests on all files in **\/*.ts");
ctx4h.artifacts["validation-contract"] = {
  path: wideContractPath,
  hash: computeHashString("Run tests on all files in **\/*.ts"),
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
result = guardAwaitingApprovalToImplementing(ctx4h);
assert(!result.allowed, "approval→implementing: blocked on repo-wide contract");
unlinkSync(wideContractPath);

// 4i. Implementing → Council — blocked without impl-complete
const ctx4i = createInitialContext();
ctx4i.state = "IMPLEMENTING";
ctx4i.feature_branch = "feat/omp-flow-phase-1";
result = guardImplementingToAwaitingCouncil(ctx4i);
assert(!result.allowed, "implementing→council: blocked without impl-complete");

// 4j. With impl-complete + feature branch — passes
const implPath = ".omp/workflow/_test-impl.md";
writeFileSync(implPath, "Implementation complete.");
ctx4i.artifacts["impl-complete"] = {
  path: implPath,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
result = guardImplementingToAwaitingCouncil(ctx4i);
assert(result.allowed, "implementing→council: passes with impl-complete + feature branch");
unlinkSync(implPath);

// 4k. Implementing on main — blocked
const ctx4k = createInitialContext();
ctx4k.state = "IMPLEMENTING";
ctx4k.feature_branch = "main";
const implPath2 = ".omp/workflow/_test-impl2.md";
writeFileSync(implPath2, "Implementation complete.");
ctx4k.artifacts["impl-complete"] = {
  path: implPath2,
  hash: computeHashString("Implementation complete."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Implementor",
};
result = guardImplementingToAwaitingCouncil(ctx4k);
assert(!result.allowed, "implementing→council: blocked on main branch");
unlinkSync(implPath2);

// 4l. Council → Validating — blocked with open P0
const ctx4l = createInitialContext();
ctx4l.state = "AWAITING_COUNCIL_REVIEW";
const reportPath = ".omp/workflow/_test-report.md";
writeFileSync(reportPath, "Council report: 1 P0 finding.");
ctx4l.artifacts["council-report"] = {
  path: reportPath,
  hash: computeHashString("Council report: 1 P0 finding."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Council",
};
ctx4l.findings_open = [
  {
    severity: "P0",
    description: "Critical bug in auth",
    trigger_conditions: "Happens on every login with null email",
    artifact_path: "/src/auth.ts",
  },
];
result = guardAwaitingCouncilToValidating(ctx4l);
assert(!result.allowed, "council→validating: blocked with open P0");

// 4m. Findings resolved — passes
ctx4l.findings_open = [];
result = guardAwaitingCouncilToValidating(ctx4l);
assert(result.allowed, "council→validating: passes with no open findings");
unlinkSync(reportPath);

// 4n. Validating → Retro — blocked without report
const vReportPath = ".omp/workflow/_test-vreport.md";
writeFileSync(vReportPath, "Validation passed: all assertions OK.");
const ctx4n = createInitialContext();
ctx4n.state = "VALIDATING";
result = guardValidatingToRetro(ctx4n);
assert(!result.allowed, "validating→retro: blocked without validation report");

// 4o. With validation report — passes
ctx4n.artifacts["validation-report"] = {
  path: vReportPath,
  hash: computeHashString("Validation passed: all assertions OK."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Validator",
};
result = guardValidatingToRetro(ctx4n);
assert(result.allowed, "validating→retro: passes with validation report");
unlinkSync(vReportPath);

// 4p. Validating → Retro — hash mismatch (report modified after sealing)
const vReportPath2 = ".omp/workflow/_test-vreport2.md";
writeFileSync(vReportPath2, "Validation passed: all assertions OK.");
const ctx4p = createInitialContext();
ctx4p.state = "VALIDATING";
ctx4p.artifacts["validation-report"] = {
  path: vReportPath2,
  hash: computeHashString("Validation passed: all assertions OK."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Validator",
};
// Modify the report after sealing
writeFileSync(vReportPath2, "Validation passed: MODIFIED AFTER SEAL.");
result = guardValidatingToRetro(ctx4p);
assert(!result.allowed, "validating→retro: blocked on hash mismatch");
unlinkSync(vReportPath2);

// 4q. Council → Validating — hash mismatch (report modified after sealing)
const councilReportPath2 = ".omp/workflow/_test-council-report2.md";
writeFileSync(councilReportPath2, "Council report: all clear.");
const ctx4q = createInitialContext();
ctx4q.state = "AWAITING_COUNCIL_REVIEW";
ctx4q.artifacts["council-report"] = {
  path: councilReportPath2,
  hash: computeHashString("Council report: all clear."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Council",
};
// Modify report after sealing
writeFileSync(councilReportPath2, "Council report: MODIFIED AFTER SEAL.");
result = guardAwaitingCouncilToValidating(ctx4q);
assert(!result.allowed, "council→validating: blocked on hash mismatch");
unlinkSync(councilReportPath2);

// 4r. Retro → Awaiting Merge — basic pass
const retroPath = ".omp/workflow/_test-retro.md";
writeFileSync(retroPath, "Retro: all good.");
const ctx4r = createInitialContext();
ctx4r.state = "RETRO";
result = guardRetroToAwaitingMerge(ctx4r);
assert(!result.allowed, "retro→merge: blocked without retro doc");
ctx4r.artifacts["retro-doc"] = {
  path: retroPath,
  hash: computeHashString("Retro: all good."),
  sealed_at: new Date().toISOString(),
  sealed_by: "Retro",
};
result = guardRetroToAwaitingMerge(ctx4r);
assert(result.allowed, "retro→merge: passes with sealed retro doc");

// 4s. Retro → Awaiting Merge — hash mismatch
writeFileSync(retroPath, "Retro: MODIFIED AFTER SEAL.");
result = guardRetroToAwaitingMerge(ctx4r);
assert(!result.allowed, "retro→merge: blocked on hash mismatch");
unlinkSync(retroPath);

// 4t. Awaiting Merge → Done
const ctx4t = createInitialContext();
ctx4t.state = "AWAITING_MERGE";
result = guardAwaitingMergeToDone(ctx4t);
assert(!result.allowed, "merge→done: blocked without operator approval");
ctx4t.operator_approval = true;
result = guardAwaitingMergeToDone(ctx4t);
assert(result.allowed, "merge→done: passes with operator approval");
console.log("\n5. XState Machine");

const testMachine = createWorkflowMachine(createInitialContext());
const actor = createActor(testMachine);
const snapshot = actor.getSnapshot();
assert(snapshot.value === "PLANNING", "machine starts in PLANNING");

// Machine with council sign-off + design doc in context
const ctx5 = createInitialContext();
ctx5.council_sign_off = true;
ctx5.artifacts["design-doc"] = {
  path: ".omp/workflow/_test-design.md",
  hash: "placeholder",
  sealed_at: new Date().toISOString(),
  sealed_by: "Planner",
};
const machine2 = createWorkflowMachine(ctx5);
const actor2 = createActor(machine2);
const snap2 = actor2.getSnapshot();
assert(snap2.value === "PLANNING", "machine initial state matches context state");

// ── 6. Loaded State Integrity ─────────────────────────────────────
console.log("\n6. State Integrity");
const finalCtx = loadState();
assert(typeof finalCtx.state === "string", "loaded state has valid state string");
assert(Array.isArray(finalCtx.findings_open), "loaded state has findings array");

// Cleanup temp files
const _cleanup = [".omp/workflow/_test-design.md", ".omp/workflow/_test-implementation.md"];
for (const f of _cleanup) {
  if (existsSync(f)) unlinkSync(f);
}

// ── Summary ───────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Passed: ${passed}  Failed: ${failed}`);
if (failed > 0) {
  console.log("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("All tests passed!");
}
