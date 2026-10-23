import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, resolve } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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

const VALE_CONFIG = join(homedir(), ".config", "vale", ".vale.ini");
const WORDLIST = join(homedir(), ".local", "share", "ste100", "wordlist.json");
const VALE = process.env.VALE_BIN || "vale";
const PROSE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst", ".adoc"]);
const PROSE_TARGET =
	/\.(?:md|markdown)\b|\b(docs?|documentation|readme|report|article|prose|paragraph|summary|essay|commit message|pr description|pull request)\b/i;
const PROSE_ACTION =
	/\b(write|writing|draft|rewrite|rewriting|edit|editing|summarize|document|produce|compose|proofread|polish|add|update|expand|shorten)\b/i;
const CODE_INTENT =
	/\b(run|ran|bash|command|execute|shell|script|test|tests|build|compile|lint|install|git|npm|pnpm|bun|grep|find|ls|cat|pi)\b/i;
const MUTATING_TOOL = /edit|write|replace|patch|insert|apply|copy|move/i;
const PROSE_ROLES = new Set(["orchestrator", "worker-prose"]);
const CODE_MUTATION = /tools\.(replace|replace_match|insert|write|edit|copy|move|undo_last_change)/;
const PROSE_PATH = /([^\s"'`(),;]*\.(?:md|markdown|txt|rst|adoc))\b/g;

type Severity = "error" | "warning" | "suggestion";

interface ValeAlert {
	Check: string;
	Severity: Severity;
	Message: string;
	Match: string;
	Line: number;
}

interface Finding extends ValeAlert {
	File: string;
}

interface WordEntry {
	word: string;
	pos: string;
	ste: boolean;
	meaning: string;
	alternatives: { term: string; pos: string }[];
}

const SEVERITY_ORDER: Record<Severity, number> = {
	error: 0,
	warning: 1,
	suggestion: 2,
};

function runVale(args: string[], input?: string): Finding[] {
	const result = spawnSync(VALE, ["--config", VALE_CONFIG, "--no-exit", "--output=JSON", ...args], {
		input,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
	});
	if (result.error) {
		throw new Error(`Cannot run vale: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || `vale exited ${result.status}`);
	}
	const parsed = JSON.parse(result.stdout || "{}") as Record<string, ValeAlert[]>;
	return Object.entries(parsed).flatMap(([file, alerts]) =>
		alerts.map((alert) => ({ ...alert, File: file })),
	);
}

function validateText(text: string, mode: "prose" | "report"): Finding[] {
	const args = ["--ext=.md"];
	if (mode === "report") args.push("--minAlertLevel=suggestion");
	return runVale(args, text);
}

function validateFiles(files: string[]): Finding[] {
	if (files.length === 0) return [];
	return runVale(files);
}

function formatFindings(findings: Finding[], limit = 60): string {
	if (findings.length === 0) return "STE: no findings.";
	const sorted = [...findings].sort(
		(a, b) =>
			SEVERITY_ORDER[a.Severity] - SEVERITY_ORDER[b.Severity] || a.File.localeCompare(b.File) || a.Line - b.Line,
	);
	const lines = sorted.slice(0, limit).map((finding) => {
		const file = finding.File === "stdin.md" ? "" : `${finding.File}:${finding.Line} `;
		return `${file}${finding.Severity} ${finding.Check}: ${finding.Message}`;
	});
	if (sorted.length > limit) lines.push(`... ${sorted.length - limit} more`);
	return lines.join("\n");
}

function pathFromDetails(details: unknown): string | undefined {
	if (!details || typeof details !== "object") return undefined;
	const record = details as { snapshotId?: unknown; patch?: unknown };
	if (typeof record.snapshotId === "string") {
		const segment = record.snapshotId.split("|")[1];
		if (segment) return segment;
	}
	if (typeof record.patch === "string") {
		const header = record.patch.match(/^\+\+\+ (.+)$/m);
		if (header) return header[1].replace(/^[ab]\//, "");
	}
	return undefined;
}

function loadWordlist(): WordEntry[] {
	if (!existsSync(WORDLIST)) {
		throw new Error(`Missing ${WORDLIST}. Run ste100/scripts/build_dict.py.`);
	}
	return (JSON.parse(readFileSync(WORDLIST, "utf8")) as { entries: WordEntry[] }).entries;
}

function lookupWord(entries: WordEntry[], word: string): WordEntry[] {
	const query = word.trim().toLowerCase();
	const exact = entries.filter((entry) => entry.word.toLowerCase() === query);
	if (exact.length > 0) return exact;
	return entries.filter((entry) => entry.word.toLowerCase().startsWith(query)).slice(0, 5);
}

function formatEntry(entry: WordEntry): string {
	const head = `${entry.word} (${entry.pos || "unknown"})`;
	if (entry.ste) return `${head}: approved. ${entry.meaning}`.trim();
	const alternatives = entry.alternatives
		.map((alternative) => (alternative.pos ? `${alternative.term} (${alternative.pos})` : alternative.term))
		.join(", ");
	return `${head}: not approved. Use ${alternatives || "no listed alternative"}.`;
}

export default function (pi: ExtensionAPI) {
	let changedFiles = new Set<string>();
	let findings: Finding[] = [];
	let continuationUsed = false;
	let wordlist: WordEntry[] | undefined;

	const reset = () => {
		changedFiles = new Set<string>();
		findings = [];
		continuationUsed = false;
	};

	const track = (
		ctx: ExtensionContext,
		toolName: string,
		input: Record<string, unknown>,
		structured: unknown,
		details: unknown,
	) => {
		if (!MUTATING_TOOL.test(toolName)) return;
		const structuredPath =
			structured && typeof structured === "object" && "path" in structured
				? (structured as { path?: unknown }).path
				: undefined;
		const raw =
			input.path ?? input.file_path ?? input.destination ?? structuredPath ?? pathFromDetails(details);
		if (typeof raw !== "string" || !PROSE_EXTENSIONS.has(extname(raw).toLowerCase())) return;
		const path = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
		if (existsSync(path)) changedFiles.add(path);
	};

	const trackCode = (ctx: ExtensionContext, input: Record<string, unknown>) => {
		const code = typeof input.code === "string" ? input.code : JSON.stringify(input);
		if (!CODE_MUTATION.test(code)) return;
		for (const match of code.matchAll(PROSE_PATH)) {
			const raw = match[1];
			if (!PROSE_EXTENSIONS.has(extname(raw).toLowerCase())) continue;
			const path = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
			if (existsSync(path)) changedFiles.add(path);
		}
	};

	const proseRole = (ctx: ExtensionContext): boolean => {
		const role = activeAgentName(ctx.getSystemPrompt);
		return role === undefined || PROSE_ROLES.has(role);
	};

	pi.on("session_start", async () => reset());
	pi.on("before_agent_start", async (event, ctx) => {
		if (!proseRole(ctx)) return;
		if (event.messageType !== "user") return;
		reset();
		if (
			event.prompt.length < 40 ||
			!PROSE_TARGET.test(event.prompt) ||
			!PROSE_ACTION.test(event.prompt) ||
			CODE_INTENT.test(event.prompt)
		) {
			return;
		}
		return {
			message: {
				customType: "ste100",
				content:
					"Prose task: load the ste100 skill. Run ste_validate on the draft before you finish. Fix error-level findings once; warnings are judgment calls.",
				display: false,
			},
		};
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!proseRole(ctx)) return;
		track(ctx, event.toolName, event.input, event.structuredContent, event.details);
		trackCode(ctx, event.input);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!proseRole(ctx)) return;
		const files = [...changedFiles].filter((file) => existsSync(file));
		if (files.length === 0) return;
		try {
			const revalidated = new Set(files);
			findings = [
				...findings.filter((finding) => !revalidated.has(finding.File)),
				...validateFiles(files),
			];
			changedFiles.clear();
		} catch (error) {
			findings = [];
			if (ctx.hasUI) ctx.ui.notify(`STE: validation failed: ${(error as Error).message}`, "warning");
		}
	});

	pi.on("agent_before_settle", async (event) => {
		if (event.outcome !== "completed" || continuationUsed) return;
		const errors = findings.filter((finding) => finding.Severity === "error");
		if (errors.length === 0) return;
		continuationUsed = true;
		const files = [...new Set(errors.map((finding) => finding.File))].join(", ");
		return {
			continue: true,
			entries: [
				{
					type: "custom_message",
					customType: "ste100",
					display: false,
					content: `STE validation found ${errors.length} error-level finding(s) in ${files}:\n${formatFindings(errors, 20)}\nFix these in the prose. Keep code, commands, identifiers, numbers, and quoted text unchanged. Then finish.`,
				},
			],
		};
	});

	pi.on("agent_settled", async (event, ctx) => {
		if (!continuationUsed || event.aborted) return;
		const errors = findings.filter((finding) => finding.Severity === "error");
		if (errors.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`STE: ${errors.length} error(s) remain after one correction pass.`, "warning");
		}
	});

	pi.registerTool({
		name: "ste_validate",
		label: "STE validate",
		description:
			"Validate Markdown prose against the local STE100 Vale rules. Pass `path` to check a file, or `text` to check a draft. Returns error, warning, and optional report findings. Use before finishing a prose task.",
		promptSnippet: "Validate prose with the STE100 rules",
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({ description: "File to validate. Preferred over text when the prose is already on disk." }),
			),
			text: Type.Optional(Type.String({ description: "Markdown prose to validate" })),
			mode: Type.Optional(
				StringEnum(["prose", "report"] as const, {
					description: "prose (default) or report, which includes readability metrics",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const mode = params.mode ?? "prose";
			const file = params.path ? (isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path)) : undefined;
			if (!file && params.text === undefined) {
				return {
					content: [{ type: "text", text: "Pass a path or text to validate." }],
					details: { mode, findings: [] },
					isError: true,
				};
			}
			const result = file ? validateFiles([file]) : validateText(params.text!, mode);
			return {
				content: [{ type: "text", text: formatFindings(result) }],
				details: { mode, file, findings: result },
			};
		},
	});

	pi.registerTool({
		name: "ste_lookup",
		label: "STE lookup",
		description:
			"Look up a word in the local ASD-STE100 dictionary. Returns approved status, meaning, and alternatives.",
		promptSnippet: "Look up a word in the STE100 dictionary",
		parameters: Type.Object({
			word: Type.String({ description: "Word to look up" }),
		}),
		async execute(_toolCallId, params) {
			wordlist ??= loadWordlist();
			const entries = lookupWord(wordlist, params.word);
			if (entries.length === 0) {
				return {
					content: [{ type: "text", text: `No STE100 entry for '${params.word}'.` }],
					details: { entries: [] },
				};
			}
			return {
				content: [{ type: "text", text: entries.map(formatEntry).join("\n") }],
				details: { entries },
			};
		},
	});
}
