/**
 * Reconhecimento de itens num print do Stash (o antigo Supply Stash).
 *
 * Funções puras sobre RGBA: nada de DOM, canvas ou rede. Quem chama (o Web
 * Worker da página) entrega os pixels; os testes entregam pixels sintéticos.
 *
 * ## Como um slot vira um item
 *
 * O sprite do wiki tem fundo transparente. Comparar só os pixels OPACOS dele
 * com o slot faz o fundo do slot sair da conta sozinho — é a ideia central,
 * a mesma do stash.kefu.ovh. O que muda aqui é o custo:
 *
 * 1. **Filtro por assinatura.** O slot vira uma grade de 8×8 células de
 *    4 px, cada uma com a sua cor média. Cada sprite, desenhado sobre o fundo
 *    real do slot (`FUNDO_DO_SLOT`), dá a grade que o slot TERIA se fosse ele. Média em bloco de 4 px
 *    aguenta o deslocamento de 1–2 px, e o fundo conta a favor do item certo.
 *    Ficam os `CANDIDATOS` mais próximos.
 * 2. **Comparação fina** só nesses: erro quadrático médio nos pontos opacos,
 *    com o sprite deslocado até ±2 px, porque o recorte do slot pode sair um
 *    pixel torto.
 *
 * O canto de baixo à direita, onde o jogo escreve a quantidade, não entra em
 * nenhuma das duas: o número por cima do sprite estragaria a comparação.
 *
 * ## A moldura colorida
 *
 * O cliente pode pintar a moldura do slot pela faixa de valor do item (cinza,
 * verde, azul, roxo, dourado — os limites são do jogador). A cor escorre para
 * dentro do slot num degradê, e o fundo muda junto. `FUNDO_DO_SLOT` é o fundo
 * da moldura cinza; o de qualquer outra cor F sai dele por
 * `fundo = cinza + brilho × (F − 131)`, com o brilho medido por pixel
 * (`BRILHO_DA_MOLDURA`). A cor de cada slot é lida na própria moldura, então
 * cor que nenhum print mostrou ainda funciona do mesmo jeito.
 */

export interface Rgba {
  largura: number;
  altura: number;
  /** RGBA, 4 bytes por pixel, linha a linha. */
  dados: Uint8ClampedArray | Uint8Array;
}

/** Lado do sprite e da área útil do slot. */
export const LADO = 32;

/** Deslocamentos testados na comparação fina, do mais provável ao menos. */
const DESLOCAMENTOS: readonly (readonly [number, number])[] = [
  [0, 0], [0, -1], [0, 1], [-1, 0], [1, 0],
  [-1, -1], [1, -1], [-1, 1], [1, 1],
  [-2, 0], [2, 0], [0, -2], [0, 2],
];

/** Quantos sprites passam do filtro de cor para a comparação fina. */
const CANDIDATOS = 96;

/** Acima deste erro médio (por ponto, soma dos 3 canais ao quadrado), não é o item. */
export const ERRO_MAXIMO = 2200;

/**
 * O erro do item tem de ser no máximo esta fração do erro de supor o slot
 * vazio. 0,25 = o item explica os pixels 4× melhor que o fundo sozinho.
 */
const MELHORA_MINIMA = 0.25;

/** Pontos com alpha acima disto contam como "do sprite". */
const OPACO = 128;

/** Fração mínima dos pontos do sprite que tem de estar à vista para decidir. */
const VISIVEL_MINIMO = 0.6;

/** Sprite com menos pontos úteis que isto casa com qualquer fundo. */
const MINIMO_DE_PONTOS = 24;

/**
 * A faixa da quantidade: da linha 20 do slot para baixo, na largura inteira.
 * Medido no print de 2026-09-28: "3,050" vai de ponta a ponta do slot, com os
 * dígitos nas linhas 21–28 e a vírgula descendo até a 31.
 */
const LINHA_DO_NUMERO = 20;

/** A grade do filtro: 8×8 células de 4 px. */
const TAM_CELULA = 4;
const CELULAS = LADO / TAM_CELULA;

/** Célula que cai na zona do número não entra no filtro. */
const CELULA_DO_NUMERO: readonly boolean[] = Array.from({ length: CELULAS * CELULAS }, (_, c) =>
  ehZonaDoNumero((c % CELULAS) * TAM_CELULA, Math.floor(c / CELULAS) * TAM_CELULA),
);

/**
 * O fundo de um slot do Stash, em cinza (r = g = b), 32×32, com a moldura
 * clara (131) na borda.
 *
 * Medido no print de 2026-09-28 (`test/fixtures/stash/`): nos três slots, os
 * pixels que nenhum sprite cobre são IDÊNTICOS (0 divergências), então o fundo
 * é uma textura fixa do cliente — escuro no centro, clareando até a moldura.
 * Os 333 pixels do centro que os três sprites cobrem foram preenchidos com a
 * média do mesmo "anel" (a distância até a borda; os anéis 13 a 15, cobertos
 * por inteiro, herdam o 12). O erro disso é o ruído da textura, uns ±8.
 * `lib/stash.test.ts` confere a tabela contra o print.
 *
 * A primeira versão estimava uma cor lisa pelos quatro cantos, e errava duas
 * vezes: o fundo não é liso, e o número ("3,050") cobre os cantos de baixo.
 */
export const FUNDO_DO_SLOT: readonly number[] = [
  131, 130, 131, 131, 130, 130, 131, 131, 131, 131, 130, 130, 131, 131, 130, 131, 131, 131, 131, 130, 130, 130, 130, 130, 130, 131, 131, 130, 130, 130, 130, 131,
  131, 118, 110, 104, 95, 89, 81, 90, 88, 88, 90, 85, 90, 84, 85, 81, 87, 90, 88, 90, 92, 90, 85, 88, 85, 88, 89, 93, 101, 107, 116, 130,
  131, 109, 95, 88, 83, 72, 69, 70, 72, 69, 75, 66, 68, 80, 75, 69, 65, 72, 72, 70, 71, 72, 75, 70, 67, 69, 72, 77, 85, 93, 105, 130,
  131, 101, 86, 73, 70, 66, 59, 58, 59, 60, 65, 59, 51, 56, 65, 59, 56, 46, 55, 56, 59, 65, 59, 62, 53, 59, 59, 65, 80, 82, 97, 130,
  130, 100, 81, 66, 61, 52, 52, 48, 46, 50, 44, 58, 42, 46, 49, 57, 54, 60, 49, 44, 38, 50, 54, 53, 43, 46, 45, 51, 62, 80, 88, 129,
  130, 87, 78, 59, 52, 46, 48, 51, 41, 36, 39, 44, 47, 40, 37, 37, 31, 39, 51, 41, 37, 30, 44, 45, 44, 40, 44, 49, 54, 71, 89, 130,
  131, 90, 75, 60, 47, 41, 41, 38, 45, 48, 36, 40, 37, 37, 46, 44, 36, 40, 36, 52, 41, 36, 36, 41, 45, 37, 47, 53, 51, 70, 81, 130,
  130, 86, 78, 51, 58, 44, 39, 40, 42, 34, 37, 41, 40, 38, 35, 36, 37, 38, 38, 33, 48, 43, 25, 39, 44, 41, 44, 43, 57, 72, 83, 130,
  130, 85, 77, 56, 46, 51, 34, 37, 40, 41, 37, 36, 38, 38, 38, 38, 38, 38, 38, 38, 38, 42, 38, 31, 44, 40, 43, 58, 53, 75, 87, 130,
  131, 86, 68, 62, 38, 51, 40, 37, 30, 44, 42, 37, 37, 37, 37, 37, 37, 37, 37, 32, 36, 33, 45, 27, 29, 30, 39, 44, 57, 72, 87, 130,
  132, 88, 70, 56, 42, 40, 50, 33, 38, 32, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 29, 48, 44, 50, 38, 50, 56, 66, 83, 131,
  130, 92, 75, 52, 46, 39, 40, 41, 30, 45, 36, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 36, 37, 34, 39, 33, 44, 49, 56, 72, 86, 130,
  129, 86, 77, 59, 47, 35, 34, 37, 40, 35, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 36, 41, 37, 37, 40, 35, 42, 60, 72, 85, 130,
  130, 81, 70, 65, 44, 47, 36, 38, 40, 44, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 36, 37, 41, 36, 29, 47, 44, 52, 69, 87, 130,
  131, 94, 70, 56, 60, 35, 40, 30, 36, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 40, 41, 44, 38, 54, 48, 53, 46, 68, 90, 130,
  130, 87, 81, 56, 49, 44, 40, 40, 38, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 24, 30, 38, 36, 44, 44, 57, 62, 63, 87, 131,
  131, 85, 69, 67, 48, 47, 38, 38, 38, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 36, 33, 39, 28, 41, 44, 49, 56, 67, 83, 131,
  130, 85, 64, 55, 48, 48, 40, 38, 38, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 36, 37, 34, 38, 34, 51, 47, 49, 72, 83, 130,
  131, 88, 69, 54, 46, 37, 38, 41, 38, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 36, 37, 41, 37, 26, 60, 61, 60, 68, 83, 130,
  130, 88, 72, 56, 44, 38, 40, 33, 38, 37, 36, 34, 40, 40, 40, 40, 40, 40, 40, 40, 34, 38, 36, 49, 54, 35, 39, 53, 72, 72, 85, 131,
  129, 88, 72, 59, 47, 35, 32, 37, 38, 37, 36, 34, 34, 34, 34, 34, 34, 34, 34, 34, 34, 36, 37, 38, 34, 48, 43, 50, 59, 74, 82, 131,
  130, 90, 72, 57, 53, 43, 30, 36, 37, 33, 40, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 36, 37, 38, 38, 39, 43, 50, 59, 74, 91, 130,
  129, 88, 76, 59, 49, 48, 38, 33, 37, 40, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 37, 38, 38, 39, 43, 50, 59, 74, 92, 132,
  132, 82, 71, 63, 48, 43, 40, 37, 32, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 43, 38, 39, 43, 50, 59, 74, 86, 131,
  132, 88, 69, 60, 51, 44, 42, 41, 37, 36, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 39, 43, 50, 59, 74, 88, 130,
  131, 93, 75, 56, 43, 48, 40, 37, 36, 32, 39, 39, 39, 39, 39, 39, 39, 39, 37, 39, 39, 39, 39, 39, 39, 39, 43, 50, 59, 74, 88, 132,
  131, 88, 78, 66, 56, 54, 43, 46, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 43, 48, 43, 43, 43, 43, 43, 43, 50, 59, 74, 91, 130,
  131, 94, 78, 67, 56, 51, 49, 55, 53, 48, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 59, 74, 91, 130,
  131, 101, 86, 73, 67, 62, 57, 56, 60, 59, 56, 59, 59, 59, 54, 59, 59, 56, 59, 59, 59, 59, 59, 59, 56, 59, 59, 59, 59, 74, 104, 130,
  131, 107, 97, 87, 79, 69, 75, 77, 69, 72, 72, 72, 74, 75, 67, 72, 69, 66, 77, 74, 74, 74, 74, 68, 66, 68, 78, 74, 74, 95, 111, 130,
  131, 118, 107, 99, 92, 90, 89, 88, 83, 88, 90, 91, 88, 87, 86, 86, 87, 85, 85, 90, 87, 86, 87, 85, 86, 88, 86, 97, 96, 106, 120, 131,
  130, 131, 131, 130, 131, 130, 131, 132, 131, 130, 131, 131, 131, 131, 131, 131, 130, 131, 130, 131, 130, 131, 131, 131, 130, 131, 129, 131, 131, 130, 129, 131
];

/** O cinza da moldura na tabela acima: a referência de `BRILHO_DA_MOLDURA`. */
const CINZA_DA_MOLDURA = 131;

/**
 * Quanto da cor da moldura chega a cada pixel do slot (1 = a própria moldura,
 * 0 = nada), pela distância até a borda na horizontal e na vertical, de 0 a 6
 * (6 = "6 ou mais"). Simétrica. Fora dos cantos só conta a distância menor.
 *
 * Medido no print de 2026-09-29 (`test/fixtures/stash/`): nos 23 slots verdes e
 * 12 azuis, pixel sem sprite, `(slot − cinza) / (F − 131)` pelo mínimo
 * quadrado dos três canais; média por classe, de 91 a 5.559 pixels cada. O
 * resíduo do modelo fica em ±4 tons, e a partir da distância 6 o brilho é zero.
 */
const BRILHO_POR_DISTANCIA: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0.828, 0.737, 0.656, 0.584, 0.527, 0.512],
  [1, 0.737, 0.604, 0.491, 0.418, 0.361, 0.344],
  [1, 0.656, 0.491, 0.372, 0.292, 0.23, 0.203],
  [1, 0.584, 0.418, 0.292, 0.191, 0.13, 0.1],
  [1, 0.527, 0.361, 0.23, 0.13, 0.069, 0.026],
  [1, 0.512, 0.344, 0.203, 0.1, 0.026, 0],
];

/** `BRILHO_POR_DISTANCIA` aberto em 32×32. */
export const BRILHO_DA_MOLDURA: Float32Array = (() => {
  const t = new Float32Array(LADO * LADO);
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const u = Math.min(6, x, LADO - 1 - x);
      const v = Math.min(6, y, LADO - 1 - y);
      t[y * LADO + x] = BRILHO_POR_DISTANCIA[u][v];
    }
  }
  return t;
})();

/**
 * Pixel de moldura, de qualquer cor: algum canal acima de 100. O que separa os
 * slots é uma linha quase preta, e o fundo perto da moldura já é mais escuro.
 * A primeira versão pedia luz média acima de 100 e perdia a moldura verde
 * (35, 137, 35 → 69) — um print com 30 slots verdes saiu com metade dos itens.
 */
function ehMoldura(d: Uint8ClampedArray | Uint8Array, i: number): boolean {
  return Math.max(d[i], d[i + 1], d[i + 2]) > 100;
}

/** Fração mínima da moldura que tem de aparecer para o slot contar. */
const MOLDURA_A_VISTA = 0.6;

/**
 * A cor da moldura do slot, como diferença para o cinza: `[F − 131]` por canal.
 * Mediana da linha de cima e da coluna da esquerda, na parte à vista — o
 * sprite às vezes invade a moldura, e o número passa por cima do pé da
 * direita, que fica de fora.
 */
function desvioDaMoldura(img: Rgba, sx: number, sy: number, y0: number, y1: number): [number, number, number] {
  const W = img.largura;
  const d = img.dados;
  const canais: number[][] = [[], [], []];
  const junta = (x: number, y: number) => {
    if (x < 0 || x >= W || y < y0 || y > y1 || y >= img.altura) return;
    const i = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) canais[c].push(d[i + c]);
  };
  for (let k = 0; k < LADO; k++) {
    junta(sx + k, sy);
    junta(sx, sy + k);
  }
  if (canais[0].length === 0) return [0, 0, 0];
  return canais.map((v) => {
    v.sort((a, b) => a - b);
    return v[v.length >> 1] - CINZA_DA_MOLDURA;
  }) as [number, number, number];
}

function ehZonaDoNumero(_x: number, y: number): boolean {
  return y >= LINHA_DO_NUMERO;
}

/**
 * Pixel do número: o branco-acinzentado dos dígitos (191 no print) ou o preto
 * do contorno. Na faixa do número, pixel assim é texto, não sprite.
 */
function pareceTexto(d: Uint8ClampedArray | Uint8Array, i: number): boolean {
  const r = d[i], g = d[i + 1], b = d[i + 2];
  return (r > 170 && g > 170 && b > 170 && Math.abs(r - g) < 8 && Math.abs(g - b) < 8) || (r < 14 && g < 14 && b < 14);
}

/** Erro máximo (3 canais ao quadrado) para um ponto da faixa do número contar como do sprite. */
const IGUAL_AO_SPRITE = 3 * 12 * 12;

/**
 * Como o ponto `k` do sprite, caído no pixel `i` do print, entra na conta:
 * - `"conta"`: ponto comum, entra no erro;
 * - `"so-a-vista"`: na faixa do número, parece texto mas bate com o sprite —
 *   prova que o sprite está ali, mas fica fora do erro;
 * - `"fora"`: na faixa do número, é texto por cima do sprite.
 *
 * A primeira versão pulava todo pixel preto ou branco da faixa, e o contorno
 * preto do PRÓPRIO sprite ia junto: o Bulltaur Horn, fino e descendo até o
 * número, ficava com 51% à vista, abaixo de `VISIVEL_MINIMO`, e saía sem item
 * apesar de 92 pontos iguais e nenhum diferente. Esses pontos contam para a
 * vista e não para o erro: no erro, dariam vantagem a quem tem contorno preto
 * exatamente onde o número passa (o teste sintético trocou Silver Rune Emblem
 * por Soulfire Rune assim).
 */
function papelDoPonto(p: Int16Array, k: number, px: Uint8ClampedArray | Uint8Array, i: number): "conta" | "so-a-vista" | "fora" {
  if (p[k + 1] < LINHA_DO_NUMERO || !pareceTexto(px, i)) return "conta";
  const e = (px[i] - p[k + 2]) ** 2 + (px[i + 1] - p[k + 3]) ** 2 + (px[i + 2] - p[k + 4]) ** 2;
  return e <= IGUAL_AO_SPRITE ? "so-a-vista" : "fora";
}

/** Um sprite do atlas, pré-digerido para comparar rápido. */
export interface SpritePreparado {
  /** Índice do item dono deste sprite. */
  item: number;
  /** Pontos opacos fora da zona do número: [x, y, r, g, b] achatado. */
  pontos: Int16Array;
  /**
   * Para o filtro: por célula da grade 8×8, a cor média `[r, g, b]` que o slot
   * teria com este sprite desenhado sobre `FUNDO_DO_SLOT`.
   *
   * A primeira versão comparava só a cor do slot nos pontos de cada sprite. Um
   * sprite cujos pontos caíam no fundo "via" cinza, e todo item de cor média
   * cinza parecia ótimo: lotavam os candidatos e o item certo, deslocado 1 px,
   * ficava de fora — 130 de 300 no teste.
   */
  celulas: Float32Array;
  /**
   * Por célula, a média de `BRILHO_DA_MOLDURA` nos pixels que o sprite NÃO
   * cobre: com a moldura de desvio `m`, a célula passa a valer
   * `celulas + m × brilho`. Conta exata, sem preparar uma grade por cor.
   */
  brilho: Float32Array;
}

/**
 * Prepara todos os sprites do atlas. Roda uma vez por carga da página.
 *
 * `donos[i]` é o item do sprite `i`; sprite sem nenhum ponto opaco utilizável
 * (transparente, ou só com pixels na zona do número) é descartado.
 */
export function prepararSprites(atlas: Rgba, colunas: number, donos: readonly number[]): SpritePreparado[] {
  const out: SpritePreparado[] = [];
  for (let s = 0; s < donos.length; s++) {
    const ox = (s % colunas) * LADO;
    const oy = Math.floor(s / colunas) * LADO;
    const pontos: number[] = [];
    const celulas = new Float32Array(CELULAS * CELULAS * 3);
    const brilho = new Float32Array(CELULAS * CELULAS);
    for (let y = 0; y < LADO; y++) {
      for (let x = 0; x < LADO; x++) {
        const i = ((oy + y) * atlas.largura + ox + x) * 4;
        const c = (Math.floor(y / TAM_CELULA) * CELULAS + Math.floor(x / TAM_CELULA)) * 3;
        const cobre = atlas.dados[i + 3] > OPACO;
        const f = FUNDO_DO_SLOT[y * LADO + x];
        const area = TAM_CELULA * TAM_CELULA;
        celulas[c] += (cobre ? atlas.dados[i] : f) / area;
        celulas[c + 1] += (cobre ? atlas.dados[i + 1] : f) / area;
        celulas[c + 2] += (cobre ? atlas.dados[i + 2] : f) / area;
        if (!cobre) brilho[c / 3] += BRILHO_DA_MOLDURA[y * LADO + x] / area;
        if (!cobre) continue;
        // A borda de 1 px do slot é a moldura clara do cliente, não o sprite.
        if (x > 0 && y > 0 && x < LADO - 1 && y < LADO - 1) pontos.push(x, y, atlas.dados[i], atlas.dados[i + 1], atlas.dados[i + 2]);
      }
    }
    // Poucos pontos casam com qualquer fundo: sprite assim não é confiável.
    if (pontos.length / 5 < MINIMO_DE_PONTOS) continue;
    out.push({ item: donos[s], pontos: Int16Array.from(pontos), celulas, brilho });
  }
  return out;
}

export interface Reconhecimento {
  item: number;
  /** Erro médio da melhor comparação: quanto menor, mais certo. */
  erro: number;
}

/**
 * Qual item está no slot cujo canto de cima à esquerda é (`sx`, `sy`) em `img`.
 * `null` quando nada fica abaixo de `ERRO_MAXIMO`.
 */
export function reconhecerSlot(
  img: Rgba,
  sx: number,
  sy: number,
  sprites: readonly SpritePreparado[],
  /**
   * Linhas do print (inclusivas) em que o slot aparece. Numa linha cortada
   * pela rolagem, só essa faixa conta; o resto é outra parte da janela.
   */
  visivel: { y0: number; y1: number } = { y0: 0, y1: Infinity },
): Reconhecimento | null {
  const W = img.largura;
  const H = Math.min(img.altura, visivel.y1 + 1);
  const Y0 = Math.max(0, visivel.y0);
  const px = img.dados;
  const m = desvioDaMoldura(img, sx, sy, Y0, H - 1);

  // 1. Filtro: a grade do slot contra a grade que cada sprite produziria
  //    sobre o fundo do slot, na cor da moldura dele. Guarda os CANDIDATOS de
  //    menor distância.
  const grade = new Float32Array(CELULAS * CELULAS * 3);
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const qx = sx + x;
      const qy = sy + y;
      if (qx < 0 || qy < Y0 || qx >= W || qy >= H) continue;
      const i = (qy * W + qx) * 4;
      const c = (Math.floor(y / TAM_CELULA) * CELULAS + Math.floor(x / TAM_CELULA)) * 3;
      grade[c] += px[i];
      grade[c + 1] += px[i + 1];
      grade[c + 2] += px[i + 2];
    }
  }
  for (let c = 0; c < grade.length; c++) grade[c] /= TAM_CELULA * TAM_CELULA;
  // Célula com alguma linha fora da faixa visível não entra no filtro.
  const celulaVisivel = Array.from({ length: CELULAS * CELULAS }, (_, c) => {
    const topo = sy + Math.floor(c / CELULAS) * TAM_CELULA;
    return topo >= Y0 && topo + TAM_CELULA - 1 < H && !CELULA_DO_NUMERO[c];
  });

  const melhores: { s: number; d: number }[] = [];
  let pior = Infinity;
  for (let s = 0; s < sprites.length; s++) {
    const cel = sprites[s].celulas;
    const bri = sprites[s].brilho;
    let d = 0;
    for (let c = 0; c < CELULAS * CELULAS; c++) {
      if (!celulaVisivel[c]) continue;
      for (let k = 0; k < 3; k++) d += (grade[c * 3 + k] - cel[c * 3 + k] - m[k] * bri[c]) ** 2;
      if (d > pior) break;
    }
    if (melhores.length < CANDIDATOS) {
      melhores.push({ s, d });
      if (melhores.length === CANDIDATOS) {
        melhores.sort((p, q) => p.d - q.d);
        pior = melhores[CANDIDATOS - 1].d;
      }
    } else if (d < pior) {
      // Inserção ordenada: a lista é curta e quase sempre só troca a cauda.
      let j = CANDIDATOS - 1;
      while (j > 0 && melhores[j - 1].d > d) {
        melhores[j] = melhores[j - 1];
        j--;
      }
      melhores[j] = { s, d };
      pior = melhores[CANDIDATOS - 1].d;
    }
  }

  // 2. Comparação fina, com corte assim que o erro parcial já perdeu.
  let melhor: (Reconhecimento & { s: number; dx: number; dy: number }) | null = null;
  let limite = ERRO_MAXIMO;
  for (const { s } of melhores) {
    const p = sprites[s].pontos;
    const total = p.length / 5;
    for (const [dx, dy] of DESLOCAMENTOS) {
      let soma = 0;
      let n = 0;
      let aVista = 0;
      let perdeu = false;
      for (let k = 0; k < p.length; k += 5) {
        const x = sx + p[k] + dx;
        const y = sy + p[k + 1] + dy;
        if (x < 0 || y < Y0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        // O número desenhado por cima do sprite não é o sprite.
        const papel = papelDoPonto(p, k, px, i);
        if (papel !== "fora") aVista++;
        if (papel !== "conta") continue;
        const er = px[i] - p[k + 2];
        const eg = px[i + 1] - p[k + 3];
        const eb = px[i + 2] - p[k + 4];
        soma += er * er + eg * eg + eb * eb;
        n++;
        // Mesmo que o resto fosse perfeito, a média já passa do melhor.
        if (soma > limite * total) {
          perdeu = true;
          break;
        }
      }
      // Entre o número por cima e a rolagem cortando, pelo menos 60% do
      // sprite tem de estar à vista; menos que isso não decide.
      if (perdeu || n === 0 || aVista < total * VISIVEL_MINIMO) continue;
      const erro = soma / n;
      if (erro < limite) {
        limite = erro;
        melhor = { item: sprites[s].item, erro, s, dx, dy };
      }
    }
  }
  if (!melhor) return null;

  // 3. O item explica o slot melhor que o slot VAZIO explicaria? Nos mesmos
  //    pontos, o erro de supor "só fundo". Sprite escuro sobre fundo escuro
  //    passa do limite absoluto sem ser item nenhum; esta conta pega isso sem
  //    limiar calibrado à mão.
  const p = sprites[melhor.s].pontos;
  let vazio = 0;
  let n = 0;
  for (let k = 0; k < p.length; k += 5) {
    const x = sx + p[k] + melhor.dx;
    const y = sy + p[k + 1] + melhor.dy;
    if (x < 0 || y < Y0 || x >= W || y >= H) continue;
    const i = (y * W + x) * 4;
    if (papelDoPonto(p, k, px, i) !== "conta") continue;
    // O fundo no pixel do slot onde este ponto do sprite caiu, na cor da moldura.
    const fx = p[k] + melhor.dx;
    const fy = p[k + 1] + melhor.dy;
    const j = Math.min(LADO - 1, Math.max(0, fy)) * LADO + Math.min(LADO - 1, Math.max(0, fx));
    const f = FUNDO_DO_SLOT[j];
    const b = BRILHO_DA_MOLDURA[j];
    vazio += (px[i] - f - b * m[0]) ** 2 + (px[i + 1] - f - b * m[1]) ** 2 + (px[i + 2] - f - b * m[2]) ** 2;
    n++;
  }
  if (melhor.erro > (vazio / n) * MELHORA_MINIMA) return null;
  return { item: melhor.item, erro: melhor.erro };
}

/** Um item achado num print, com a quantidade lida. */
export interface Achado {
  item: number;
  quantidade: number;
}

/**
 * Junta os achados de vários prints do mesmo Stash.
 *
 * O Stash mostra cada item num slot só, com a quantidade total — até arma e
 * escudo, que não empilham na mochila, aparecem ali como "Crown Shield 3". O
 * mesmo item em dois prints é o MESMO slot, visto duas vezes — não se soma. Isso dispensa alinhar linhas entre prints, que é o que o
 * stash.kefu.ovh faz e pode errar.
 *
 * Quando os dois prints discordam da quantidade (OCR errou num deles), fica o
 * maior e o item vai para `divergentes`, para a tela avisar.
 */
export function juntarPrints(prints: readonly (readonly Achado[])[]): {
  itens: Achado[];
  divergentes: number[];
} {
  const porItem = new Map<number, number>();
  const divergentes = new Set<number>();
  for (const achados of prints) {
    for (const a of achados) {
      const antes = porItem.get(a.item);
      if (antes !== undefined && antes !== a.quantidade) divergentes.add(a.item);
      porItem.set(a.item, Math.max(antes ?? 0, a.quantidade));
    }
  }
  return {
    itens: [...porItem].map(([item, quantidade]) => ({ item, quantidade })),
    divergentes: [...divergentes],
  };
}

// ---------------------------------------------------------------------------
// O print inteiro: achar a janela, os slots e as quantidades
// ---------------------------------------------------------------------------
//
// Tudo medido no print de 2026-09-28 (`test/fixtures/stash/`), cliente em
// 1920×1080 e interface a 100%. Outra escala muda estas medidas.

function luz(d: Uint8ClampedArray | Uint8Array, i: number): number {
  return (d[i] + d[i + 1] + d[i + 2]) / 3;
}

/**
 * O título "Stash" da janela, em texto bitmap: nítido, cor 144 sobre fundo
 * ≤ 71. É a âncora: os slots só são procurados dentro da janela, e as
 * mochilas abertas ao lado, que têm a mesma moldura de slot, ficam de fora.
 */
const TITULO = [
  "..........................##....",
  ".####...##................##....",
  "##...#..##................##....",
  "##.....#####..####...####.#####.",
  "#####...##.......##.##....##..##",
  ".#####..##....#####.####..##..##",
  "....##..##...##..##..####.##..##",
  "#...##..##...##..##....##.##..##",
  ".####....###..#####.####..##..##",
];

/**
 * As cinco letras do título, pelas colunas que ocupam em `TITULO`. O espaço
 * entre elas varia: no print de 2026-10-06 (`exemplos/`, outra máquina) o "s"
 * e o "h" vêm 1 px mais à direita cada um, e a palavra tem 34 px em vez de 32.
 * Com o molde inteiro de uma vez, a janela não era achada e o print não lia
 * nada. Cada letra é procurada com até `FOLGA_ENTRE_LETRAS` px a mais.
 */
const LETRAS_DO_TITULO: { texto: [number, number][]; fundo: [number, number][] }[] = [
  [0, 5],
  [7, 11],
  [13, 18],
  [20, 24],
  [26, 31],
].map(([c0, c1]) => {
  const texto: [number, number][] = [];
  const fundo: [number, number][] = [];
  TITULO.forEach((linha, y) => {
    for (let x = c0; x <= c1; x++) (linha[x] === "#" ? texto : fundo).push([x, y]);
  });
  return { texto, fundo };
});
const FOLGA_ENTRE_LETRAS = 2;

/**
 * A lista de itens, medida a partir do canto do título: a borda escura dela
 * começa 362 px à esquerda e 55 abaixo. O sprite do primeiro slot fica 5 px
 * para dentro, os slots andam de 37 em 37, e 20 colunas cabem até a barra de
 * rolagem.
 *
 * A ALTURA não é fixa: no print de 2026-09-28 a lista vai até 428 px abaixo da
 * borda de cima, e no stash.kefu.ovh ela vai mais longe. Por isso o fundo é
 * achado descendo pela borda escura até ela acabar.
 */
const LISTA = { dx: -362, dy: 55, margem: 5, passo: 37, colunas: 20, largura: 745 };

/** Da lista até a janela inteira, para o recorte que a tela mostra. */
const JANELA = { dx: -16, dyTitulo: -3, largura: 788, abaixoDaLista: 58 };

/** Canto de cima à esquerda do texto "Stash", ou `null`. */
export function acharTitulo(img: Rgba): { x: number; y: number } | null {
  const W = img.largura;
  const H = img.altura;
  const d = img.dados;
  const [ax, ay] = LETRAS_DO_TITULO[0].texto[0];
  const largura = TITULO[0].length + FOLGA_ENTRE_LETRAS * (LETRAS_DO_TITULO.length - 1);
  /** Contraste da letra `l` com o canto em (`x`, `y`): o pior texto e o pior fundo. */
  const letra = (l: number, x: number, y: number): [number, number] => {
    let minTexto = 255;
    for (const [tx, ty] of LETRAS_DO_TITULO[l].texto) {
      minTexto = Math.min(minTexto, luz(d, ((y + ty) * W + x + tx) * 4));
      if (minTexto < 110) return [minTexto, 255];
    }
    let maxFundo = 0;
    for (const [fx, fy] of LETRAS_DO_TITULO[l].fundo) {
      maxFundo = Math.max(maxFundo, luz(d, ((y + fy) * W + x + fx) * 4));
      if (maxFundo > minTexto - 40) break;
    }
    return [minTexto, maxFundo];
  };
  for (let y = 0; y + TITULO.length <= H; y++) {
    for (let x = 0; x + largura <= W; x++) {
      // Corte rápido: o primeiro pixel do "S" tem de ser claro.
      if (luz(d, ((y + ay) * W + x + ax) * 4) < 110) continue;
      let minTexto = 255;
      let maxFundo = 0;
      let desvio = 0;
      let achou = true;
      for (let l = 0; l < LETRAS_DO_TITULO.length && achou; l++) {
        achou = false;
        for (let e = 0; e <= (l === 0 ? 0 : FOLGA_ENTRE_LETRAS); e++) {
          const [t, f] = letra(l, x + desvio + e, y);
          if (t < 110 || f > t - 40) continue;
          desvio += e;
          minTexto = Math.min(minTexto, t);
          maxFundo = Math.max(maxFundo, f);
          achou = true;
          break;
        }
      }
      if (achou && maxFundo <= minTexto - 40) return { x, y };
    }
  }
  return null;
}

/**
 * Molduras de slot dentro de `area`. A moldura, medida: linha escura (17) em
 * cima e à esquerda, e logo dentro um quadrado de 32×32 na cor da moldura —
 * que é a área do sprite. Devolve o canto de dentro.
 *
 * O Stash só desenha slot onde há item; não existe grade de slots vazios.
 */
export function acharSlots(img: Rgba, area: { x: number; y: number; largura: number; altura: number }): { x: number; y: number }[] {
  const W = img.largura;
  const d = img.dados;
  const x0 = Math.max(0, area.x);
  const y0 = Math.max(0, area.y);
  const x1 = Math.min(W - LADO - 1, area.x + area.largura - LADO - 1);
  const y1 = Math.min(img.altura - LADO - 1, area.y + area.altura - LADO - 1);
  const escuro = (x: number, y: number) => luz(d, (y * W + x) * 4) < 40;
  const claro = (x: number, y: number) => ehMoldura(d, (y * W + x) * 4);
  const out: { x: number; y: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!escuro(x, y) || !escuro(x + 1, y) || !escuro(x, y + 1)) continue;
      // Linha escura de cima e da esquerda, inteiras.
      let ok = true;
      for (let k = 0; k <= LADO && ok; k++) ok = escuro(x + k, y) && escuro(x, y + k);
      if (!ok) continue;
      // Moldura: linha de cima e coluna da esquerda. A de baixo e a da
      // direita levam o número por cima e não servem de prova. O sprite pode
      // invadir a moldura — a lâmina do Titan Axe cobre 10 dos 32 pixels de
      // cada lado, a ponta da Mercenary Sword cobre o canto —, por isso basta
      // a maioria; a linha escura inteira dos dois lados é que prova o slot.
      let claros = 0;
      for (let k = 1; k <= LADO; k++) claros += (claro(x + k, y + 1) ? 1 : 0) + (claro(x + 1, y + k) ? 1 : 0);
      if (claros < 2 * LADO * MOLDURA_A_VISTA) continue;
      out.push({ x: x + 1, y: y + 1 });
      x += LADO; // o próximo slot começa pelo menos um slot adiante
    }
  }
  return out;
}

/**
 * Os dígitos da quantidade, medidos nos prints: 8 linhas de altura, brancos
 * com contorno preto. O 7 e o 8 vieram do print de 2026-09-29; antes dele o 8
 * saía "0" (só a cintura difere, e 46 de 48 pixels batiam) e o 7 saía "?".
 * Dígito que não bate com nenhum vira "?".
 */
const DIGITOS: Record<string, string[]> = {
  "0": [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  "1": [".##.", "###.", ".##.", ".##.", ".##.", ".##.", ".##.", "####"],
  "2": [".####.", "##..##", "....##", "...##.", "..##..", ".##...", "##....", "######"],
  "3": [".####.", "##..##", "....##", "..###.", "....##", "....##", "##..##", ".####."],
  "4": ["....#.", "...##.", "..###.", ".#.##.", "#..##.", "######", "....##", "....##"],
  "5": [".#####", ".##...", ".##...", ".####.", "....##", "....##", "##..##", ".####."],
  "6": ["..###.", ".##...", "##....", "#####.", "##..##", "##..##", "##..##", ".####."],
  "7": ["######", "....##", "...##.", "...##.", "..##..", "..##..", ".##...", ".##..."],
  "8": [".####.", "##..##", "##..##", ".####.", "##..##", "##..##", "##..##", ".####."],
  "9": [".####.", "##..##", "##..##", "##..##", ".#####", "....##", "...##.", ".###.."],
};

/**
 * Linha do topo dos dígitos, contada do topo do slot, e as alternativas. No
 * cliente dos prints de 2026-09 os dígitos ocupam as linhas 21–28 e a vírgula
 * desce até a 31; no print de 2026-10-06 (`exemplos/`) tudo vem 1 linha abaixo
 * (22–29). Com a linha fixa, a base do dígito caía onde só a vírgula passa, o
 * número inteiro saía como vírgula, e 186 de 240 quantidades viraram "1".
 * Cada slot tenta as três e fica com a que lê melhor.
 */
const DIGITO_TOPO = 21;
const TOPOS_DO_NUMERO = [21, 22, 20];
const DIGITO_ALTURA = 8;
/** A vírgula desce até 2 linhas abaixo da base dos dígitos. */
const VIRGULA_ABAIXO = 2;

export interface Quantidade {
  /** `null` quando algum dígito não foi reconhecido. */
  valor: number | null;
  /** O que foi lido, com "?" no dígito desconhecido: "3050", "2?5". */
  texto: string;
}

/**
 * Lê o número do slot cujo sprite começa em (`sx`, `sy`). Sem número = 1 unidade.
 *
 * 1. Máscara de texto na faixa do número.
 * 2. Colunas da vírgula saem: as que têm texto abaixo da linha de base dos
 *    dígitos. No "3,050" a vírgula encosta no 3, sem coluna vazia entre eles.
 * 3. O resto é separado em blocos por colunas vazias, e cada bloco é comparado
 *    com os modelos, deslocado até 1 px. Bloco pequeno demais é sujeira do
 *    sprite (pixel branco que caiu na faixa).
 * 4. Bloco que não é dígito nenhum e mostra sinal de sprite sai: branco nas
 *    linhas logo ACIMA dos dígitos (dígito nunca sobe além da linha 21 — o
 *    cabo do Butcher's Axe sobe), ou branco sem o contorno preto que a fonte
 *    sempre tem (o reflexo da Steel Boots). Sem essa prova, bloco desconhecido
 *    continua "?", e a quantidade fica sem valor.
 */
export function lerQuantidade(img: Rgba, sx: number, sy: number): Quantidade {
  let melhor: { texto: string; pontos: number; nota: number } | null = null;
  for (const topo of TOPOS_DO_NUMERO) {
    const l = lerComTopo(img, sx, sy, topo);
    // Mais dígitos reconhecidos, menos "?"; no empate, a nota dos modelos.
    if (!melhor || l.pontos > melhor.pontos || (l.pontos === melhor.pontos && l.nota > melhor.nota)) melhor = l;
  }
  const texto = melhor!.texto;
  if (texto === "") return { valor: 1, texto: "" };
  return { valor: texto.includes("?") ? null : Number(texto), texto };
}

/** Nota mínima (fração de pixels iguais ao molde) para aceitar um dígito. */
const NOTA_DO_DIGITO = 0.85;
/** Fração mínima dos brancos de um dígito com o contorno preto da fonte em volta. */
const CONTORNO_DO_DIGITO = 0.75;
/**
 * Maior vão, em colunas, entre o começo de um dígito e o fim do próximo à
 * esquerda. Os dígitos ocupam células de 7 px; o "1" é estreito e deixa até
 * 5 colunas livres ("157"), e a vírgula soma mais 3 ("3,050").
 */
const VAO_ENTRE_DIGITOS = 6;
const VAO_COM_VIRGULA = 9;

/**
 * `lerQuantidade` supondo os dígitos a partir da linha `topo` do slot.
 *
 * Lê da DIREITA para a esquerda, um dígito por vez: o número é alinhado à
 * direita, e o que fica à esquerda dele é sprite. Cada passo encaixa o melhor
 * molde onde a última coluna com texto termina, pula a vírgula e segue até não
 * achar mais dígito. A primeira versão cortava a faixa em blocos por colunas
 * vazias, e o sprite claro encostado no número juntava dois dígitos num bloco
 * só: o "163" das Encrypted Notes (papel branco) saía "13", e o "524" da
 * Glowing Rune (metal prateado), "52".
 */
export function lerComTopo(img: Rgba, sx: number, sy: number, topo: number): { texto: string; pontos: number; nota: number } {
  const W = img.largura;
  const d = img.dados;
  const branco = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    return r > 170 && g > 170 && b > 170 && Math.abs(r - g) < 8 && Math.abs(g - b) < 8;
  };
  const preto = (x: number, y: number) => luz(d, (y * W + x) * 4) < 40;
  const colunas: boolean[][] = [];
  for (let x = 0; x < LADO; x++) {
    const col: boolean[] = [];
    for (let y = topo; y <= Math.min(LADO - 1, topo + DIGITO_ALTURA - 1 + VIRGULA_ABAIXO); y++) col.push(branco(sx + x, sy + y));
    colunas.push(col);
  }
  const tem = (x: number, y: number) => x >= 0 && x < LADO && y >= 0 && y < colunas[x].length && colunas[x][y];
  const nosDigitos = (x: number) => colunas[x].slice(0, DIGITO_ALTURA).some(Boolean);
  const abaixo = (x: number) => colunas[x].slice(DIGITO_ALTURA).some(Boolean);
  const texto = (x: number) => nosDigitos(x) && !abaixo(x);

  /** Fração dos brancos do retângulo cujos 4 vizinhos são branco ou preto (o contorno da fonte). */
  const contorno = (x0: number, w: number, oy: number) => {
    let brancos = 0;
    let bons = 0;
    for (let x = Math.max(0, x0); x < Math.min(LADO, x0 + w); x++) {
      for (let y = 0; y < DIGITO_ALTURA; y++) {
        const py = sy + topo + y + oy;
        if (!branco(sx + x, py)) continue;
        brancos++;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => branco(sx + x + dx, py + dy) || preto(sx + x + dx, py + dy))) bons++;
      }
    }
    return brancos === 0 ? 0 : bons / brancos;
  };

  let lido = "";
  let notas = 0;
  let cursor = LADO - 1;
  while (cursor >= 0 && !texto(cursor)) cursor--;
  let limite = LADO; // o próximo dígito tem de terminar antes do anterior começar
  while (cursor >= 0) {
    let melhor: { dig: string; x0: number; w: number; oy: number; nota: number } | null = null;
    for (const [dig, modelo] of Object.entries(DIGITOS)) {
      const w = modelo[0].length;
      // O fim do dígito fica até 3 colunas antes do cursor: sprite claro
      // encostado à direita dele (o metal da Glowing Rune) puxa o cursor.
      for (let fim = cursor - 3; fim <= cursor + 1; fim++) {
        const x0 = fim - w + 1;
        if (fim >= limite || x0 < -1) continue;
        for (let oy = -1; oy <= 1; oy++) {
          let iguais = 0;
          for (let y = 0; y < DIGITO_ALTURA; y++) {
            for (let x = 0; x < w; x++) if (tem(x0 + x, y + oy) === (modelo[y][x] === "#")) iguais++;
          }
          const nota = iguais / (w * DIGITO_ALTURA);
          if (!melhor || nota > melhor.nota) melhor = { dig, x0, w, oy, nota };
        }
      }
    }
    if (!melhor || melhor.nota <= NOTA_DO_DIGITO || contorno(melhor.x0, melhor.w, melhor.oy) < CONTORNO_DO_DIGITO) {
      // Não é dígito conhecido. Se tem o contorno da fonte, é um dígito que o
      // molde não pegou: "?", e a quantidade fica sem valor em vez de errada.
      // Reflexo do sprite (o brilho da Spiked Iron Ball) também tem contorno
      // escuro, mas é 1 ou 2 pixels; dígito tem pelo menos 8.
      let brancos = 0;
      for (let x = Math.max(0, cursor - 5); x <= cursor; x++) brancos += colunas[x].slice(0, DIGITO_ALTURA).filter(Boolean).length;
      if (brancos >= 8 && contorno(cursor - 5, 6, 0) >= 0.8) lido = "?" + lido;
      break;
    }
    lido = melhor.dig + lido;
    notas += melhor.nota;
    limite = melhor.x0;
    let c = melhor.x0 - 1;
    let virgula = false;
    while (c >= 0 && !texto(c)) {
      if (abaixo(c)) virgula = true;
      c--;
    }
    if (c < 0 || melhor.x0 - c > (virgula ? VAO_COM_VIRGULA : VAO_ENTRE_DIGITOS)) break;
    cursor = c;
  }
  const desconhecidos = lido.split("?").length - 1;
  return { texto: lido, pontos: lido.length - 3 * desconhecidos, nota: notas };
}

export interface SlotLido {
  /** Canto do sprite no print, para a tela marcar. */
  x: number;
  y: number;
  /** `null` = não reconhecido. */
  item: number | null;
  erro: number | null;
  quantidade: Quantidade;
  /**
   * O slot está cortado pela rolagem, no topo ou no pé da lista. O item foi
   * lido pela parte à vista; se o corte levou o número, a quantidade é `null`.
   */
  parcial: boolean;
}

export interface Leitura {
  /** A janela do Stash no print; `null` = não achada. */
  janela: { x: number; y: number; largura: number; altura: number } | null;
  slots: SlotLido[];
  /** 1 = interface a 100%; 2 = a 200%, lida reduzindo o print à metade. */
  escala: 1 | 2;
}

/** A área visível da lista: a borda escura de cima e da esquerda, e onde ela acaba. */
function acharLista(img: Rgba, t: { x: number; y: number }): { x: number; y: number; fundo: number } | null {
  const W = img.largura;
  const d = img.dados;
  const escuro = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < img.altura && luz(d, (y * W + x) * 4) < 40;
  // A medida pode variar um pixel ou dois entre versões do cliente: procura em volta.
  for (let ey = -3; ey <= 3; ey++) {
    for (let ex = -3; ex <= 3; ex++) {
      const x = t.x + LISTA.dx + ex;
      const y = t.y + LISTA.dy + ey;
      if (!escuro(x, y) || !escuro(x, y + 20) || !escuro(x + 100, y) || !escuro(x + 400, y)) continue;
      let fundo = y + 1;
      while (escuro(x, fundo)) fundo++;
      if (fundo - y < LISTA.passo) continue;
      return { x, y, fundo: fundo - 1 };
    }
  }
  return null;
}

/**
 * Na região do título, a partir de (`X`, `Y`), os pixels andam em pares iguais —
 * na horizontal e na vertical? É o sinal de que (`X`, `Y`) começa um bloco 2×2.
 */
function alinhadoAosBlocos(img: Rgba, X: number, Y: number): boolean {
  const d = img.dados;
  const igual = (a: number, b: number) => d[a] === d[b] && d[a + 1] === d[b + 1] && d[a + 2] === d[b + 2];
  let pares = 0;
  let iguais = 0;
  for (let y = 0; y < TITULO.length * 2; y += 2) {
    for (let x = 0; x < TITULO[0].length * 2; x += 2) {
      const o = ((Y + y) * img.largura + X + x) * 4;
      if (X + x + 1 >= img.largura || Y + y + 1 >= img.altura) continue;
      pares += 2;
      if (igual(o, o + 4)) iguais++;
      if (igual(o, o + img.largura * 4)) iguais++;
    }
  }
  return pares > 0 && iguais / pares > 0.95;
}

/** O print reduzido à metade, pegando um pixel de cada bloco 2×2 (fase `fx`, `fy`). */
function reduzir(img: Rgba, fx: number, fy: number): Rgba {
  const L = Math.floor((img.largura - fx) / 2);
  const A = Math.floor((img.altura - fy) / 2);
  const dados = new Uint8ClampedArray(L * A * 4);
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      const o = ((2 * y + fy) * img.largura + 2 * x + fx) * 4;
      dados.set(img.dados.subarray(o, o + 4), (y * L + x) * 4);
    }
  }
  return { largura: L, altura: A, dados };
}

function lerComTitulo(img: Rgba, t: { x: number; y: number }, sprites: readonly SpritePreparado[]): Omit<Leitura, "escala"> {
  const lista = acharLista(img, t);
  if (!lista) return { janela: null, slots: [] };
  const janela = {
    x: lista.x + JANELA.dx,
    y: t.y + JANELA.dyTitulo,
    largura: JANELA.largura,
    altura: lista.fundo + JANELA.abaixoDaLista - (t.y + JANELA.dyTitulo),
  };
  // Área de conteúdo: entre as bordas da lista, exclusive.
  const topo = lista.y + 1;
  const pe = lista.fundo - 1;
  const esquerda = lista.x + LISTA.margem;

  // As linhas inteiras dão a fase da rolagem: em que pixel começa cada linha.
  const inteiros = acharSlots(img, { x: lista.x + 1, y: topo, largura: LISTA.largura, altura: pe - topo + 1 });
  if (inteiros.length === 0) return { janela, slots: [] };
  const votos = new Map<number, number>();
  for (const s of inteiros) {
    const f = (((s.y - (lista.y + LISTA.margem)) % LISTA.passo) + LISTA.passo) % LISTA.passo;
    votos.set(f, (votos.get(f) ?? 0) + 1);
  }
  const fase = [...votos].sort((a, b) => b[1] - a[1])[0][0];
  const inteiro = new Set(inteiros.map((s) => `${s.x},${s.y}`));

  const W = img.largura;
  const escuro = (x: number, y: number) => luz(img.dados, (y * W + x) * 4) < 40;
  const claro = (x: number, y: number) => ehMoldura(img.dados, (y * W + x) * 4);

  const slots: SlotLido[] = [];
  for (let sy = lista.y + LISTA.margem + fase - LISTA.passo; sy <= pe; sy += LISTA.passo) {
    const v0 = Math.max(sy, topo);
    const v1 = Math.min(sy + LADO - 1, pe);
    if (v1 - v0 + 1 < 8) continue; // uma lasca de slot não decide nada
    const parcial = sy < topo || sy + LADO - 1 > pe;
    for (let c = 0; c < LISTA.colunas; c++) {
      const sx = esquerda + c * LISTA.passo;
      if (!parcial) {
        if (!inteiro.has(`${sx},${sy}`)) continue;
      } else {
        // O Stash só desenha slot onde há item. Na parte à vista, a moldura:
        // linha escura à esquerda e, logo dentro, a clara (o número pode
        // passar por cima dela no pé do slot).
        let escuros = 0;
        let claros = 0;
        for (let y = v0; y <= v1; y++) {
          if (escuro(sx - 1, y)) escuros++;
          if (claro(sx, y)) claros++;
        }
        const h = v1 - v0 + 1;
        if (escuros < h || claros < h * MOLDURA_A_VISTA) continue;
      }
      const r = reconhecerSlot(img, sx, sy, sprites, { y0: v0, y1: v1 });
      // O número ocupa as linhas 21 a 31 do slot: só se lê se estiverem à vista.
      const numeroInteiro = sy + LADO - 1 <= pe && sy + DIGITO_TOPO >= topo;
      slots.push({
        x: sx,
        y: sy,
        item: r?.item ?? null,
        erro: r?.erro ?? null,
        quantidade: numeroInteiro ? lerQuantidade(img, sx, sy) : { valor: null, texto: "" },
        parcial,
      });
    }
  }
  return { janela, slots };
}

/**
 * O print inteiro: janela, slots, item e quantidade de cada um.
 *
 * A janela pode estar em qualquer lugar e o print pode ter qualquer tamanho:
 * o título é procurado na imagem toda. Se não aparecer a 100%, tenta a 200% —
 * reduzindo o print à metade nas quatro fases possíveis de um bloco 2×2 — e
 * devolve as coordenadas já no tamanho original. Supõe que o cliente amplia
 * sem suavizar (cada pixel vira um bloco 2×2 idêntico); escala fracionária
 * (125%, 150%) suaviza e não é lida.
 */
export function lerPrint(img: Rgba, sprites: readonly SpritePreparado[]): Leitura {
  const t = acharTitulo(img);
  if (t) return { ...lerComTitulo(img, t, sprites), escala: 1 };
  for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const meia = reduzir(img, fx, fy);
    const tm = acharTitulo(meia);
    // Sem suavização, qualquer fase lê a imagem; só a alinhada aos blocos 2×2
    // devolve as coordenadas certas. As outras saem 1 px tortas.
    if (!tm || !alinhadoAosBlocos(img, 2 * tm.x + fx, 2 * tm.y + fy)) continue;
    const l = lerComTitulo(meia, tm, sprites);
    return {
      janela: l.janela && {
        x: l.janela.x * 2 + fx,
        y: l.janela.y * 2 + fy,
        largura: l.janela.largura * 2,
        altura: l.janela.altura * 2,
      },
      slots: l.slots.map((s) => ({ ...s, x: s.x * 2 + fx, y: s.y * 2 + fy })),
      escala: 2,
    };
  }
  return { janela: null, slots: [], escala: 1 };
}
