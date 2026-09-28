/**
 * Teste de ponta a ponta dos drops extras, contra o banco de verdade.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/testar-extras.ts
 *
 * Existe pelo motivo da diretriz 46: `drop_extra` nasceu com RLS de quatro
 * verbos, e regra que vive no Postgres não é pega por teste de `lib/`. Foi
 * assim que o `update` faltando na `sessao` passou despercebido em 2026-09-21 —
 * a chamada "funcionava", o PostgREST respondia 200, e nada acontecia.
 *
 * Desde o 0005 cobre também a posse da pasta: anotar drop na pasta de outra
 * pessoa, ou mover um drop para lá, é recusado pelo banco (diretriz 57).
 *
 * Roda com duas contas descartáveis, logadas pela chave publicável, e apaga as
 * duas no fim — ver `scripts/usuarios-de-teste.ts`. Não entra na diretriz 3:
 * precisa de credencial e de rede.
 */

import { createClient } from "@supabase/supabase-js";
import { somarExtras } from "../lib/extras.ts";
import {
  apagarSobras,
  apagarUsuariosDeTeste,
  criarUsuarioDeTeste,
  type UsuarioDeTeste,
} from "./usuarios-de-teste.ts";

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
const secreta = exigir("SUPABASE_SECRET_KEY");

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

async function main() {
  const admin = createClient(url, secreta, { auth: { persistSession: false } });

  const { error: naoExiste } = await admin.from("drop_extra").select("id").limit(1);
  if (naoExiste) {
    console.error(
      `\nA tabela 'drop_extra' nao existe (${naoExiste.code}).\n` +
        "Rode supabase/migrations/0004_drops_extras.sql no SQL Editor primeiro.\n",
    );
    process.exit(1);
  }

  const sobras = await apagarSobras(admin);
  if (sobras > 0) console.log(`(apaguei ${sobras} conta(s) de teste de uma rodada anterior)\n`);

  const criados: UsuarioDeTeste[] = [];
  try {
    const eu = await criarUsuarioDeTeste(admin, url, publicavel, "a");
    criados.push(eu);
    const outro = await criarUsuarioDeTeste(admin, url, publicavel, "b");
    criados.push(outro);
    console.log(`usuários do teste: ${eu.email} e ${outro.email}\n`);
    await testar(eu, outro);
  } finally {
    await apagarUsuariosDeTeste(admin, criados);
  }

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exit(1);
}

async function testar(eu: UsuarioDeTeste, outro: UsuarioDeTeste) {
  const sb = eu.sb;

  // Um item de verdade, para nao inventar linha no lookup compartilhado.
  const { data: item } = await sb.from("item").select("id, nome").limit(1).single();
  if (!item) throw new Error("nenhum item no banco; importe uma sessao antes");

  // -------------------------------------------------------------------------
  console.log("== o extra nasce, e nasce meu");
  const { data: criado, error: erroCriar } = await sb
    .from("drop_extra")
    .insert({ usuario_id: eu.id, item_id: item.id, valor: 30_000_000, unidade: "gp" })
    .select("id, valor, unidade, pasta_id")
    .single();
  ok("criar", erroCriar?.message ?? "sem erro", "sem erro");
  if (!criado) throw new Error("sem extra, nao da para continuar");
  ok("valor e unidade", [criado.valor, criado.unidade], [30_000_000, "gp"]);
  ok("sem pasta = nulo", criado.pasta_id, null);

  console.log("\n== o check do banco recusa o que nao faz sentido");
  const { error: erroZero } = await sb
    .from("drop_extra")
    .insert({ usuario_id: eu.id, item_id: item.id, valor: 0, unidade: "gp" });
  ok("valor zero recusado (23514)", erroZero?.code, "23514");

  const { error: erroUnidade } = await sb
    .from("drop_extra")
    .insert({ usuario_id: eu.id, item_id: item.id, valor: 10, unidade: "eur" });
  ok("unidade invalida recusada (23514)", erroUnidade?.code, "23514");

  // -------------------------------------------------------------------------
  console.log("\n== UPDATE, o verbo que faltou na sessao em 21/09");
  const { error: erroUp } = await sb
    .from("drop_extra")
    .update({ valor: 42_000_000 })
    .eq("id", criado.id);
  ok("update nao da erro", erroUp?.message ?? "sem erro", "sem erro");
  // Rele do banco: era exatamente o RETORNO que mentia no bug de 21/09.
  const valorDe = async () =>
    (await sb.from("drop_extra").select("valor, pasta_id").eq("id", criado.id).single()).data;
  ok("e REALMENTE gravou", (await valorDe())?.valor, 42_000_000);

  // -------------------------------------------------------------------------
  console.log("\n== a pasta de OUTRA pessoa e recusada pelo banco (0005)");
  const { data: pastaDoOutro } = await outro.sb
    .from("pasta")
    .insert({ usuario_id: outro.id, nome: "do outro" })
    .select("id")
    .single();
  if (!pastaDoOutro) throw new Error("sem a pasta do outro, nao da para continuar");

  const { error: erroAnotarAlheia } = await sb
    .from("drop_extra")
    .insert({ usuario_id: eu.id, pasta_id: pastaDoOutro.id, item_id: item.id, valor: 1, unidade: "gp" });
  ok("anotar drop na pasta alheia da 42501", erroAnotarAlheia?.code, "42501");

  const { error: erroMoverAlheia } = await sb
    .from("drop_extra")
    .update({ pasta_id: pastaDoOutro.id })
    .eq("id", criado.id);
  ok("mover o meu drop para a pasta alheia da 42501", erroMoverAlheia?.code, "42501");
  ok("e ele continua sem pasta", (await valorDe())?.pasta_id, null);

  const { data: minhaPasta } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: "minha" })
    .select("id")
    .single();
  const { error: erroMoverMinha } = await sb
    .from("drop_extra")
    .update({ pasta_id: minhaPasta?.id })
    .eq("id", criado.id);
  ok("mover para a PROPRIA pasta passa", [erroMoverMinha?.message ?? "sem erro", (await valorDe())?.pasta_id], [
    "sem erro",
    minhaPasta?.id,
  ]);

  // -------------------------------------------------------------------------
  console.log("\n== a soma da tela bate com a logica pura");
  const { data: meus } = await sb.from("drop_extra").select("valor, unidade, item(nome)");
  const lista = (meus ?? []).map((d) => ({
    item: (d.item as unknown as { nome: string } | null)?.nome ?? "?",
    valor: d.valor as number,
    unidade: d.unidade as "tc" | "gp",
  }));
  const total = somarExtras(lista, 44_800);
  ok("contados + semPreco = total da lista", total.contados + total.semPreco, lista.length);
  ok("o extra criado esta na soma", total.gp >= 42_000_000, true);

  // -------------------------------------------------------------------------
  console.log("\n== a RLS isola de verdade");
  const anon = createClient(url, publicavel, { auth: { persistSession: false } });
  const { data: semLogin, error: erroAnonLe } = await anon.from("drop_extra").select("id");
  ok("anonimo nao ve extra nenhum", semLogin?.length ?? 0, 0);
  ok("  e nem tem privilegio para tentar (42501)", erroAnonLe?.code, "42501");
  const { error: erroAnon } = await anon
    .from("drop_extra")
    .insert({ usuario_id: eu.id, item_id: item.id, valor: 1, unidade: "gp" });
  ok("anonimo nao cria", erroAnon?.code, "42501");

  const { error: erroForja } = await sb
    .from("drop_extra")
    .insert({ usuario_id: outro.id, item_id: item.id, valor: 1, unidade: "gp" });
  ok("nao da para criar em nome de outro (with check)", erroForja?.code, "42501");

  const { data: doOutro } = await outro.sb.from("drop_extra").select("id").eq("id", criado.id);
  ok("o outro nao enxerga o meu", doOutro?.length ?? 0, 0);

  const { error: erroUpAlheio } = await outro.sb
    .from("drop_extra")
    .update({ valor: 1 })
    .eq("id", criado.id);
  ok("o outro nao altera o meu", [erroUpAlheio?.message ?? "sem erro", (await valorDe())?.valor], [
    "sem erro",
    42_000_000,
  ]);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
