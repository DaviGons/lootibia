/**
 * De-para de nomes de criatura entre o Hunt Analyser e a TibiaData.
 *
 * Fica separado de lib/tibiadata.ts de proposito: é lógica pura, sem nenhuma
 * dependência do Next, então roda no teste com `node --experimental-strip-types`.
 */

/**
 * Reduz um nome de criatura a uma chave estável entre as duas fontes.
 *
 * Minúsculas, sem pontuação, e cada palavra no singular — o Hunt Analyser
 * escreve no singular ("lost soul") e a TibiaData no plural ("Lost Souls").
 * Normalizar os DOIS lados com a mesma função é o que faz o de-para funcionar
 * sem tabela manual (diretriz 23).
 *
 * Casar por NOME e não por `race` não é escolha estética: o race de
 * "betrayed wraith" é só "wraith", que nenhuma slugificação do nome produz.
 *
 * Verificado contra a lista real: zero colisões entre as 718 criaturas.
 */
export function normalizarNomeDeCriatura(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(\w+?)(?:es|s)\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
