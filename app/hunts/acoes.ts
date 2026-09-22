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
 * A separação nasceu quando houve duas cascas sobre o mesmo trabalho. Restou
 * uma, e a separação fica: é ela que mantém a conversão de fuso e o tratamento
 * de duplicata fora de um arquivo de UI.
 */
export async function importarSessao(
  _anterior: ResultadoImportacao | null,
  formData: FormData,
): Promise<ResultadoImportacao> {
  const texto = String(formData.get("texto") ?? "");
  const spot = String(formData.get("rotulo") ?? "").trim();
  const personagemId = Number(formData.get("personagem_id")) || null;
  const fuso = String(formData.get("fuso") ?? "UTC");

  if (!texto.trim()) return { ok: false, mensagem: "Cole o texto do Hunt Analyser." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, mensagem: "Faça login para importar." };

  // O fuso do navegador é a única fonte que temos — o Hunt Analyser não escreve
  // fuso nenhum. Guardar no perfil a cada importação mantém o valor atualizado
  // para quem viaja ou muda de máquina.
  await guardarFuso(supabase, auth.user.id, fuso);

  // O seletor só mostra char do usuário, mas o `select` chega por `FormData` e
  // isso é o cliente falando. A RLS de `personagem` é `using (true)` — vocabulário
  // compartilhado, todo autenticado lê —, então ela NÃO recusaria o id de um char
  // alheio. Quem recusa é esta consulta, que passa por `usuario_personagem`.
  if (personagemId !== null) {
    const { data: meu } = await supabase
      .from("usuario_personagem")
      .select("personagem_id")
      .eq("personagem_id", personagemId)
      .maybeSingle();
    if (!meu) return { ok: false, mensagem: "Esse personagem não é seu." };
  }

  const r = await gravarSessao(supabase, {
    texto,
    spot,
    personagemId,
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
 * A tabela `perfil` existe por causa desta coluna: é o `fuso` que diz a que
 * dia de Tibia uma sessão pertence, e o relógio do Hunt Analyser não traz fuso
 * nenhum no texto que o jogador cola (docs/periodos.md).
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
