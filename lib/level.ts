/**
 * Previsão de level a partir do ritmo REAL das hunts do jogador.
 *
 * É o que separa esta ferramenta de uma calculadora genérica: o XP/h não é
 * digitado, sai das sessões importadas, pela mesma regra do resto do app —
 * `Σ XP / Σ horas`, nunca a média das médias.
 *
 * Tudo aqui é função pura: sem rede, sem banco, sem relógio. Quem chama passa
 * o `agora`, e é isso que deixa `lib/level.test.ts` rodar em qualquer máquina.
 */

/**
 * Teto da busca de `levelDeXp`. O maior char do jogo está na casa dos 2.500;
 * 10.000 dá folga e mantém a XP em ~1,7·10¹³, longe do limite de inteiro
 * exato do JavaScript (2⁵³ ≈ 9·10¹⁵).
 */
export const LEVEL_MAXIMO = 10_000;

/** Abaixo disso o ritmo é pouco confiável: uma hunt boa ou ruim decide tudo. */
export const MINIMO_HUNTS = 3;
export const MINIMO_HORAS = 5;

/** Janela do "ritmo recente" e das horas por semana. */
export const DIAS_RECENTES = 30;
const DIAS_HORAS_POR_SEMANA = 28;

const MS_POR_DIA = 86_400_000;

/**
 * XP total para CHEGAR ao level, pela fórmula oficial:
 * `50/3 · (L³ − 6L² + 17L − 12)`.
 *
 * O polinômio é sempre múltiplo de 3 (L³ − L é, pelo pequeno teorema de
 * Fermat, e o resto dos termos também), então a divisão é feita antes da
 * multiplicação e o resultado é inteiro exato — sem `Math.round` escondendo erro.
 */
export function xpParaLevel(level: number): number {
  if (!Number.isInteger(level) || level <= 1) return 0;
  const L = level;
  return ((L ** 3 - 6 * L ** 2 + 17 * L - 12) / 3) * 50;
}

/** O level de quem tem esta XP total: o maior L com `xpParaLevel(L) ≤ xp`. */
export function levelDeXp(xp: number): number {
  if (!(xp > 0)) return 1;
  let baixo = 1;
  let alto = LEVEL_MAXIMO;
  while (baixo < alto) {
    const meio = Math.ceil((baixo + alto) / 2);
    if (xpParaLevel(meio) <= xp) baixo = meio;
    else alto = meio - 1;
  }
  return baixo;
}

/** A XP que cabe dentro de um level: do começo dele até um antes do próximo. */
export function faixaDoLevel(level: number): { de: number; ate: number } {
  return { de: xpParaLevel(level), ate: xpParaLevel(level + 1) - 1 };
}

/** O mínimo que a previsão precisa de uma sessão. */
export interface SessaoDeXp {
  inicio: Date;
  duracaoS: number;
  /** `XP Gain` do Hunt Analyser, já com os bônus: é o que de fato sobe level. */
  xp: number;
}

export interface Ritmo {
  xp: number;
  segundos: number;
  hunts: number;
}

/** Soma as sessões a partir de `desde` (inclusive); sem `desde`, todas. */
export function somarRitmo(sessoes: readonly SessaoDeXp[], desde?: Date): Ritmo {
  const r: Ritmo = { xp: 0, segundos: 0, hunts: 0 };
  for (const s of sessoes) {
    if (desde && s.inicio < desde) continue;
    r.xp += s.xp;
    r.segundos += s.duracaoS;
    r.hunts++;
  }
  return r;
}

/** `Σ XP / Σ horas`. Sem tempo caçado não há ritmo: `null`, não zero. */
export function xpPorHora(r: Ritmo): number | null {
  return r.segundos > 0 ? r.xp / (r.segundos / 3600) : null;
}

export function ritmoFraco(r: Ritmo): boolean {
  return r.hunts < MINIMO_HUNTS || r.segundos < MINIMO_HORAS * 3600;
}

/**
 * Quantas horas por semana o jogador caça, olhando as últimas 4 semanas.
 *
 * O divisor é o tempo que o lootibia de fato OBSERVOU, não 4 semanas cravadas:
 * quem começou a importar há 8 dias e caçou 10 h está no ritmo de ~8,8 h por
 * semana, não de 2,5. Por isso ele vai da sessão mais antiga até `agora`,
 * limitado a 28 dias, e nunca abaixo de 7 — uma hunt ontem não é "140 h por
 * semana".
 *
 * Sem hunt nenhuma na janela, `null`: quem parou de caçar não tem data
 * prevista, e inventar uma seria pior que dizer isso.
 */
export function horasPorSemana(sessoes: readonly SessaoDeXp[], agora: Date): number | null {
  if (sessoes.length === 0) return null;
  const inicioJanela = new Date(agora.getTime() - DIAS_HORAS_POR_SEMANA * MS_POR_DIA);
  const r = somarRitmo(sessoes, inicioJanela);
  if (r.segundos === 0) return null;

  const primeira = Math.min(...sessoes.map((s) => s.inicio.getTime()));
  const dias = Math.min(
    DIAS_HORAS_POR_SEMANA,
    Math.max(7, (agora.getTime() - primeira) / MS_POR_DIA),
  );
  return r.segundos / 3600 / (dias / 7);
}

/** Uma semana tem 168 horas; mais que isso é erro de digitação. */
export const HORAS_NA_SEMANA = 168;

/**
 * Lê as horas por semana que o jogador digitou: aceita `10`, `10,5` e `10.5`.
 *
 * Vazio é `null` (usar o medido); o que não é número entre 0 e 168 é
 * `"invalido"`, para a tela dizer isso em vez de prever com lixo.
 */
export function lerHorasPorSemana(texto: string): number | null | "invalido" {
  const t = texto.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d+)?$/.test(t)) return "invalido";
  const h = Number(t);
  return h > 0 && h <= HORAS_NA_SEMANA ? h : "invalido";
}

export interface Previsao {
  xpFaltando: number;
  horas: number;
  /** `null` quando não há horas por semana para projetar no calendário. */
  semanas: number | null;
  data: Date | null;
}

/**
 * Quanto falta para `levelAlvo`, em XP, em horas de hunt e no calendário.
 *
 * `null` quando não há o que prever: alvo que já foi alcançado, ou ritmo
 * zero (horas infinitas não são uma previsão).
 */
export function preverLevel(p: {
  xpAtual: number;
  levelAlvo: number;
  xpPorHora: number | null;
  horasPorSemana: number | null;
  agora: Date;
}): Previsao | null {
  const alvo = xpParaLevel(p.levelAlvo);
  if (!(alvo > p.xpAtual) || !p.xpPorHora || p.xpPorHora <= 0) return null;

  const xpFaltando = alvo - p.xpAtual;
  const horas = xpFaltando / p.xpPorHora;
  const semanas = p.horasPorSemana && p.horasPorSemana > 0 ? horas / p.horasPorSemana : null;
  const data = semanas === null ? null : new Date(p.agora.getTime() + semanas * 7 * MS_POR_DIA);
  return { xpFaltando, horas, semanas, data };
}

/** O caminho inverso: com mais `horas` de hunt neste ritmo, qual level. */
export function levelDepoisDe(xpAtual: number, horas: number, xpPorHora: number): number {
  return levelDeXp(xpAtual + Math.max(0, horas) * Math.max(0, xpPorHora));
}
