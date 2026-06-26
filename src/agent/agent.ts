import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import type { AgentDecision, FailureClass } from "../types.js";

/** Owns the retry decision: given a failed attempt, returns retry-with-changes or abort. */

export interface AgentContext {
  entryId: string;
  attempt: number;
  maxAttempts: number;
  failureClass: FailureClass;
  failureDetail: string;
  currentSlot: number;
  slotsSinceBlockhashFetch: number;
  lastTipLamports: number;
  tipPercentiles: { p25: number; p50: number; p75: number; p95: number; p99: number };
  /** Budget guardrail: the agent must never propose a tip above this. */
  maxTipLamports: number;
  congestionFactor: number;
  /** Compact history of prior attempts for this entry. */
  attemptHistory: Array<{
    attempt: number;
    tipLamports: number;
    outcome: string;
    failureClass?: FailureClass;
  }>;
}

const DECISION_TOOL = {
  name: "record_decision",
  description:
    "Record your operational decision for this failed bundle. Your reasoning must weigh the failure class, network conditions, tip economics, and attempt history.",
  input_schema: {
    type: "object",
    properties: {
      reasoning: {
        type: "string",
        description:
          "Your full chain of reasoning: what failed, why it most likely failed given the evidence, what you considered changing, and why your chosen changes address the root cause.",
      },
      action: { type: "string", enum: ["retry", "abort"] },
      refreshBlockhash: { type: "boolean" },
      newTipLamports: {
        type: "integer",
        description: "Tip for the retry, in lamports. Justify any change from the last tip in your reasoning.",
      },
      delaySlots: {
        type: "integer",
        description: "Slots to wait before resubmitting (0 = immediately).",
      },
      otherAdjustments: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      rejectedAlternatives: {
        type: "array",
        items: { type: "string" },
        description: "Actions you considered and rejected, each with the reason.",
      },
    },
    required: ["reasoning", "action", "confidence", "rejectedAlternatives"],
  },
} as const;

const SYSTEM_PROMPT = `You are the retry-decision agent inside a Solana transaction stack that submits Jito bundles.
You own one operational decision: when a bundle attempt fails, decide whether and how to retry.

Domain facts you must reason with:
- A blockhash is valid for ~150 slots (~60s). If slotsSinceBlockhashFetch approaches or exceeds 150, any resubmission MUST refresh the blockhash or it is guaranteed to fail again.
- Jito bundles land only when the current leader runs the Jito client; a bundle that stays Pending may simply be waiting for a Jito leader window, or its tip may be below the current inclusion floor.
- The published tip percentiles (p25..p99) are the tips of recently LANDED bundles — but most of those land from staked/authenticated connections. On an unauthenticated public connection your bundles are deprioritized, so the tip you actually need to land can be MANY TIMES the published p99. Treat the percentiles as a lower bound, not a target.
- KEY INFERENCE: if prior attempts in attemptHistory already tipped at or ABOVE p99 and still did not land (failureClass bundle_failure, never reaching processed), the tip was not the only obstacle OR the real inclusion floor for this connection is far higher. In that case escalate the tip MULTIPLICATIVELY (e.g. 3–6×), not by small percentages — small bumps just burn attempts. Failed bundles cost nothing, so an aggressive escalation that finally lands is cheaper than many timid ones that don't. Do NOT crawl up from tiny tips: when cheap attempts are dropped-before-auction, the inclusion floor is high — within one or two attempts jump to a LARGE fraction of maxTipLamports (70–100%), because every dropped attempt is free and the goal is to cross the floor, not to bracket it slowly.
- Budget guardrail: NEVER propose newTipLamports above maxTipLamports. But do NOT abort while attempts remain AND your last tip was still BELOW maxTipLamports — for a bundle_failure that never reached the auction (Invalid / dropped before auction) the only proven cure is more tip, and trying the cap costs nothing when it fails. In that situation set newTipLamports to 90–100% of maxTipLamports and retry. Abort ONLY when you have ALREADY tried at (or within ~10% of) maxTipLamports and it STILL failed to land — that is the real signal the connection needs authenticated infrastructure, not more retries.
- Retrying without changing anything causally connected to the failure is wasted money. Every retry must change something — tip, blockhash, or timing — tied to the evidence, or you should abort.

Always weigh cost vs landing probability vs time sensitivity, and say what you rejected and why.`;

export class RetryAgent {
  readonly mode: "live" | "mock";

  constructor(private apiKey = config.anthropicApiKey) {
    this.mode = apiKey ? "live" : "mock";
  }

  async decide(ctx: AgentContext): Promise<AgentDecision> {
    const base = {
      id: randomUUID(),
      at: Date.now(),
      trigger: {
        entryId: ctx.entryId,
        attempt: ctx.attempt,
        failureClass: ctx.failureClass,
        failureDetail: ctx.failureDetail,
        networkContext: {
          currentSlot: ctx.currentSlot,
          recentTipPercentiles: ctx.tipPercentiles,
          slotsSinceBlockhashFetch: ctx.slotsSinceBlockhashFetch,
          attemptsSoFar: ctx.attempt,
        },
      },
    };

    if (this.mode === "mock") return { ...base, ...mockDecision(ctx), model: "MOCK (no API key — not for submission)" };

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.agentModel,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        tools: [DECISION_TOOL],
        tool_choice: { type: "tool", name: "record_decision" },
        messages: [
          {
            role: "user",
            content: `A bundle attempt failed. Decide what to do.\n\n${JSON.stringify(ctx, null, 2)}`,
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as any;
    const toolUse = body.content.find((c: any) => c.type === "tool_use");
    if (!toolUse) throw new Error("agent returned no decision tool call");
    const d = toolUse.input;

    return {
      ...base,
      reasoning: d.reasoning,
      decision: {
        action: d.action,
        changes:
          d.action === "retry"
            ? {
                refreshBlockhash: d.refreshBlockhash ?? false,
                newTipLamports: d.newTipLamports,
                delaySlots: d.delaySlots ?? 0,
                otherAdjustments: d.otherAdjustments,
              }
            : undefined,
        confidence: d.confidence,
        rejectedAlternatives: d.rejectedAlternatives,
      },
      model: body.model,
    };
  }
}

/** Deterministic stand-in for development only. */
function mockDecision(ctx: AgentContext): Pick<AgentDecision, "reasoning" | "decision"> {
  if (ctx.attempt >= ctx.maxAttempts) {
    return {
      reasoning: "[MOCK] Attempt budget exhausted; aborting.",
      decision: { action: "abort", confidence: 0.9, rejectedAlternatives: ["retry: out of budget"] },
    };
  }
  const refresh = ctx.failureClass === "expired_blockhash" || ctx.slotsSinceBlockhashFetch > 120;
  const bump = ctx.failureClass === "fee_too_low" ? Math.round(ctx.tipPercentiles.p75) : ctx.lastTipLamports;
  return {
    reasoning: `[MOCK] ${ctx.failureClass}: refresh=${refresh}, tip ${ctx.lastTipLamports}→${bump}.`,
    decision: {
      action: "retry",
      changes: { refreshBlockhash: refresh, newTipLamports: bump, delaySlots: 0 },
      confidence: 0.5,
      rejectedAlternatives: ["abort: attempts remain"],
    },
  };
}
