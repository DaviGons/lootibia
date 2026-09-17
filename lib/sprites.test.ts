import { readFileSync } from "node:fs";
import { variantesDeNome, normalizarNomeDeCriatura } from "./nomesDeCriatura.ts";
import { CRIATURAS } from "./dados/criaturas.ts";
import { spriteDe, tamanhoDoIndice } from "./sprites.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

// Os dados de producao, nao uma copia: o teste valida o arquivo que a tela usa.
const lista = CRIATURAS.map(([name, race, image_url]) => ({ name, race, image_url }));
// Nomes de página do TibiaWiki: singulares, como o Hunt Analyser escreve.
const nomesDoWiki: string[] = JSON.parse(
  readFileSync("test/fixtures/tibiawiki-creature-names.json", "utf8"),
);

// Mesmo índice que lib/sprites.ts monta: cada criatura sob todas as suas
// variantes e sob o `race`.
const indice = new Map<string, (typeof lista)[number]>();
const colisoes: string[] = [];
function indexar(chave: string, c: (typeof lista)[number]) {
  const ja = indice.get(chave);
  if (ja && ja.name !== c.name) colisoes.push(`${chave}: ${ja.name} vs ${c.name}`);
  else indice.set(chave, c);
}
for (const c of lista) {
  for (const v of variantesDeNome(c.name)) indexar(v, c);
  if (c.race) indexar(c.race, c);
}
const achar = (nome: string) => variantesDeNome(nome).map((v) => indice.get(v)).find(Boolean);

console.log("== limpeza do nome");
ok("minusculas e sem pontuacao", normalizarNomeDeCriatura("Ghazbaran's Guard"), "ghazbarans guard");
// A forma canonica so limpa; quem desfaz o possessivo e a lista de variantes.
ok("variante sem o -s do possessivo", variantesDeNome("Ghazbaran's Guard").includes("ghazbaran guard"), true);
ok("espacos colapsados", normalizarNomeDeCriatura("  Dark   Torturers "), "dark torturers");
ok("nome vazio nao gera variante", variantesDeNome("   "), []);

console.log("\n== o plural -ies e ambiguo: as duas leituras precisam existir");
ok("furies gera fury", variantesDeNome("Furies").includes("fury"), true);
ok("zombies gera zombie", variantesDeNome("Zombies").includes("zombie"), true);
ok("variante sem espaco existe", variantesDeNome("Dark Torturers").includes("darktorturer"), true);

console.log("\n== casos que estavam quebrados na primeira versao");
// "Fury" aparecia sem sprite porque a regra unica virava "furies" em "furi".
for (const n of ["fury", "zombie", "hero", "cyclops", "medusa", "sabretooth", "witch", "wolf"]) {
  ok(`${n} acha sprite`, Boolean(achar(n)), true);
}

console.log("\n== os mobs da sessao real continuam casando");
for (const n of [
  "betrayed wraith",
  "dark torturer",
  "destroyer",
  "hand of cursed fate",
  "lost soul",
  "plaguesmith",
]) {
  ok(`${n} acha sprite`, Boolean(achar(n)), true);
}
// O caso que prova por que nao casamos por `race`: o de "betrayed wraith" e so
// "wraith", que nenhuma slugificacao do nome produz.
ok("betrayed wraith tem race 'wraith'", achar("betrayed wraith")?.race, "wraith");

console.log("\n== o indice de producao concorda com o do teste");
// spriteDe e o que a tela chama; o indice acima e uma reimplementacao usada
// para medir colisoes. Se os dois divergirem, o teste mede outra coisa.
for (const n of ["fury", "dark torturer", "cyclops", "zombie", "betrayed wraith"]) {
  ok(`spriteDe("${n}") concorda com o indice`, spriteDe(n), achar(n)?.image_url);
}
ok("spriteDe devolve undefined fora da biblioteca", spriteDe("abyssador"), undefined);
ok("indice tem mais de 2.000 chaves", tamanhoDoIndice() > 2000, true);

console.log("\n== integridade do indice");
ok("arquivo de dados tem 718 criaturas", lista.length, 718);
// Uma chave apontando para duas criaturas exibiria o sprite do bicho errado.
ok("nenhuma colisao", colisoes.length, 0);
if (colisoes.length) console.log(colisoes.slice(0, 10).join("\n"));
ok("nenhuma URL fora de static.tibia.com", lista.filter((c) => !c.image_url.startsWith("https://static.tibia.com/")).length, 0);

console.log("\n== cobertura medida contra os nomes singulares do TibiaWiki");
const comSprite = nomesDoWiki.filter((n) => achar(n));
const alcancadas = new Set(comSprite.map((n) => achar(n)!.name));
console.log(`   ${comSprite.length} de ${nomesDoWiki.length} nomes do wiki acham sprite`);
console.log(`   ${alcancadas.size} de ${lista.length} criaturas da TibiaData ficam alcancaveis`);
// Numeros travados: a primeira versao (regra unica de plural) achava 613.
// Se cair abaixo disso, alguma regra regrediu.
ok("cobertura do wiki nao regrediu", comSprite.length >= 715, true);
ok("criaturas alcancaveis nao regrediu", alcancadas.size >= 712, true);
// O resto do wiki sao bosses e bichos de evento que nao existem na biblioteca
// do tibia.com — limite da fonte, nao defeito do de-para.

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
