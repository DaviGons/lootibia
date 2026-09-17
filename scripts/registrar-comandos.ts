/**
 * Ver docs/bot-discord.md.
 *
 * Registra os slash commands no Discord. Rodado à mão, como
 * `scripts/atualizar-criaturas.ts` — não é passo de build nem de deploy.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/registrar-comandos.ts
 *
 * Por padrão registra **no servidor** informado em `DISCORD_GUILD_ID`, e não
 * globalmente. A diferença importa na prática:
 *
 *   * comando de servidor aparece **na hora**;
 *   * comando global leva **até uma hora** para propagar.
 *
 * Num círculo fechado não há motivo para esperar uma hora a cada ajuste de
 * descrição. Para registrar global mesmo assim: `--global`.
 *
 * `PUT` substitui a lista inteira — comando removido daqui some do Discord. É o
 * comportamento desejado: a fonte da verdade é `lib/discord/comandos.ts`.
 */

import { COMANDOS } from "../lib/discord/comandos.ts";

const API = "https://discord.com/api/v10";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome}. Rode com --env-file=.env.local, ou exporte a variável.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const global = process.argv.includes("--global");
  const appId = exigir("DISCORD_APPLICATION_ID");
  const token = exigir("DISCORD_BOT_TOKEN");

  const url = global
    ? `${API}/applications/${appId}/commands`
    : `${API}/applications/${appId}/guilds/${exigir("DISCORD_GUILD_ID")}/commands`;

  console.log(`Registrando ${COMANDOS.length} comandos (${global ? "global" : "no servidor"})…`);

  const r = await fetch(url, {
    method: "PUT",
    headers: {
      // `Bot ` na frente não é enfeite: sem o prefixo o Discord responde 401.
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "lootibia (https://lootibia.vercel.app)",
    },
    body: JSON.stringify(COMANDOS),
  });

  const corpo = await r.text();

  if (!r.ok) {
    // O Discord devolve o motivo em JSON, campo por campo. Imprimir cru é mais
    // útil que resumir: os erros são específicos ("description too long").
    console.error(`Falhou com ${r.status}:`);
    console.error(corpo);
    process.exit(1);
  }

  const registrados = JSON.parse(corpo) as { name: string }[];
  for (const c of registrados) console.log(`  /${c.name}`);
  console.log(
    global
      ? "Pronto. Comandos globais podem levar até 1 hora para aparecer."
      : "Pronto. Comandos de servidor aparecem na hora.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
