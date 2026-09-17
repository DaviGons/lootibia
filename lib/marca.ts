/**
 * Geometria da marca — fonte única para a tela e para os arquivos de imagem.
 *
 * O wordmark **não usa fonte**: as letras são retângulos e anéis desenhados à
 * mão. Isso não é purismo. É o que faz a marca sair idêntica no cabeçalho
 * (React), no favicon e na imagem de OpenGraph (gerada por `sharp`, que
 * renderiza SVG sem garantia nenhuma sobre quais fontes existem na máquina).
 * Texto num SVG rasterizado fora do navegador é aposta; `<rect>` não é.
 *
 * Desenho: grotesca geométrica pesada, terminais retos, `a` de um andar.
 * Sistema de coordenadas do wordmark, com y crescendo para baixo:
 *
 *     y=8    topo dos ascendentes (l, b) e do cabo da espada
 *     y=46   topo da altura-x — onde fica a guarda, como a barra de um "t"
 *     y=73   centro dos anéis (o, b, a)
 *     y=100  linha de base
 *     y=104  ponta da lâmina: 4 de transbordo, porque forma pontiaguda
 *            terminando exatamente na base parece curta demais
 *
 * As duas cores não são decorativas e vêm da paleta de `app/globals.css`:
 * o punho acompanha a cor do texto (`currentColor` na tela) e só a lâmina é
 * laranja. Testado nos dois temas e em 18 px: com o punho numa cor própria a
 * espada se descola e a palavra deixa de ler como "lootibia".
 */

/** `--primary` do tema claro: hsl(18 82% 56%). O único matiz de dado do projeto. */
export const LARANJA = "#EB6A33";
/** `--foreground` do tema escuro: hsl(38 30% 95%). */
export const CREME = "#F6F3EE";
/** `--background` do tema escuro: hsl(24 16% 7%). */
export const CARVAO = "#151110";

export const CAIXA_MARCA = "0 0 396 112";
export const CAIXA_ICONE = "0 0 64 64";

/** Hastes retas e soltas: `l`, primeiro `i`, segundo `i`. `[x, y, largura, altura]` */
export const HASTES = [
  [0, 8, 16, 92],
  [216, 46, 16, 54],
  [312, 46, 16, 54],
] as const;

/** Pingos dos dois `i`. `[cx, cy, r]` */
export const PINGOS = [
  [224, 28, 8],
  [320, 28, 8],
] as const;

/**
 * `o`, `o`, `b` e `a` — contorno externo e olho, num caminho só, com
 * `fill-rule="evenodd"` abrindo o furo.
 *
 * Por que não anel com traço mais um retângulo de haste, que seria bem mais
 * curto de escrever: no `b` e no `a` os dois não se encostam. Com bojo externo
 * de raio 28 e haste de 16 tangente pela direita, a haste só entra no círculo
 * em y=47,70 — abaixo do topo da altura-x. Sobra um degrau de 4,58 de fundo
 * entre a curva e o canto da haste, invisível no código e gritante em 1200 px.
 * Unindo as duas formas num contorno, o encaixe deixa de existir.
 *
 * Círculos: externo r=28 (45..101, com 1 de transbordo em cima e embaixo sobre
 * as letras de terminal reto), olho r=12. Peso resultante do traço: 16, igual
 * ao das hastes.
 */
export const CONTORNOS = [
  // o
  "M56 45a28 28 0 1 0 0 56a28 28 0 1 0 0-56ZM56 61a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z",
  // o
  "M122 45a28 28 0 1 0 0 56a28 28 0 1 0 0-56ZM122 61a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z",
  // b — haste ascendente à esquerda, bojo à direita
  "M244 8H260V47.7A28 28 0 1 1 260 98.3V100H244ZM272 61a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z",
  // a — de um andar: bojo à esquerda, haste à direita
  "M380 46H396V100H380V98.3A28 28 0 1 1 380 47.7ZM368 61a12 12 0 1 0 0 24a12 12 0 1 0 0-24Z",
] as const;

/** `[x, y, largura, altura, rx]` */
type Retangulo = readonly [number, number, number, number, number];

/** Topo da altura-x — onde a guarda cruza a lâmina, como a barra de um `t`. */
export const TOPO_ALTURA_X = 46;
/** Linha de base das letras de terminal reto. */
export const BASE = 100;
/** Onde a ponta da lâmina para. Abaixo da base, de propósito (ver o cabeçalho). */
export const PONTA_DA_LAMINA = 104;

const LAMINA = { esquerda: 174, direita: 192, meio: 183, topo: 53, ombro: 86 };

/** A espada que faz as vezes do `t`. Guarda na altura-x, ponta pouco abaixo da base. */
export const ESPADA: { cabo: Retangulo; guarda: Retangulo; lamina: string } = {
  cabo: [176, 11, 14, 35, 7],
  guarda: [160, 44, 46, 11, 5.5],
  lamina:
    `M${LAMINA.esquerda} ${LAMINA.topo} H${LAMINA.direita} V${LAMINA.ombro} ` +
    `L${LAMINA.meio} ${PONTA_DA_LAMINA} L${LAMINA.esquerda} ${LAMINA.ombro} Z`,
};

/**
 * A espada sozinha, para favicon e avatar. Proporções mais gordas que as do
 * wordmark: em 16 px a lâmina do wordmark some, e o que sobra é um borrão.
 */
export const ICONE: { cabo: Retangulo; guarda: Retangulo; lamina: string; raio: number } = {
  cabo: [28, 5, 8, 19, 4],
  guarda: [14, 22, 36, 7, 3.5],
  lamina: "M25.5 27 H38.5 V43 L32 59 L25.5 43 Z",
  raio: 14,
};

const ret = ([x, y, w, h, rx]: Retangulo) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;

/**
 * O wordmark como string de SVG, para quem não é React (o gerador de imagens).
 * `cor` pinta letras e punho; a lâmina é sempre laranja.
 */
export function svgDaMarca(cor: string): string {
  const hastes = HASTES.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`);
  const pingos = PINGOS.map(([cx, cy, r]) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`);
  const contornos = CONTORNOS.map((d) => `<path d="${d}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CAIXA_MARCA}">
  <g fill="${cor}" fill-rule="evenodd">${hastes.join("")}${pingos.join("")}${contornos.join("")}${ret(ESPADA.cabo)}${ret(ESPADA.guarda)}</g>
  <path d="${ESPADA.lamina}" fill="${LARANJA}"/>
</svg>`;
}

/** O ícone como string de SVG. `fundo` nulo devolve a espada sem o tile. */
export function svgDoIcone(cor = CREME, fundo: string | null = CARVAO): string {
  const tile = fundo
    ? `<rect width="64" height="64" rx="${ICONE.raio}" fill="${fundo}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CAIXA_ICONE}">
  ${tile}
  <g fill="${cor}">${ret(ICONE.cabo)}${ret(ICONE.guarda)}</g>
  <path d="${ICONE.lamina}" fill="${LARANJA}"/>
</svg>`;
}
