"use server";

import { revalidatePath } from "next/cache";
import { randomInt } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { importarSessao as gravarSessao, fusoValido } from "@/lib/importacao";

export interface ResultadoImportacao {
  ok: boolean;
  mensagem: string;
}

/**
 * Importa a sessão colada no formulário.
 *
 * O trabalho de verdade mora em `lib/importacao.ts`, compartilhado com o bot do
 * Discord — aqui fica só o que é da casca web: ler o `FormData`, conferir o
 * login e revalidar a rota. Ver docs/bot-discord.md.
 */
export async function importarSessao(
  _anterior: ResultadoImportacao | null,
  formData: FormData,
): Promise<ResultadoImportacao> {
  const texto = String(formData.get("texto") ?? "");
  const spot = String(formData.get("rotulo") ?? "").trim();
  const personagem = String(formData.get("personagem") ?? "").trim();
  const fuso = String(formData.get("fuso") ?? "UTC");

  if (!texto.trim()) return { ok: false, mensagem: "Cole o texto do Hunt Analyser." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, mensagem: "Faça login para importar." };

  // O fuso do navegador é a única fonte que temos, e o bot do Discord não tem
  // navegador: ele herda daqui. Guardar no perfil a cada importação mantém o
  // valor atualizado para quem viaja ou muda de máquina.
  await guardarFuso(supabase, auth.user.id, fuso);

  const r = await gravarSessao(supabase, {
    texto,
    spot,
    personagem,
    fuso,
    usuarioId: auth.user.id,
  });

  if (!r.ok) {
    const prefixo = r.motivo === "parse" ? "Texto inválido: " : "";
    return { ok: false, mensagem: `${prefixo}${r.mensagem}` };
  }

  revalidatePath("/hunts");
  return {
    ok: true,
    mensagem: `Sessão de ${(r.duracaoSegundos / 3600).toFixed(2)} h importada: ${r.monstros} monstros e ${r.itens} itens.`,
  };
}

export async function apagarSessao(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("sessao").delete().eq("id", id);
  revalidatePath("/hunts");
}

// ---------------------------------------------------------------------------
// Vínculo com o Discord
// ---------------------------------------------------------------------------

type ClienteServidor = Awaited<ReturnType<typeof createClient>>;

/** Grava o fuso IANA no perfil. Falha aqui não pode derrubar a importação. */
async function guardarFuso(
  supabase: ClienteServidor,
  usuarioId: string,
  fuso: string,
): Promise<void> {
  if (!fusoValido(fuso)) return;
  const { error } = await supabase
    .from("perfil")
    .upsert({ usuario_id: usuarioId, fuso }, { onConflict: "usuario_id" });
  if (error) console.error("[perfil] não consegui guardar o fuso:", error.message);
}

/**
 * Alfabeto do código de vínculo.
 *
 * Sem `I`, `O`, `0` e `1`: o código é lido da tela e digitado no Discord, e esses
 * quatro são exatamente os que as pessoas trocam entre si. 32 símbolos em 8
 * posições dão 2^40 combinações, o que com 10 minutos de vida e um código por
 * usuário torna adivinhação irrelevante.
 */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TAMANHO_CODIGO = 8;
const VIDA_DO_CODIGO_MIN = 10;

export interface ResultadoVinculo {
  ok: boolean;
  /** Código formatado para leitura ('ABCD-2345'). */
  codigo?: string;
  mensagem: string;
}

/**
 * Gera o código que o `/cadastro` do bot consome.
 *
 * `randomInt` do `node:crypto`, não `Math.random()`: é um segredo de curta
 * duração, e o gerador padrão é previsível.
 *
 * O índice único parcial `codigo_vinculo_um_pendente_idx` garante um código
 * pendente por usuário — por isso os anteriores são apagados antes, em vez de
 * acumular vários válidos soltos por aí.
 */
export async function gerarCodigoDeVinculo(): Promise<ResultadoVinculo> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, mensagem: "Faça login para vincular o Discord." };

  let codigo = "";
  for (let i = 0; i < TAMANHO_CODIGO; i++) codigo += ALFABETO[randomInt(ALFABETO.length)];

  // Apaga TODOS os códigos do usuário, não só o pendente: usado e expirado são
  // lixo, e é aqui que a retenção da diretriz 12 acontece de verdade. Amarrá-la
  // a um cron seria política no papel — não existe cron neste projeto ainda, e
  // `limpar_codigos_expirados()` no migration é o expurgo em massa para quando
  // existir.
  //
  // Quem garante que só os códigos deste usuário somem é a RLS, não o `eq` —
  // ele está aqui porque o PostgREST recusa `delete` sem filtro nenhum.
  await supabase.from("codigo_vinculo").delete().eq("usuario_id", auth.user.id);

  const expira = new Date(Date.now() + VIDA_DO_CODIGO_MIN * 60_000);
  const { error } = await supabase.from("codigo_vinculo").insert({
    codigo,
    usuario_id: auth.user.id,
    expira_em: expira.toISOString(),
  });

  if (error) {
    return { ok: false, mensagem: `Não consegui gerar o código: ${error.message}` };
  }

  return {
    ok: true,
    codigo: `${codigo.slice(0, 4)}-${codigo.slice(4)}`,
    mensagem: `Vale ${VIDA_DO_CODIGO_MIN} minutos. Rode /cadastro no Discord e cole aí.`,
  };
}
