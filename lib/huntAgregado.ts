/**
 * Ver docs/hunt-analyser.md.
 *
 * Agregação das métricas da tela principal (Analisador de Hunts).
 *
 * A REGRA que este módulo existe para proteger:
 *
 *   NUNCA tirar média das médias. Toda taxa é `Σ total / Σ horas`, nunca a média
 *   aritmética dos `/h` de cada sessão.
 *
 * Uma hunt de 10 min com XP/h inflado tem o mesmo peso que uma de 4 h na média
 * simples, e distorce o resultado. Ponderar pelo tempo é o que torna hunts de
 * durações diferentes comparáveis. Por isso o tipo de entrada nem expõe taxa por
 * sessão: só existem totais e duração.
 */

import type { SessaoHunt } from "./huntSession.ts";

/** Sessão com o rótulo que o usuário deu ao spot, para 'Hunts mais caçadas'. */
export interface SessaoRotulada extends SessaoHunt {
  /**
   * Nome do spot dado pelo usuário, ex.: 'Asura Palace'. O Hunt Analyser NÃO
   * fornece isso — é campo do app, capturado na importação.
   */
  rotulo?: string;
}

export interface TotaisPorHora {
  profit: number;
  loot: number;
  supplies: number;
  xp: number;
  rawXp: number;
}

export interface SpotCacado {
  rotulo: string;
  hunts: number;
  segundos: number;
  profit: number;
}

export interface ResumoDeHunts {
  hunts: number;
  segundos: number;
  horas: number;

  /** Σ Balance. */
  profit: number;
  loot: number;
  supplies: number;
  xp: number;
  rawXp: number;
  damage: number;
  healing: number;

  /** Σ total / Σ horas. Zero hunts ⇒ null, não zero. */
  porHora: TotaisPorHora | null;
  /** Σ Supplies / nº de hunts. Secundário; o útil é `porHora.supplies`. */
  suppliesPorHunt: number | null;

  /** Contagem por monstro, da maior para a menor. */
  monstrosMortos: { nome: string; quantidade: number }[];
  /** Contagem por item, da maior para a menor. */
  itensLootados: { nome: string; quantidade: number }[];

  /** Spots ordenados por tempo caçado. Sessões sem rótulo ficam de fora. */
  spotsMaisCacados: SpotCacado[];
  /** Quantas sessões entraram sem rótulo — o app deve pedir para nomear. */
  huntsSemRotulo: number;
}

function somarContagens(
  sessoes: readonly SessaoHunt[],
  campo: "monstrosMortos" | "itensLootados",
): { nome: string; quantidade: number }[] {
  const acumulado = new Map<string, number>();
  for (const s of sessoes) {
    for (const c of s[campo]) {
      acumulado.set(c.nome, (acumulado.get(c.nome) ?? 0) + c.quantidade);
    }
  }
  return [...acumulado]
    .map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));
}

function agruparSpots(sessoes: readonly SessaoRotulada[]): {
  spots: SpotCacado[];
  semRotulo: number;
} {
  const porRotulo = new Map<string, SpotCacado>();
  let semRotulo = 0;
  for (const s of sessoes) {
    const rotulo = s.rotulo?.trim();
    if (!rotulo) {
      semRotulo++;
      continue;
    }
    const atual = porRotulo.get(rotulo) ?? { rotulo, hunts: 0, segundos: 0, profit: 0 };
    atual.hunts++;
    atual.segundos += s.duracaoSegundos;
    atual.profit += s.balance;
    porRotulo.set(rotulo, atual);
  }
  const spots = [...porRotulo.values()].sort(
    (a, b) => b.segundos - a.segundos || a.rotulo.localeCompare(b.rotulo),
  );
  return { spots, semRotulo };
}

/** Consolida um conjunto de sessões. A janela (semana, dia) é escolhida fora. */
export function resumirHunts(sessoes: readonly SessaoRotulada[]): ResumoDeHunts {
  const segundos = sessoes.reduce((s, x) => s + x.duracaoSegundos, 0);
  const horas = segundos / 3600;

  const profit = sessoes.reduce((s, x) => s + x.balance, 0);
  const loot = sessoes.reduce((s, x) => s + x.loot, 0);
  const supplies = sessoes.reduce((s, x) => s + x.supplies, 0);
  const xp = sessoes.reduce((s, x) => s + x.xpGain, 0);
  const rawXp = sessoes.reduce((s, x) => s + x.rawXpGain, 0);
  const damage = sessoes.reduce((s, x) => s + x.damage, 0);
  const healing = sessoes.reduce((s, x) => s + x.healing, 0);

  const { spots, semRotulo } = agruparSpots(sessoes);

  return {
    hunts: sessoes.length,
    segundos,
    horas,
    profit,
    loot,
    supplies,
    xp,
    rawXp,
    damage,
    healing,
    // Divisão por zero vira null: "sem dados" não é "zero por hora".
    porHora:
      horas > 0
        ? {
            profit: profit / horas,
            loot: loot / horas,
            supplies: supplies / horas,
            xp: xp / horas,
            rawXp: rawXp / horas,
          }
        : null,
    suppliesPorHunt: sessoes.length > 0 ? supplies / sessoes.length : null,
    monstrosMortos: somarContagens(sessoes, "monstrosMortos"),
    itensLootados: somarContagens(sessoes, "itensLootados"),
    spotsMaisCacados: spots,
    huntsSemRotulo: semRotulo,
  };
}

/**
 * Agrupa sessões por uma chave de período e resume cada grupo.
 *
 * `chaveDoPeriodo` recebe a sessão e devolve o rótulo do período — tipicamente
 * `semanaTibia(diaTibia(instante))` de lib/periodo.ts. Fica como parâmetro
 * porque converter o relógio local da sessão em instante exige o fuso do
 * usuário, que este módulo não conhece.
 */
export function resumirPorPeriodo<T extends SessaoRotulada>(
  sessoes: readonly T[],
  chaveDoPeriodo: (sessao: T) => string,
): Map<string, ResumoDeHunts> {
  const grupos = new Map<string, T[]>();
  for (const s of sessoes) {
    const chave = chaveDoPeriodo(s);
    const atual = grupos.get(chave);
    if (atual) atual.push(s);
    else grupos.set(chave, [s]);
  }
  const saida = new Map<string, ResumoDeHunts>();
  for (const chave of [...grupos.keys()].sort()) {
    saida.set(chave, resumirHunts(grupos.get(chave)!));
  }
  return saida;
}
