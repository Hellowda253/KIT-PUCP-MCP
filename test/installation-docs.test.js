import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function text(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8").catch(
    () => ""
  );
}

test("installation docs let agents install from a repository URL safely", async () => {
  const [agents, installation, integrations, readme, gitignore] = await Promise.all([
    text("AGENTS.md"),
    text("docs/installation.md"),
    text("integrations/README.md"),
    text("README.md"),
    text(".gitignore")
  ]);

  assert.ok(agents, "AGENTS.md must exist");
  assert.ok(installation, "docs/installation.md must exist");
  assert.match(agents, /Codex.*Antigravity.*Claude/is);
  assert.match(agents, /rutas? absolutas?/i);
  assert.match(agents, /copia de seguridad/i);
  assert.match(agents, /\.env\.local/);
  assert.match(agents, /credenciales.*chat/is);
  assert.match(agents, /no.*repetir.*contraseña/is);
  assert.match(agents, /bloque `env`.*petición expresa/is);
  assert.match(agents, /install\.cmd doctor/);
  assert.match(agents, /initialize.*tools\/list/is);
  assert.match(agents, /release-manifest\.json/i);
  assert.match(agents, /seleccionad[oa]s?.*clientes|clientes.*seleccionad[oa]s?/is);
  assert.match(agents, /integration-manifest\.json/i);
  assert.doesNotMatch(agents, /clona.*etiqueta/is);
  assert.doesNotMatch(agents, /npm ci.*raíz/is);

  assert.match(readme, /Instala PUCP-MCP desde este repositorio/i);
  assert.match(readme, /release portátil/i);
  assert.match(readme, /Claude Code/);
  assert.match(readme, /Claude Desktop/);
  assert.match(installation, /actualización/i);
  assert.match(installation, /ZIP.*versión/is);
  assert.match(installation, /rollback/i);
  assert.match(installation, /desinstalación/i);
  assert.match(installation, /no.*borra.*caché/is);
  assert.match(installation, /credenciales.*chat.*política.*privacidad/is);
  assert.match(installation, /Codex.*verificado/is);
  assert.match(installation, /Antigravity.*verificado/is);
  assert.match(installation, /Claude Code.*documentado/is);
  assert.match(installation, /Claude Desktop.*condicional/is);
  assert.match(integrations, /\.agents[\\/]skills/i);
  assert.match(integrations, /\.gemini[\\/]antigravity[\\/]skills/i);
  assert.match(integrations, /Cursor.*condicional/is);
  assert.match(integrations, /Kimi.*condicional/is);

  assert.match(gitignore, /^\*\.log$/m);
  assert.match(gitignore, /^\*\.backup$/m);
  assert.match(gitignore, /^\*\.bak$/m);
  assert.doesNotMatch(gitignore, /\*\.log\\n/);
});

test("integration examples use the stable portable launcher", async () => {
  const examples = await Promise.all([
    text("integrations/codex/config.example.toml"),
    text("integrations/antigravity/mcp_config.example.json"),
    text("integrations/claude-code/mcp.example.json"),
    text("integrations/claude-desktop/claude_desktop_config.example.json"),
    text("integrations/cursor/mcp.example.json"),
    text("integrations/kimi-code/mcp.example.json"),
    text("integrations/generic/mcp.example.json")
  ]);
  for (const example of examples) {
    assert.match(example, /PUCP_MCP_LAUNCHER/u);
    assert.match(example, /--client/u);
    assert.doesNotMatch(example, /NODE_EXECUTABLE|PUCP_MCP_ROOT/u);
  }
});
