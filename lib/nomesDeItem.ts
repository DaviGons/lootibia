/**
 * De-para de nomes de ITEM entre o Hunt Analyser e o TibiaWiki.
 *
 * ## O problema NÃO é plural — isso foi medido
 *
 * O `AGENTS.md` e o `docs/hunt-analyser.md` diziam que o jogo escreve
 * `great mana potions` no plural. **É falso**, e três evidências independentes
 * derrubam isso:
 *
 * 1. O fixture gravado (`test/fixtures/sessao-indentada.txt`, diretriz 29) traz
 *    `413x a great mana potion` — singular, com artigo, na quantidade 413.
 * 2. 135 itens distintos de 7 sessões reais: **zero** pares singular/plural.
 * 3. Os únicos nomes terminados em `s` (`steel boots`, `terra legs`,
 *    `silencer claws`, `damaged armor plates`, `oriental shoes`) são itens cujo
 *    nome É plural — e o wiki os indexa assim mesmo (`Steel Boots` → 200).
 *
 * O Hunt Analyser escreve item como `<n>x a <nome singular>`, e `normalizarNome`
 * já remove o artigo. Criatura é outra história: ali o plural existe de verdade,
 * e é o que `lib/nomesDeCriatura.ts` resolve.
 *
 * ## O problema REAL é a caixa, e a convenção não é a óbvia
 *
 * Medido contra `tibiawiki.dev/api/items/{titulo}`:
 *
 * | título pedido | resposta |
 * |---|---|
 * | `Great Mana Potion` | **200** |
 * | `great mana potion` | 404 — a API é sensível a caixa |
 * | `GREAT MANA POTION` | 404 |
 * | `Wand of Inferno` | **200** |
 * | `Wand Of Inferno` | **404** |
 *
 * Ou seja: Title Case ingênuo **falha** em todo item com preposição no meio, e
 * são muitos (`wand of inferno`, `helmet of the deep`, `boots of haste`).
 *
 * ## Por que devolver variantes em vez de escolher
 *
 * Mesmo motivo de `lib/nomesDeCriatura.ts`: a convenção do wiki é editorial, não
 * mecânica, e uma exceção nova não deve virar item sem preço. `variantesDeTitulo`
 * devolve todas as formas plausíveis, da mais provável para a menos, e quem
 * consulta tenta na ordem. Ambiguidade resolvida por cobertura, não por
 * adivinhação.
 *
 * `scripts/conferir-itens.ts` mede a cobertura contra a API de verdade. Em
 * 2026-09-22: **135 de 135**, zero exceções. Rodar de novo quando aparecer item
 * novo no banco — é ele que avisa se a convenção do wiki mudou.
 */

/**
 * Palavras que ficam em minúscula quando não são a primeira.
 *
 * Não é opinião: `Wand of Inferno` responde 200 e `Wand Of Inferno` responde
 * 404. A lista cobre as preposições e artigos que aparecem em nome de item do
 * Tibia; palavra fora dela é capitalizada, e se algum dia isso errar, o
 * `scripts/conferir-itens.ts` mostra qual item deixou de resolver.
 */
export const MINUSCULAS = new Set([
  "a",
  "an",
  "and",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

/** Minúsculas, espaços colapsados. Preserva apóstrofo: `Cat's Paw` é 200. */
function limpar(nome: string): string {
  return nome.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Capitaliza a primeira letra, deixando o resto como está.
 *
 * Não usa `charAt(0).toUpperCase() + resto` cru porque nome com apóstrofo
 * (`cat's paw`) e com hífen precisa manter o miolo intacto — capitalizar só a
 * inicial faz isso naturalmente.
 */
function capitalizar(palavra: string): string {
  if (!palavra) return palavra;
  return palavra[0].toUpperCase() + palavra.slice(1);
}

/**
 * Títulos plausíveis para um nome vindo do Hunt Analyser, do mais provável ao
 * menos. Quem consulta tenta na ordem e para no primeiro que responder.
 *
 * Devolve `[]` para entrada vazia, e nunca devolve duplicata.
 */
export function variantesDeTitulo(nome: string): string[] {
  const base = limpar(nome);
  if (!base) return [];
  const palavras = base.split(" ");

  const comMinusculas = palavras
    .map((p, i) => (i > 0 && MINUSCULAS.has(p) ? p : capitalizar(p)))
    .join(" ");
  const tudoCapitalizado = palavras.map(capitalizar).join(" ");

  // `Set` preserva a ordem de inserção: a forma provável vem primeiro. Para
  // nome sem preposição as duas coincidem e sobra uma variante só.
  return [...new Set([comMinusculas, tudoCapitalizado])];
}

/**
 * O palpite único — a primeira variante. Serve para exibir; para CONSULTAR,
 * use `variantesDeTitulo` e tente todas, senão um item com preposição some.
 */
export function tituloDeItem(nome: string): string {
  return variantesDeTitulo(nome)[0] ?? "";
}
