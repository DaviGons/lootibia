/**
 * Teste de ponta a ponta dos caminhos do BOT que tocam pastas e metas.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/testar-bot-pastas.ts
 *
 * ## Por que existe, ao lado de `testar-pastas.ts`
 *
 * Aquele cobre a tela; este cobre o bot. São caminhos diferentes para o mesmo
 * banco: a tela grava `pasta_id` por um `update` disparado num clique, e o bot
 * grava no `insert` da importação. A diretriz 45 nasceu de uma RLS que negava em
 * silêncio num desses caminhos e respondia `200` — e nenhum teste de `lib/`
 * pegaria isso, porque não há lógica errada, só política faltando.
 *
 * Por isso aqui vale a mesma regra do irmão: **relê do banco** em vez de confiar
 * no retorno da chamada. Era exatamente o retorno que mentia.
 *
 * ## O que ele NÃO faz
 *
 * Não fala com o Discord. Verificação de assinatura, formato de modal e limites
 * de embed estão em `lib/discord.test.ts`, que roda sem rede. Aqui é só o que
 * exige Postgres: RLS, `pasta_id` gravado de verdade e os agregados.
 *
 * Cria e apaga os próprios dados — pasta com nome improvável e uma sessão de
 * teste, removidas no fim mesmo se alguma asserção falhar.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assinarJwt } from "../lib/supabase/bot.ts";
import { importarSessao } from "../lib/importacao.ts";
import { pastasDoUsuario, precoDaTc, totaisPorPasta, resumoDoPeriodo } from "../lib/consulta.ts";
import { progressoDaMeta } from "../lib/meta.ts";

function exigir(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`Falta ${nome}. Rode com --env-file=.env.local.`);
    process.exit(1);
  }
  return v;
}

const url = exigir("NEXT_PUBLIC_SUPABASE_URL");
const publicavel = exigir("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const segredo = exigir("SUPABASE_JWT_SECRET");
const secreta = exigir("SUPABASE_SECRET_KEY");

const MARCA = `zz-bot-${Date.now()}`;

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

/** Cliente autenticado como o usuário, igual ao que o bot monta (diretriz 34). */
function comoUsuario(id: string): SupabaseClient {
  return createClient(url, publicavel, {
    global: { headers: { Authorization: `Bearer ${assinarJwt(id, segredo)}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Sessão de teste com início improvável, para não colidir com hunt de verdade.
 *
 * O ano 2011 é anterior ao `INICIO_SERVER_SAVE_PADRONIZADO` de `lib/periodo.ts`,
 * então nenhuma hunt real pode estar aqui — e o `unique (usuario_id, inicio)`
 * garante que duas execuções não se atropelem, porque o minuto entra no texto.
 */
function textoDeHunt(minuto: number): string {
  const mm = String(minuto).padStart(2, "0");
  return [
    `Session data: From 2011-01-01, 03:${mm}:00 to 2011-01-01, 05:${mm}:00`,
    "Session: 02:00h",
    "Raw XP Gain: 1,000,000",
    "XP Gain: 2,000,000",
    "Loot: 3,000,000",
    "Supplies: 1,000,000",
    "Balance: 2,000,000",
    "Damage: 5,000,000",
    "Healing: 1,000,000",
    "Killed Monsters:",
    "10x betrayed wraith",
    "Looted Items:",
    "5x a great mana potion",
  ].join("\n");
}

async function main() {
  const admin = createClient(url, secreta, { auth: { persistSession: false } });

  const { data: contas, error: erroContas } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (erroContas) throw new Error(erroContas.message);
  if (contas.users.length === 0) throw new Error("Nenhuma conta. Rode criar-usuario.ts primeiro.");

  const eu = contas.users[0];
  console.log(`usuário do teste: ${eu.email}\n`);
  const sb = comoUsuario(eu.id);

  let pastaId: number | null = null;
  const sessoesCriadas: number[] = [];

  try {
    // -----------------------------------------------------------------------
    console.log("== a pasta que o seletor do modal vai oferecer");
    const { data: pasta, error: erroPasta } = await sb
      .from("pasta")
      .insert({
        usuario_id: eu.id,
        nome: `${MARCA}-meta`,
        meta_valor: 500,
        meta_unidade: "tc",
      })
      .select("id, nome")
      .single();
    if (erroPasta) throw new Error(`não consegui criar a pasta: ${erroPasta.message}`);
    pastaId = pasta.id as number;

    const listadas = await pastasDoUsuario(sb);
    const minha = listadas.find((p) => p.id === pastaId);
    ok("pastasDoUsuario devolve a pasta nova", minha?.nome, `${MARCA}-meta`);
    ok("e devolve a meta junto", [minha?.metaValor, minha?.metaUnidade], [500, "tc"]);

    // -----------------------------------------------------------------------
    console.log("\n== /addhunt gravando NA pasta");
    // É o buraco principal que esta entrega fecha: antes, toda hunt vinda do
    // Discord caía em "Sem pasta".
    const r = await importarSessao(sb, {
      texto: textoDeHunt(11),
      spot: `${MARCA}-spot`,
      personagem: `${MARCA}-char`,
      pastaId,
      fuso: "America/Sao_Paulo",
      usuarioId: eu.id,
    });
    ok("importou", r.ok, true);
    if (!r.ok) throw new Error(`importação falhou: ${r.mensagem}`);
    sessoesCriadas.push(r.sessaoId);

    // AQUI está o ponto do teste. O retorno acima diria "ok" mesmo se a RLS
    // tivesse engolido o `pasta_id` — então relemos do banco (diretriz 46).
    const { data: gravada } = await sb
      .from("sessao")
      .select("id, pasta_id")
      .eq("id", r.sessaoId)
      .single();
    ok("o pasta_id foi gravado DE VERDADE", gravada?.pasta_id, pastaId);

    // -----------------------------------------------------------------------
    console.log("\n== /addhunt sem pasta continua funcionando");
    const semPasta = await importarSessao(sb, {
      texto: textoDeHunt(22),
      fuso: "America/Sao_Paulo",
      usuarioId: eu.id,
    });
    ok("importou sem pasta", semPasta.ok, true);
    if (semPasta.ok) {
      sessoesCriadas.push(semPasta.sessaoId);
      const { data: solta } = await sb
        .from("sessao")
        .select("pasta_id")
        .eq("id", semPasta.sessaoId)
        .single();
      ok("cai em Sem pasta, como antes", solta?.pasta_id, null);
    }

    // -----------------------------------------------------------------------
    console.log("\n== /viewstats filtrando por pasta");
    // "tudo", sem fronteira de tempo: a hunt de teste é de 2011 e ficaria fora
    // de qualquer janela de semana ou mês.
    const daPasta = await resumoDoPeriodo(sb, { inicio: null, fim: null, pastaId });
    ok("só a hunt da pasta entra", daPasta.resumo.hunts, 1);
    ok("profit é loot − supplies", daPasta.resumo.profit, 2_000_000);
    ok("o spot aparece em hunts mais caçadas", daPasta.resumo.spotsMaisCacados[0]?.rotulo, `${MARCA}-spot`);

    const semFiltro = await resumoDoPeriodo(sb, { inicio: null, fim: null });
    ok("sem filtro, conta as duas", semFiltro.resumo.hunts >= 2, true);
    ok("filtrar por pasta reduz mesmo", daPasta.resumo.hunts < semFiltro.resumo.hunts, true);

    // Pasta que não é minha (id impossível) não pode vazar hunt de ninguém.
    const inexistente = await resumoDoPeriodo(sb, { inicio: null, fim: null, pastaId: 2_000_000_000 });
    ok("pasta inexistente devolve vazio", inexistente.resumo.hunts, 0);

    // -----------------------------------------------------------------------
    console.log("\n== /meta somando a pasta");
    const totais = await totaisPorPasta(sb);
    const meu = totais.get(pastaId);
    ok("a pasta soma uma hunt", meu?.hunts, 1);
    ok("e o profit dela", meu?.profit, 2_000_000);

    const preco = await precoDaTc(sb);
    console.log(`     preço da TC configurado: ${preco === null ? "nenhum" : preco}`);

    // A conversão é a regra que não se negocia: 500 TC continuam 500 TC, e o
    // alvo em gold é recalculado ao preço vigente.
    const prog = progressoDaMeta({ valor: 500, unidade: "tc" }, 2_000_000, 6000, 1);
    ok("500 TC a 6.000 gp dão alvo de 3 mi", prog?.alvoEmGp, 3_000_000);
    ok("2 mi de 3 mi é 2/3", prog && Math.round(prog.fracao * 100), 67);
    ok("faltam 167 TC, na unidade da meta", prog?.falta, 167);
    ok("no ritmo de 2 mi/hunt, falta 1 hunt", prog?.huntsRestantes, 1);
    ok("sem preço, meta em TC não tem alvo", progressoDaMeta({ valor: 500, unidade: "tc" }, 1, null), null);

    // -----------------------------------------------------------------------
    console.log("\n== apagar pasta NÃO apaga hunt");
    // `on delete set null` — apagar pasta é organizar, não destruir.
    await sb.from("pasta").delete().eq("id", pastaId);
    const { data: sobrevivente } = await sb
      .from("sessao")
      .select("id, pasta_id")
      .eq("id", r.sessaoId)
      .single();
    ok("a hunt continua existindo", sobrevivente?.id, r.sessaoId);
    ok("e voltou para Sem pasta", sobrevivente?.pasta_id, null);
    pastaId = null;
  } finally {
    console.log("\n== limpeza");
    if (pastaId !== null) await sb.from("pasta").delete().eq("id", pastaId);
    for (const id of sessoesCriadas) await sb.from("sessao").delete().eq("id", id);
    const { data: restou } = await sb.from("sessao").select("id").in("id", sessoesCriadas);
    ok("nenhuma sessão de teste sobrou", restou?.length ?? 0, 0);
    // Lookups (spot, personagem) são vocabulário compartilhado e não têm
    // política de delete: ficam, com nome marcado, e não atrapalham ninguém.
  }

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
