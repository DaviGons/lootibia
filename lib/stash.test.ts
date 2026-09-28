import sharp from "sharp";
import { ATLAS, ITENS_DO_STASH } from "./dados/stash.ts";
import {
  FUNDO_DO_SLOT,
  LADO,
  acharTitulo,
  juntarPrints,
  lerPrint,
  prepararSprites,
  reconhecerSlot,
  type Rgba,
} from "./stash.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

// O atlas de verdade, o mesmo que vai para o navegador.
const { data, info } = await sharp(`public${ATLAS.url}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const atlas: Rgba = { largura: info.width, altura: info.height, dados: data };

const donos: number[] = [];
ITENS_DO_STASH.forEach((it, i) => it[5].forEach((s) => (donos[s] = i)));
const sprites = prepararSprites(atlas, ATLAS.colunas, donos);

console.log("== base");
ok("atlas do tamanho declarado", [atlas.largura, atlas.altura], [ATLAS.largura, ATLAS.altura]);
ok("todo sprite tem dono", donos.length === donos.filter((d) => d !== undefined).length, true);
console.log(`     ${ITENS_DO_STASH.length} itens, ${donos.length} sprites, ${sprites.length} utilizáveis`);

// Gerador pseudoaleatório fixo: o teste sorteia os mesmos sprites em toda máquina.
let semente = 12345;
const sorteio = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/**
 * Slot vazio: o fundo medido do cliente, com ±4 de ruído (a parte central da
 * tabela é estimada, e o teste não pode depender de ela ser exata), numa
 * margem cinza de 4 px.
 */
function slotVazio(): Rgba {
  const L = 40;
  const dados = new Uint8ClampedArray(L * L * 4);
  for (let i = 0; i < L * L; i++) dados.set([72, 72, 73, 255], i * 4);
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const v = FUNDO_DO_SLOT[y * LADO + x] + Math.floor(sorteio() * 9) - 4;
      dados.set([v, v, v, 255], ((4 + y) * L + 4 + x) * 4);
    }
  }
  return { largura: L, altura: L, dados };
}

/** Cola o sprite `s` com alpha no slot, na posição (4+dx, 4+dy), e desenha um "1" no canto. */
function comSprite(s: number, dx: number, dy: number): Rgba {
  const img = slotVazio();
  const ox = (s % ATLAS.colunas) * LADO;
  const oy = Math.floor(s / ATLAS.colunas) * LADO;
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const a = ((oy + y) * atlas.largura + ox + x) * 4;
      const al = atlas.dados[a + 3] / 255;
      const d = ((4 + dy + y) * img.largura + 4 + dx + x) * 4;
      for (let c = 0; c < 3; c++) img.dados[d + c] = atlas.dados[a + c] * al + img.dados[d + c] * (1 - al);
    }
  }
  // A quantidade como o cliente desenha: dígito branco 191 com contorno preto,
  // nas linhas 21–28 do slot. Um "1" de 2 px de largura no canto direito.
  for (let y = 21; y <= 28; y++) {
    for (const x of [26, 29]) img.dados.set([0, 0, 0], ((4 + y) * img.largura + 4 + x) * 4);
    for (const x of [27, 28]) img.dados.set([191, 191, 191], ((4 + y) * img.largura + 4 + x) * 4);
  }
  return img;
}

/** Dois sprites com os mesmos pixels são indistinguíveis por definição. */
function mesmoDesenho(a: number, b: number): boolean {
  const pa = [(a % ATLAS.colunas) * LADO, Math.floor(a / ATLAS.colunas) * LADO];
  const pb = [(b % ATLAS.colunas) * LADO, Math.floor(b / ATLAS.colunas) * LADO];
  for (let y = 0; y < LADO; y++) {
    for (let x = 0; x < LADO; x++) {
      const ia = ((pa[1] + y) * atlas.largura + pa[0] + x) * 4;
      const ib = ((pb[1] + y) * atlas.largura + pb[0] + x) * 4;
      for (let c = 0; c < 4; c++) if (Math.abs(atlas.dados[ia + c] - atlas.dados[ib + c]) > 8) return false;
    }
  }
  return true;
}

console.log("== reconhecimento, 300 sprites sorteados");
const N = 300;
let certos = 0;
let gemeos = 0;
const erros: string[] = [];
const t0 = performance.now();
for (let k = 0; k < N; k++) {
  const s = Math.floor(sorteio() * donos.length);
  const dx = Math.floor(sorteio() * 3) - 1;
  const dy = Math.floor(sorteio() * 3) - 1;
  const r = reconhecerSlot(comSprite(s, dx, dy), 4, 4, sprites);
  if (r?.item === donos[s]) certos++;
  else if (r && ITENS_DO_STASH[r.item][5].some((t) => mesmoDesenho(t, s))) gemeos++;
  else erros.push(`${ITENS_DO_STASH[donos[s]][0]} -> ${r ? ITENS_DO_STASH[r.item][0] : "nada"}`);
}
const ms = (performance.now() - t0) / N;
console.log(`     ${certos} certos, ${gemeos} gêmeos (mesmo desenho), ${erros.length} errados, ${ms.toFixed(1)} ms por slot`);
if (erros.length) console.log(`     errados: ${erros.slice(0, 10).join(" | ")}`);
ok("98% ou mais certos, contando gêmeos", (certos + gemeos) / N >= 0.98, true);
// 20 linhas × 14 colunas visíveis = 280 slots; 30 ms cada = 8 s num print cheio.
ok("menos de 30 ms por slot", ms < 30, true);

console.log("== slot vazio não vira item");
ok("fundo liso", reconhecerSlot(slotVazio(), 4, 4, sprites), null);

console.log("== fundo do slot contra o print");
const print = await sharp("test/fixtures/stash/2026-09-28-stash.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const tela: Rgba = { largura: print.info.width, altura: print.info.height, dados: print.data };
// Linha de cima e coluna da esquerda do primeiro slot, acima do número: nem
// sprite nem o "3" de "3,050" passam por ali.
let iguais = 0;
let conferidos = 0;
for (let k = 0; k < LADO; k++) {
  for (const [x, y] of [[k, 1], [1, k]]) {
    if (y >= 20) continue;
    const i = ((331 + y) * tela.largura + 46 + x) * 4;
    conferidos++;
    if (Math.abs(tela.dados[i] - FUNDO_DO_SLOT[y * LADO + x]) <= 1) iguais++;
  }
}
ok("borda do fundo igual ao print", iguais, conferidos);

console.log("== o print de verdade (test/fixtures/stash)");
ok("título achado", acharTitulo(tela), { x: 403, y: 271 });
const t1 = performance.now();
const leitura = lerPrint(tela, sprites);
const msPrint = performance.now() - t1;
ok("janela", leitura.janela, { x: 25, y: 268, largura: 788, altura: 544 });
ok(
  "os três itens e as três quantidades",
  leitura.slots.map((s) => [s.item === null ? null : ITENS_DO_STASH[s.item][0], s.quantidade.valor]),
  [["Brown Mushroom", 3050], ["Supreme Health Potion", 265], ["Ultimate Health Potion", 914]],
);
ok("as mochilas abertas ao lado não viram item", leitura.slots.length, 3);
console.log(`     ${msPrint.toFixed(0)} ms no print inteiro de ${tela.largura}×${tela.altura}`);
ok("menos de 1,5 s no print inteiro", msPrint < 1500, true);

// ---------------------------------------------------------------------------
// Robustez: outras telas, outras posições, 200% e linhas cortadas. Tudo
// montado a partir do print real, recortando e colando a janela.
// ---------------------------------------------------------------------------

const ESPERADO = [["Brown Mushroom", 3050], ["Supreme Health Potion", 265], ["Ultimate Health Potion", 914]];
const nomesEQuantidades = (l: ReturnType<typeof lerPrint>) =>
  l.slots.map((s) => [s.item === null ? null : ITENS_DO_STASH[s.item][0], s.quantidade.valor]);

/** Tela vazia de fundo cinza com ruído, do tamanho pedido. */
function telaVazia(L: number, A: number): Rgba {
  const dados = new Uint8ClampedArray(L * A * 4);
  for (let i = 0; i < L * A; i++) {
    const v = 30 + Math.floor(sorteio() * 60);
    dados.set([v, v, v, 255], i * 4);
  }
  return { largura: L, altura: A, dados };
}

/** Copia o retângulo `r` de `de` para `para`, com o canto em (`x`, `y`) e ampliação `k`. */
function colar(de: Rgba, r: { x: number; y: number; largura: number; altura: number }, para: Rgba, x: number, y: number, k = 1) {
  for (let yy = 0; yy < r.altura * k; yy++) {
    for (let xx = 0; xx < r.largura * k; xx++) {
      const o = ((r.y + Math.floor(yy / k)) * de.largura + r.x + Math.floor(xx / k)) * 4;
      para.dados.set(de.dados.subarray(o, o + 4), ((y + yy) * para.largura + x + xx) * 4);
    }
  }
}

const JANELA_NO_PRINT = { x: 25, y: 268, largura: 788, altura: 544 };

console.log("== a janela em outras telas e posições");
for (const [L, A, x, y] of [
  [1366, 768, 0, 0],
  [1366, 768, 1366 - 788, 768 - 544],
  [1920, 1080, 17, 503],
  [2560, 1440, 1701, 883],
]) {
  const t = telaVazia(L, A);
  colar(tela, JANELA_NO_PRINT, t, x, y);
  const l = lerPrint(t, sprites);
  ok(`${L}×${A}, janela em (${x}, ${y})`, [l.janela?.x, l.janela?.y, nomesEQuantidades(l)], [x, y, ESPERADO]);
}

console.log("== interface a 200%");
{
  const t = telaVazia(3840, 2160);
  colar(tela, JANELA_NO_PRINT, t, 1001, 457, 2); // posição ímpar: testa a fase do bloco 2×2
  const l = lerPrint(t, sprites);
  ok("4K a 200%, posição ímpar", [l.escala, l.janela?.x, l.janela?.y, nomesEQuantidades(l)], [2, 1001, 457, ESPERADO]);
}

console.log("== linhas cortadas pela rolagem");
/**
 * A lista "rolada": o conteúdo apagado (copiando uma linha vazia da própria
 * lista) e a linha de itens colada em `linhas` (topo da moldura escura), com
 * corte na área visível, como a rolagem faz.
 */
function rolada(linhas: number[]): Rgba {
  const t: Rgba = { largura: tela.largura, altura: tela.altura, dados: Uint8ClampedArray.from(tela.dados) };
  const [topo, pe, esq, dir] = [327, 753, 42, 784];
  for (let y = topo; y <= pe; y++) colar(tela, { x: esq, y: 700, largura: dir - esq + 1, altura: 1 }, t, esq, y);
  for (const y0 of linhas) {
    for (let k = 0; k < 34; k++) {
      const y = y0 + k;
      if (y >= topo && y <= pe) colar(tela, { x: esq, y: 330 + k, largura: dir - esq + 1, altura: 1 }, t, esq, y);
    }
  }
  return t;
}
/** Cortado pode ficar sem item; o que não pode é virar o item ERRADO. */
function semItemErrado(l: ReturnType<typeof lerPrint>, parciais: boolean) {
  return l.slots
    .filter((s) => s.parcial === parciais)
    .every((s, i) => s.item === null || ITENS_DO_STASH[s.item][0] === ESPERADO[i % 3][0]);
}
{
  // Linha de cima cortada em 12 px; a de baixo, inteira, dá a fase.
  const l = lerPrint(rolada([318, 355]), sprites);
  const cortados = l.slots.filter((s) => s.parcial);
  ok("topo: 3 inteiros lidos certo", nomesEQuantidades({ ...l, slots: l.slots.filter((s) => !s.parcial) }), ESPERADO);
  ok("topo: 3 cortados achados", cortados.length, 3);
  ok("topo: nenhum cortado vira item errado", semItemErrado(l, true), true);
  // O número fica no pé do slot: cortado em cima, ele continua inteiro.
  ok("topo: quantidades dos cortados lidas", cortados.map((s) => s.quantidade.valor), [3050, 265, 914]);
  console.log(`     topo: ${cortados.filter((s) => s.item !== null).length} de 3 cortados reconhecidos`);
}
{
  // Linha de baixo cortada: só 21 linhas à vista, o número fica de fora.
  const l = lerPrint(rolada([695, 732]), sprites);
  const cortados = l.slots.filter((s) => s.parcial);
  ok("pé: 3 inteiros lidos certo", nomesEQuantidades({ ...l, slots: l.slots.filter((s) => !s.parcial) }), ESPERADO);
  ok("pé: 3 cortados achados", cortados.length, 3);
  ok("pé: nenhum cortado vira item errado", semItemErrado(l, true), true);
  ok("pé: sem número, sem quantidade", cortados.map((s) => s.quantidade.valor), [null, null, null]);
  console.log(`     pé: ${cortados.filter((s) => s.item !== null).length} de 3 cortados reconhecidos`);
}

console.log("== juntar prints");
ok(
  "mesmo item em dois prints não soma",
  juntarPrints([[{ item: 1, quantidade: 50 }], [{ item: 1, quantidade: 50 }, { item: 2, quantidade: 3 }]]),
  { itens: [{ item: 1, quantidade: 50 }, { item: 2, quantidade: 3 }], divergentes: [] },
);
ok(
  "quantidades diferentes: fica a maior e avisa",
  juntarPrints([[{ item: 7, quantidade: 120 }], [{ item: 7, quantidade: 12 }]]),
  { itens: [{ item: 7, quantidade: 120 }], divergentes: [7] },
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
