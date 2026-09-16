import {
  diaTibia, instanteDoServerSave, intervaloDoDia, horasNoDia, semanaTibia,
  diasDaSemana, intervaloDaSemana, diasEntre, semanasEntre, somarDias,
} from "./periodo.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== server save em UTC: 08:00Z no verao (CEST), 09:00Z no inverno (CET)");
ok("verao 2026-07-01", instanteDoServerSave("2026-07-01").toISOString(), "2026-07-01T08:00:00.000Z");
ok("inverno 2026-01-15", instanteDoServerSave("2026-01-15").toISOString(), "2026-01-15T09:00:00.000Z");

console.log("\n== fronteira do dia: 09:59 de Berlim ainda e o dia anterior");
ok("09:59 Berlim (07:59Z verao)", diaTibia(new Date("2026-07-02T07:59:00Z")), "2026-07-01");
ok("10:00 Berlim (08:00Z verao)", diaTibia(new Date("2026-07-02T08:00:00Z")), "2026-07-02");
ok("09:59 Berlim (08:59Z inverno)", diaTibia(new Date("2026-01-16T08:59:00Z")), "2026-01-15");
ok("10:00 Berlim (09:00Z inverno)", diaTibia(new Date("2026-01-16T09:00:00Z")), "2026-01-16");
ok("virada de mes", diaTibia(new Date("2026-03-01T08:30:00Z")), "2026-02-28");
ok("virada de ano", diaTibia(new Date("2026-01-01T08:00:00Z")), "2025-12-31");

console.log("\n== DST: 2026 muda em 29/03 (CET->CEST) e 25/10 (CEST->CET)");
ok("dia 2026-03-27 (sem transicao) tem 24h", horasNoDia("2026-03-27"), 24);
ok("dia 2026-03-28 engole a transicao: 23h", horasNoDia("2026-03-28"), 23);
ok("dia 2026-03-29 volta a 24h", horasNoDia("2026-03-29"), 24);
ok("dia 2026-10-24 ganha a hora repetida: 25h", horasNoDia("2026-10-24"), 25);
ok("dia 2026-10-25 volta a 24h", horasNoDia("2026-10-25"), 24);
ok("total marco/outubro bate 8760h em ano comum",
   diasEntre("2026-01-01","2026-12-31").reduce((s,d)=>s+horasNoDia(d),0), 8760);

console.log("\n== semana ISO");
ok("2026-09-16 (quarta)", semanaTibia("2026-09-16"), "2026-W38");
ok("segunda dessa semana", diasDaSemana("2026-W38")[0], "2026-09-14");
ok("domingo dessa semana", diasDaSemana("2026-W38")[6], "2026-09-20");
ok("virada: 2025-12-29 e semana 1 de 2026", semanaTibia("2025-12-29"), "2026-W01");
ok("virada: 2027-01-01 ainda e semana 53 de 2026", semanaTibia("2027-01-01"), "2026-W53");
ok("ida e volta em 400 dias",
   diasEntre("2026-01-01","2027-02-04").every(d => diasDaSemana(semanaTibia(d)).includes(d)), true);

console.log("\n== intervalo de semana: fecha exatamente onde a proxima abre");
const s38 = intervaloDaSemana("2026-W38"), s39 = intervaloDaSemana("2026-W39");
ok("sem buraco entre semanas", s38.fim.toISOString(), s39.inicio.toISOString());
ok("semana comeca no server save de segunda", s38.inicio.toISOString(), "2026-09-14T08:00:00.000Z");
ok("semanas tocadas por um intervalo", semanasEntre("2026-09-13","2026-09-21"),
   ["2026-W37","2026-W38","2026-W39"]);

console.log("\n== dias encadeiam sem buraco nem sobreposicao (inclui DST)");
let encadeia = true;
for (const d of diasEntre("2026-03-26","2026-03-31").concat(diasEntre("2026-10-22","2026-10-28"))) {
  if (intervaloDoDia(d).fim.getTime() !== intervaloDoDia(somarDias(d,1)).inicio.getTime()) encadeia = false;
}
ok("fim[d] === inicio[d+1]", encadeia, true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
