/**
 * Testes do bot do Discord. Sem framework, sem rede, sem banco:
 *
 *   node --experimental-strip-types lib/discord.test.ts
 *
 * O que dá para provar aqui é o que quebra em silêncio na produção — assinatura
 * mal verificada, janela de período deslocada por horário de verão, embed que
 * estoura o limite do Discord e a mensagem não sai. O que exige Discord ou
 * Supabase de verdade está listado no fim de docs/bot-discord.md, em "A
 * verificar", e não se finge que está coberto aqui.
 */

import { generateKeyPairSync, sign } from "node:crypto";
import { Buffer } from "node:buffer";

import { assinaturaConfere, chavePublicaDoDiscord } from "./discord/assinatura.ts";
import { janelaDe, lerRotulo, descreverJanela, ROTULOS } from "./discord/janela.ts";
import {
  listaQueCabe,
  embedDeResumo,
  tamanhoDoEmbed,
  horas,
  compacto,
} from "./discord/embed.ts";
import { LIMITES, campoDoModal, opcaoTexto, opcaoBooleana, autorDaInteracao, modal } from "./discord/protocolo.ts";
import { COMANDOS, CAMPOS_ADDHUNT, CAMPOS_CADASTRO, MODAL } from "./discord/comandos.ts";
import { assinarJwt, jwtConfere } from "./supabase/bot.ts";
import { instanteDoRelogioLocal, fusoValido } from "./importacao.ts";
import { resumirHunts, type SessaoRotulada } from "./huntAgregado.ts";
import { diaTibia, semanaTibia } from "./periodo.ts";
import type { Interacao } from "./discord/protocolo.ts";

let falhas = 0;
function ok(nome: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  const passou = a === b;
  if (!passou) falhas++;
  console.log(`${passou ? "ok  " : "FALHA"} ${nome}  ->  ${a}${passou ? "" : `  (esperado ${b})`}`);
}

// ===========================================================================
console.log("== assinatura Ed25519");
// ===========================================================================
// O Discord recusa registrar uma URL que não devolva 401 para assinatura
// inválida: ele manda requisições propositalmente quebradas na verificação.

const par = generateKeyPairSync("ed25519");
// Os 32 bytes crus ficam no fim da SPKI DER, depois de um cabeçalho fixo de 12.
const chaveHex = par.publicKey.export({ format: "der", type: "spki" }).subarray(12).toString("hex");
const chave = chavePublicaDoDiscord(chaveHex);

const ts = "1758100000";
const corpo = JSON.stringify({ type: 1 });
const assinar = (t: string, c: string) =>
  sign(null, Buffer.from(t + c, "utf8"), par.privateKey).toString("hex");

ok("assinatura correta passa", assinaturaConfere(chave, assinar(ts, corpo), ts, corpo), true);
ok(
  "corpo adulterado nao passa",
  assinaturaConfere(chave, assinar(ts, corpo), ts, JSON.stringify({ type: 2 })),
  false,
);
ok(
  "timestamp trocado nao passa",
  assinaturaConfere(chave, assinar(ts, corpo), "1758100001", corpo),
  false,
);
// Replay com a chave de outro app: o cenário de alguém copiando um POST real.
const outro = generateKeyPairSync("ed25519");
ok(
  "assinatura de outra chave nao passa",
  assinaturaConfere(
    chave,
    sign(null, Buffer.from(ts + corpo, "utf8"), outro.privateKey).toString("hex"),
    ts,
    corpo,
  ),
  false,
);
ok("cabecalho ausente nao passa", assinaturaConfere(chave, null, ts, corpo), false);
ok("timestamp ausente nao passa", assinaturaConfere(chave, assinar(ts, corpo), null, corpo), false);
ok("hex invalido nao passa", assinaturaConfere(chave, "nao sou hex", ts, corpo), false);
ok("hex do tamanho errado nao passa", assinaturaConfere(chave, "abcd", ts, corpo), false);

// Reserializar o JSON muda o texto (espaçamento, escapes) e invalida a
// assinatura. É a razão de o handler ler `req.text()` e só depois `JSON.parse`.
const cruComEspacos = '{"type": 1, "id": "9"}';
ok(
  "reserializar o corpo quebra a assinatura",
  assinaturaConfere(chave, assinar(ts, cruComEspacos), ts, JSON.stringify(JSON.parse(cruComEspacos))),
  false,
);
ok(
  "o corpo cru, intacto, continua passando",
  assinaturaConfere(chave, assinar(ts, cruComEspacos), ts, cruComEspacos),
  true,
);

// A chave remontada a partir dos 32 bytes crus tem de ser idêntica à original,
// byte a byte — é o que prova que o prefixo SPKI está certo.
ok(
  "chave remontada bate com a original",
  chave
    .export({ format: "der", type: "spki" })
    .equals(par.publicKey.export({ format: "der", type: "spki" })),
  true,
);

let lancou = false;
try {
  chavePublicaDoDiscord("abc");
} catch {
  lancou = true;
}
ok("chave publica malformada lanca no boot", lancou, true);

// ===========================================================================
console.log("\n== janela de periodo");
// ===========================================================================
// As fronteiras são as do jogo: server save às 10:00 de Berlim, que é 08:00Z no
// verão e 09:00Z no inverno. Offset fixo erraria metade do ano, em silêncio.

// 17/09/2026 é quinta; a semana ISO abre na segunda, 14/09. Verão em Berlim.
const quintaDeSetembro = new Date("2026-09-17T12:00:00Z");
const semanaSet = janelaDe("semana", quintaDeSetembro);
ok("semana abre no server save da segunda", semanaSet.inicio?.toISOString(), "2026-09-14T08:00:00.000Z");
ok("semana fecha no server save da segunda seguinte", semanaSet.fim?.toISOString(), "2026-09-21T08:00:00.000Z");
ok("a janela concorda com semanaTibia", semanaTibia(diaTibia(quintaDeSetembro)), "2026-W38");

const passadaSet = janelaDe("semana-passada", quintaDeSetembro);
ok("semana passada fecha onde a atual abre", passadaSet.fim?.toISOString(), semanaSet.inicio?.toISOString());
ok("semana passada dura sete dias", passadaSet.inicio?.toISOString(), "2026-09-07T08:00:00.000Z");

// Um instante ANTES do server save pertence ao dia anterior — e pode pertencer
// à semana anterior. 14/09/2026 às 09:00 de Berlim ainda é domingo no jogo.
const antesDoSave = new Date("2026-09-14T07:00:00Z"); // 09:00 em Berlim (CEST)
ok(
  "antes do server save a semana ainda e a anterior",
  janelaDe("semana", antesDoSave).inicio?.toISOString(),
  "2026-09-07T08:00:00.000Z",
);
const depoisDoSave = new Date("2026-09-14T08:00:01Z");
ok(
  "um segundo depois do save a semana virou",
  janelaDe("semana", depoisDoSave).inicio?.toISOString(),
  "2026-09-14T08:00:00.000Z",
);

// Inverno: o mesmo server save às 10:00 de Berlim vira 09:00Z.
const janeiro = new Date("2026-01-15T12:00:00Z");
ok("no inverno o save e 09:00Z", janelaDe("semana", janeiro).inicio?.toISOString(), "2026-01-12T09:00:00.000Z");

// O mês também abre no server save, não à meia-noite.
const mesSet = janelaDe("mes", quintaDeSetembro);
ok("mes abre no save do dia 1", mesSet.inicio?.toISOString(), "2026-09-01T08:00:00.000Z");
ok("mes fecha no save do dia 1 seguinte", mesSet.fim?.toISOString(), "2026-10-01T08:00:00.000Z");

// Dezembro tem de virar o ano, não ir para o mês 13.
ok(
  "dezembro fecha em janeiro do ano seguinte",
  janelaDe("mes", new Date("2026-12-20T12:00:00Z")).fim?.toISOString(),
  "2027-01-01T09:00:00.000Z",
);

// Janela que atravessa a virada do horário de verão: o mês de outubro de 2026
// abre no verão (08:00Z) e fecha no inverno (09:00Z). Uma subtração de "30 dias
// de 24 h" erraria em uma hora aqui.
const outubro = janelaDe("mes", new Date("2026-10-15T12:00:00Z"));
ok("outubro abre no verao", outubro.inicio?.toISOString(), "2026-10-01T08:00:00.000Z");
ok("outubro fecha no inverno", outubro.fim?.toISOString(), "2026-11-01T09:00:00.000Z");

const tudo = janelaDe("tudo", quintaDeSetembro);
ok("tudo nao tem fronteira", [tudo.inicio, tudo.fim], [null, null]);

ok("rotulo desconhecido vira o padrao", lerRotulo("ontem"), "semana");
ok("rotulo ausente vira o padrao", lerRotulo(null), "semana");
ok("rotulo valido e preservado", lerRotulo("mes"), "mes");
ok("rotulo aceita caixa alta", lerRotulo("TUDO"), "tudo");
ok("todo rotulo do comando resolve numa janela", ROTULOS.every((r) => janelaDe(r, quintaDeSetembro) !== undefined), true);

// O fim é exclusivo; o rodapé mostra o último dia INCLUÍDO, senão a semana
// parece ter oito dias.
ok("rodape nao vaza o dia do fim exclusivo", descreverJanela(semanaSet), "Esta semana · 14/09 a 20/09");
ok("rodape de tudo nao inventa datas", descreverJanela(tudo), "Tudo");

// ===========================================================================
console.log("\n== formatacao");
// ===========================================================================

ok("horas arredonda para o minuto", horas(6658), "1h51");
ok("hora cheia", horas(3600), "1h00");
// 59,7 min não pode virar "3h60".
ok("minuto 60 sobe para a hora", horas(3 * 3600 + 3582), "4h00");
ok("zero", horas(0), "0h00");
ok("compacto em milhoes", compacto(2_450_488), "2,5 mi");
ok("compacto em milhares", compacto(303_842), "304 mil");
ok("compacto abaixo de 10 mil sai cheio", compacto(1284), "1.284");
ok("compacto preserva o negativo", compacto(-2_146_646), "-2,1 mi");

// ===========================================================================
console.log("\n== listas que cabem no embed");
// ===========================================================================
// Estourar 1.024 caracteres num campo é 400 do Discord: a mensagem NÃO sai
// truncada, ela não sai.

ok("lista vazia vira travessao", listaQueCabe([]), "—");
ok("lista curta sai inteira", listaQueCabe(["437× betrayed wraith", "12× hellspawn"]), "437× betrayed wraith\n12× hellspawn");
ok("maximo de 10 corta e resume", listaQueCabe(Array.from({ length: 14 }, (_, i) => `n${i}`)), "n0\nn1\nn2\nn3\nn4\nn5\nn6\nn7\nn8\nn9\n+4 outros");

// Nomes longos: quem manda no corte é o limite de caracteres, não a contagem.
const longos = Array.from({ length: 10 }, (_, i) => `${i}× ${"criatura muito longa".repeat(10)}`);
const cortada = listaQueCabe(longos);
ok("lista longa cabe no limite do campo", cortada.length <= LIMITES.EMBED_CAMPO_VALOR, true);
ok("lista longa avisa o que ficou de fora", /\+\d+ outros$/.test(cortada), true);

// Uma única linha que sozinha não cabe não pode gerar campo vazio nem estourar.
const monstruosa = listaQueCabe([`1× ${"x".repeat(2000)}`, "2× y"]);
ok("linha que nao cabe sozinha nao estoura", monstruosa.length <= LIMITES.EMBED_CAMPO_VALOR, true);

// ===========================================================================
console.log("\n== embed do /viewstats");
// ===========================================================================

function sessao(p: Partial<SessaoRotulada> & { duracaoSegundos: number }): SessaoRotulada {
  return {
    inicio: "2026-09-15T19:34:12",
    fim: "2026-09-15T21:25:10",
    duracaoExibidaSegundos: null,
    rawXpGain: 0,
    xpGain: 0,
    loot: 0,
    supplies: 0,
    balance: 0,
    damage: 0,
    healing: 0,
    monstrosMortos: [],
    itensLootados: [],
    taxasExibidas: { rawXpPorHora: null, xpPorHora: null, damagePorHora: null, healingPorHora: null },
    camposIgnorados: {},
    ...p,
  };
}

const ctx = { janela: semanaSet, autor: "Davi" };

ok("zero hunts vira embed de vazio, nao de erro", embedDeResumo(resumirHunts([]), ctx).fields, undefined);
ok("zero hunts ainda diz o periodo", embedDeResumo(resumirHunts([]), ctx).footer?.text, "Esta semana · 14/09 a 20/09");

// A REGRA: `Σ total / Σ horas`, nunca média das médias. É o caso do
// docs/hunt-analyser.md: 100k em 10 min + 400k em 4 h dá 120.000/h ponderado
// contra 350.000/h na média ingênua. O embed tem de mostrar o primeiro.
const duasHunts = resumirHunts([
  sessao({ duracaoSegundos: 600, xpGain: 100_000, loot: 100_000, balance: 100_000 }),
  sessao({ duracaoSegundos: 14_400, xpGain: 400_000, loot: 400_000, balance: 400_000 }),
]);
ok("taxa e ponderada pelo tempo", Math.round(duasHunts.porHora!.xp), 120_000);
const embedTaxa = embedDeResumo(duasHunts, ctx);
const campoXp = embedTaxa.fields?.find((c) => c.name === "XP");
ok("o embed mostra a taxa ponderada", campoXp?.value.includes("120 mil/h"), true);
ok("o embed NAO mostra a media das medias", campoXp?.value.includes("350 mil"), false);

// Profit negativo tem de se distinguir do positivo à primeira vista.
const prejuizo = embedDeResumo(
  resumirHunts([sessao({ duracaoSegundos: 3600, loot: 100, supplies: 500, balance: -400 })]),
  ctx,
);
ok("profit negativo mantem o sinal", prejuizo.fields?.[0].value.startsWith("**-400**"), true);

// Sessão sem rótulo não entra em "hunts mais caçadas" — e o usuário precisa
// saber disso, senão acha que o bot perdeu a hunt.
const semRotulo = embedDeResumo(
  resumirHunts([sessao({ duracaoSegundos: 3600 }), sessao({ duracaoSegundos: 60, rotulo: "Asura" })]),
  ctx,
);
ok("rodape avisa hunts sem spot", semRotulo.footer?.text.includes("1 hunt sem spot"), true);
ok("hunts mais cacadas so lista quem tem rotulo", semRotulo.fields?.find((c) => c.name === "Hunts mais caçadas")?.value.includes("Asura"), true);

// Um resumo grande de verdade continua dentro dos 6.000 do embed inteiro.
const muitosMonstros = Array.from({ length: 300 }, (_, i) => ({
  nome: `criatura de nome consideravelmente longo numero ${i}`,
  quantidade: 1000 - i,
}));
const grande = embedDeResumo(
  resumirHunts(
    Array.from({ length: 40 }, (_, i) =>
      sessao({
        duracaoSegundos: 3600,
        loot: 1_000_000,
        supplies: 300_000,
        balance: 700_000,
        xpGain: 5_000_000,
        rawXpGain: 3_000_000,
        rotulo: `spot com nome longo numero ${i}`,
        monstrosMortos: muitosMonstros,
      }),
    ),
  ),
  ctx,
);
ok("embed grande cabe em 6000", tamanhoDoEmbed(grande) <= LIMITES.EMBED_TOTAL, true);
ok("nenhum campo passa de 1024", (grande.fields ?? []).every((c) => c.value.length <= LIMITES.EMBED_CAMPO_VALOR), true);
ok("no maximo 25 campos", (grande.fields ?? []).length <= LIMITES.EMBED_CAMPOS, true);
ok("nenhum campo sai vazio", (grande.fields ?? []).every((c) => c.value.length > 0), true);

// ===========================================================================
console.log("\n== leitura da interacao");
// ===========================================================================
// Em servidor o usuário vem em `member.user`; em DM, em `user` na raiz.
// Confundir os dois é o bug clássico de bot que só funciona num dos dois.

const emServidor = { member: { user: { id: "1", username: "davi" } } } as Interacao;
const emDm = { user: { id: "2", username: "amigo" } } as Interacao;
ok("autor em servidor", autorDaInteracao(emServidor)?.id, "1");
ok("autor em DM", autorDaInteracao(emDm)?.id, "2");
ok("sem autor devolve null", autorDaInteracao({} as Interacao), null);

const comOpcoes = {
  data: {
    name: "viewstats",
    options: [
      { name: "periodo", type: 3, value: "mes" },
      { name: "publico", type: 5, value: true },
      { name: "personagem", type: 3, value: "   " },
    ],
  },
} as Interacao;
ok("opcao de texto", opcaoTexto(comOpcoes, "periodo"), "mes");
ok("opcao ausente vira null", opcaoTexto(comOpcoes, "inexistente"), null);
ok("opcao so com espacos vira null", opcaoTexto(comOpcoes, "personagem"), null);
ok("opcao booleana", opcaoBooleana(comOpcoes, "publico", false), true);
ok("booleana ausente cai no padrao", opcaoBooleana(comOpcoes, "outra", false), false);

const submit = {
  data: {
    custom_id: MODAL.ADDHUNT,
    components: [
      { type: 1, components: [{ type: 4, custom_id: "personagem", value: " Bubble " }] },
      { type: 1, components: [{ type: 4, custom_id: "spot", value: "" }] },
      { type: 1, components: [{ type: 4, custom_id: "analyzer", value: "Session data: ..." }] },
    ],
  },
} as Interacao;
ok("campo de modal vem limpo", campoDoModal(submit, "personagem"), "Bubble");
// Campo opcional em branco chega como string vazia, não some da lista.
ok("campo em branco vira null", campoDoModal(submit, "spot"), null);
ok("campo inexistente vira null", campoDoModal(submit, "nada"), null);

// ===========================================================================
console.log("\n== definicao dos comandos");
// ===========================================================================
// Erros aqui só aparecem como 400 na hora de registrar, e o registro é manual.

ok("tres comandos", COMANDOS.map((c) => c.name), ["cadastro", "addhunt", "viewstats"]);
ok("descricao dentro de 100 caracteres", COMANDOS.every((c) => c.description.length <= 100), true);
ok("nome so com minusculas e hifen", COMANDOS.every((c) => /^[a-z-]{1,32}$/.test(c.name)), true);
ok(
  "descricao de opcao dentro de 100",
  COMANDOS.every((c) => (c.options ?? []).every((o) => o.description.length <= 100)),
  true,
);
ok(
  "escolhas de periodo batem com os rotulos",
  COMANDOS.find((c) => c.name === "viewstats")?.options?.[0].choices?.map((e) => e.value),
  ROTULOS,
);

// O analyzer precisa do campo de parágrafo: a maior sessão real medida tem
// ~1.460 caracteres, e campo curto para em 100.
const analyzer = CAMPOS_ADDHUNT.find((c) => c.id === "analyzer")!;
ok("analyzer e paragrafo", analyzer.estilo, 2);
ok("analyzer usa os 4000 do limite", analyzer.tamanhoMaximo, LIMITES.MODAL_PARAGRAFO);
ok("analyzer e obrigatorio", analyzer.obrigatorio, true);
ok("personagem e spot sao opcionais", CAMPOS_ADDHUNT.filter((c) => c.obrigatorio).length, 1);
ok("modal cabe em 5 campos", CAMPOS_ADDHUNT.length <= 5 && CAMPOS_CADASTRO.length <= 5, true);

const montado = modal(MODAL.ADDHUNT, "Importar sessão", CAMPOS_ADDHUNT);
ok("modal e o tipo 9", montado.type, 9);
ok("cada campo vai na sua action row", montado.data.components.every((l) => l.components.length === 1), true);
ok("titulo do modal cabe em 45", montado.data.title.length <= LIMITES.MODAL_TITULO, true);

// ===========================================================================
console.log("\n== JWT do bot");
// ===========================================================================
// Este é o token com que o bot fala pelo usuário. Se as claims saírem erradas o
// PostgREST aceita o token e nega tudo — falha confusa de diagnosticar.

const SEGREDO = "segredo-de-teste-que-nao-e-o-de-producao";
const token = assinarJwt("11111111-2222-3333-4444-555555555555", SEGREDO, 1_758_100_000);
ok("token tem tres partes", token.split(".").length, 3);
ok("assinatura confere", jwtConfere(token, SEGREDO), true);
ok("segredo errado nao confere", jwtConfere(token, "outro"), false);
ok("token adulterado nao confere", jwtConfere(token.slice(0, -2) + "xx", SEGREDO), false);
ok("token truncado nao confere", jwtConfere("a.b", SEGREDO), false);

// Só as duas primeiras partes são JSON; a terceira é a assinatura em bytes.
const [cab, payload] = token
  .split(".")
  .slice(0, 2)
  .map((p) => JSON.parse(Buffer.from(p, "base64url").toString()));
ok("algoritmo HS256", cab.alg, "HS256");
ok("sub e o usuario", payload.sub, "11111111-2222-3333-4444-555555555555");
// Sem `role: authenticated` o token é válido e inútil: cai em `anon`, que não
// tem política nenhuma.
ok("role authenticated", payload.role, "authenticated");
ok("audience authenticated", payload.aud, "authenticated");
ok("expira depois de emitir", payload.exp > payload.iat, true);
ok("validade curta", payload.exp - payload.iat, 120);
// base64url, não base64: `+` e `/` quebrariam o header Authorization.
ok("sem caractere fora do base64url", /^[A-Za-z0-9._-]+$/.test(token), true);

// ===========================================================================
console.log("\n== fuso na importacao");
// ===========================================================================
// Sem o fuso IANA não dá para dizer a que dia de Tibia a sessão pertence: 19:34
// em São Paulo é 00:34 em Berlim, ou seja, ainda o dia anterior.

const emSaoPaulo = instanteDoRelogioLocal("2026-09-15T19:34:12", "America/Sao_Paulo");
ok("relogio local vira instante UTC", emSaoPaulo.toISOString(), "2026-09-15T22:34:12.000Z");
ok("o dia de Tibia sai do instante, nao do relogio", diaTibia(emSaoPaulo), "2026-09-15");

// 08:00 em São Paulo do dia 16 é 13:00 em Berlim: já passou do server save.
ok(
  "manha em SP ja e o dia novo em Berlim",
  diaTibia(instanteDoRelogioLocal("2026-09-16T08:00:00", "America/Sao_Paulo")),
  "2026-09-16",
);
// 04:00 em São Paulo do dia 16 é 09:00 em Berlim: ANTES do save, dia anterior.
ok(
  "madrugada em SP ainda e o dia anterior no jogo",
  diaTibia(instanteDoRelogioLocal("2026-09-16T04:00:00", "America/Sao_Paulo")),
  "2026-09-15",
);
// O mesmo relógio em fusos diferentes dá instantes diferentes. É exatamente o
// que se perde ao assumir UTC para todo mundo.
ok(
  "o fuso muda o instante",
  instanteDoRelogioLocal("2026-09-15T19:34:12", "Europe/Berlin").toISOString(),
  "2026-09-15T17:34:12.000Z",
);

ok("fuso IANA valido", fusoValido("America/Sao_Paulo"), true);
ok("fuso inventado e recusado", fusoValido("Mars/Olympus"), false);
ok("string vazia e recusada", fusoValido(""), false);

// ===========================================================================
console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
