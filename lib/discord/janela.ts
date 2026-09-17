/**
 * Ver docs/bot-discord.md e docs/periodos.md.
 *
 * Traduz o filtro de período do `/viewstats` num intervalo `[início, fim)` em
 * UTC, pronto para virar `gte`/`lt` na consulta.
 *
 * Por que isto é um módulo e não um `switch` dentro do comando: **as fronteiras
 * são as do jogo, não as do calendário civil**. Uma semana aqui abre no server
 * save de segunda (10:00 de Berlim, que é 08:00Z no verão e 09:00Z no inverno),
 * não à meia-noite. Toda a aritmética fica em `lib/periodo.ts`; este arquivo só
 * escolhe qual intervalo o rótulo pede.
 *
 * O `/viewstats` sem argumento responde "semana atual" — que é o padrão da tela
 * — mas o doc já antecipa que isso vai faltar na primeira semana de uso, por
 * isso os quatro rótulos existem desde o começo.
 */

import {
  diaTibia,
  semanaTibia,
  diasDaSemana,
  intervaloDaSemana,
  instanteDoServerSave,
  somarDias,
  type Intervalo,
} from "../periodo.ts";

/** Os rótulos que o slash command oferece. */
export type RotuloDeJanela = "semana" | "semana-passada" | "mes" | "tudo";

export const ROTULOS: RotuloDeJanela[] = ["semana", "semana-passada", "mes", "tudo"];

export const ROTULO_PADRAO: RotuloDeJanela = "semana";

/** Como cada rótulo aparece para o usuário, no embed e no menu do comando. */
export const NOME_AMIGAVEL: Record<RotuloDeJanela, string> = {
  semana: "Esta semana",
  "semana-passada": "Semana passada",
  mes: "Este mês",
  tudo: "Tudo",
};

/**
 * Intervalo aberto no fim: `[inicio, fim)`. `inicio` nulo em "tudo" — não
 * existe fronteira inferior, e inventar uma (epoch, 2011) só acrescentaria uma
 * comparação inútil na consulta.
 */
export interface JanelaDeTempo {
  rotulo: RotuloDeJanela;
  inicio: Date | null;
  fim: Date | null;
}

/** Aceita só os quatro rótulos conhecidos; qualquer outra coisa vira o padrão. */
export function lerRotulo(bruto: string | null | undefined): RotuloDeJanela {
  const limpo = (bruto ?? "").trim().toLowerCase();
  return (ROTULOS as string[]).includes(limpo) ? (limpo as RotuloDeJanela) : ROTULO_PADRAO;
}

/** A semana de Tibia anterior à informada. */
function semanaAnterior(semana: string): string {
  // Recua um dia a partir da segunda: cai no domingo da semana de trás. Fazer
  // pela data evita ter de tratar a virada de ano ISO na mão (a semana 1 de um
  // ano pode começar em dezembro do anterior).
  return semanaTibia(somarDias(diasDaSemana(semana)[0], -1));
}

/**
 * O mês corrente, medido em dias de Tibia.
 *
 * "Este mês" abre no server save do dia 1 e fecha no server save do dia 1 do mês
 * seguinte. Repare que NÃO é `[00:00 do dia 1, 00:00 do dia 1 seguinte)`: uma
 * hunt às 09:00 de Berlim do dia 1 pertence ao último dia do mês anterior, e é
 * exatamente esse tipo de erro silencioso que `lib/periodo.ts` existe para
 * evitar.
 */
function intervaloDoMes(dia: string): Intervalo {
  const [ano, mes] = dia.split("-").map(Number);
  const primeiro = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const proximoAno = mes === 12 ? ano + 1 : ano;
  const proximoMes = mes === 12 ? 1 : mes + 1;
  const primeiroDoSeguinte = `${proximoAno}-${String(proximoMes).padStart(2, "0")}-01`;
  return {
    inicio: instanteDoServerSave(primeiro),
    fim: instanteDoServerSave(primeiroDoSeguinte),
  };
}

/**
 * Resolve o rótulo num intervalo.
 *
 * `agora` é parâmetro em vez de `new Date()` interno para que o teste possa
 * fixar o instante — sem isso não dá para testar a virada do server save nem as
 * transições de horário de verão (diretriz 29, em espírito: nada de depender do
 * relógio de quem roda).
 */
export function janelaDe(rotulo: RotuloDeJanela, agora: Date = new Date()): JanelaDeTempo {
  const hoje = diaTibia(agora);

  switch (rotulo) {
    case "semana": {
      const { inicio, fim } = intervaloDaSemana(semanaTibia(hoje));
      return { rotulo, inicio, fim };
    }
    case "semana-passada": {
      const { inicio, fim } = intervaloDaSemana(semanaAnterior(semanaTibia(hoje)));
      return { rotulo, inicio, fim };
    }
    case "mes": {
      const { inicio, fim } = intervaloDoMes(hoje);
      return { rotulo, inicio, fim };
    }
    case "tudo":
      return { rotulo, inicio: null, fim: null };
  }
}

/**
 * Descrição curta do intervalo, para o rodapé do embed.
 *
 * O usuário precisa saber de que recorte são os números — "profit de 4,2 mi" sem
 * período não significa nada.
 *
 * As datas são **dias de Tibia**, obtidas com `diaTibia`, e não a data civil do
 * instante. A diferença é real e morde: a semana fecha em `21/09 às 08:00Z`, que
 * é 09:59 de Berlim um segundo antes — data civil 21, mas o último dia de jogo
 * INCLUÍDO é o 20, que só termina naquele server save. Formatar o instante
 * imprimiria "14/09 a 21/09" e sugeriria oito dias numa semana de sete.
 */
export function descreverJanela(j: JanelaDeTempo): string {
  if (!j.inicio || !j.fim) return NOME_AMIGAVEL[j.rotulo];

  // 'AAAA-MM-DD' → 'DD/MM'. Recorte de string, não `Date`: o rótulo já É a data
  // do dia de Tibia, e reconvertê-lo para instante só reintroduziria fuso.
  const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

  const primeiro = diaTibia(j.inicio);
  // Um segundo antes do fim exclusivo cai dentro do último dia incluído.
  const ultimo = diaTibia(new Date(j.fim.getTime() - 1000));

  return `${NOME_AMIGAVEL[j.rotulo]} · ${ddmm(primeiro)} a ${ddmm(ultimo)}`;
}
