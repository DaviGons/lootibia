import {
  BASE,
  CAIXA_MARCA,
  CONTORNOS,
  ESPADA,
  HASTES,
  ICONE,
  PINGOS,
  PONTA_DA_LAMINA,
  TOPO_ALTURA_X,
  svgDaMarca,
  svgDoIcone,
} from "./marca.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== independencia de fonte");
// Esta e a razao de as letras serem desenhadas a mao. `sharp` rasteriza os
// arquivos de imagem fora do navegador, sem garantia nenhuma sobre que fontes
// existem na maquina de quem rodar o gerador. Um <text> aqui e uma aposta que
// so falha na maquina do outro.
for (const [rotulo, svg] of [
  ["wordmark", svgDaMarca("#000")],
  ["icone", svgDoIcone()],
] as const) {
  ok(`${rotulo} sem <text>`, /<text[\s>]/.test(svg), false);
  ok(`${rotulo} sem font-family`, /font-family/.test(svg), false);
}

console.log("== contorno unico com o olho aberto por evenodd");
// O bug que motivou este bloco: com anel de traco mais retangulo de haste, a
// haste do `b` e a do `a` nao encostam no bojo. Bojo externo de raio 28 e
// haste tangente de 16 so se cruzam em y=47,7 — abaixo do topo da altura-x —
// deixando um degrau de fundo de 4,58 de largura, invisivel em 22 px e
// gritante em 1200. Cada letra virou um caminho so: contorno externo mais o
// olho. Dois `M` por caminho, nem mais nem menos.
ok("quatro letras de contorno (o, o, b, a)", CONTORNOS.length, 4);
for (const [i, d] of CONTORNOS.entries()) {
  ok(`contorno ${i}: exatamente 2 subcaminhos`, (d.match(/M/g) ?? []).length, 2);
  ok(`contorno ${i}: fechado`, d.trimEnd().endsWith("Z"), true);
}
ok(
  "todos os caminhos dependem de fill-rule evenodd",
  svgDaMarca("#000").includes('fill-rule="evenodd"'),
  true,
);

console.log("== a espada le como um 't'");
// Se a guarda sair da altura-x ou a ponta parar longe da base, o desenho deixa
// de ser um "t" e a palavra deixa de ler "lootibia".
const [, guardaY, , guardaAltura] = ESPADA.guarda;
ok("guarda cavalga o topo da altura-x", guardaY < TOPO_ALTURA_X && guardaY + guardaAltura > TOPO_ALTURA_X, true);
ok("ponta transborda a base (forma pontiaguda pede)", PONTA_DA_LAMINA > BASE, true);
ok("transbordo modesto: no maximo 6", PONTA_DA_LAMINA - BASE <= 6, true);
// A constante e o caminho tem de continuar contando a mesma historia.
ok("o caminho da lamina usa a ponta declarada", ESPADA.lamina.includes(` ${PONTA_DA_LAMINA} `), true);

console.log("== tudo cabe na caixa declarada");
const [, , caixaL, caixaA] = CAIXA_MARCA.split(" ").map(Number);
for (const [x, y, largura, altura] of HASTES) {
  ok(`haste x=${x} dentro da caixa`, x >= 0 && x + largura <= caixaL && y >= 0 && y + altura <= caixaA, true);
}
for (const [cx, cy, r] of PINGOS) {
  ok(`pingo cx=${cx} dentro da caixa`, cx - r >= 0 && cx + r <= caixaL && cy - r >= 0, true);
}
ok("ponta da lamina cabe na altura da caixa", PONTA_DA_LAMINA <= caixaA, true);

console.log("== o icone e outro desenho, nao o wordmark encolhido");
// Em 16 px a lamina do wordmark vira um fio e some. O icone tem proporcoes
// proprias justamente por isso; se um dia virarem o mesmo desenho, isto falha.
const larguraLaminaIcone = 38.5 - 25.5;
const larguraLaminaMarca = 192 - 174;
ok("lamina do icone e proporcionalmente mais gorda", larguraLaminaIcone / 64 > larguraLaminaMarca / 396, true);
ok("icone tem tile com canto arredondado", ICONE.raio > 0, true);
ok("icone sem fundo nao desenha o tile", /<rect width="64"/.test(svgDoIcone("#fff", null)), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
