/**
 * Permission Gate Extension
 *
 * Reads ~/.pi/agent/permissions.json and gates tool calls by agent role.
 * The role comes from PI_AGENT_NAME, which the subagent launcher sets for
 * child processes. A top-level session uses the policy's defaultRole.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function activeAgentName(getSystemPrompt: (() => string) | undefined): string | undefined {
	const explicit = process.env.PI_AGENT_NAME;
	if (explicit) return explicit;
	if (!getSystemPrompt) return undefined;
	try {
		return /<active_agent\s+name="([^"]+)"/.exec(getSystemPrompt())?.[1];
	} catch {
		return undefined;
	}
}

type Decision = "allow" | "ask" | "deny";

interface ToolRule {
	allow?: string[];
	ask?: string[];
	deny?: string[];
}

interface Policy {
	defaultRole?: string;
	roles?: Record<string, ToolRule>;
	bash?: { ask?: string[]; deny?: string[] };
}

const POLICY_PATH = join(homedir(), ".pi", "agent", "permissions.json");

const FALLBACK: Policy = {
	defaultRole: "orchestrator",
	roles: {},
	bash: {
		deny: ["\\bmkfs\\b", "\\bdd\\s+if=", "\\bshutdown\\b", "\\breboot\\b"],
		ask: ["\\brm\\b", "\\bmv\\b", "\\bgit\\s+push\\b", "\\bsudo\\b", "\\bchmod\\b", "\\bchown\\b"],
	},
};

function loadPolicy(): Policy {
	if (!existsSync(POLICY_PATH)) return FALLBACK;
	try {
		return JSON.parse(readFileSync(POLICY_PATH, "utf8")) as Policy;
	} catch {
		return FALLBACK;
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function matches(pattern: string, value: string): boolean {
	if (pattern === "*") return true;
	if (!pattern.includes("*")) return pattern === value;
	return new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`).test(value);
}

function matchesAny(patterns: string[] | undefined, value: string): boolean {
	return (patterns ?? []).some((pattern) => matches(pattern, value));
}

function ruleFor(policy: Policy, role: string): ToolRule | undefined {
	const roles = policy.roles ?? {};
	if (roles[role]) return roles[role];
	for (const [key, rule] of Object.entries(roles)) {
		if (key.includes("*") && matches(key, role)) return rule;
	}
	return undefined;
}

function matchesCommand(patterns: string[] | undefined, command: string): boolean {
	return (patterns ?? []).some((pattern) => {
		try {
			return new RegExp(pattern, "i").test(command);
		} catch {
			return false;
		}
	});
}

function decide(policy: Policy, role: string, toolName: string, input: Record<string, unknown>): Decision {
	const rule = ruleFor(policy, role);
	if (rule) {
		if (matchesAny(rule.deny, toolName)) return "deny";
		if (matchesAny(rule.ask, toolName)) return "ask";
		if (matchesAny(rule.allow, toolName)) return "allow";
	}

	if (toolName === "bash") {
		const command = typeof input.command === "string" ? input.command : "";
		if (matchesCommand(policy.bash?.deny, command)) return "deny";
		if (matchesCommand(policy.bash?.ask, command)) return "ask";
	}

	return "allow";
}

function preview(input: Record<string, unknown>): string {
	if (typeof input.command === "string") return input.command;
	const path = input.path ?? input.file_path ?? input.destination;
	if (typeof path === "string") return path;
	const tasks = input.tasks;
	if (Array.isArray(tasks)) {
		return tasks
			.map((task) => {
				const entry = task as { agent?: unknown; task?: unknown };
				const first = typeof entry.task === "string" ? entry.task.split("\n")[0] : "";
				return `- ${String(entry.agent ?? "?")}: ${first}`;
			})
			.join("\n");
	}
	return JSON.stringify(input).slice(0, 600);
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		const policy = loadPolicy();
		const fallbackRole = policy.defaultRole || "orchestrator";
		const active = activeAgentName(ctx.getSystemPrompt);
		const role = active ?? fallbackRole;
		const effectiveRule = ruleFor(policy, role) ? role : fallbackRole;
		const input = event.input as Record<string, unknown>;
		const decision = decide(policy, effectiveRule, event.toolName, input);

		if (decision === "allow") return undefined;

		const detail = preview(input);
		if (decision === "deny") {
			return {
				block: true,
				reason: `Blocked by permission policy: role '${effectiveRule}' cannot use ${event.toolName}.\n${detail}`,
			};
		}

		if (!ctx.hasUI) {
			return {
				block: true,
				reason: `Blocked by permission policy: ${event.toolName} needs approval and no UI is available.\nReport this to your caller and stop. Do not work around it.\n${detail}`,
			};
		}

		const choice = await ctx.ui.select(
			`${event.toolName} requested by ${effectiveRule}:\n\n${detail}\n\nAllow?`,
			["Allow", "Deny"],
		);
		if (choice !== "Allow") {
			return { block: true, reason: `Blocked by user: ${event.toolName}.\n${detail}` };
		}
		return undefined;
	});
}
