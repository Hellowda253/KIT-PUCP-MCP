import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(repositoryRoot, "scripts", "generate-install-config.js");

test("install config CLI renders a portable launcher fragment for an agent", async () => {
  const launcher = path.resolve("C:/Student Tools/PUCP-MCP/launcher.cmd");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    "--client", "generic",
    "--launcher", launcher,
    "--client-id", "cursor"
  ], { cwd: repositoryRoot, windowsHide: true });
  const config = JSON.parse(stdout);
  assert.equal(config.mcpServers.paideia.command, launcher);
  assert.deepEqual(config.mcpServers.paideia.args, ["paideia", "--client", "cursor"]);
});

test("install config CLI requires complete legacy or portable coordinates", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [script, "--client", "generic", "--launcher", path.resolve("C:/launcher.cmd")], {
      cwd: repositoryRoot,
      windowsHide: true
    }),
    /--client-id/iu
  );
});
