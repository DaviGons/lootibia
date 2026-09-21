/**
 * Onde o Rashid está hoje.
 *
 * Ele muda de cidade **no server save**, não à meia-noite. Às 08:00 de Berlim
 * numa terça ele ainda está na cidade de segunda. Por isso a pergunta "que dia
 * é hoje" passa por `diaTibia()` (ver `lib/periodo.ts`) e não por
 * `Date.getDay()` — que erraria durante 10 horas, todo dia.
 *
 * É também o motivo de `lib/periodo.ts` continuar existindo depois que a
 * semana saiu da tela: ele deixou de ser o eixo da interface e virou o motor
 * que sabe a que dia de jogo um instante pertence.
 *
 * ## Origem da tabela
 *
 * TibiaData **não tem** endpoint de NPC — conferido nos 20 caminhos da v4. A
 * rotação veio do TibiaWiki (`/api/npcs/Rashid`), onde os campos `city` a
 * `city7` e a prosa de `notes` concordam entre si.
 *
 * É arquivo versionado e não chamada de API pelo motivo da diretriz 33: sete
 * strings que não mudam desde sempre não justificam uma dependência de rede no
 * caminho da requisição.
 */

import { diaTibia } from "./periodo.ts";

export interface ParadaDoRashid {
  /** 1 = segunda … 7 = domingo (ISO-8601). */
  readonly dia: number;
  readonly cidade: string;
  /** Onde exatamente, para quem nunca foi. Vazio quando o wiki não diz. */
  readonly onde: string;
}

/**
 * A semana do Rashid, de segunda a domingo.
 *
 * A ordem é a do wiki (`city` = segunda), confirmada pela prosa: "On Mondays
 * you can find him in Svargrond, in Dankwart's tavern".
 */
export const ROTA: readonly ParadaDoRashid[] = [
  { dia: 1, cidade: "Svargrond", onde: "taverna do Dankwart" },
  { dia: 2, cidade: "Liberty Bay", onde: "taverna do Lyonel" },
  { dia: 3, cidade: "Port Hope", onde: "taverna do Clyde" },
  { dia: 4, cidade: "Ankrahmun", onde: "taverna do Arito" },
  { dia: 5, cidade: "Darashia", onde: "taverna da Miraia" },
  { dia: 6, cidade: "Edron", onde: "" },
  { dia: 7, cidade: "Carlin", onde: "" },
];

/**
 * Dia ISO (1 = segunda … 7 = domingo) de uma data `YYYY-MM-DD`.
 *
 * Monta em UTC ao meio-dia de propósito: `new Date("2026-09-21")` já é UTC,
 * mas `getDay()` leria no fuso local e viraria o dia para quem está a oeste de
 * Greenwich — que é o caso do Brasil inteiro.
 */
function diaIso(data: string): number {
  const d = new Date(`${data}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d; // getUTCDay devolve 0 no domingo; ISO quer 7
}

/**
 * A parada do Rashid no dia de Tibia a que `instante` pertence.
 *
 * Recebe o instante e não a data já resolvida para que quem chama não precise
 * saber que existe server save — essa é a razão de ser desta função.
 */
export function rashidEm(instante: Date = new Date()): ParadaDoRashid {
  return rashidNoDia(diaTibia(instante));
}

/** Idem, a partir de um dia de Tibia já calculado (`YYYY-MM-DD`). */
export function rashidNoDia(dia: string): ParadaDoRashid {
  const iso = diaIso(dia);
  const parada = ROTA.find((p) => p.dia === iso);
  // ROTA cobre 1..7 e `diaIso` só devolve 1..7, então isto não acontece — mas
  // um `!` aqui esconderia o dia em que alguém editar a ROTA e tirar uma linha.
  if (!parada) throw new Error(`ROTA do Rashid sem entrada para o dia ISO ${iso}`);
  return parada;
}
