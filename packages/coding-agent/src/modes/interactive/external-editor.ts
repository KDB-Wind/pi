import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnProcess } from "../../utils/child-process.ts";
import { stripBom } from "../../utils/text.ts";

export interface ExternalEditorOptions {
	command: string;
	content: string;
}

export type ExternalEditorResult = { status: "complete"; content: string } | { status: "failed" };

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function parseExternalEditorCommand(command: string): string[] {
	const args: string[] = [];
	let current = "";
	let quote: '"' | "'" | undefined;
	let hasToken = false;

	for (let i = 0; i < command.length; i++) {
		const char = command[i]!;
		const next = command[i + 1];

		if (quote) {
			if (char === quote) {
				quote = undefined;
				hasToken = true;
			} else if (quote === '"' && char === "\\" && next === '"') {
				current += next;
				i++;
				hasToken = true;
			} else {
				current += char;
				hasToken = true;
			}
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			hasToken = true;
		} else if (/\s/.test(char)) {
			if (hasToken) {
				args.push(current);
				current = "";
				hasToken = false;
			}
		} else if (char === "\\" && next && /[\s"']/.test(next)) {
			current += next;
			i++;
			hasToken = true;
		} else {
			current += char;
			hasToken = true;
		}
	}

	if (hasToken) args.push(current);
	return args;
}

/** @internal Exported for testing */
export function resolveUnquotedExecutablePath(args: string[], fileCheck: (path: string) => boolean = isFile): string[] {
	if (args.length < 2) return args;

	const first = args[0]!;
	if (!(first.includes("\\") || first.includes("/") || first.startsWith("."))) return args;
	if (fileCheck(first)) return args;

	for (let i = 1; i < args.length; i++) {
		const candidate = args.slice(0, i + 1).join(" ");
		if (fileCheck(candidate)) return [candidate, ...args.slice(i + 1)];
	}

	return args;
}

export async function editInExternalEditor(options: ExternalEditorOptions): Promise<ExternalEditorResult> {
	const directory = mkdtempSync(join(tmpdir(), "pi-editor-"));
	const filePath = join(directory, "prompt.md");
	try {
		writeFileSync(filePath, options.content, "utf-8");
		const [editor, ...editorArgs] = resolveUnquotedExecutablePath(parseExternalEditorCommand(options.command));
		process.stdout.write(`Launching external editor: ${options.command}\nPi will resume when the editor exits.\n`);

		// Do not use spawnSync here. On Windows, synchronous child_process calls can keep
		// Node/libuv's console input read active after the parent pauses stdin, racing
		// vim/nvim for the console input buffer until Ctrl+C cancels the pending read.
		const exitCode = await new Promise<number | null>((resolve) => {
			const child = spawnProcess(editor, [...editorArgs, filePath], {
				stdio: "inherit",
			});
			child.on("error", () => resolve(null));
			child.on("close", (code) => resolve(code));
		});

		if (exitCode !== 0) {
			return { status: "failed" };
		}

		return { status: "complete", content: stripBom(readFileSync(filePath, "utf-8")).replace(/\n$/, "") };
	} finally {
		try {
			rmSync(directory, { recursive: true, force: true });
		} catch {
			// Cleanup is best effort.
		}
	}
}
