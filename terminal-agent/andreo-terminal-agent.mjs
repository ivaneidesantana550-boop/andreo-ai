#!/usr/bin/env node
import readline from "node:readline";
import { exec } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(exec);
const base = process.argv[2] || "https://andreo-nfiygksy.manus.space";
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = question => new Promise(resolve => rl.question(question, resolve));
const tokenIndex = process.argv.indexOf("--token");
const joinToken = tokenIndex >= 0 ? process.argv[tokenIndex + 1] : "";
const code = joinToken ? "" : (await ask("Código exibido no Andreo: ")).trim();
const name = (joinToken ? "Terminal local" : await ask("Nome deste terminal (opcional): ")).trim() || "Terminal local";
const claim = await fetch(`${base}/api/terminal/agent/${joinToken ? "connect" : "claim"}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(joinToken ? { joinToken, name } : { code, name }) });
if (!claim.ok) { console.error("Não foi possível parear:", await claim.text()); process.exit(1); }
const { agentToken } = await claim.json();
console.log("Terminal conectado. Mantenha esta janela aberta.");
rl.close();
let busy = false;
while (true) {
  try {
    const response = await fetch(`${base}/api/terminal/agent/next?agentToken=${encodeURIComponent(agentToken)}`);
    const data = await response.json();
    if (!data.command || busy) { await new Promise(r => setTimeout(r, 1000)); continue; }
    busy = true;
    console.log(`\\nExecutando comando autorizado pelo usuário: ${data.command.command}`);
    try {
      const result = await execAsync(data.command.command, { shell: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
      await fetch(`${base}/api/terminal/agent/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentToken, commandId: data.command.id, status: "done", output: `${result.stdout || ""}${result.stderr || ""}` }) });
      console.log(result.stdout || result.stderr || "Comando concluído sem saída.");
    } catch (error) {
      await fetch(`${base}/api/terminal/agent/result`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentToken, commandId: data.command.id, status: "error", output: error.stdout || "", error: error.message }) });
      console.error(error.message);
    } finally { busy = false; }
  } catch (error) { console.error("Conexão perdida; tentando novamente...", error.message); await new Promise(r => setTimeout(r, 3000)); }
}
