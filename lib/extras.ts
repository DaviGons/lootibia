/**
 * Soma dos drops extras — os que o usuário avaliou à mão.
 *
 * ## Por que eles NÃO entram no profit
 *
 * Decisão do Davi em 2026-09-23. O valor de todo o resto do app é que os
 * números saíram do texto do jogo e podem ser conferidos contra ele. Um extra é
 * palpite do usuário sobre quanto um rare vale de verdade — útil justamente
 * porque o `Loot` do Hunt Analyser avalia por referência de NPC e erra feio
 * nesses casos. Somar as duas coisas num total só apagaria a fronteira entre
 * medido e estimado, e o profit deixaria de ser auditável.
 *
 * Então eles somam à parte, e a tela mostra os dois lado a lado.
 *
 * ## O que acontece quando falta o preço da TC
 *
 * Extra em TC sem preço configurado para o mundo **não tem** equivalente em
 * gold. Isso não é zero: é desconhecido. `somarExtras` separa os dois, e a tela
 * mostra quantos ficaram de fora em vez de somar 0 e mentir um total menor.
 */

import { alvoEmGp, type UnidadeDaMeta } from "./meta.ts";

export interface DropExtra {
  readonly item: string;
  readonly valor: number;
  readonly unidade: UnidadeDaMeta;
}

export interface TotalDeExtras {
  /** Soma em gold do que deu para converter. */
  readonly gp: number;
  /** Quantos extras entraram na soma. */
  readonly contados: number;
  /**
   * Quantos ficaram de fora por serem em TC sem preço configurado. A tela tem
   * de dizer isso: um total que esconde parcelas é pior que nenhum total.
   */
  readonly semPreco: number;
}

/**
 * Soma os extras em gold, usando o preço da TC do mundo quando preciso.
 *
 * `precoTc` nulo ou zero significa "não configurado": os extras em gp continuam
 * somando normalmente, e os em TC ficam de fora e são contados em `semPreco`.
 */
export function somarExtras(
  extras: readonly DropExtra[],
  precoTc: number | null,
): TotalDeExtras {
  let gp = 0;
  let contados = 0;
  let semPreco = 0;

  for (const e of extras) {
    // `alvoEmGp` é a MESMA conversão da meta da pasta: em gp devolve o valor,
    // em TC multiplica pelo preço, e devolve null quando não dá para saber.
    const emGold = alvoEmGp({ valor: e.valor, unidade: e.unidade }, precoTc);
    if (emGold === null) {
      semPreco++;
      continue;
    }
    gp += emGold;
    contados++;
  }

  return { gp, contados, semPreco };
}
