import fs from "node:fs";

const file = "resource-pack-progress.json";
const catalogue = "resource-packs.json";
const action = process.argv[2];
const stage = process.argv.slice(3).join(" ") || action;
const now = new Date().toISOString();
const count = JSON.parse(fs.readFileSync(catalogue, "utf8")).length;
let state = {};
try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}

if (action === "start") {
  const history = Array.isArray(state.history) ? state.history : [];
  state = { schema: 1, updatedAt: now, status: "running", runStartedAt: now, runFinishedAt: null, baselineCount: count, currentCount: count, stage: "開始", history };
} else if (action === "stage") {
  state = { ...state, updatedAt: now, status: "running", currentCount: count, stage };
} else if (action === "finish") {
  const started = Date.parse(state.runStartedAt || now);
  const durationMs = Math.max(1000, Date.now() - (Number.isFinite(started) ? started : Date.now()));
  const added = Math.max(0, count - Number(state.baselineCount || count));
  const entry = { startedAt: state.runStartedAt || now, finishedAt: now, durationMs, baselineCount: Number(state.baselineCount || count), finalCount: count, added };
  const history = [...(Array.isArray(state.history) ? state.history : []), entry].slice(-10);
  state = { ...state, updatedAt: now, status: "completed", runFinishedAt: now, currentCount: count, stage: "完了", lastRun: entry, history };
} else {
  throw new Error("Usage: start | stage <name> | finish");
}
fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
console.log(JSON.stringify({ action, stage: state.stage, count, status: state.status, updatedAt: now }));
