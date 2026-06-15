import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type { AgentDecision, LifecycleEntry } from "../types.js";

/**
 * Append-only JSONL stores. Two artifacts come out of here, both judged:
 *  - lifecycle.jsonl — one line per logical transaction (all attempts,
 *    stages, slots, tips, failure classes). Slots are explorer-verifiable.
 *  - agent-decisions.jsonl — one line per agent decision, reasoning verbatim.
 */
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
