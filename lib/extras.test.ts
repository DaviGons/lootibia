import { somarExtras } from "./extras.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

const PRECO = 44800; // o preco de TC configurado pelo Davi

console.log("== lista vazia");
ok("tudo zero", somarExtras([], PRECO), { gp: 0, contados: 0, semPreco: 0 });
ok("sem preco tambem", somarExtras([], null), { gp: 0, contados: 0, semPreco: 0 });

console.log("\n== so gp: o preco da TC nem entra na conta");
const soGp = [
  { item: "falcon coif", valor: 30_000_000, unidade: "gp" as const },
  { item: "cat's paw", valor: 2_000_000, unidade: "gp" as const },
];
ok("soma com preco", somarExtras(soGp, PRECO), { gp: 32_000_000, contados: 2, semPreco: 0 });
ok("soma SEM preco", somarExtras(soGp, null), { gp: 32_000_000, contados: 2, semPreco: 0 });

console.log("\n== so TC: converte pelo preco do mundo");
const soTc = [
  { item: "falcon coif", valor: 500, unidade: "tc" as const },
  { item: "gnome armor", valor: 100, unidade: "tc" as const },
];
// 600 TC x 44.800 = 26.880.000
ok("converte", somarExtras(soTc, PRECO), { gp: 26_880_000, contados: 2, semPreco: 0 });

console.log("\n== SEM preco da TC, o extra em TC nao vira zero: vira DESCONHECIDO");
// Somar 0 mentiria um total menor sem avisar. Ficam de fora e sao contados.
ok("nenhum entra", somarExtras(soTc, null), { gp: 0, contados: 0, semPreco: 2 });
ok("preco zero conta como nao configurado", somarExtras(soTc, 0), { gp: 0, contados: 0, semPreco: 2 });

console.log("\n== misturado, sem preco: gp soma, TC fica de fora");
const misto = [
  { item: "falcon coif", valor: 30_000_000, unidade: "gp" as const },
  { item: "gnome armor", valor: 100, unidade: "tc" as const },
];
ok("so o gp entra", somarExtras(misto, null), { gp: 30_000_000, contados: 1, semPreco: 1 });
ok("com preco, os dois entram", somarExtras(misto, PRECO), {
  gp: 30_000_000 + 100 * PRECO,
  contados: 2,
  semPreco: 0,
});

console.log("\n== contados + semPreco = total da lista, SEMPRE");
// A tela mostra os dois numeros; se essa soma nao fechar, ela esconde parcela.
for (const [nome, lista, preco] of [
  ["so gp", soGp, PRECO],
  ["so tc sem preco", soTc, null],
  ["misto sem preco", misto, null],
  ["misto com preco", misto, PRECO],
  ["vazia", [], null],
] as const) {
  const r = somarExtras(lista, preco);
  ok(`  ${nome}`, r.contados + r.semPreco, lista.length);
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
