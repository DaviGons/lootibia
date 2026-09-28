"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { buscarPersonagem, ErroDaTibiaData } from "@/lib/tibiadata";
import type { UnidadeDaMeta } from "@/lib/meta";
import { pastaEhMinha } from "@/lib/posse";
import { idsPorNome } from "@/lib/importacao";

export interface Resultado {
  ok: boolean;
  mensagem: string;
}

/**
 * Nenhuma destas ações filtra por `usuario_id` à mão, e isso é deliberado.
 *
 * Quem isola é a RLS: as políticas de `pasta`, `config_mundo` e
 * `usuario_personagem` são todas `auth.uid() = usuario_id` (migration 0003).
 * Repetir o `.eq('usuario_id', …)` aqui daria a impressão de que o isolamento
 * depende deste arquivo — e `where` esquecido é bug comum, enquanto política de
 * RLS não se esquece sozinha — diretriz 26.
 *
 * O `usuario_id` aparece só no INSERT, porque a coluna é `not null` e o banco
 * precisa de um valor; o `with check` da política confere que é o seu.
 *
 * A POSSE do que o cliente aponta por id — a pasta de uma sessão, o personagem
 * de uma importação — também é do banco, desde o 0005: `with check` para a
 * pasta, gatilho para o personagem (diretriz 57). As conferências que sobraram
 * aqui existem para dar frase ao usuário, não para proteger nada: o token dele
 * fala direto com o PostgREST e passa por fora deste arquivo.
 */
async function usuarioAtual() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, usuario: data.user };
}

const LIMITE_NOME = 60;

/** Aparo e validação de nome de pasta, iguais aos `check` do banco. */
function nomeDePasta(bruto: unknown): string | null {
  const nome = String(bruto ?? "").trim();
  return nome.length >= 1 && nome.length <= LIMITE_NOME ? nome : null;
}

/**
 * Lê a meta do formulário.
 *
 * Campo vazio é "pasta sem meta", não erro — a meta é opcional. Mas valor sem
 * unidade, ou unidade fora de `tc|gp`, é recusado: o banco tem um `check` que
 * exige as duas colunas juntas, e deixar passar daria um erro de constraint
 * cru na cara do usuário.
 */
function metaDoFormulario(
  fd: FormData,
): { valor: number | null; unidade: UnidadeDaMeta | null } | "invalida" {
  const cru = String(fd.get("meta_valor") ?? "").replace(/[^\d]/g, "");
  const unidade = String(fd.get("meta_unidade") ?? "");

  if (cru === "") return { valor: null, unidade: null };

  const valor = Number(cru);
  if (!Number.isFinite(valor) || valor <= 0) return "invalida";
  if (unidade !== "tc" && unidade !== "gp") return "invalida";
  return { valor, unidade };
}

export async function criarPasta(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const nome = nomeDePasta(formData.get("nome"));
  if (!nome) return { ok: false, mensagem: `Dê um nome de 1 a ${LIMITE_NOME} caracteres.` };

  const meta = metaDoFormulario(formData);
  if (meta === "invalida") return { ok: false, mensagem: "Meta inválida: informe o valor e a unidade." };

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Faça login." };

  const { error } = await supabase.from("pasta").insert({
    usuario_id: usuario.id,
    nome,
    meta_valor: meta.valor,
    meta_unidade: meta.unidade,
  });

  // 23505 é o `unique (usuario_id, nome)`. Duas "Roshamuul" ficariam
  // indistinguíveis na lateral, então o banco recusa e a mensagem explica.
  if (error?.code === "23505") return { ok: false, mensagem: `Você já tem uma pasta "${nome}".` };
  if (error) return { ok: false, mensagem: error.message };

  revalidatePath("/hunts");
  return { ok: true, mensagem: `Pasta "${nome}" criada.` };
}

export async function editarPasta(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return { ok: false, mensagem: "Pasta inválida." };

  const nome = nomeDePasta(formData.get("nome"));
  if (!nome) return { ok: false, mensagem: `Dê um nome de 1 a ${LIMITE_NOME} caracteres.` };

  const meta = metaDoFormulario(formData);
  if (meta === "invalida") return { ok: false, mensagem: "Meta inválida: informe o valor e a unidade." };

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Faça login." };

  const { error } = await supabase
    .from("pasta")
    .update({ nome, meta_valor: meta.valor, meta_unidade: meta.unidade })
    .eq("id", id);

  if (error?.code === "23505") return { ok: false, mensagem: `Você já tem uma pasta "${nome}".` };
  if (error) return { ok: false, mensagem: error.message };

  revalidatePath("/hunts");
  return { ok: true, mensagem: "Pasta atualizada." };
}

/**
 * Apaga a pasta. As hunts dentro dela NÃO vão junto.
 *
 * Quem garante é o `on delete set null` de `sessao.pasta_id` (migration 0003):
 * as sessões caem no balde "Sem pasta" e continuam em "Todas as hunts".
 * Apagar pasta é organizar, não destruir.
 */
export async function apagarPasta(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id)) return;

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return;

  await supabase.from("pasta").delete().eq("id", id);
  revalidatePath("/hunts");
}

/** Ninguém tem dezenas de pastas; uma reordenação maior que isto é abuso. */
const MAX_PASTAS = 200;

/** `pasta.ordem` é `smallint`. */
const MAX_ORDEM = 32_767;

/** Reordena as pastas. `ordens` é `[id, ordem]` na sequência final. */
export async function reordenarPastas(ordens: [number, number][]): Promise<void> {
  // Server action é endpoint: `ordens` chega do cliente e pode ser qualquer
  // coisa, o tipo do TypeScript não existe em tempo de execução. Sem esta
  // conferência, um array de 100 mil pares virava 100 mil `update` em paralelo
  // contra o Supabase, disparados por uma requisição só.
  if (!Array.isArray(ordens) || ordens.length > MAX_PASTAS) return;
  const pares = ordens.every(
    (par) =>
      Array.isArray(par) &&
      par.length === 2 &&
      Number.isInteger(par[0]) &&
      Number.isInteger(par[1]) &&
      par[1] >= 0 &&
      par[1] <= MAX_ORDEM,
  );
  if (!pares) return;

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return;

  // Um `update` por pasta. São dezenas de linhas no pior caso, e um `upsert`
  // em lote exigiria mandar TODAS as colunas — inclusive `nome` e a meta, que
  // não estão em jogo aqui e seriam sobrescritas com o que o cliente mandasse.
  await Promise.all(
    ordens.map(([id, ordem]) => supabase.from("pasta").update({ ordem }).eq("id", id)),
  );
  revalidatePath("/hunts");
}

/** Move uma sessão para uma pasta, ou para fora de todas (`pasta_id` nulo). */
export async function moverSessao(formData: FormData): Promise<void> {
  const sessaoId = Number(formData.get("sessao_id"));
  const cru = String(formData.get("pasta_id") ?? "");
  if (!Number.isInteger(sessaoId)) return;

  const pastaId = cru === "" ? null : Number(cru);
  if (pastaId !== null && !Number.isInteger(pastaId)) return;

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return;

  if (pastaId !== null && !(await pastaEhMinha(supabase, pastaId))) return;

  await supabase.from("sessao").update({ pasta_id: pastaId }).eq("id", sessaoId);
  revalidatePath("/hunts");
}

/** Igual ao `check` de `config_mundo.mundo` (0005). Nome de mundo do Tibia tem menos de 15. */
const LIMITE_MUNDO = 40;

/** `integer` no banco. */
const MAX_INTEIRO = 2_147_483_647;

/** Preço da Tibia Coin, em gold, por mundo. */
export async function salvarPrecoTc(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const mundo = String(formData.get("mundo") ?? "").trim();
  const preco = Number(String(formData.get("preco_tc") ?? "").replace(/[^\d]/g, ""));

  if (!mundo || mundo.length > LIMITE_MUNDO) return { ok: false, mensagem: "Mundo inválido." };
  if (!Number.isFinite(preco) || preco <= 0) return { ok: false, mensagem: "Informe o preço em gold." };
  if (preco > MAX_INTEIRO) return { ok: false, mensagem: "Preço grande demais." };

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Faça login." };

  const { error } = await supabase
    .from("config_mundo")
    .upsert({ usuario_id: usuario.id, mundo, preco_tc: preco }, { onConflict: "usuario_id,mundo" });

  if (error) return { ok: false, mensagem: error.message };

  revalidatePath("/hunts");
  revalidatePath("/config");
  return { ok: true, mensagem: `Preço de ${mundo} salvo.` };
}

/** Nome de char no Tibia tem até 29 caracteres; 60 é o `check` de `personagem.nome` (0005). */
const LIMITE_NOME_PERSONAGEM = 60;

/**
 * Cadastra um personagem, buscando mundo/level/vocação na TibiaData.
 *
 * A chamada de rede acontece aqui, numa **ação de usuário**, e não durante a
 * renderização de página — por isso a diretriz 33 não se aplica: não há nada
 * para cachear, é uma vez por personagem.
 */
export async function cadastrarPersonagem(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const nome = String(formData.get("nome") ?? "").trim();
  if (!nome) return { ok: false, mensagem: "Digite o nome do personagem." };
  if (nome.length > LIMITE_NOME_PERSONAGEM) {
    return { ok: false, mensagem: "Nome grande demais para um personagem do Tibia." };
  }

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return { ok: false, mensagem: "Faça login." };

  let achado;
  try {
    achado = await buscarPersonagem(nome);
  } catch (e) {
    // Erro da API é diferente de "não existe": um pede para tentar de novo, o
    // outro pede para conferir o nome.
    return {
      ok: false,
      mensagem: e instanceof ErroDaTibiaData ? e.message : "Não deu para consultar a TibiaData.",
    };
  }
  if (!achado) return { ok: false, mensagem: `Não existe personagem "${nome}" no Tibia.` };

  // O NOME é vocabulário compartilhado — nome de char é único no jogo inteiro
  // — e entra só por insert: desde o 0005 um gatilho impede renomear, e o 0006
  // tira a política de update. `idsPorNome` lê antes de inserir, para não
  // queimar id da sequência (diretriz 56).
  let personagemId: number | undefined;
  try {
    personagemId = (await idsPorNome(supabase, "personagem", [achado.nome])).get(achado.nome);
  } catch (e) {
    return { ok: false, mensagem: (e as Error).message };
  }
  if (personagemId === undefined) return { ok: false, mensagem: "Não deu para gravar o personagem." };

  // O que a TibiaData respondeu vai na SUA linha de vínculo, não na
  // compartilhada. Até o 0005, mundo e level moravam em `personagem`, que
  // qualquer conta podia alterar — e o mundo decide o preço da TC na tela do
  // dono do char. Vazio vira `null`: "não sei" não é um mundo chamado "".
  const { error: erroVinculo } = await supabase.from("usuario_personagem").upsert(
    {
      usuario_id: usuario.id,
      personagem_id: personagemId,
      mundo: achado.mundo || null,
      vocacao: achado.vocacao || null,
      nivel: achado.nivel > 0 ? achado.nivel : null,
      visto_em: new Date().toISOString(),
    },
    { onConflict: "usuario_id,personagem_id" },
  );
  if (erroVinculo) return { ok: false, mensagem: erroVinculo.message };

  revalidatePath("/hunts");
  revalidatePath("/config");
  // A previsão de level usa este mesmo cadastro para atualizar o level.
  revalidatePath("/ferramentas/level");
  return {
    ok: true,
    mensagem: `${achado.nome} — ${achado.vocacao} level ${achado.nivel}, em ${achado.mundo}.`,
  };
}

/** Desvincula o personagem da conta. Não apaga a linha compartilhada nem as hunts. */
export async function removerPersonagem(formData: FormData): Promise<void> {
  const id = Number(formData.get("personagem_id"));
  if (!Number.isInteger(id)) return;

  const { supabase, usuario } = await usuarioAtual();
  if (!usuario) return;

  await supabase.from("usuario_personagem").delete().eq("personagem_id", id);
  revalidatePath("/config");
}
