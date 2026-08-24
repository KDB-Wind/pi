import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	type ExternalEditorResult,
	editInExternalEditor,
	resolveUnquotedExecutablePath,
} from "../src/modes/interactive/external-editor.ts";

const editorFixturePath = fileURLToPath(new URL("./fixtures/fake-external-editor.mjs", import.meta.url));

interface EditorCapture {
	filePath: string;
	content: string;
	entries: string[];
	directoryMode: number;
	arguments: string[];
}

async function runExternalEditor(
	options: { fixtureFlag?: "--fail" | "--empty"; quoteExecutable?: boolean; quotedArgument?: boolean } = {},
): Promise<{
	result: ExternalEditorResult;
	capture: EditorCapture;
}> {
	const testDirectory = mkdtempSync(join(tmpdir(), "pi-external-editor-test-"));
	const capturePath = join(testDirectory, "capture.json");
	try {
		const executable = options.quoteExecutable ? `"${process.execPath}"` : process.execPath;
		const quotedArgument = options.quotedArgument ? ` --profile "My Profile"` : "";
		const fixtureFlag = options.fixtureFlag ? ` ${options.fixtureFlag}` : "";
		const result = await editInExternalEditor({
			command: `${executable} ${editorFixturePath} ${capturePath}${quotedArgument}${fixtureFlag}`,
			content: "original",
		});
		const capture = JSON.parse(readFileSync(capturePath, "utf-8")) as EditorCapture;
		return { result, capture };
	} finally {
		rmSync(testDirectory, { recursive: true, force: true });
	}
}

describe("editInExternalEditor", () => {
	it("edits a prompt inside a private temporary directory", async () => {
		const { result, capture } = await runExternalEditor();
		const directory = dirname(capture.filePath);

		expect(result).toEqual({ status: "complete", content: "edited" });
		expect(dirname(directory)).toBe(tmpdir());
		expect(basename(directory)).toMatch(/^pi-editor-.+$/);
		expect(basename(capture.filePath)).toBe("prompt.md");
		expect(capture.entries).toEqual(["prompt.md"]);
		expect(capture.content).toBe("original");
		if (process.platform !== "win32") {
			expect(capture.directoryMode & 0o077).toBe(0);
		}
		expect(existsSync(directory)).toBe(false);
	});

	it("keeps the original content when the editor exits unsuccessfully", async () => {
		const { result, capture } = await runExternalEditor({ fixtureFlag: "--fail" });

		expect(result).toEqual({ status: "failed" });
		expect(existsSync(dirname(capture.filePath))).toBe(false);
	});

	it("preserves quoted executable paths and arguments", async () => {
		const { result, capture } = await runExternalEditor({ quoteExecutable: true, quotedArgument: true });

		expect(result).toEqual({ status: "complete", content: "edited" });
		expect(capture.arguments).toEqual(["--profile", "My Profile"]);
	});

	it("resolves unquoted executable paths with spaces", () => {
		const executablePath = "C:\\Program Files\\nodejs\\node.exe";
		const fileCheck = vi.fn((path: string) => path === executablePath);

		expect(
			resolveUnquotedExecutablePath(
				["C:\\Program", "Files\\nodejs\\node.exe", "fake-editor.mjs", "--profile", "My Profile"],
				fileCheck,
			),
		).toEqual([executablePath, "fake-editor.mjs", "--profile", "My Profile"]);
		expect(fileCheck).toHaveBeenCalledWith("C:\\Program");
		expect(fileCheck).toHaveBeenCalledWith(executablePath);
	});

	it("returns empty content when the editor clears the prompt", async () => {
		const { result } = await runExternalEditor({ fixtureFlag: "--empty" });

		expect(result).toEqual({ status: "complete", content: "" });
	});
});
