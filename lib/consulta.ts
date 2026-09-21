/**
 * Ver docs/hunt-analyser.md e docs/bot-discord.md.
 *
 * Lê sessões de um intervalo e devolve o resumo agregado.
 *
 * Diferença deliberada para o que a tela faz hoje: aqui o recorte de período vai
 * **no banco** (`gte`/`lt` sobre `inicio`), não num `filter` depois de puxar 200
 * linhas. O índice `sessao_usuario_inicio_idx` existe exatamente para isso, e o
 * bot não tem como saber se o usuário tem 20 ou 20 mil sessões — "tudo" é um dos
 * filtros oferecidos.
 *
 * Como sempre: a agregação é `resumirHunts`, que garante `Σ total / Σ horas`.
 * Este arquivo só busca e adapta o formato das linhas.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resumirHunts, type ResumoDeHunts, type SessaoRotulada } from "./huntAgregado.ts";

/**
 * Teto de sessões lidas de uma vez.
 *
 * 5 hunts/dia é o cenário de uso pesado do dimensionamento (docs/hunt-analyser.md);
 * 2.000 cobre mais de um ano disso. Passar daí num `/viewstats tudo` significa
 * paginar, e o embed não comportaria o detalhe de qualquer forma — quando essa
 * hora chegar, o certo é agregar no Postgres, não puxar mais linhas.
 */
const TETO_DE_SESSOES = 2000;

interface LinhaSessao {
  id: number;
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
}

interface LinhaDetalhe {
  sessao_id: number;
  quantidade: number;
  monstro: { nome: string } | null;
}

export interface FiltroDeConsulta {
  /** Fronteira inferior, inclusiva. `null` em "tudo". */
  inicio: Date | null;
  /** Fronteira superior, EXCLUSIVA. `null` em "tudo". */
  fim: Date | null;
  /** Nome do personagem, se o comando filtrou por um. */
  personagem?: string | null;
  /** Id da pasta, se o comando filtrou por uma. Vai no banco, não em memória. */
  pastaId?: number | null;
}

/** Uma pasta como o bot precisa dela: para listar, filtrar e medir meta. */
export interface PastaDoUsuario {
  id: number;
  nome: string;
  metaValor: number | null;
  metaUnidade: "tc" | "gp" | null;
}

/**
 * As pastas do usuário, na ordem que ele arrastou.
 *
 * Usada em três lugares e com pressas diferentes: no seletor do `/addhunt`, que
 * corre contra a janela de 3 s do modal; no autocomplete de `/viewstats` e
 * `/meta`, que tem janela própria; e no `/meta`, que já está adiado e pode
 * respirar.
 *
 * O `limit` existe porque o String Select do Discord comporta 25 opções — pedir
 * mais seria tráfego que o modal descartaria de qualquer forma.
 */
export async function pastasDoUsuario(
  supabase: SupabaseClient,
  limite = 25,
): Promise<PastaDoUsuario[]> {
  const { data, error } = await supabase
    .from("pasta")
    .select("id, nome, meta_valor, meta_unidade")
    .order("ordem", { ascending: true })
    .order("id", { ascending: true })
    .limit(limite);

  if (error) throw new Error(`Falha ao ler as pastas: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id as number,
    nome: p.nome as string,
    metaValor: (p.meta_valor as number | null) ?? null,
    metaUnidade: (p.meta_unidade as "tc" | "gp" | null) ?? null,
  }));
}

/**
 * Preço da Tibia Coin que o usuário configurou, em gold.
 *
 * Por MUNDO no banco, mas o bot não sabe de qual mundo se trata — quem pergunta
 * é um comando do Discord, não uma tela com personagem selecionado. Sem mundo,
 * pega-se o menor preço configurado: erra para o lado conservador, mostrando a
 * meta em TC como mais perto do que está, e nunca inventa um preço que o
 * usuário não escreveu (diretriz 24).
 *
 * Sem nenhum preço configurado devolve `null`, e meta em TC fica sem alvo em
 * gold — o `/meta` diz isso em vez de chutar.
 */
export async function precoDaTc(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase.from("config_mundo").select("preco_tc");
  if (error) throw new Error(`Falha ao ler o preço da TC: ${error.message}`);
  const precos = (data ?? []).map((c) => c.preco_tc as number).filter((n) => n > 0);
  return precos.length > 0 ? Math.min(...precos) : null;
}

/**
 * Converte a linha do banco no formato que `resumirHunts` consome.
 *
 * `fim` recebe o mesmo valor de `inicio` porque a agregação não usa `fim` — ela
 * soma `duracaoSegundos`, que é o campo confiável. E `balance` é recalculado de
 * `loot - supplies` porque não existe coluna: é derivado, por decisão
 * (diretriz 6).
 */
function paraAgregado(l: LinhaSessao, detalhes: LinhaDetalhe[]): SessaoRotulada {
  return {
    inicio: l.inicio,
    fim: l.inicio,
    duracaoSegundos: l.duracao_s,
    duracaoExibidaSegundos: null,
    rawXpGain: l.raw_xp,
    xpGain: l.xp,
    loot: l.loot,
    supplies: l.supplies,
    balance: l.loot - l.supplies,
    damage: l.damage,
    healing: l.healing,
    monstrosMortos: detalhes
      .filter((d) => d.sessao_id === l.id && d.monstro)
      .map((d) => ({ nome: d.monstro!.nome, quantidade: d.quantidade })),
    // O embed não mostra itens: sem o de-para de plural com o wiki, a lista é
    // ruído ('great mana potions' não cruza com nada). Ver docs/hunt-analyser.md.
    itensLootados: [],
    taxasExibidas: {
      rawXpPorHora: null,
      xpPorHora: null,
      damagePorHora: null,
      healingPorHora: null,
    },
    camposIgnorados: {},
    rotulo: l.spot?.nome,
  };
}

export interface ResultadoDaConsulta {
  resumo: ResumoDeHunts;
  /** Bateu no teto? O chamador avisa que o número está incompleto. */
  truncado: boolean;
}

/**
 * Resumo das sessões do usuário no intervalo.
 *
 * O `usuario_id` NÃO entra como filtro: quem faz esse recorte é a RLS, a partir
 * do `auth.uid()` do token que o cliente carrega. Acrescentar um `.eq()` aqui
 * daria a impressão errada de que é o código que isola — e é justamente o que a
 * decisão 3 de docs/bot-discord.md evita.
 */
export async function resumoDoPeriodo(
  supabase: SupabaseClient,
  filtro: FiltroDeConsulta,
): Promise<ResultadoDaConsulta> {
  let q = supabase
    .from("sessao")
    .select(
      "id, inicio, duracao_s, raw_xp, xp, loot, supplies, damage, healing, spot(nome), personagem(nome)",
    )
    .order("inicio", { ascending: false })
    .limit(TETO_DE_SESSOES);

  if (filtro.inicio) q = q.gte("inicio", filtro.inicio.toISOString());
  if (filtro.fim) q = q.lt("inicio", filtro.fim.toISOString());
  // Pasta vai no banco, ao contrário de personagem: o índice parcial
  // `sessao_pasta_idx` existe para isto, e "tudo desta pasta" pode alcançar o
  // teto de linhas — filtrar depois de truncar daria número errado em silêncio.
  if (filtro.pastaId != null) q = q.eq("pasta_id", filtro.pastaId);

  const { data, error } = await q;
  if (error) throw new Error(`Falha ao ler as sessões: ${error.message}`);

  let linhas = (data ?? []) as unknown as LinhaSessao[];

  // Filtro de personagem em memória, e não no banco, porque o embed de uma
  // semana raramente passa de algumas dezenas de linhas e o `!inner` do
  // PostgREST mudaria a forma do retorno. Se virar gargalo, sobe para a consulta.
  const alvo = filtro.personagem?.trim().toLowerCase();
  if (alvo) {
    linhas = linhas.filter((l) => l.personagem?.nome.toLowerCase() === alvo);
  }

  const detalhes = await lerDetalhes(
    supabase,
    linhas.map((l) => l.id),
  );

  return {
    resumo: resumirHunts(linhas.map((l) => paraAgregado(l, detalhes))),
    truncado: (data ?? []).length === TETO_DE_SESSOES,
  };
}

export interface TotalDaPasta {
  pastaId: number;
  hunts: number;
  /** Σ (loot − supplies). `balance` é derivado, não coluna (diretriz 6). */
  profit: number;
  segundos: number;
}

/**
 * Profit e tempo acumulados por pasta.
 *
 * Agregação em memória, e não no Postgres, porque o PostgREST não expõe
 * `group by` — e porque as colunas envolvidas são quatro inteiros. Puxar
 * `pasta_id, loot, supplies, duracao_s` de alguns milhares de linhas custa
 * menos que manter uma view só para isto, que ainda precisaria de RLS própria.
 *
 * Se um dia o volume incomodar, o caminho é uma função `security definer` que
 * devolva o agregado pronto — não um índice a mais.
 */
export async function totaisPorPasta(
  supabase: SupabaseClient,
): Promise<Map<number, TotalDaPasta>> {
  const { data, error } = await supabase
    .from("sessao")
    .select("pasta_id, loot, supplies, duracao_s")
    .not("pasta_id", "is", null)
    .limit(TETO_DE_SESSOES);

  if (error) throw new Error(`Falha ao somar as pastas: ${error.message}`);

  const porPasta = new Map<number, TotalDaPasta>();
  for (const l of data ?? []) {
    const id = l.pasta_id as number;
    const atual = porPasta.get(id) ?? { pastaId: id, hunts: 0, profit: 0, segundos: 0 };
    atual.hunts++;
    atual.profit += (l.loot as number) - (l.supplies as number);
    atual.segundos += l.duracao_s as number;
    porPasta.set(id, atual);
  }
  return porPasta;
}

/**
 * Monstros mortos das sessões informadas.
 *
 * Lista vazia sai sem ida ao banco: `in('sessao_id', [])` é uma requisição que a
 * gente já sabe que volta vazia.
 */
async function lerDetalhes(
  supabase: SupabaseClient,
  ids: number[],
): Promise<LinhaDetalhe[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("sessao_monstro")
    .select("sessao_id, quantidade, monstro(nome)")
    .in("sessao_id", ids);
  if (error) throw new Error(`Falha ao ler os monstros: ${error.message}`);
  return (data ?? []) as unknown as LinhaDetalhe[];
}
