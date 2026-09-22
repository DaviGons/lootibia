import { DENOMINACAO, moedaDe, separarLoot, valorDasMoedas } from "./moedas.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== o conjunto e FECHADO: exatamente tres moedas");
ok("sao tres", Object.keys(DENOMINACAO).length, 3);
ok("denominacoes", Object.values(DENOMINACAO), [1, 100, 10000]);

console.log("\n== reconhece as tres");
ok("gold coin", moedaDe("gold coin"), 1);
ok("platinum coin", moedaDe("platinum coin"), 100);
ok("crystal coin", moedaDe("crystal coin"), 10000);

console.log("\n== plural nao pode fazer dinheiro sumir");
// O parser nao resolve plural (lib/huntSession.ts). Se o jogo escrever
// "2x gold coins", tratar como nao-moeda perderia dinheiro EM SILENCIO.
ok("gold coins", moedaDe("gold coins"), 1);
ok("platinum coins", moedaDe("platinum coins"), 100);
ok("crystal coins", moedaDe("crystal coins"), 10000);

console.log("\n== nada mais e moeda, e isso e o ponto");
// gold ingot vale 10.000 e e a armadilha obvia: voce VENDE a um NPC, nao gasta.
ok("gold ingot NAO e moeda", moedaDe("gold ingot"), null);
ok("platinum amulet NAO e moeda", moedaDe("platinum amulet"), null);
ok("crystal ring NAO e moeda", moedaDe("crystal ring"), null);
ok("crystal sword NAO e moeda", moedaDe("crystal sword"), null);
ok("golden figurine NAO e moeda", moedaDe("golden figurine"), null);
ok("great mana potion NAO e moeda", moedaDe("great mana potion"), null);
// 'coins' sozinho nao existe como item; nao pode virar gold coin por acidente.
ok("'coins' sozinho nao e moeda", moedaDe("coins"), null);

console.log("\n== soma, com os numeros reais da sessao 28");
const sessao28 = [
  { nome: "gold coin", quantidade: 61862 },
  { nome: "platinum coin", quantidade: 1667 },
  { nome: "great mana potion", quantidade: 234 },
  { nome: "gold ingot", quantidade: 7 },
];
// 61.862 + 166.700 = 228.562. A potion e o ingot nao entram.
ok("valor das moedas", valorDasMoedas(sessao28), 228562);
ok("lista vazia da zero", valorDasMoedas([]), 0);
ok("lista sem moeda da zero", valorDasMoedas([{ nome: "soul orb", quantidade: 170 }]), 0);

console.log("\n== separacao, sessao 28 real (loot 1.381.597, supplies 179.668)");
const s28 = separarLoot(1381597, 179668, sessao28);
ok("moedas", s28.moedas, 228562);
ok("itens (o resto)", s28.itens, 1153035);
ok("moedas + itens = loot", s28.moedas + s28.itens, 1381597);
ok("profit", s28.profit, 1201929);
ok("caixa = moedas - supplies", s28.caixa, 48894);
ok("supplies vem junto, para a tela nao divergir", s28.supplies, 179668);
ok("consistente", s28.consistente, true);

console.log("\n== a hunt que o profit esconde: sessao 26 real");
// Profit de 2.305.437 com caixa NEGATIVO. Consumiu mais supply do que caiu de
// moeda: so fica positiva depois de vender o loot.
const s26 = separarLoot(2828026, 522589, [
  { nome: "gold coin", quantidade: 123534 },
  { nome: "platinum coin", quantidade: 3444 },
]);
ok("moedas", s26.moedas, 467934);
ok("profit e alto", s26.profit, 2305437);
ok("mas o caixa e NEGATIVO", s26.caixa, -54655);
ok("e o caixa negativo nao torna o dado inconsistente", s26.consistente, true);

console.log("\n== A INVARIANTE que a tela exibe: as duas metades somam o profit");
// caixa + itens = (moedas - supplies) + (loot - moedas) = loot - supplies.
// A tela PROMETE essa soma ao usuario, entao ela tem de valer sempre: com caixa
// negativo, sem moeda nenhuma, sem supplies, e com profit negativo.
const casos: [string, number, number, { nome: string; quantidade: number }[]][] = [
  ["sessao 28", 1381597, 179668, sessao28],
  ["sessao 26 (caixa negativo)", 2828026, 522589, [
    { nome: "gold coin", quantidade: 123534 },
    { nome: "platinum coin", quantidade: 3444 },
  ]],
  ["sem moeda alguma", 50000, 10000, [{ nome: "soul orb", quantidade: 3 }]],
  ["sem supplies", 90000, 0, [{ nome: "crystal coin", quantidade: 5 }]],
  ["tudo zero", 0, 0, []],
  ["profit negativo", 1000, 9000, [{ nome: "gold coin", quantidade: 100 }]],
];
for (const [nome, loot, supplies, itens] of casos) {
  const r = separarLoot(loot, supplies, itens);
  ok(`  ${nome}`, r.caixa + r.itens, r.profit);
}

console.log("\n== dado inconsistente e sinalizado, nao escondido");
// Moeda acima do loot nao deveria existir; se existir, quem chama precisa saber
// em vez de receber um "a vender" negativo com cara de normal.
const ruim = separarLoot(1000, 0, [{ nome: "crystal coin", quantidade: 1 }]);
ok("consistente = false", ruim.consistente, false);
ok("e o numero nao e mascarado", ruim.itens, -9000);

console.log("\n== sem moeda nenhuma: tudo e mercadoria");
const seco = separarLoot(50000, 10000, [{ nome: "demonic essence", quantidade: 110 }]);
ok("moedas zero", seco.moedas, 0);
ok("itens = loot", seco.itens, 50000);
ok("caixa = -supplies", seco.caixa, -10000);
ok("consistente", seco.consistente, true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
