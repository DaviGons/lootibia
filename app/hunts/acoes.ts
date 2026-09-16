"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lerSessaoHunt, ErroDeParse, type ContagemNomeada } from "@/lib/huntSession";

export interface ResultadoImportacao {
  ok: boolean;
  mensagem: string;
}

/**
 * Resolve nomes para ids numa tabela de lookup, criando o que faltar.
 *
 * Duas idas ao banco por tabela, não uma por nome: uma sessão traz ~13 nomes e
 * o Supabase cobra latência por chamada. O `upsert` com `ignoreDuplicates`
 * cobre a corrida de dois usuários importando o mesmo monstro ao mesmo tempo.
 */
async function idsPorNome(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: "monstro" | "item" | "spot",
  nomes: string[],
): Promise<Map<string, number>> {
  if (nomes.length === 0) return new Map();
  const unicos = [...new Set(nomes)];

  const { error: erroUpsert } = await supabase
    .from(tabela)
    .upsert(
      unicos.map((nome) => ({ nome })),
      { onConflict: "nome", ignoreDuplicates: true },
    );
  if (erroUpsert) throw new Error(`Falha ao gravar ${tabela}: ${erroUpsert.message}`);

  const { data, error } = await supabase.from(tabela).select("id, nome").in("nome", unicos);
  if (error) throw new Error(`Falha ao ler ${tabela}: ${error.message}`);

  const mapa = new Map<string, number>();
  for (const linha of data ?? []) mapa.set(linha.nome as string, linha.id as number);
  const faltando = unicos.filter((n) => !mapa.has(n));
  if (faltando.length > 0) throw new Error(`Sem id para: ${faltando.join(", ")}`);
  return mapa;
}

/** Converte um relógio local ('2026-09-15T19:34:12') num instante UTC real. */
function instanteDoRelogioLocal(relogio: string, fuso: string): Date {
  const base = Date.parse(`${relogio}Z`);
  if (Number.isNaN(base)) throw new ErroDeParse(`Data/hora ilegível: ${relogio}`);
  // Mede o deslocamento do fuso NAQUELE instante e corrige. Duas passadas
  // cobrem o caso de a primeira estimativa cair do outro lado de uma virada
  // de horário de verão.
  let ts = base;
  for (let i = 0; i < 2; i++) {
    const partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: fuso,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ts));
    const p: Record<string, string> = {};
    for (const x of partes) if (x.type !== "literal") p[x.type] = x.value;
    const comoSeFosseUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    ts = base - (comoSeFosseUtc - ts);
  }
  return new Date(ts);
}

export async function importarSessao(
  _anterior: ResultadoImportacao | null,
  formData: FormData,
): Promise<ResultadoImportacao> {
  const texto = String(formData.get("texto") ?? "");
  const rotulo = String(formData.get("rotulo") ?? "").trim();
  const fuso = String(formData.get("fuso") ?? "UTC");

  if (!texto.trim()) return { ok: false, mensagem: "Cole o texto do Hunt Analyser." };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { ok: false, mensagem: "Faça login para importar." };

  try {
    const sessao = lerSessaoHunt(texto);
    const inicio = instanteDoRelogioLocal(sessao.inicio, fuso);

    let spotId: number | null = null;
    if (rotulo) {
      const mapa = await idsPorNome(supabase, "spot", [rotulo]);
      spotId = mapa.get(rotulo) ?? null;
    }

    const { data: inserida, error: erroSessao } = await supabase
      .from("sessao")
      .insert({
        usuario_id: auth.user.id,
        inicio: inicio.toISOString(),
        duracao_s: sessao.duracaoSegundos,
        raw_xp: sessao.rawXpGain,
        xp: sessao.xpGain,
        loot: sessao.loot,
        supplies: sessao.supplies,
        damage: sessao.damage,
        healing: sessao.healing,
        spot_id: spotId,
      })
      .select("id")
      .single();

    if (erroSessao) {
      // 23505 = unique_violation, ou seja, a sessão já tinha sido importada.
      if (erroSessao.code === "23505") {
        return { ok: false, mensagem: "Esta sessão já foi importada." };
      }
      return { ok: false, mensagem: `Erro ao gravar a sessão: ${erroSessao.message}` };
    }

    const sessaoId = inserida.id as number;

    const gravarDetalhe = async (
      tabela: "sessao_monstro" | "sessao_item",
      lookup: "monstro" | "item",
      coluna: "monstro_id" | "item_id",
      contagens: ContagemNomeada[],
    ) => {
      if (contagens.length === 0) return;
      const ids = await idsPorNome(supabase, lookup, contagens.map((c) => c.nome));
      const linhas = contagens.map((c) => ({
        sessao_id: sessaoId,
        [coluna]: ids.get(c.nome)!,
        quantidade: c.quantidade,
      }));
      const { error } = await supabase.from(tabela).insert(linhas);
      if (error) throw new Error(`Falha ao gravar ${tabela}: ${error.message}`);
    };

    await gravarDetalhe("sessao_monstro", "monstro", "monstro_id", sessao.monstrosMortos);
    await gravarDetalhe("sessao_item", "item", "item_id", sessao.itensLootados);

    revalidatePath("/hunts");
    return {
      ok: true,
      mensagem: `Sessão de ${(sessao.duracaoSegundos / 3600).toFixed(2)} h importada: ${sessao.monstrosMortos.length} monstros e ${sessao.itensLootados.length} itens.`,
    };
  } catch (e) {
    const msg = e instanceof ErroDeParse ? `Texto inválido: ${e.message}` : (e as Error).message;
    return { ok: false, mensagem: msg };
  }
}

export async function apagarSessao(formData: FormData): Promise<void> {
  const id = Number(formData.get("id"));
  const supabase = await createClient();
  await supabase.from("sessao").delete().eq("id", id);
  revalidatePath("/hunts");
}
