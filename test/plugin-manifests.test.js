import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8").catch(
    () => ""
  );
}

test("plugin manifests package PUCP skills without embedding secrets", async () => {
  const [codexText, claudeText, packageText] = await Promise.all([
    read(".codex-plugin/plugin.json"),
    read(".claude-plugin/plugin.json"),
    read("package.json")
  ]);
  assert.ok(codexText, "Codex plugin manifest must exist");
  assert.ok(claudeText, "Claude plugin manifest must exist");
  const codex = JSON.parse(codexText);
  const claude = JSON.parse(claudeText);
  const packageVersion = JSON.parse(packageText).version;

  assert.equal(codex.name, "pucp-mcp");
  assert.equal(claude.name, "pucp-mcp");
  assert.equal(codex.version, packageVersion);
  assert.equal(claude.version, packageVersion);
  assert.equal(codex.skills, "./skills/");
  assert.doesNotMatch(
    JSON.stringify({ codex, claude }),
    /PAIDEIA_PASS|CAMPUS_PUCP_PASS|PASSWORD|student-secret-sentinel/iu
  );
});
test("client templates name all servers and remain public placeholders", async () => {
  const paths = [
    "integrations/codex/config.example.toml",
    "integrations/antigravity/mcp_config.example.json",
    "integrations/claude-code/mcp.example.json",
    "integrations/claude-desktop/claude_desktop_config.example.json",
    "integrations/cursor/mcp.example.json",
    "integrations/kimi-code/mcp.example.json",
    "integrations/generic/mcp.example.json"
  ];
  const templates = await Promise.all(paths.map(read));
  for (const [index, template] of templates.entries()) {
    assert.ok(template, `${paths[index]} must exist`);
    assert.match(template, /paideia/);
    assert.match(template, /campus_virtual_pucp/);
    assert.match(template, /pucp_academic_overview/);
    assert.match(template, /PUCP_MCP_LAUNCHER/);
    assert.match(template, /--client/);
    assert.doesNotMatch(template, /PUCP_MCP_ROOT|NODE_EXECUTABLE/);
    assert.doesNotMatch(
      template,
      /PAIDEIA_PASS|CAMPUS_PUCP_PASS|PASSWORD|student-secret-sentinel|C:\\Users\\student/iu
    );
  }

  const guide = await read("integrations/README.md");
  assert.match(guide, /npm run install-config/);
  assert.match(guide, /referencia.*no.*copiar/is);
});

test("all bundled skill metadata is valid UTF-8", async () => {
  const metadata = await Promise.all([
    read("skills/profe-pucp/agents/openai.yaml"),
    read("skills/pucp-academic/agents/openai.yaml"),
    read("skills/pucp-context/agents/openai.yaml")
  ]);
  assert.equal(metadata.length, 3);
  for (const value of metadata) {
    assert.ok(value);
    assert.doesNotMatch(value, /\uFFFD/u);
  }
});
