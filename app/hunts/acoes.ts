"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { importarSessao as gravarSessao, fusoValido } from "@/lib/importacao";

export interface ResultadoImportacao {
  ok: boolean;
  mensagem: string;
}

/**
 * Importa a sessão colada no formulário.
 *
 * O trabalho de verdade mora em `lib/importacao.ts`; aqui fica só o que é da
 * casca web: ler o `FormData`, conferir o login e revalidar a rota.
 *
 * A separação nasceu porque havia duas cascas — esta e o slash command do bot.
 * O bot se foi, a separação fica: ela é o que mantém a conversão de fuso e o
 * tratamento de duplicata fora de um arquivo de UI.
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

  // O fuso do navegador é a única fonte que temos — o Hunt Analyser não escreve
  // fuso nenhum. Guardar no perfil a cada importação mantém o valor atualizado
  // para quem viaja ou muda de máquina.
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
// Perfil
// ---------------------------------------------------------------------------

type ClienteServidor = Awaited<ReturnType<typeof createClient>>;

/**
 * Grava o fuso IANA no perfil. Falha aqui não pode derrubar a importação.
 *
 * A tabela `perfil` nasceu em 2026-09-17 para o bot do Discord, que precisava
 * herdar o fuso de alguém — ele não tem navegador de onde tirá-lo. O bot foi
 * aposentado, a coluna `discord_id` foi embora com ele, mas o `fuso` **fica**:
 * é ele que diz a que dia de Tibia uma sessão pertence quando o relógio do
 * Hunt Analyser não traz fuso nenhum (docs/periodos.md).
 */
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
