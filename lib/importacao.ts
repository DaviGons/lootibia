/**
 * Ver docs/hunt-analyser.md e docs/bot-discord.md.
 *
 * Importação de uma sessão do Hunt Analyser para o banco.
 *
 * Nasceu dentro de `app/hunts/acoes.ts` e saiu de lá quando o bot do Discord
 * apareceu: são duas cascas (server action e slash command) sobre exatamente o
 * mesmo trabalho. Duplicar isto significaria duas conversões de fuso e dois
 * tratamentos de duplicata que divergem no primeiro ajuste.
 *
 * Nenhuma linha de Next aqui. A dependência do Supabase é só o TIPO do cliente —
 * quem monta o cliente é o chamador, e é essa costura que deixa a RLS valer nos
 * dois caminhos: no site o cliente carrega o cookie do usuário; no bot, o JWT
 * que `lib/supabase/bot.ts` assina.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSessaoHunt, ErroDeParse, type ContagemNomeada } from "./huntSession.ts";

export interface PedidoDeImportacao {
  /** Texto cru copiado do Hunt Analyser. */
  texto: string;
  /** Rótulo do spot ('Asura Palace'). O jogo não informa — é do usuário. */
  spot?: string | null;
  /** Nome do personagem. Também não vem do jogo. */
  personagem?: string | null;
  /** Fuso IANA de quem jogou. Ver `instanteDoRelogioLocal`. */
  fuso: string;
  /** Dono da sessão. Tem de bater com o `auth.uid()` do cliente, ou a RLS recusa. */
  usuarioId: string;
}

export type ResultadoDaImportacao =
  | {
      ok: true;
      sessaoId: number;
      duracaoSegundos: number;
      monstros: number;
      itens: number;
      loot: number;
      supplies: number;
      profit: number;
    }
  | { ok: false; motivo: "duplicata" | "parse" | "banco"; mensagem: string };

/**
 * Converte um relógio local ('2026-09-15T19:34:12') no instante UTC real.
 *
 * O Hunt Analyser não escreve fuso nenhum: os horários são o relógio de parede
 * de quem jogou. Sem o IANA do usuário não dá para dizer a que dia de Tibia a
 * sessão pertence, porque o dia do jogo vira às 10:00 de Berlim — 19:34 em São
 * Paulo já é 00:34 em Berlim, ou seja, ainda o dia anterior (docs/periodos.md).
 *
 * Duas passadas porque a primeira estimativa pode cair do outro lado de uma
 * virada de horário de verão local: mede-se o deslocamento NAQUELE instante e
 * corrige, e a segunda passada confirma. Offset fixo erraria metade do ano, em
 * silêncio.
 */
export function instanteDoRelogioLocal(relogio: string, fuso: string): Date {
  const base = Date.parse(`${relogio}Z`);
  if (Number.isNaN(base)) throw new ErroDeParse(`Data/hora ilegível: ${relogio}`);

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

/** Fuso IANA que o runtime reconhece? Entrada do bot não é confiável. */
export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve nomes para ids numa tabela de lookup, criando o que faltar.
 *
 * Duas idas ao banco por tabela, não uma por nome: uma sessão traz ~13 nomes e o
 * Supabase cobra latência por chamada — num slash command essa latência sai do
 * orçamento de 15 min do follow-up, mas no site sai da cara do usuário. O
 * `upsert` com `ignoreDuplicates` cobre a corrida de dois usuários importando o
 * mesmo monstro ao mesmo tempo.
 */
export async function idsPorNome(
  supabase: SupabaseClient,
  tabela: "monstro" | "item" | "spot" | "personagem",
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

/**
 * Parseia, resolve os lookups e grava a sessão com as linhas de detalhe.
 *
 * Devolve resultado tipado em vez de lançar nos casos esperados: duplicata e
 * texto inválido são o dia a dia, não excepcionais, e cada casca quer
 * apresentá-los do seu jeito (parágrafo de erro no site, embed no Discord).
 */
export async function importarSessao(
  supabase: SupabaseClient,
  pedido: PedidoDeImportacao,
): Promise<ResultadoDaImportacao> {
  let sessao;
  try {
    sessao = lerSessaoHunt(pedido.texto);
  } catch (e) {
    const msg = e instanceof ErroDeParse ? e.message : (e as Error).message;
    return { ok: false, motivo: "parse", mensagem: msg };
  }

  try {
    const fuso = fusoValido(pedido.fuso) ? pedido.fuso : "UTC";
    const inicio = instanteDoRelogioLocal(sessao.inicio, fuso);

    const rotulo = pedido.spot?.trim() || null;
    const personagem = pedido.personagem?.trim() || null;

    const spotId = rotulo
      ? ((await idsPorNome(supabase, "spot", [rotulo])).get(rotulo) ?? null)
      : null;
    const personagemId = personagem
      ? ((await idsPorNome(supabase, "personagem", [personagem])).get(personagem) ?? null)
      : null;

    const { data: inserida, error: erroSessao } = await supabase
      .from("sessao")
      .insert({
        usuario_id: pedido.usuarioId,
        inicio: inicio.toISOString(),
        duracao_s: sessao.duracaoSegundos,
        raw_xp: sessao.rawXpGain,
        xp: sessao.xpGain,
        loot: sessao.loot,
        supplies: sessao.supplies,
        damage: sessao.damage,
        healing: sessao.healing,
        spot_id: spotId,
        personagem_id: personagemId,
      })
      .select("id")
      .single();

    if (erroSessao) {
      // 23505 = unique_violation em (usuario_id, inicio): já foi importada.
      if (erroSessao.code === "23505") {
        return { ok: false, motivo: "duplicata", mensagem: "Esta sessão já foi importada." };
      }
      return {
        ok: false,
        motivo: "banco",
        mensagem: `Erro ao gravar a sessão: ${erroSessao.message}`,
      };
    }

    const sessaoId = inserida.id as number;

    const gravarDetalhe = async (
      tabela: "sessao_monstro" | "sessao_item",
      lookup: "monstro" | "item",
      coluna: "monstro_id" | "item_id",
      contagens: ContagemNomeada[],
    ) => {
      if (contagens.length === 0) return;
      const ids = await idsPorNome(
        supabase,
        lookup,
        contagens.map((c) => c.nome),
      );
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

    return {
      ok: true,
      sessaoId,
      duracaoSegundos: sessao.duracaoSegundos,
      monstros: sessao.monstrosMortos.length,
      itens: sessao.itensLootados.length,
      loot: sessao.loot,
      supplies: sessao.supplies,
      // `balance` é derivado: conferido no parse, nunca persistido (diretriz 6).
      profit: sessao.balance,
    };
  } catch (e) {
    return { ok: false, motivo: "banco", mensagem: (e as Error).message };
  }
}
