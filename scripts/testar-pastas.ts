/**
 * Teste de ponta a ponta das pastas, contra o banco de verdade.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/testar-pastas.ts
 *
 * ## Por que existe, se já há testes em `lib/`
 *
 * Os testes de `lib/` cobrem lógica pura e não tocam rede (diretriz 29). Mas o
 * bug que motivou este arquivo não estava em lógica nenhuma: `sessao` não tinha
 * política de **update** na RLS, então mover uma hunt para uma pasta atingia
 * zero linhas e o PostgREST respondia **sucesso**. Nenhum teste de unidade
 * pegaria isso, e o `tsc` muito menos — é uma regra que vive no Postgres.
 *
 * Então este script fala com o banco real, autenticado como um usuário real,
 * pelo mesmo caminho que a tela usa. Ele **cria e apaga os próprios dados**:
 * pastas com nome improvável, e nenhuma sessão é criada ou destruída.
 *
 * ## Como ele vira "um usuário"
 *
 * Assinando um JWT com `sub = usuario_id`, igual ao bot do Discord faz
 * (diretriz 34). Usar a chave secreta seria mais fácil e testaria a coisa
 * errada: ela **ignora a RLS**, e é justamente a RLS que estava quebrada.
 */

import { createClient } from "@supabase/supabase-js";
import { assinarJwt } from "../lib/supabase/bot.ts";
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

const MARCA = `zz-teste-${Date.now()}`;

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

/** Cliente autenticado como o usuário, com a RLS valendo. */
function comoUsuario(id: string) {
  return createClient(url, publicavel, {
    global: { headers: { Authorization: `Bearer ${assinarJwt(id, segredo)}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function main() {
  const admin = createClient(url, secreta, { auth: { persistSession: false } });

  const { data: contas, error: erroContas } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (erroContas) throw new Error(erroContas.message);
  if (contas.users.length === 0) throw new Error("Nenhuma conta. Rode criar-usuario.ts primeiro.");

  const eu = contas.users[0];
  const outro = contas.users[1] ?? null;
  console.log(`usuário do teste: ${eu.email}\n`);

  const sb = comoUsuario(eu.id);

  // -------------------------------------------------------------------------
  console.log("== a pasta nasce, e nasce minha");
  const { data: pasta, error: erroCriar } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: `${MARCA}-alfa`, meta_valor: 500, meta_unidade: "tc" })
    .select("id, nome, meta_valor, meta_unidade, ordem")
    .single();
  ok("criar pasta com meta", erroCriar?.message ?? "sem erro", "sem erro");
  if (!pasta) throw new Error("sem pasta, não dá para continuar");
  ok("meta gravada em TC", [pasta.meta_valor, pasta.meta_unidade], [500, "tc"]);

  console.log("\n== o check do banco recusa meta pela metade");
  // `pasta_meta_completa`: valor sem unidade é número sem significado.
  const { error: erroMetade } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: `${MARCA}-quebrada`, meta_valor: 100 });
  ok("valor sem unidade é recusado", erroMetade !== null, true);
  ok("  e o erro é de constraint (23514)", erroMetade?.code, "23514");

  console.log("\n== nome repetido na mesma conta é recusado");
  const { error: erroDup } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: `${MARCA}-alfa` });
  ok("unique (usuario_id, nome)", erroDup?.code, "23505");

  // -------------------------------------------------------------------------
  console.log("\n== mover hunt para a pasta — O BUG QUE MOTIVOU ISTO");
  const { data: sessoes } = await sb.from("sessao").select("id, pasta_id, loot, supplies").limit(1);
  const sessao = sessoes?.[0];

  if (!sessao) {
    console.log("pula  nenhuma sessão importada nesta conta; importe uma para cobrir este bloco");
  } else {
    const pastaOriginal = sessao.pasta_id;

    // Sem a política de update em `sessao`, isto respondia SUCESSO e não movia
    // nada. Por isso o teste confere relendo, e não o retorno da chamada.
    const { error: erroMover } = await sb
      .from("sessao")
      .update({ pasta_id: pasta.id })
      .eq("id", sessao.id);
    ok("update não dá erro", erroMover?.message ?? "sem erro", "sem erro");

    const { data: depois } = await sb
      .from("sessao")
      .select("pasta_id")
      .eq("id", sessao.id)
      .single();
    ok("a hunt REALMENTE foi para a pasta", depois?.pasta_id, pasta.id);

    const { count } = await sb
      .from("sessao")
      .select("id", { count: "exact", head: true })
      .eq("pasta_id", pasta.id);
    ok("a contagem da pasta enxerga a hunt", count, 1);

    // ---------------------------------------------------------------------
    console.log("\n== apagar a pasta NÃO apaga a hunt (on delete set null)");
    await sb.from("pasta").delete().eq("id", pasta.id);
    const { data: sobreviveu } = await sb
      .from("sessao")
      .select("id, pasta_id")
      .eq("id", sessao.id)
      .single();
    ok("a hunt continua existindo", sobreviveu?.id, sessao.id);
    ok("e voltou para 'sem pasta'", sobreviveu?.pasta_id, null);

    // Devolve a sessão ao estado em que estava, para não mexer nos dados dele.
    await sb.from("sessao").update({ pasta_id: pastaOriginal }).eq("id", sessao.id);
    const { data: restaurada } = await sb
      .from("sessao")
      .select("pasta_id")
      .eq("id", sessao.id)
      .single();
    ok("estado original restaurado", restaurada?.pasta_id, pastaOriginal);
  }

  // -------------------------------------------------------------------------
  console.log("\n== preço da TC por mundo");
  const mundo = `${MARCA}-mundo`;
  const { error: erroPreco } = await sb
    .from("config_mundo")
    .upsert({ usuario_id: eu.id, mundo, preco_tc: 15800 }, { onConflict: "usuario_id,mundo" });
  ok("gravar preço", erroPreco?.message ?? "sem erro", "sem erro");

  const { data: lido } = await sb
    .from("config_mundo")
    .select("preco_tc")
    .eq("mundo", mundo)
    .single();
  ok("preço relido", lido?.preco_tc, 15800);

  // A conta que a tela faz, com o número que acabou de sair do banco.
  const p = progressoDaMeta({ valor: 500, unidade: "tc" }, 4_912_300, lido?.preco_tc ?? null, 24)!;
  ok("progresso bate com a lógica pura", [p.alvoEmGp, p.falta], [7_900_000, 190]);
  await sb.from("config_mundo").delete().eq("mundo", mundo);

  // -------------------------------------------------------------------------
  console.log("\n== a RLS isola de verdade");
  const anon = createClient(url, publicavel, { auth: { persistSession: false } });
  const { data: semLogin } = await anon.from("pasta").select("id");
  ok("anônimo não vê pasta nenhuma", semLogin?.length ?? 0, 0);

  const { error: erroAnon } = await anon
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: `${MARCA}-invasao` });
  ok("anônimo não cria pasta", erroAnon?.code, "42501");

  if (outro) {
    // Forjar `usuario_id` de outra conta tem de bater no `with check`.
    const { error: erroForja } = await sb
      .from("pasta")
      .insert({ usuario_id: outro.id, nome: `${MARCA}-forjada` });
    ok("não dá para criar pasta no nome de outro", erroForja?.code, "42501");

    const sbOutro = comoUsuario(outro.id);
    const { data: doOutro } = await sbOutro.from("pasta").select("nome").like("nome", `${MARCA}%`);
    ok("o outro usuário não enxerga as minhas", doOutro?.length ?? 0, 0);
  } else {
    console.log("pula  só existe uma conta; crie outra para cobrir o isolamento entre usuários");
  }

  // -------------------------------------------------------------------------
  console.log("\n== limpeza");
  await sb.from("pasta").delete().like("nome", `${MARCA}%`);
  const { data: sobras } = await sb.from("pasta").select("id").like("nome", `${MARCA}%`);
  ok("nenhuma sobra do teste", sobras?.length ?? 0, 0);

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
