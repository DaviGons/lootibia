import { readFileSync } from "node:fs";
import { lerSessaoHunt, ErroDeParse, normalizarNome, numeroTibia } from "./huntSession.ts";
import { resumirHunts, resumirPorPeriodo, type SessaoRotulada } from "./huntAgregado.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}
function lanca(nome: string, fn: () => unknown) {
  try {
    fn();
    falhas++;
    console.log(`FALHA ${nome}  ->  nao lancou`);
  } catch (e) {
    const esperado = e instanceof ErroDeParse;
    if (!esperado) falhas++;
    console.log(`${esperado ? "ok  " : "FALHA"} ${nome}  ->  ${(e as Error).message}`);
  }
}

const EXEMPLO = `Session data: From 2026-09-15, 19:34:12 to 2026-09-15, 21:25:10
Session: 01:50h
Raw XP Gain: 7,051,729
XP Gain: 10,577,467
Raw XP/h: 3,812,527
XP/h: 5,718,723
Loot: 2,450,488
Supplies: 303,842
Balance: 2,146,646
Damage: 10,756,966
Damage/h: 5,819,757
Healing: 2,158,980
Healing/h: 1,168,056
Killed Monsters:
437x betrayed wraith
609x dark torturer
2x destroyer
257x hand of cursed fate
348x lost soul
6x plaguesmith
Looted Items:
413x a great mana potion
3x a ruby necklace
87x a white pearl
93x a black pearl
143x a small diamond
118x a small sapphire
109384x a gold coin`;

console.log("== parse do exemplo real");
const s = lerSessaoHunt(EXEMPLO);
ok("inicio", s.inicio, "2026-09-15T19:34:12");
ok("fim", s.fim, "2026-09-15T21:25:10");
ok("duracao real em segundos (1h50m58s)", s.duracaoSegundos, 6658);
ok("duracao exibida trunca para 01:50", s.duracaoExibidaSegundos, 6600);
ok("exibida perde 58s", s.duracaoSegundos - (s.duracaoExibidaSegundos ?? 0), 58);
ok("xpGain", s.xpGain, 10577467);
ok("rawXpGain", s.rawXpGain, 7051729);
ok("loot", s.loot, 2450488);
ok("supplies", s.supplies, 303842);
ok("balance", s.balance, 2146646);
ok("balance == loot - supplies", s.balance === s.loot - s.supplies, true);
ok("damage", s.damage, 10756966);
ok("healing", s.healing, 2158980);
ok("nenhum campo ignorado", Object.keys(s.camposIgnorados), []);

console.log("\n== contagens");
ok("6 monstros", s.monstrosMortos.length, 6);
ok("dark torturer", s.monstrosMortos.find((m) => m.nome === "dark torturer")?.quantidade, 609);
ok("7 itens", s.itensLootados.length, 7);
ok("artigo removido do nome", s.itensLootados.map((i) => i.nome).includes("gold coin"), true);
ok("gold coin sem separador", s.itensLootados.find((i) => i.nome === "gold coin")?.quantidade, 109384);
ok("normalizarNome remove 'an'", normalizarNome("an amber staff"), "amber staff");
ok("numeroTibia com virgula", numeroTibia("10,577,467"), 10577467);
ok("numeroTibia negativo", numeroTibia("-1,234"), -1234);

console.log("\n== taxas do jogo ficam so como diagnostico");
ok("xp/h exibido lido", s.taxasExibidas.xpPorHora, 5718723);
const xpHCalculado = s.xpGain / (s.duracaoSegundos / 3600);
ok(
  "xp/h calculado difere do exibido em menos de 0,1%",
  Math.abs(xpHCalculado / (s.taxasExibidas.xpPorHora as number) - 1) < 0.001,
  true,
);

console.log("\n== robustez");
lanca("sem cabecalho de sessao", () => lerSessaoHunt("XP Gain: 10\nLoot: 5\nSupplies: 1"));
lanca("balance inconsistente", () =>
  lerSessaoHunt(EXEMPLO.replace("Balance: 2,146,646", "Balance: 999")),
);
lanca("faltando um total", () => lerSessaoHunt(EXEMPLO.replace("Damage: 10,756,966\n", "")));
const comCampoNovo = lerSessaoHunt(EXEMPLO.replace("Session: 01:50h", "Session: 01:50h\nPreys Active: 2"));
ok("campo desconhecido nao quebra", comCampoNovo.camposIgnorados["Preys Active"], "2");
ok("e nao entra nos totais", comCampoNovo.xpGain, 10577467);
const semBalance = lerSessaoHunt(EXEMPLO.replace("Balance: 2,146,646\n", ""));
ok("balance ausente e derivado", semBalance.balance, 2146646);

console.log("\n== fixture real do jogo (linhas de contagem indentadas)");
// O cliente indenta as linhas de 'Killed Monsters' e 'Looted Items'. Fixture
// gravada de uma sessao real para travar esse comportamento (diretriz 29).
const real = lerSessaoHunt(readFileSync("test/fixtures/sessao-indentada.txt", "utf8"));
ok("indentacao nao quebra o parse", real.monstrosMortos.length, 6);
ok("contagem indentada lida", real.monstrosMortos.find((m) => m.nome === "betrayed wraith")?.quantidade, 437);
ok("itens indentados lidos", real.itensLootados.length, 7);
ok("gold coin indentado", real.itensLootados.find((i) => i.nome === "gold coin")?.quantidade, 109384);
ok("mesma duracao do exemplo inline", real.duracaoSegundos, s.duracaoSegundos);
ok("mesmos totais do exemplo inline", [real.xpGain, real.loot, real.supplies, real.balance], [s.xpGain, s.loot, s.supplies, s.balance]);
ok("nada caiu em camposIgnorados", Object.keys(real.camposIgnorados), []);

console.log("\n== agregacao: a regra de nunca tirar media das medias");
// Hunt curta com profit/h altissimo (600k/h) e hunt longa com 100k/h.
const curta: SessaoRotulada = { ...s, duracaoSegundos: 600, loot: 100000, supplies: 0, balance: 100000, xpGain: 1000, rawXpGain: 1000, monstrosMortos: [{ nome: "dark torturer", quantidade: 10 }], itensLootados: [], rotulo: "Spot A" };
const longa: SessaoRotulada = { ...s, duracaoSegundos: 14400, loot: 400000, supplies: 0, balance: 400000, xpGain: 4000, rawXpGain: 4000, monstrosMortos: [{ nome: "dark torturer", quantidade: 40 }, { nome: "lost soul", quantidade: 5 }], itensLootados: [], rotulo: "Spot B" };
const r = resumirHunts([curta, longa]);
ok("profit somado", r.profit, 500000);
ok("horas somadas", r.horas, 4.166666666666667);
ok("profit/h ponderado pelo tempo", Math.round(r.porHora!.profit), 120000);
const mediaIngenua = (100000 / (600 / 3600) + 400000 / (14400 / 3600)) / 2;
ok("media ingenua daria 350000, bem diferente", Math.round(mediaIngenua), 350000);
ok("supplies por hunt", r.suppliesPorHunt, 0);
ok("mobs somados entre sessoes", r.monstrosMortos, [
  { nome: "dark torturer", quantidade: 50 },
  { nome: "lost soul", quantidade: 5 },
]);
ok("spots ordenados por tempo", r.spotsMaisCacados.map((x) => x.rotulo), ["Spot B", "Spot A"]);
ok("hunts sem rotulo contadas", resumirHunts([{ ...curta, rotulo: undefined }]).huntsSemRotulo, 1);

console.log("\n== conjunto vazio nao vira zero");
const vazio = resumirHunts([]);
ok("porHora e null", vazio.porHora, null);
ok("suppliesPorHunt e null", vazio.suppliesPorHunt, null);
ok("hunts zero", vazio.hunts, 0);

console.log("\n== agrupamento por periodo");
const porSemana = resumirPorPeriodo(
  [
    { ...curta, rotulo: "A" },
    { ...longa, rotulo: "B" },
  ],
  (x) => (x.duracaoSegundos < 1000 ? "2026-W38" : "2026-W39"),
);
ok("duas semanas", [...porSemana.keys()], ["2026-W38", "2026-W39"]);
ok("profit da W38", porSemana.get("2026-W38")!.profit, 100000);
ok("profit da W39", porSemana.get("2026-W39")!.profit, 400000);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
