/**
 * Ver docs/periodos.md. A mesma regra está replicada em SQL na view
 * `sessao_periodo` de supabase/migrations/0001_schema.sql — se mudar aqui,
 * mudar lá.
 *
 * Calendário do jogo: converte instantes em "dia de Tibia" e agrupa dias em
 * semanas, para que dados coletados em momentos diferentes possam ser
 * organizados em períodos comparáveis.
 *
 * Por que isso não é só `new Date()`:
 *
 * 1. O dia do jogo vira no SERVER SAVE, às 10:00:00 no fuso Europe/Berlin,
 *    padronizado desde 21/09/2011. Um kill às 09:00 de Berlim pertence ao dia
 *    ANTERIOR. Usar meia-noite, ou o fuso do usuário, desalinha tudo.
 *
 * 2. Berlim alterna entre CET (UTC+1) e CEST (UTC+2). O server save acontece
 *    às 08:00Z no verão e às 09:00Z no inverno. Offset fixo quebra duas vezes
 *    por ano, e de forma silenciosa — os números só ficam "um pouco errados".
 *
 * 3. Nos dois domingos de transição, o dia de Tibia tem 23 h ou 25 h. Qualquer
 *    lógica que assuma 86.400.000 ms por dia erra nessas datas.
 *
 * Não há dependência externa: a conversão de fuso usa `Intl.DateTimeFormat`,
 * que carrega o banco IANA do próprio runtime.
 *
 * Convenções:
 * - Instantes trafegam e são persistidos em UTC (`timestamptz`). Rótulo de dia
 *   e de semana são DERIVADOS, nunca armazenados junto (diretriz 6).
 * - O rótulo de um dia é a data do server save que o abriu, em ISO 'YYYY-MM-DD'.
 *   Cabe num `date` de 4 bytes, se algum dia precisar ser coluna (diretriz 9).
 */

/** Fuso oficial do server save. Nunca substituir por offset fixo. */
export const FUSO_SERVER_SAVE = "Europe/Berlin";

/** Hora local de Berlim em que o server save ocorre. */
export const HORA_SERVER_SAVE = 10;

/** Data do primeiro dia em que todos os mundos passaram a salvar às 10:00. */
export const INICIO_SERVER_SAVE_PADRONIZADO = "2011-09-21";

/** Rótulo de dia de Tibia: data ISO do server save que abriu o dia. */
export type DiaTibia = string;

/** Rótulo de semana no formato ISO-8601, ex.: '2026-W38'. */
export type SemanaTibia = string;

export interface Intervalo {
  /** Instante de abertura, inclusivo. */
  inicio: Date;
  /** Instante de fechamento, EXCLUSIVO. */
  fim: Date;
}

export interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

const FORMATADOR = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO_SERVER_SAVE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const MS_POR_DIA = 86_400_000;

/** Decompõe um instante no relógio de parede de Berlim. */
export function partesEmBerlim(instante: Date): PartesLocais {
  const partes: Record<string, string> = {};
  for (const p of FORMATADOR.formatToParts(instante)) {
    if (p.type !== "literal") partes[p.type] = p.value;
  }
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second),
  };
}

/** Deslocamento de Berlim em relação ao UTC, em minutos, naquele instante. */
export function deslocamentoBerlim(instante: Date): number {
  const p = partesEmBerlim(instante);
  const comoSeFosseUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  // O segundo é truncado dos dois lados, então a diferença é múltipla de 1 min.
  return Math.round((comoSeFosseUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60_000);
}

function formatarDataIso(ano: number, mes: number, dia: number): DiaTibia {
  const mm = String(mes).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return `${ano}-${mm}-${dd}`;
}

function partesDaDataIso(dia: DiaTibia): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!m) throw new Error(`Data ISO inválida: ${dia}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Instante exato (UTC) do server save de uma data.
 *
 * Resolve o offset por aproximação sucessiva: chuta o instante assumindo UTC,
 * mede o offset real de Berlim ali e corrige. Duas iterações bastam, e 10:00
 * nunca cai no buraco de DST (as transições ocorrem às 02:00/03:00), então não
 * existe hora ambígua ou inexistente para tratar.
 */
export function instanteDoServerSave(dia: DiaTibia): Date {
  const [ano, mes, d] = partesDaDataIso(dia);
  const alvo = Date.UTC(ano, mes - 1, d, HORA_SERVER_SAVE, 0, 0);
  let ts = alvo;
  for (let i = 0; i < 2; i++) {
    ts = alvo - deslocamentoBerlim(new Date(ts)) * 60_000;
  }
  return new Date(ts);
}

/**
 * A que dia de Tibia um instante pertence.
 * Antes das 10:00 de Berlim, o instante ainda pertence ao dia anterior.
 */
export function diaTibia(instante: Date): DiaTibia {
  const p = partesEmBerlim(instante);
  if (p.hora >= HORA_SERVER_SAVE) return formatarDataIso(p.ano, p.mes, p.dia);
  const anterior = new Date(Date.UTC(p.ano, p.mes - 1, p.dia) - MS_POR_DIA);
  return formatarDataIso(
    anterior.getUTCFullYear(),
    anterior.getUTCMonth() + 1,
    anterior.getUTCDate(),
  );
}

/** Intervalo [server save, próximo server save) de um dia de Tibia. */
export function intervaloDoDia(dia: DiaTibia): Intervalo {
  return { inicio: instanteDoServerSave(dia), fim: instanteDoServerSave(somarDias(dia, 1)) };
}

/** Avança (ou recua) uma data ISO em N dias de calendário. */
export function somarDias(dia: DiaTibia, n: number): DiaTibia {
  const [ano, mes, d] = partesDaDataIso(dia);
  const t = new Date(Date.UTC(ano, mes - 1, d) + n * MS_POR_DIA);
  return formatarDataIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Duração real de um dia de Tibia em horas: 23, 24 ou 25 conforme o DST. */
export function horasNoDia(dia: DiaTibia): number {
  const { inicio, fim } = intervaloDoDia(dia);
  return (fim.getTime() - inicio.getTime()) / 3_600_000;
}

/**
 * Semana ISO-8601 do dia: segunda a domingo, e a semana 1 é a que contém a
 * primeira quinta-feira do ano. Note que o ano do rótulo pode diferir do ano da
 * data na virada (31/12 pode ser semana 1 do ano seguinte) — é o comportamento
 * correto da norma, não um bug.
 */
export function semanaTibia(dia: DiaTibia): SemanaTibia {
  const [ano, mes, d] = partesDaDataIso(dia);
  const t = new Date(Date.UTC(ano, mes - 1, d));
  // Desloca para a quinta-feira da mesma semana; o ano dela é o ano ISO.
  const diaSemana = (t.getUTCDay() + 6) % 7; // 0 = segunda
  t.setUTCDate(t.getUTCDate() - diaSemana + 3);
  const anoIso = t.getUTCFullYear();
  const primeiraQuinta = new Date(Date.UTC(anoIso, 0, 4));
  const deslocPrimeira = (primeiraQuinta.getUTCDay() + 6) % 7;
  primeiraQuinta.setUTCDate(primeiraQuinta.getUTCDate() - deslocPrimeira + 3);
  const semana = 1 + Math.round((t.getTime() - primeiraQuinta.getTime()) / (7 * MS_POR_DIA));
  return `${anoIso}-W${String(semana).padStart(2, "0")}`;
}

/** Os sete dias de Tibia de uma semana ISO, de segunda a domingo. */
export function diasDaSemana(semana: SemanaTibia): DiaTibia[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(semana);
  if (!m) throw new Error(`Semana ISO inválida: ${semana}`);
  const anoIso = Number(m[1]);
  const numero = Number(m[2]);
  // Segunda-feira da semana 1: recua da quinta que contém 4 de janeiro.
  const quatroDeJaneiro = new Date(Date.UTC(anoIso, 0, 4));
  const desloc = (quatroDeJaneiro.getUTCDay() + 6) % 7;
  const segundaDaSemana1 = new Date(quatroDeJaneiro.getTime() - desloc * MS_POR_DIA);
  const inicio = new Date(segundaDaSemana1.getTime() + (numero - 1) * 7 * MS_POR_DIA);
  const primeiro = formatarDataIso(
    inicio.getUTCFullYear(),
    inicio.getUTCMonth() + 1,
    inicio.getUTCDate(),
  );
  return Array.from({ length: 7 }, (_, i) => somarDias(primeiro, i));
}

/** Intervalo [abertura da segunda, abertura da segunda seguinte) da semana. */
export function intervaloDaSemana(semana: SemanaTibia): Intervalo {
  const dias = diasDaSemana(semana);
  return {
    inicio: instanteDoServerSave(dias[0]),
    fim: instanteDoServerSave(somarDias(dias[6], 1)),
  };
}

/** Todos os dias de Tibia entre duas datas, inclusive nas duas pontas. */
export function diasEntre(de: DiaTibia, ate: DiaTibia): DiaTibia[] {
  const saida: DiaTibia[] = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) saida.push(d);
  return saida;
}

/** Todas as semanas ISO tocadas pelo intervalo de dias, sem repetição. */
export function semanasEntre(de: DiaTibia, ate: DiaTibia): SemanaTibia[] {
  const vistas = new Set<SemanaTibia>();
  for (const d of diasEntre(de, ate)) vistas.add(semanaTibia(d));
  return [...vistas];
}
