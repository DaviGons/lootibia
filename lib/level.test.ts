import {
  faixaDoLevel,
  horasPorSemana,
  lerHorasPorSemana,
  levelDeXp,
  levelDepoisDe,
  preverLevel,
  ritmoFraco,
  somarRitmo,
  xpParaLevel,
  xpPorHora,
  type SessaoDeXp,
} from "./level.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

console.log("== formula oficial de XP");
// O 100 confere com o valor conhecido do jogo; os outros foram conferidos a mao
// pela formula, fora deste arquivo.
ok("level 1 comeca em 0", xpParaLevel(1), 0);
ok("level 2 = 100", xpParaLevel(2), 100);
ok("level 8 = 4.200", xpParaLevel(8), 4_200);
ok("level 100 = 15.694.800", xpParaLevel(100), 15_694_800);
ok("level 500 = 2.058.474.800", xpParaLevel(500), 2_058_474_800);
ok("level 1000 = 16.566.949.800", xpParaLevel(1000), 16_566_949_800);
ok("resultado sempre inteiro", [2, 3, 7, 99, 413, 1234].every((l) => Number.isInteger(xpParaLevel(l))), true);
ok("level invalido vira 0", [0, -5, 2.5].map(xpParaLevel), [0, 0, 0]);

console.log("== caminho inverso");
ok("0 XP e level 1", levelDeXp(0), 1);
ok("99 XP ainda e level 1", levelDeXp(99), 1);
ok("100 XP e level 2", levelDeXp(100), 2);
ok("um a menos que o 500 e 499", levelDeXp(xpParaLevel(500) - 1), 499);
ok("exatamente o 500 e 500", levelDeXp(xpParaLevel(500)), 500);
ok("ida e volta em 1..3000", [...Array(3000)].every((_, i) => levelDeXp(xpParaLevel(i + 1)) === i + 1), true);
ok("faixa do 412", faixaDoLevel(412), { de: 1_148_717_600, ate: 1_157_143_199 });

console.log("== ritmo e Σ/Σ, nunca media das medias");
const agora = new Date("2026-09-28T12:00:00Z");
const dia = (n: number) => new Date(agora.getTime() - n * 86_400_000);
// Uma hunt de 10 min com XP/h altissimo e uma de 4 h normal. A media das
// medias daria (6 mi + 2 mi) / 2 = 4 mi/h; o certo e 9 mi / 4,1667 h.
const curtaELonga: SessaoDeXp[] = [
  { inicio: dia(1), duracaoS: 600, xp: 1_000_000 },
  { inicio: dia(2), duracaoS: 14_400, xp: 8_000_000 },
];
const r = somarRitmo(curtaELonga);
ok("soma", r, { xp: 9_000_000, segundos: 15_000, hunts: 2 });
ok("XP/h e Σ XP / Σ horas", Math.round(xpPorHora(r)!), 2_160_000);
ok("sem tempo caçado nao ha ritmo", xpPorHora({ xp: 0, segundos: 0, hunts: 0 }), null);
ok("recorte por data", somarRitmo(curtaELonga, dia(1.5)).hunts, 1);
ok("2 hunts e ritmo fraco", ritmoFraco(r), true);
ok("3 hunts e 6 h nao e", ritmoFraco({ xp: 1, segundos: 6 * 3600, hunts: 3 }), false);
ok("10 hunts em 2 h e fraco", ritmoFraco({ xp: 1, segundos: 2 * 3600, hunts: 10 }), true);

console.log("== horas por semana");
ok("sem sessao, sem ritmo", horasPorSemana([], agora), null);
// 10 h num historico de 8 dias: 10 / (8/7) = 8,75 h por semana, nao 10/4.
const oitoDias: SessaoDeXp[] = [
  { inicio: dia(8), duracaoS: 5 * 3600, xp: 1 },
  { inicio: dia(1), duracaoS: 5 * 3600, xp: 1 },
];
ok("divide pelo tempo observado", horasPorSemana(oitoDias, agora), 8.75);
// Uma hunt so, ontem: o piso de 7 dias impede "70 h por semana".
ok("piso de uma semana", horasPorSemana([{ inicio: dia(1), duracaoS: 3 * 3600, xp: 1 }], agora), 3);
// Historico longo: a janela para em 28 dias, e o que e mais velho nao conta.
const longo: SessaoDeXp[] = [
  { inicio: dia(200), duracaoS: 100 * 3600, xp: 1 },
  { inicio: dia(10), duracaoS: 8 * 3600, xp: 1 },
];
ok("janela de 28 dias", horasPorSemana(longo, agora), 2);
ok("parou de caçar ha 2 meses", horasPorSemana([{ inicio: dia(60), duracaoS: 3600, xp: 1 }], agora), null);

console.log("== horas por semana digitadas");
ok("inteiro", lerHorasPorSemana("10"), 10);
ok("virgula", lerHorasPorSemana("10,5"), 10.5);
ok("ponto", lerHorasPorSemana(" 7.5 "), 7.5);
ok("vazio usa o medido", lerHorasPorSemana("  "), null);
ok("zero nao preve", lerHorasPorSemana("0"), "invalido");
ok("mais que 168 h", lerHorasPorSemana("200"), "invalido");
ok("168 h ainda vale", lerHorasPorSemana("168"), 168);
ok("texto", lerHorasPorSemana("dez"), "invalido");
ok("negativo", lerHorasPorSemana("-3"), "invalido");
ok("milhar com ponto nao passa", lerHorasPorSemana("1.000,5"), "invalido");

console.log("== previsao");
const p = preverLevel({
  xpAtual: xpParaLevel(412),
  levelAlvo: 500,
  xpPorHora: 3_000_000,
  horasPorSemana: 10,
  agora,
})!;
ok("XP faltando", p.xpFaltando, 909_757_200);
ok("horas", Math.round(p.horas * 100) / 100, 303.25);
ok("semanas", Math.round(p.semanas! * 100) / 100, 30.33);
ok("data", p.data!.toISOString().slice(0, 10), "2027-04-28");
ok("sem horas por semana, sem data", preverLevel({ xpAtual: 0, levelAlvo: 10, xpPorHora: 1e6, horasPorSemana: null, agora })?.data, null);
ok("alvo ja alcançado", preverLevel({ xpAtual: xpParaLevel(500), levelAlvo: 500, xpPorHora: 1e6, horasPorSemana: 5, agora }), null);
ok("alvo abaixo do atual", preverLevel({ xpAtual: xpParaLevel(500), levelAlvo: 300, xpPorHora: 1e6, horasPorSemana: 5, agora }), null);
ok("ritmo zero nao preve", preverLevel({ xpAtual: 0, levelAlvo: 10, xpPorHora: 0, horasPorSemana: 5, agora }), null);
ok("ritmo nulo nao preve", preverLevel({ xpAtual: 0, levelAlvo: 10, xpPorHora: null, horasPorSemana: 5, agora }), null);

console.log("== e se eu caçar mais");
ok("0 h nao muda o level", levelDepoisDe(xpParaLevel(412), 0, 3e6), 412);
// 303,25 h arredondado fica 7.200 XP antes do 500; as horas exatas chegam.
ok("303,25 h para no 499", levelDepoisDe(xpParaLevel(412), 303.25, 3e6), 499);
ok("as horas exatas chegam ao 500", levelDepoisDe(xpParaLevel(412), p.horas, 3e6), 500);
ok("hora negativa conta como zero", levelDepoisDe(xpParaLevel(412), -10, 3e6), 412);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
