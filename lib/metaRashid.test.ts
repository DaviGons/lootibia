import { ROTA, rashidEm, rashidNoDia } from "./rashid.ts";
import { alvoEmGp, progressoDaMeta, rotuloDaMeta } from "./meta.ts";
import { diaTibia } from "./periodo.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== rota do Rashid");
ok("sete paradas", ROTA.length, 7);
ok("dias 1 a 7 sem buraco", ROTA.map((p) => p.dia), [1, 2, 3, 4, 5, 6, 7]);
ok("nenhuma cidade repetida", new Set(ROTA.map((p) => p.cidade)).size, 7);
// Ancora do wiki: "On Mondays you can find him in Svargrond".
ok("segunda e Svargrond", rashidNoDia("2026-09-21").cidade, "Svargrond");
ok("domingo e Carlin", rashidNoDia("2026-09-20").cidade, "Carlin");
ok("sabado e Edron", rashidNoDia("2026-09-19").cidade, "Edron");
ok("sexta e Darashia", rashidNoDia("2026-09-18").cidade, "Darashia");

console.log("== o server save e quem manda, nao a meia-noite");
// 2026-09-22 e terca. As 07:00 de Berlim ainda NAO houve server save, entao o
// dia de Tibia e segunda e o Rashid segue em Svargrond. Este e o bug que
// existiria se o codigo usasse Date.getDay() em vez de diaTibia().
const antesDoSave = new Date("2026-09-22T05:00:00Z"); // 07:00 em Berlim (CEST)
const depoisDoSave = new Date("2026-09-22T09:00:00Z"); // 11:00 em Berlim
ok("antes do save o dia de Tibia ainda e segunda", diaTibia(antesDoSave), "2026-09-21");
ok("  -> Rashid ainda em Svargrond", rashidEm(antesDoSave).cidade, "Svargrond");
ok("depois do save vira terca", diaTibia(depoisDoSave), "2026-09-22");
ok("  -> Rashid ja em Liberty Bay", rashidEm(depoisDoSave).cidade, "Liberty Bay");

console.log("== meta: converter para gold");
ok("meta em gp e ela mesma", alvoEmGp({ valor: 1_000_000, unidade: "gp" }, 15_800), 1_000_000);
ok("meta em gp nao depende do preco", alvoEmGp({ valor: 1_000_000, unidade: "gp" }, null), 1_000_000);
ok("meta em TC multiplica pelo preco", alvoEmGp({ valor: 500, unidade: "tc" }, 15_800), 7_900_000);
// Sem preco configurado nao ha alvo em gold. Devolver 0 ou o valor cru faria a
// tela mostrar "meta batida" ou "faltam 500 gp" — as duas mentiras.
ok("meta em TC sem preco nao tem alvo", alvoEmGp({ valor: 500, unidade: "tc" }, null), null);
ok("preco zero tambem nao", alvoEmGp({ valor: 500, unidade: "tc" }, 0), null);

console.log("== meta: progresso");
const meta = { valor: 500, unidade: "tc" } as const;
const p = progressoDaMeta(meta, 4_912_300, 15_800, 24)!;
ok("alvo em gold", p.alvoEmGp, 7_900_000);
ok("fracao", Number(p.fracao.toFixed(4)), 0.6218);
ok("falta em TC, nao em gp", p.falta, 190);
ok("nao bateu", p.bateu, false);
ok("hunts restantes no ritmo da pasta", p.huntsRestantes, 15);

console.log("== meta: bordas que quebram barra de progresso");
const batida = progressoDaMeta(meta, 8_000_000, 15_800, 30)!;
ok("passou da meta: bateu", batida.bateu, true);
ok("fracao trava em 1", batida.fracao, 1);
ok("fracao crua passa de 1", Number(batida.fracaoCrua.toFixed(3)), 1.013);
ok("falta zero", batida.falta, 0);
ok("hunts restantes zero", batida.huntsRestantes, 0);

// Pasta de teste de setup costuma dar prejuizo. Barra nao anda para tras, e
// "-12% da meta" nao quer dizer nada para quem le.
const prejuizo = progressoDaMeta(meta, -900_000, 15_800, 4)!;
ok("profit negativo: fracao zero", prejuizo.fracao, 0);
ok("  mas a fracao crua preserva o sinal", prejuizo.fracaoCrua < 0, true);
// Mais que a meta inteira: quem esta no negativo precisa recuperar o prejuizo
// ANTES de comecar a somar para o alvo. 7,9M + 0,9M = 8,8M, a 15.800 o TC.
ok("  falta a meta MAIS o prejuizo", prejuizo.falta, 557);
// Nenhuma quantidade de hunts com media negativa fecha a meta: estimar seria mentir.
ok("  sem estimativa de hunts", prejuizo.huntsRestantes, null);

const semHunts = progressoDaMeta(meta, 0, 15_800, 0)!;
ok("sem hunts nao ha media", semHunts.huntsRestantes, null);
ok("meta em TC sem preco nao tem progresso", progressoDaMeta(meta, 5_000_000, null, 10), null);

console.log("== rotulo");
ok("TC", rotuloDaMeta({ valor: 500, unidade: "tc" }), "500 TC");
ok("gp com separador", rotuloDaMeta({ valor: 1_200_000, unidade: "gp" }), "1.200.000 gp");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
