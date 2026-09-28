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
 * Desde o 0005 ele cobre também o que o banco passou a recusar por conta
 * própria (diretriz 57): pôr a sessão na pasta de outra pessoa, gravar sessão
 * com o char de outra pessoa, renomear personagem — e `anon` sem privilégio.
 *
 * ## Como ele vira "um usuário"
 *
 * Criando DUAS contas descartáveis e entrando nelas com `signInWithPassword`
 * pela chave publicável — o mesmo caminho da tela, com a RLS valendo. No fim as
 * contas são apagadas, e o cascade leva tudo o que elas criaram. Nenhum dado de
 * quem usa o site é tocado. O porquê de não assinar token está em
 * `scripts/usuarios-de-teste.ts`.
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { progressoDaMeta } from "../lib/meta.ts";
import { importarSessao } from "../lib/importacao.ts";
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

/** Uma sessão mínima, gravada direto — o caminho de quem pula a tela. */
const sessaoCrua = (usuarioId: string, inicio: string, extra: Record<string, unknown> = {}) => ({
  usuario_id: usuarioId,
  inicio,
  duracao_s: 60,
  raw_xp: 0,
  xp: 0,
  loot: 0,
  supplies: 0,
  damage: 0,
  healing: 0,
  ...extra,
});

async function main() {
  const admin = createClient(url, secreta, { auth: { persistSession: false } });

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
    const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
    const restaram = (data?.users ?? []).filter((u) => criados.some((c) => c.id === u.id));
    ok("\nlimpeza: as contas de teste não existem mais", restaram.length, 0);
  }

  console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
  if (falhas > 0) process.exit(1);
}

async function testar(eu: UsuarioDeTeste, outro: UsuarioDeTeste) {
  const sb = eu.sb;

  // -------------------------------------------------------------------------
  console.log("== a pasta nasce, e nasce minha");
  const { data: pasta, error: erroCriar } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: "alfa", meta_valor: 500, meta_unidade: "tc" })
    .select("id, nome, meta_valor, meta_unidade, ordem")
    .single();
  ok("criar pasta com meta", erroCriar?.message ?? "sem erro", "sem erro");
  if (!pasta) throw new Error("sem pasta, não dá para continuar");
  ok("meta gravada em TC", [pasta.meta_valor, pasta.meta_unidade], [500, "tc"]);

  const { data: pastaDoOutro } = await outro.sb
    .from("pasta")
    .insert({ usuario_id: outro.id, nome: "do outro" })
    .select("id")
    .single();
  if (!pastaDoOutro) throw new Error("sem a pasta do outro, não dá para continuar");

  console.log("\n== o check do banco recusa meta pela metade");
  // `pasta_meta_completa`: valor sem unidade é número sem significado.
  const { error: erroMetade } = await sb
    .from("pasta")
    .insert({ usuario_id: eu.id, nome: "quebrada", meta_valor: 100 });
  ok("valor sem unidade é recusado (23514)", erroMetade?.code, "23514");

  console.log("\n== nome repetido na mesma conta é recusado");
  const { error: erroDup } = await sb.from("pasta").insert({ usuario_id: eu.id, nome: "alfa" });
  ok("unique (usuario_id, nome)", erroDup?.code, "23505");

  // -------------------------------------------------------------------------
  console.log("\n== importar pelo mesmo código da tela");
  const texto = readFileSync("test/fixtures/sessao-indentada.txt", "utf8");
  const r = await importarSessao(sb, { texto, fuso: "America/Sao_Paulo", usuarioId: eu.id });
  ok("importação da fixture", r.ok ? "ok" : r.mensagem, "ok");
  if (!r.ok) throw new Error("sem sessão importada, não dá para continuar");
  const { count: monstros } = await sb
    .from("sessao_monstro")
    .select("monstro_id", { count: "exact", head: true })
    .eq("sessao_id", r.sessaoId);
  ok("o detalhe entrou junto", monstros, r.monstros);
  const dup = await importarSessao(sb, { texto, fuso: "America/Sao_Paulo", usuarioId: eu.id });
  ok("colar de novo é duplicata", dup.ok ? "ok" : dup.motivo, "duplicata");

  // -------------------------------------------------------------------------
  console.log("\n== mover hunt para a pasta — O BUG QUE MOTIVOU ISTO");
  // Sem a política de update em `sessao`, isto respondia SUCESSO e não movia
  // nada. Por isso o teste confere relendo, e não o retorno da chamada.
  const { error: erroMover } = await sb
    .from("sessao")
    .update({ pasta_id: pasta.id })
    .eq("id", r.sessaoId);
  ok("update não dá erro", erroMover?.message ?? "sem erro", "sem erro");
  const pastaDa = async () =>
    (await sb.from("sessao").select("pasta_id").eq("id", r.sessaoId).single()).data?.pasta_id;
  ok("a hunt REALMENTE foi para a pasta", await pastaDa(), pasta.id);

  const { count } = await sb
    .from("sessao")
    .select("id", { count: "exact", head: true })
    .eq("pasta_id", pasta.id);
  ok("a contagem da pasta enxerga a hunt", count, 1);

  console.log("\n== a pasta de OUTRA pessoa é recusada pelo banco (0005)");
  // A FK aceita qualquer pasta que exista; quem recusa é o `with check`.
  const { error: erroAlheia } = await sb
    .from("sessao")
    .update({ pasta_id: pastaDoOutro.id })
    .eq("id", r.sessaoId);
  ok("mover para a pasta alheia dá 42501", erroAlheia?.code, "42501");
  ok("e a hunt continua onde estava", await pastaDa(), pasta.id);
  const { error: erroInsereAlheia } = await sb
    .from("sessao")
    .insert(sessaoCrua(eu.id, "2020-01-01T10:00:00Z", { pasta_id: pastaDoOutro.id }));
  ok("gravar sessão direto na pasta alheia dá 42501", erroInsereAlheia?.code, "42501");

  console.log("\n== apagar a pasta NÃO apaga a hunt (on delete set null)");
  await sb.from("pasta").delete().eq("id", pasta.id);
  const { data: sobreviveu } = await sb
    .from("sessao")
    .select("id, pasta_id")
    .eq("id", r.sessaoId)
    .single();
  ok("a hunt continua existindo", sobreviveu?.id, r.sessaoId);
  ok("e voltou para 'sem pasta'", sobreviveu?.pasta_id, null);

  // -------------------------------------------------------------------------
  console.log("\n== personagem: vínculo conferido pelo banco (0005)");
  const { data: chars } = await sb.from("personagem").select("id, nome").order("id").limit(2);
  if (!chars || chars.length < 2) {
    console.log("pula  o banco precisa de dois personagens cadastrados para este bloco");
  } else {
    const [meu, alheio] = chars;
    const { error: erroVinculo } = await sb
      .from("usuario_personagem")
      .insert({ usuario_id: eu.id, personagem_id: meu.id, mundo: "Teste", nivel: 1 });
    ok("vincular um char", erroVinculo?.message ?? "sem erro", "sem erro");

    const { error: erroCharAlheio } = await sb
      .from("sessao")
      .insert(sessaoCrua(eu.id, "2020-01-02T10:00:00Z", { personagem_id: alheio.id }));
    ok("sessão com char NÃO vinculado dá 42501", erroCharAlheio?.code, "42501");

    const { data: comChar, error: erroCharMeu } = await sb
      .from("sessao")
      .insert(sessaoCrua(eu.id, "2020-01-03T10:00:00Z", { personagem_id: meu.id }))
      .select("id")
      .single();
    ok("sessão com o próprio char passa", erroCharMeu?.message ?? "sem erro", "sem erro");

    // O caso que um `with check` erraria: o vínculo acaba DEPOIS, e a hunt
    // antiga continua apontando para o char. Movê-la não pode ser recusado.
    await sb.from("usuario_personagem").delete().eq("personagem_id", meu.id);
    const { data: novaPasta } = await sb
      .from("pasta")
      .insert({ usuario_id: eu.id, nome: "beta" })
      .select("id")
      .single();
    const { error: erroMoverAntiga } = await sb
      .from("sessao")
      .update({ pasta_id: novaPasta?.id })
      .eq("id", comChar?.id ?? -1);
    const { data: antiga } = await sb
      .from("sessao")
      .select("pasta_id")
      .eq("id", comChar?.id ?? -1)
      .single();
    ok(
      "char desvinculado não trava mover a hunt antiga",
      [erroMoverAntiga?.message ?? "sem erro", antiga?.pasta_id],
      ["sem erro", novaPasta?.id],
    );

    console.log("\n== o nome de um personagem não muda");
    const { error: erroRenome } = await sb
      .from("personagem")
      .update({ nome: `${alheio.nome} vandalizado` })
      .eq("id", alheio.id);
    const { data: nomeDepois } = await sb.from("personagem").select("nome").eq("id", alheio.id).single();
    // Com o 0005: o gatilho recusa (42501). Com o 0006: sem política de update,
    // zero linhas. Os dois deixam o nome intacto, e é isso que importa.
    ok("renomear o char de outra pessoa não pega", nomeDepois?.nome, alheio.nome);
    console.log(`     (resposta do banco: ${erroRenome?.code ?? "zero linhas, sem erro"})`);
  }

  // -------------------------------------------------------------------------
  console.log("\n== preço da TC por mundo");
  const { error: erroPreco } = await sb
    .from("config_mundo")
    .upsert({ usuario_id: eu.id, mundo: "Teste", preco_tc: 15800 }, { onConflict: "usuario_id,mundo" });
  ok("gravar preço", erroPreco?.message ?? "sem erro", "sem erro");

  const { data: lido } = await sb.from("config_mundo").select("preco_tc").eq("mundo", "Teste").single();
  ok("preço relido", lido?.preco_tc, 15800);

  // A conta que a tela faz, com o número que acabou de sair do banco.
  const p = progressoDaMeta({ valor: 500, unidade: "tc" }, 4_912_300, lido?.preco_tc ?? null, 24)!;
  ok("progresso bate com a lógica pura", [p.alvoEmGp, p.falta], [7_900_000, 190]);

  const { error: erroMundo } = await sb
    .from("config_mundo")
    .insert({ usuario_id: eu.id, mundo: "x".repeat(41), preco_tc: 1 });
  ok("mundo acima do teto é recusado (23514)", erroMundo?.code, "23514");

  // -------------------------------------------------------------------------
  console.log("\n== a RLS isola de verdade");
  const anon = createClient(url, publicavel, { auth: { persistSession: false } });
  const { data: semLogin, error: erroAnonLe } = await anon.from("pasta").select("id");
  ok("anônimo não vê pasta nenhuma", semLogin?.length ?? 0, 0);
  // Desde o 0005 `anon` não tem privilégio nenhum: o erro é "permission denied",
  // e não uma lista vazia filtrada pela RLS.
  ok("  e nem tem privilégio para tentar (42501)", erroAnonLe?.code, "42501");

  const { error: erroAnon } = await anon.from("pasta").insert({ usuario_id: eu.id, nome: "invasao" });
  ok("anônimo não cria pasta", erroAnon?.code, "42501");

  // Forjar `usuario_id` de outra conta tem de bater no `with check`.
  const { error: erroForja } = await sb.from("pasta").insert({ usuario_id: outro.id, nome: "forjada" });
  ok("não dá para criar pasta no nome de outro", erroForja?.code, "42501");

  const { data: doOutro } = await outro.sb.from("pasta").select("nome").neq("id", pastaDoOutro.id);
  ok("o outro usuário não enxerga as minhas", doOutro?.length ?? 0, 0);
}

main().catch((e) => {
  console.error("FALHOU:", (e as Error).message);
  process.exit(1);
});
