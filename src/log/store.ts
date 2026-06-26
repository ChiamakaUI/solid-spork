import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { AgentDecision, LifecycleEntry } from "../types.js";

/** Append-only JSONL stores for lifecycle entries, agent decisions, and events. */
export class LogStore {
  constructor(private dir = config.logDir) {
    mkdirSync(dir, { recursive: true });
  }

  lifecycle(entry: LifecycleEntry) {
    appendFileSync(join(this.dir, "lifecycle.jsonl"), JSON.stringify(entry) + "\n");
  }

  agentDecision(d: AgentDecision) {
    appendFileSync(join(this.dir, "agent-decisions.jsonl"), JSON.stringify(d) + "\n");
  }

  event(kind: string, payload: unknown) {
    appendFileSync(
      join(this.dir, "events.jsonl"),
      JSON.stringify({ at: Date.now(), kind, payload }) + "\n"
    );
  }
}
