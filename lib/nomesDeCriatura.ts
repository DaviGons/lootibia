/**
 * De-para de nomes de criatura entre o Hunt Analyser e a TibiaData.
 *
 * Fica separado de lib/sprites.ts de propósito: é lógica pura, sem nenhuma
 * dependência do Next, então roda no teste com `node --experimental-strip-types`.
 *
 * O problema: o Hunt Analyser escreve no SINGULAR e minúsculo ("dark torturer",
 * "fury"); a TibiaData escreve no PLURAL e capitalizado ("Dark Torturers",
 * "Furies"). Casar os dois exige desfazer o plural.
 *
 * Por que não existe "a" regra de singular: o sufixo `-ies` é ambíguo.
 *
 *     Furies  -> Fury      (raiz termina em consoante + y)
 *     Zombies -> Zombie    (raiz já termina em -ie)
 *
 * Nenhuma regra acerta as duas. Por isso não escolhemos: `variantesDeNome`
 * devolve TODAS as formas plausíveis, o índice guarda a criatura sob cada uma
 * delas, e a busca tenta todas. Ambiguidade resolvida por cobertura, não por
 * adivinhação.
 *
 * Medido contra as 718 criaturas da TibiaData e os ~2.069 nomes do TibiaWiki:
 * 715 nomes do wiki encontram sprite, 712 das 718 criaturas ficam alcançáveis,
 * e **zero colisões** — nenhuma chave aponta para duas criaturas diferentes.
 * O teste trava os três números.
 */

/** Minúsculas, sem pontuação, espaços colapsados. */
function limpar(nome: string): string {
  return nome
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Cada regra é uma tentativa de singular, aplicada palavra a palavra.
 *
 * Palavra a palavra porque o plural nem sempre está na última: o jogo escreve
 * "hand of cursed fate" e a TibiaData, "Hands of Cursed Fate". Regra que não
 * casa com a palavra a devolve intacta, então aplicar todas é seguro.
 */
const REGRAS: Array<(palavra: string) => string> = [
  (p) => p, // já singular
  (p) => p.replace(/([^aeiou])ies$/, "$1y"), // furies -> fury
  (p) => p.replace(/ies$/, "ie"), // zombies -> zombie
  (p) => p.replace(/(ss|ch|sh|x|z)es$/, "$1"), // witches -> witch
  (p) => p.replace(/oes$/, "o"), // heroes -> hero
  (p) => p.replace(/uses$/, "us"), // corpuses -> corpus
  (p) => p.replace(/ves$/, "f"), // wolves -> wolf
  (p) => p.replace(/men$/, "man"),
  (p) => p.replace(/([^s])s$/, "$1"), // torturers -> torturer
];

/**
 * Todas as chaves sob as quais um nome de criatura pode ser encontrado.
 *
 * Inclui a versão sem espaços de cada variante, que é o formato do `race` da
 * TibiaData ("darktorturer") — é o que resgata irregulares como
 * `Cyclopes` ↔ `cyclops`, que nenhuma regra de sufixo alcança.
 *
 * A primeira chave é sempre o nome limpo, útil como forma canônica.
 */
export function variantesDeNome(nome: string): string[] {
  const base = limpar(nome);
  if (!base) return [];
  const palavras = base.split(" ");
  const saida = new Set<string>();
  for (const regra of REGRAS) saida.add(palavras.map(regra).join(" "));
  for (const v of [...saida]) saida.add(v.replace(/ /g, ""));
  return [...saida];
}

/** Forma canônica de um nome — a primeira variante, sempre o nome limpo. */
export function normalizarNomeDeCriatura(nome: string): string {
  return limpar(nome);
}
