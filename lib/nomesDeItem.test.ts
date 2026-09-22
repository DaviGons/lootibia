import { MINUSCULAS, tituloDeItem, variantesDeTitulo } from "./nomesDeItem.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== o caso simples");
ok("great mana potion", tituloDeItem("great mana potion"), "Great Mana Potion");
ok("gold coin", tituloDeItem("gold coin"), "Gold Coin");
ok("uma palavra so", tituloDeItem("boots"), "Boots");

console.log("\n== PREPOSICAO: os 6 do banco, todos conferidos contra a API (200)");
// `Wand Of Inferno` responde 404 e `Wand of Inferno` responde 200 — Title Case
// ingenuo quebraria em todos estes.
for (const [cru, titulo] of [
  ["boots of haste", "Boots of Haste"],
  ["cluster of solace", "Cluster of Solace"],
  ["flask of demonic blood", "Flask of Demonic Blood"],
  ["piece of hell steel", "Piece of Hell Steel"],
  ["red piece of cloth", "Red Piece of Cloth"],
  ["wand of inferno", "Wand of Inferno"],
] as const) {
  ok(`  ${cru}`, tituloDeItem(cru), titulo);
}

console.log("\n== a preposicao NA PRIMEIRA palavra continua maiuscula");
// Nenhum item do banco comeca com preposicao, mas a regra so e correta assim:
// titulo comeca com maiuscula, sempre.
ok("of the dead", tituloDeItem("of the dead"), "Of the Dead");
ok("the dead", tituloDeItem("the dead"), "The Dead");

console.log("\n== APOSTROFO: o miolo nao pode ser tocado");
for (const [cru, titulo] of [
  ["butcher's axe", "Butcher's Axe"],
  ["cat's paw", "Cat's Paw"],
  ["lion's mane", "Lion's Mane"],
  ["spellweaver's robe", "Spellweaver's Robe"],
] as const) {
  ok(`  ${cru}`, tituloDeItem(cru), titulo);
}

console.log("\n== NOME JA PLURAL fica como esta — nao existe singularizacao aqui");
// Medido: o jogo escreve item no SINGULAR ("413x a great mana potion"), entao
// um `s` no fim faz parte do nome. `Steel Boots` e `Terra Legs` respondem 200.
for (const [cru, titulo] of [
  ["steel boots", "Steel Boots"],
  ["terra legs", "Terra Legs"],
  ["silencer claws", "Silencer Claws"],
  ["damaged armor plates", "Damaged Armor Plates"],
  ["oriental shoes", "Oriental Shoes"],
] as const) {
  ok(`  ${cru}`, tituloDeItem(cru), titulo);
}

console.log("\n== variantes: a segunda so existe quando ha preposicao");
ok("sem preposicao: uma variante", variantesDeTitulo("gold coin"), ["Gold Coin"]);
ok("com preposicao: duas", variantesDeTitulo("wand of inferno"), [
  "Wand of Inferno",
  "Wand Of Inferno",
]);
ok("a provavel vem primeiro", variantesDeTitulo("wand of inferno")[0], "Wand of Inferno");
ok("nunca ha duplicata", new Set(variantesDeTitulo("boots of haste")).size, 2);

console.log("\n== entrada suja nao quebra");
ok("espacos sobrando", tituloDeItem("  gold   coin  "), "Gold Coin");
ok("ja capitalizado", tituloDeItem("Gold Coin"), "Gold Coin");
ok("caixa alta", tituloDeItem("GOLD COIN"), "Gold Coin");
ok("vazio da string vazia", tituloDeItem(""), "");
ok("vazio da lista vazia", variantesDeTitulo("   "), []);

console.log("\n== a lista de minusculas");
ok("'of' esta nela", MINUSCULAS.has("of"), true);
ok("'the' esta nela", MINUSCULAS.has("the"), true);
// `coin` nunca pode entrar: viraria "Gold coin", que da 404.
ok("'coin' NAO esta nela", MINUSCULAS.has("coin"), false);
ok("'steel' NAO esta nela", MINUSCULAS.has("steel"), false);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
