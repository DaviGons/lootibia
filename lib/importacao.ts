/**
 * Ver docs/hunt-analyser.md.
 *
 * Importação de uma sessão do Hunt Analyser para o banco.
 *
 * Nasceu dentro de `app/(app)/hunts/acoes.ts` e saiu de lá quando houve duas cascas
 * sobre exatamente o mesmo trabalho. Restou uma, e a separação continua boa:
 * junta aqui a conversão de fuso e o tratamento de duplicata, que dentro de um
 * arquivo de UI ficariam misturados com leitura de formulário.
 *
 * Nenhuma linha de Next aqui. A dependência do Supabase é só o TIPO do cliente —
 * quem monta o cliente é o chamador, e é essa costura que deixa a RLS valer:
 * o cliente que chega carrega o cookie do usuário, e as políticas valem por
 * ele, não por este arquivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lerSessaoHunt, ErroDeParse } from "./huntSession.ts";

export interface PedidoDeImportacao {
  /** Texto cru copiado do Hunt Analyser. */
  texto: string;
  /** Rótulo do spot ('Asura Palace'). O jogo não informa — é do usuário. */
  spot?: string | null;
  /**
   * Id do personagem, dos que o usuário cadastrou. Também não vem do jogo.
   *
   * Id e não nome: nome livre passava por `idsPorNome`, que faz `upsert` — cada
   * erro de digitação virava uma linha nova numa tabela de lookup que todo
   * autenticado enxerga. Quem cria personagem agora é só a tela de `/config`,
   * que confere o nome contra a TibiaData antes.
   */
  personagemId?: number | null;
  /**
   * Pasta onde arquivar. Nulo cai em "Sem pasta", que e o padrao.
   *
   * Id, nao nome: a pasta ja existe (o usuario criou no site ou escolheu no
   * seletor do modal). Criar pasta por nome aqui seria o oposto do que a tela
   * faz — e um erro de digitacao viraria pasta nova em silencio.
   */
  pastaId?: number | null;
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
      pastaId: number | null;
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

/** Fuso IANA que o runtime reconhece? Entrada de fora não é confiável. */
export function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** As tabelas de lookup: vocabulário compartilhado, um nome por linha (diretriz 10). */
export type TabelaDeNomes = "monstro" | "item" | "spot" | "personagem";

/** Teto do nome do spot, igual ao `check` de `spot.nome` (migration 0005). */
export const LIMITE_SPOT = 60;

/**
 * Resolve nomes para ids numa tabela de lookup, criando o que faltar.
 *
 * ## Lê ANTES de inserir, e isso é conserto, não estilo
 *
 * A versão anterior mandava todos os nomes num `upsert` com `ignoreDuplicates`
 * e depois lia. Parecia inofensivo — nome repetido não vira linha —, mas o
 * Postgres calcula o `default` da coluna, o `nextval` da identity, ANTES de
 * descobrir o conflito, e valor de sequência não volta. Cada importação
 * queimava um id por item da sessão, existisse o item ou não. Medido em
 * 2026-09-27: `item_id_seq` em 1.179 com 156 itens gravados, ~30 ids por
 * importação, contra um teto de 32.767 enquanto o id era `smallint`
 * (diretriz 56).
 *
 * Agora só vai para o `insert` o que a leitura não achou — no dia a dia, nada.
 * O `ignoreDuplicates` fica para a corrida de dois usuários gravando o mesmo
 * nome novo ao mesmo tempo, e a segunda leitura resolve o id de quem perdeu.
 *
 * Uma ida ao banco quando todo nome já existe, três quando falta algum — por
 * tabela, não por nome: uma sessão traz ~13 nomes e o Supabase cobra latência
 * por chamada, que sai da cara do usuário.
 */
export async function idsPorNome(
  supabase: SupabaseClient,
  tabela: TabelaDeNomes,
  nomes: string[],
): Promise<Map<string, number>> {
  if (nomes.length === 0) return new Map();
  const unicos = [...new Set(nomes)];

  const mapa = await lerIds(supabase, tabela, unicos);
  const novos = unicos.filter((n) => !mapa.has(n));
  if (novos.length === 0) return mapa;

  const { error: erroInsert } = await supabase
    .from(tabela)
    .upsert(
      novos.map((nome) => ({ nome })),
      { onConflict: "nome", ignoreDuplicates: true },
    );
  if (erroInsert) throw new Error(`Falha ao gravar ${tabela}: ${erroInsert.message}`);

  for (const [nome, id] of await lerIds(supabase, tabela, novos)) mapa.set(nome, id);
  const faltando = unicos.filter((n) => !mapa.has(n));
  if (faltando.length > 0) throw new Error(`Sem id para: ${faltando.join(", ")}`);
  return mapa;
}

async function lerIds(
  supabase: SupabaseClient,
  tabela: TabelaDeNomes,
  nomes: string[],
): Promise<Map<string, number>> {
  const { data, error } = await supabase.from(tabela).select("id, nome").in("nome", nomes);
  if (error) throw new Error(`Falha ao ler ${tabela}: ${error.message}`);
  const mapa = new Map<string, number>();
  for (const linha of data ?? []) mapa.set(linha.nome as string, linha.id as number);
  return mapa;
}

/**
 * Parseia, resolve os lookups e grava a sessão com as linhas de detalhe.
 *
 * Devolve resultado tipado em vez de lançar nos casos esperados: duplicata e
 * texto inválido são o dia a dia, não excepcionais, e quem chama decide como
 * apresentá-los.
 *
 * ## Tudo ou nada, sem transação
 *
 * O PostgREST não abre transação entre chamadas, e a sessão e o detalhe são
 * três `insert` separados. Se o detalhe falhasse depois de a sessão gravada, ela
 * ficava sem monstros nem itens — e colar o texto de novo dava "já foi
 * importada", porque a sessão incompleta ocupava o `unique (usuario_id,
 * inicio)`. O único conserto era apagar e reimportar, sabendo que precisava.
 *
 * Duas medidas fecham isso:
 *
 * 1. **Todo lookup se resolve ANTES da sessão.** É o passo que mais vai ao
 *    banco; falhando ali, não há sessão gravada para desfazer. O que sobra no
 *    vocabulário é nome que a próxima tentativa gravaria de qualquer jeito.
 * 2. **Se o detalhe falhar, a sessão é apagada**, e o `on delete cascade` de
 *    `sessao_monstro` e `sessao_item` leva junto o que chegou a entrar. O texto
 *    pode ser colado de novo.
 *
 * O que isso não cobre: se a própria compensação falhar, a mensagem diz que a
 * sessão ficou incompleta e precisa ser apagada. Transação de verdade exigiria
 * uma função no banco — e não compensa enquanto o `delete` resolver.
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

  let sessaoId: number;
  let linhasMonstro: { sessao_id: number; monstro_id: number; quantidade: number }[];
  let linhasItem: { sessao_id: number; item_id: number; quantidade: number }[];

  try {
    const fuso = fusoValido(pedido.fuso) ? pedido.fuso : "UTC";
    const inicio = instanteDoRelogioLocal(sessao.inicio, fuso);

    const rotulo = pedido.spot?.trim() || null;
    if (rotulo && rotulo.length > LIMITE_SPOT) {
      return {
        ok: false,
        motivo: "parse",
        mensagem: `O nome do spot passa de ${LIMITE_SPOT} caracteres.`,
      };
    }

    // Os três lookups em paralelo, e antes da sessão — ver o comentário acima.
    const [idsSpot, idsMonstro, idsItem] = await Promise.all([
      idsPorNome(supabase, "spot", rotulo ? [rotulo] : []),
      idsPorNome(supabase, "monstro", sessao.monstrosMortos.map((c) => c.nome)),
      idsPorNome(supabase, "item", sessao.itensLootados.map((c) => c.nome)),
    ]);
    const spotId = rotulo ? (idsSpot.get(rotulo) ?? null) : null;

    // O personagem chega resolvido: quem escolhe é um seletor de chars já
    // cadastrados, então não há nome novo para criar aqui. O spot continua
    // passando por `idsPorNome` porque ele é digitado livre, de propósito —
    // nome de hunt é vocabulário que cresce com o uso.
    const personagemId = pedido.personagemId ?? null;

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
        pasta_id: pedido.pastaId ?? null,
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

    sessaoId = inserida.id as number;
    linhasMonstro = sessao.monstrosMortos.map((c) => ({
      sessao_id: sessaoId,
      monstro_id: idsMonstro.get(c.nome)!,
      quantidade: c.quantidade,
    }));
    linhasItem = sessao.itensLootados.map((c) => ({
      sessao_id: sessaoId,
      item_id: idsItem.get(c.nome)!,
      quantidade: c.quantidade,
    }));
  } catch (e) {
    // Nada gravado em `sessao` até aqui: não há o que desfazer.
    return { ok: false, motivo: "banco", mensagem: (e as Error).message };
  }

  try {
    if (linhasMonstro.length > 0) {
      const { error } = await supabase.from("sessao_monstro").insert(linhasMonstro);
      if (error) throw new Error(`Falha ao gravar sessao_monstro: ${error.message}`);
    }
    if (linhasItem.length > 0) {
      const { error } = await supabase.from("sessao_item").insert(linhasItem);
      if (error) throw new Error(`Falha ao gravar sessao_item: ${error.message}`);
    }
  } catch (e) {
    const motivo = (e as Error).message;
    const { error: erroDesfazer } = await supabase.from("sessao").delete().eq("id", sessaoId);
    return {
      ok: false,
      motivo: "banco",
      mensagem: erroDesfazer
        ? `${motivo}. A sessão ficou gravada sem o detalhe completo — apague-a antes de importar de novo.`
        : `${motivo}. Nada foi gravado; pode colar o texto de novo.`,
    };
  }

  return {
    ok: true,
    sessaoId,
    duracaoSegundos: sessao.duracaoSegundos,
    monstros: sessao.monstrosMortos.length,
    itens: sessao.itensLootados.length,
    pastaId: pedido.pastaId ?? null,
    loot: sessao.loot,
    supplies: sessao.supplies,
    // `balance` é derivado: conferido no parse, nunca persistido (diretriz 6).
    profit: sessao.balance,
  };
}
