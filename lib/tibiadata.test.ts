import { readFileSync } from "node:fs";
import { normalizarNomeDeCriatura } from "./nomesDeCriatura.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

interface Criatura {
  name: string;
  race: string;
  image_url: string;
}
const lista: Criatura[] = JSON.parse(
  readFileSync("test/fixtures/tibiadata-creatures.json", "utf8"),
);

console.log("== normalizacao");
ok("plural simples", normalizarNomeDeCriatura("Lost Souls"), "lost soul");
ok("singular fica igual", normalizarNomeDeCriatura("lost soul"), "lost soul");
ok("plural em -es", normalizarNomeDeCriatura("Witches"), "witch");
ok("apostrofo sai", normalizarNomeDeCriatura("Ghazbaran's Guard"), "ghazbaran guard");
ok("espacos extras somem", normalizarNomeDeCriatura("  Dark   Torturers "), "dark torturer");

console.log("\n== de-para com a lista real da TibiaData (fixture de 718 criaturas)");
const porNome = new Map<string, Criatura>();
for (const c of lista) porNome.set(normalizarNomeDeCriatura(c.name), c);

ok("fixture tem 718 criaturas", lista.length, 718);
// Se duas criaturas diferentes normalizassem para a mesma chave, o sprite
// exibido poderia ser o do monstro errado. Zero colisao e o que autoriza
// usar normalizacao no lugar de tabela de de-para manual.
ok("nenhuma colisao apos normalizar", lista.length - porNome.size, 0);

console.log("\n== os mobs da sessao real casam com um sprite");
// Nomes exatamente como o Hunt Analyser escreve: minusculo e singular.
const doHuntAnalyser = [
  "betrayed wraith",
  "dark torturer",
  "destroyer",
  "hand of cursed fate",
  "lost soul",
  "plaguesmith",
];
for (const n of doHuntAnalyser) {
  const achou = porNome.get(normalizarNomeDeCriatura(n));
  ok(`${n} tem sprite`, Boolean(achou?.image_url), true);
}

// O caso que prova por que casamos por NOME e nao por `race`: o race de
// "betrayed wraith" e so "wraith", que nenhuma slugificacao do nome produz.
const wraith = porNome.get(normalizarNomeDeCriatura("betrayed wraith"));
ok("betrayed wraith tem race 'wraith', nao 'betrayedwraith'", wraith?.race, "wraith");
ok(
  "slugificar o nome NAO acharia o race",
  "betrayed wraith".replace(/\s/g, "") === wraith?.race,
  false,
);

console.log("\n== toda URL de sprite aponta para o dominio esperado");
const fora = lista.filter((c) => !c.image_url.startsWith("https://static.tibia.com/"));
ok("nenhuma URL fora de static.tibia.com", fora.length, 0);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
