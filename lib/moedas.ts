/**
 * Separa o `Loot` entre o que já é dinheiro e o que ainda é mercadoria.
 *
 * ## A regra, que é do jogo e não nossa
 *
 * **Exatamente três itens caem direto no balance do personagem: gold coin,
 * platinum coin e crystal coin.** Nenhum outro item do Tibia inteiro faz isso.
 * Não é heurística nem "as moedas mais comuns": é um conjunto FECHADO, e por
 * isso não precisa de arquivo versionado, de de-para nem de manutenção quando o
 * jogo ganha item novo.
 *
 * `gold ingot` vale 10.000 e **não** entra: você vende a um NPC, não gasta
 * direto. Mesma coisa para qualquer outro valuable.
 *
 * ## Por que isto não viola a diretriz 24
 *
 * A diretriz 24 proíbe inventar preço: nenhuma API publica preço de Market, e
 * `npcvalue` é referência de NPC. Aqui não há preço nenhum — 1, 100 e 10.000
 * são **denominações**, definidas pelo jogo, tão estimativa quanto dizer que
 * uma dúzia tem doze. O que continua sendo estimativa é a OUTRA parte do loot:
 * o valor que o jogo atribui aos itens, que é ~NPC e não mercado.
 *
 * ## Por que a separação importa
 *
 * O `Loot` do Hunt Analyser soma as duas coisas, e os `Supplies` você paga em
 * dinheiro vivo. Medido nas sessões reais em 2026-09-22: as moedas foram 27,4%
 * do loot, com variação de 16,5% a 35,5% entre sessões. Numa das hunts o profit
 * era de 2,3 milhões e o caixa, **negativo** — ela consumiu mais supply do que
 * caiu de moeda, e só fica positiva depois de vender o loot.
 */

import type { ContagemNomeada } from "./huntSession.ts";

/**
 * Denominação de cada moeda, em gold. Conjunto fechado (ver o topo do arquivo).
 *
 * As chaves são o nome já normalizado por `normalizarNome`: minúsculas, sem
 * artigo. O parser **não resolve plural** (`lib/huntSession.ts`), então
 * `moedaDe` também aceita a forma plural — se o jogo um dia escrever
 * `2x gold coins`, o dinheiro não pode sumir em silêncio por causa de um "s".
 */
export const DENOMINACAO = {
  "gold coin": 1,
  "platinum coin": 100,
  "crystal coin": 10_000,
} as const;

export type NomeDeMoeda = keyof typeof DENOMINACAO;

/**
 * Os três nomes, para filtrar a consulta ao banco. Só a forma singular, que é
 * a que o parser grava hoje (conferido no banco: não há plural de moeda em
 * nenhuma sessão). `moedaDe` aceita as duas formas — este array é só o filtro.
 */
export const NOMES_DE_MOEDA = Object.keys(DENOMINACAO) as NomeDeMoeda[];

/** Denominação do nome, ou `null` se não for moeda. Aceita singular e plural. */
export function moedaDe(nome: string): number | null {
  const limpo = nome.trim().toLowerCase();
  const singular = limpo.endsWith("s") ? limpo.slice(0, -1) : limpo;
  return DENOMINACAO[singular as NomeDeMoeda] ?? DENOMINACAO[limpo as NomeDeMoeda] ?? null;
}

/** Soma em gold das moedas de uma lista de itens lootados. */
export function valorDasMoedas(itens: readonly ContagemNomeada[]): number {
  let total = 0;
  for (const i of itens) {
    const v = moedaDe(i.nome);
    if (v !== null) total += i.quantidade * v;
  }
  return total;
}

export interface LootSeparado {
  /** Já é dinheiro: caiu no balance do char sem você fazer nada. */
  moedas: number;
  /** Ainda é mercadoria. É a avaliação DO JOGO (~NPC), não preço de mercado. */
  itens: number;
  /**
   * Os supplies da sessão, repetidos aqui de propósito: `caixa` e `profit` são
   * calculados com eles, e quem exibe a conta não pode mostrar um supplies
   * diferente do que entrou nela.
   */
  supplies: number;
  /** `moedas − supplies`: a hunt se pagou em dinheiro vivo? Pode ser negativo. */
  caixa: number;
  /** `loot − supplies`, o profit de sempre. */
  profit: number;
  /**
   * `false` quando as moedas passam do `Loot` — o que não deveria acontecer,
   * porque o jogo conta as moedas dentro do `Loot` (conferido em 7 de 7 sessões
   * reais). Se aparecer, é dado inconsistente e a tela deve dizer isso em vez
   * de mostrar um "a vender" negativo como se fosse normal.
   */
  consistente: boolean;
}

/**
 * Separa um `Loot` já conhecido entre moeda e mercadoria.
 *
 * Não recebe o valor das moedas para calcular — recebe os itens e faz a conta,
 * para que quem chama não possa passar um total de moedas de outra sessão.
 */
export function separarLoot(
  loot: number,
  supplies: number,
  itens: readonly ContagemNomeada[],
): LootSeparado {
  const moedas = valorDasMoedas(itens);
  return {
    moedas,
    itens: loot - moedas,
    supplies,
    caixa: moedas - supplies,
    profit: loot - supplies,
    consistente: moedas <= loot,
  };
}
