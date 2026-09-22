"use server";

import { createClient } from "@/lib/supabase/server";

/**
 * O analyzer de UMA sessão: os números dela mais as listas de detalhe.
 *
 * ## Por que é ação sob demanda, e não parte da consulta da página
 *
 * A sessão medida em 22/09 tinha 4 monstros e **38 itens**. A tela carrega até
 * 500 sessões; trazer o detalhe de todas seriam ~20 mil linhas em toda visita,
 * para mostrar as de uma só quando alguém clica. O detalhe vem quando é pedido.
 *
 * ## Isolamento
 *
 * Nenhum `.eq('usuario_id', …)` aqui, pelo mesmo motivo de `pastas.ts`: quem
 * isola é a RLS. `sessao_monstro` e `sessao_item` têm política de `select` que
 * atravessa a `sessao` dona (migration 0001), então o detalhe de sessão alheia
 * volta **vazio** — verificado contra o banco, com JWT de outro usuário.
 *
 * Isso tem uma consequência que o tipo não conta: sessão inexistente e sessão
 * de outra pessoa são o MESMO caso aqui, e os dois devolvem `null`. É de
 * propósito — distinguir contaria a quem perguntou que o id existe.
 */

export interface ContagemDoDetalhe {
  nome: string;
  quantidade: number;
}

export interface DetalheDaSessao {
  inicio: string;
  duracaoSegundos: number;
  rawXp: number;
  xp: number;
  loot: number;
  supplies: number;
  damage: number;
  healing: number;
  spot: string | null;
  personagem: string | null;
  monstros: ContagemDoDetalhe[];
  itens: ContagemDoDetalhe[];
}

/** Linha de detalhe como o PostgREST devolve o join. */
interface LinhaLigada {
  quantidade: number;
  // O embed de um-para-um chega como objeto; o tipo gerado do supabase-js não
  // sabe disso sozinho quando a FK não é única.
  [chave: string]: unknown;
}

function contagens(linhas: LinhaLigada[] | null, chave: "monstro" | "item"): ContagemDoDetalhe[] {
  return (linhas ?? [])
    .map((l) => {
      const ligado = l[chave] as { nome?: unknown } | null;
      return {
        nome: typeof ligado?.nome === "string" ? ligado.nome : "",
        quantidade: l.quantidade,
      };
    })
    .filter((c) => c.nome !== "")
    .sort((a, b) => b.quantidade - a.quantidade);
}

export async function detalheDaSessao(sessaoId: number): Promise<DetalheDaSessao | null> {
  if (!Number.isInteger(sessaoId) || sessaoId <= 0) return null;

  const supabase = await createClient();

  // Três consultas em paralelo: nenhuma depende do resultado da outra, e
  // sequenciais seriam três idas ao banco somadas na cara de quem clicou.
  const [{ data: sessao }, { data: monstros }, { data: itens }] = await Promise.all([
    supabase
      .from("sessao")
      .select(
        "inicio, duracao_s, raw_xp, xp, loot, supplies, damage, healing, spot(nome), personagem(nome)",
      )
      .eq("id", sessaoId)
      .maybeSingle(),
    supabase.from("sessao_monstro").select("quantidade, monstro(nome)").eq("sessao_id", sessaoId),
    supabase.from("sessao_item").select("quantidade, item(nome)").eq("sessao_id", sessaoId),
  ]);

  if (!sessao) return null;

  const s = sessao as unknown as {
    inicio: string;
    duracao_s: number;
    raw_xp: number;
    xp: number;
    loot: number;
    supplies: number;
    damage: number;
    healing: number;
    spot: { nome: string } | null;
    personagem: { nome: string } | null;
  };

  return {
    inicio: s.inicio,
    duracaoSegundos: s.duracao_s,
    rawXp: s.raw_xp,
    xp: s.xp,
    loot: s.loot,
    supplies: s.supplies,
    damage: s.damage,
    healing: s.healing,
    spot: s.spot?.nome ?? null,
    personagem: s.personagem?.nome ?? null,
    monstros: contagens(monstros as LinhaLigada[] | null, "monstro"),
    itens: contagens(itens as LinhaLigada[] | null, "item"),
  };
}
