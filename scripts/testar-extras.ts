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
 * Assina um JWT de usuário (`lib/supabase/jwt.ts`) em vez de usar a chave
 * secreta, porque a secreta IGNORA a RLS, que é justamente o que se testa.
 *
 * Cria e apaga os próprios dados. Não entra na diretriz 3: precisa de
 * credencial e de rede.
 */

import { createClient } from "@supabase/supabase-js";
import { assinarJwt } from "../lib/supabase/jwt.ts";
import { somarExtras } from "../lib/extras.ts";

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

const MARCA = `zz-extra-${Date.now()}`;

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

const comoUsuario = (id: string) =>
  createClient(url, publicavel, {
    global: { headers: { Authorization: `Bearer ${assinarJwt(id, segredo)}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

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

  const { data: contas } = await admin.auth.admin.listUsers({ perPage: 200 });
  const eu = contas!.users[0];
  const outro = contas!.users[1] ?? null;
  const sb = comoUsuario(eu.id);
  console.log(`usuário do teste: ${eu.email}\n`);

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
  const { data: depois } = await sb
    .from("drop_extra")
    .select("valor")
    .eq("id", criado.id)
    .single();
  ok("e REALMENTE gravou", depois?.valor, 42_000_000);

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
  const { data: semLogin } = await anon.from("drop_extra").select("id");
  ok("anonimo nao ve extra nenhum", semLogin?.length ?? 0, 0);
  const { error: erroAnon } = await anon
    .from("drop_extra")
    .insert({ usuario_id: eu.id, item_id: item.id, valor: 1, unidade: "gp" });
  ok("anonimo nao cria", erroAnon?.code, "42501");

  if (outro) {
    const { error: erroForja } = await sb
      .from("drop_extra")
      .insert({ usuario_id: outro.id, item_id: item.id, valor: 1, unidade: "gp" });
    ok("nao da para criar em nome de outro (with check)", erroForja?.code, "42501");

    const sbOutro = comoUsuario(outro.id);
    const { data: doOutro } = await sbOutro.from("drop_extra").select("id").eq("id", criado.id);
    ok("o outro nao enxerga o meu", doOutro?.length ?? 0, 0);

    const { error: erroUpAlheio } = await sbOutro
      .from("drop_extra")
      .update({ valor: 1 })
      .eq("id", criado.id);
    const { data: intacto } = await sb
      .from("drop_extra")
      .select("valor")
      .eq("id", criado.id)
      .single();
    ok("o outro nao altera o meu", [erroUpAlheio?.message ?? "sem erro", intacto?.valor], [
      "sem erro",
      42_000_000,
    ]);
  } else {
    console.log("pula  so existe uma conta; crie outra para cobrir o isolamento");
  }

  // -------------------------------------------------------------------------
  console.log("\n== limpeza");
  await sb.from("drop_extra").delete().eq("id", criado.id);
  const { data: sobrou } = await sb.from("drop_extra").select("id").eq("id", criado.id);
  ok("apagado", sobrou?.length ?? 0, 0);
  console.log(`(marca deste teste: ${MARCA})`);

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
