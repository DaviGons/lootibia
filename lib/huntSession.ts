/**
 * Ver docs/hunt-analyser.md.
 *
 * Parser do texto que o Hunt Analyser do Tibia copia para a área de transferência.
 *
 * Decisões que vêm da análise do formato (docs/hunt-analyser.md tem os números):
 *
 * 1. `Balance` é sempre `Loot - Supplies`. É campo derivado: parseado para
 *    conferência, nunca persistido (diretriz 6).
 *
 * 2. Os campos `/h` do jogo (`XP/h`, `Raw XP/h`, `Damage/h`, `Healing/h`) NÃO são
 *    reproduzíveis a partir de nenhuma duração única — XP e Damage divergem em
 *    sentidos opostos. São lidos apenas para diagnóstico e marcados como não
 *    confiáveis. Toda taxa exibida pelo app se calcula dos totais.
 *
 * 3. `Session: 01:50h` trunca os minutos e erra ~0,9% numa sessão de 1h51.
 *    A duração de verdade vem de `fim - inicio`.
 *
 * 4. Os horários NÃO têm fuso: são o relógio local de quem jogou. Converter para
 *    instante exige o fuso IANA do usuário, que o app precisa capturar. Sem ele
 *    não dá para dizer a que dia de Tibia a sessão pertence — ver lib/periodo.ts.
 *
 * 5. Campo desconhecido não quebra o parse: vai para `camposIgnorados`. O formato
 *    muda entre atualizações do cliente (diretriz 21).
 */

/** Data e hora como vieram no texto, sem fuso. Ex.: '2026-09-15T19:34:12'. */
export type RelogioLocal = string;

export interface ContagemNomeada {
  nome: string;
  quantidade: number;
}

export interface SessaoHunt {
  /** Relógio local do jogador, sem fuso. Resolver com o fuso IANA do usuário. */
  inicio: RelogioLocal;
  fim: RelogioLocal;
  /** Duração real em segundos, de `fim - inicio`. Não é o `Session:` exibido. */
  duracaoSegundos: number;
  /** O que o jogo exibiu em `Session:`, em segundos. Truncado; só diagnóstico. */
  duracaoExibidaSegundos: number | null;

  rawXpGain: number;
  xpGain: number;
  loot: number;
  supplies: number;
  /** `Loot - Supplies`. Derivado — conferido no parse, não persistir. */
  balance: number;
  damage: number;
  healing: number;

  monstrosMortos: ContagemNomeada[];
  itensLootados: ContagemNomeada[];

  /**
   * Taxas que o jogo exibiu. Não reproduzíveis; guardadas só para diagnóstico.
   * Nunca usar para cálculo nem para agregação.
   */
  taxasExibidas: {
    rawXpPorHora: number | null;
    xpPorHora: number | null;
    damagePorHora: number | null;
    healingPorHora: number | null;
  };

  /** Linhas `Chave: valor` que este parser não conhece. */
  camposIgnorados: Record<string, string>;
}

export class ErroDeParse extends Error {}

const ROTULOS_NUMERICOS: Record<string, keyof SessaoHunt | string> = {
  "Raw XP Gain": "rawXpGain",
  "XP Gain": "xpGain",
  Loot: "loot",
  Supplies: "supplies",
  Balance: "balance",
  Damage: "damage",
  Healing: "healing",
};

const ROTULOS_TAXA: Record<string, string> = {
  "Raw XP/h": "rawXpPorHora",
  "XP/h": "xpPorHora",
  "Damage/h": "damagePorHora",
  "Healing/h": "healingPorHora",
};

/** Converte '10,577,467' e '-1,234' em número. */
export function numeroTibia(bruto: string): number {
  const limpo = bruto.trim().replace(/,/g, "");
  if (!/^-?\d+$/.test(limpo)) throw new ErroDeParse(`Número inválido: ${bruto}`);
  return Number(limpo);
}

/**
 * Teto do texto colado. Uma sessão real tem 1 a 2 KB (a medida em 22/09, com
 * 38 itens, tinha 1,5 KB); 64 KB cobre uma hunt enorme com folga e impede que
 * o parser gaste tempo com o que claramente não é um Hunt Analyser.
 */
export const MAX_TEXTO = 64 * 1024;

/** Data e hora como o jogo escreve: '2026-09-15, 19:34:12'. */
const DATA_HORA = String.raw`\d{4}-\d{2}-\d{2},\s*\d{2}:\d{2}:\d{2}`;

/**
 * `From <data> to <data>`, com o formato da data FIXO.
 *
 * A versão anterior era `^From\s+(.+?)\s+to\s+(.+)$`, e aquilo era
 * backtracking CÚBICO: `.+?` e os dois `\s+` disputavam os mesmos espaços.
 * Medido em 2026-09-27 com `From` seguido de espaços: 2 mil, 0,9 s; 4 mil,
 * 6,7 s; 8 mil, 50 s. Oito KB colados no formulário travavam a função até o
 * timeout. Sem ambiguidade sobre onde cada pedaço termina, 1 milhão de espaços
 * leva 2,4 ms.
 */
const INTERVALO = new RegExp(String.raw`^From\s+(${DATA_HORA})\s+to\s+(${DATA_HORA})$`, "i");

/** Converte '2026-09-15, 19:34:12' no relógio local ISO, sem fuso. */
function relogioLocal(bruto: string): RelogioLocal {
  const m = /^(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2}:\d{2})$/.exec(bruto.trim());
  if (!m) throw new ErroDeParse(`Data/hora inválida: ${bruto}`);
  return `${m[1]}T${m[2]}`;
}

function segundosEntre(inicio: RelogioLocal, fim: RelogioLocal): number {
  // Ambos são relógio local do MESMO fuso, então a diferença é válida sem
  // conhecer o fuso — exceto se a sessão atravessar uma virada de horário de
  // verão local. É a ressalva registrada em docs/hunt-analyser.md.
  const a = Date.parse(`${inicio}Z`);
  const b = Date.parse(`${fim}Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new ErroDeParse("Data/hora ilegível");
  return (b - a) / 1000;
}

/**
 * Normaliza nome vindo do jogo: remove o artigo inicial e espaços duplicados.
 * O jogo já escreve no singular ('413x a great mana potion'), então não há
 * plural a desfazer (diretriz 52). O que falta para casar com o wiki é a caixa
 * do título, e isso é de lib/nomesDeItem.ts e lib/nomesDeCriatura.ts
 * (diretriz 23).
 */
export function normalizarNome(bruto: string): string {
  return bruto.trim().replace(/^(an?)\s+/i, "").replace(/\s+/g, " ");
}

/**
 * Teto de um nome de monstro ou item, igual ao `check` das tabelas de lookup
 * (migration 0005). O maior nome gravado em 2026-09-27 tinha 27 caracteres.
 */
export const MAX_NOME = 100;

function lerContagens(linhas: string[]): ContagemNomeada[] {
  const saida: ContagemNomeada[] = [];
  for (const linha of linhas) {
    const m = /^([\d,]+)x\s+(.+)$/.exec(linha.trim());
    if (!m) throw new ErroDeParse(`Linha de contagem inválida: ${linha}`);
    const nome = normalizarNome(m[2]);
    if (nome.length > MAX_NOME) {
      throw new ErroDeParse(`Nome com mais de ${MAX_NOME} caracteres: ${nome.slice(0, 40)}…`);
    }
    saida.push({ nome, quantidade: numeroTibia(m[1]) });
  }
  return saida;
}

/** Converte '01:50h' em segundos. Aceita 'hh:mm' com ou sem o 'h' final. */
function duracaoExibida(bruto: string): number | null {
  const m = /^(\d{1,3}):(\d{2})h?$/.exec(bruto.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

/**
 * Lê o texto do Hunt Analyser.
 * @throws {ErroDeParse} se faltar o cabeçalho de sessão ou algum total.
 */
export function lerSessaoHunt(texto: string): SessaoHunt {
  if (texto.length > MAX_TEXTO) {
    throw new ErroDeParse(
      `Texto grande demais (${Math.round(texto.length / 1024)} KB). O Hunt Analyser copia poucos KB — cole só uma sessão.`,
    );
  }

  const linhas = texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const numericos: Record<string, number> = {};
  const taxas: Record<string, number> = {};
  const camposIgnorados: Record<string, string> = {};
  let inicio: RelogioLocal | null = null;
  let fim: RelogioLocal | null = null;
  let duracaoExibidaSegundos: number | null = null;

  const monstros: string[] = [];
  const itens: string[] = [];
  let secao: "nenhuma" | "monstros" | "itens" = "nenhuma";

  for (const linha of linhas) {
    if (/^Killed Monsters:?$/i.test(linha)) {
      secao = "monstros";
      continue;
    }
    if (/^Looted Items:?$/i.test(linha)) {
      secao = "itens";
      continue;
    }

    // Dentro de uma seção, linhas 'Nx nome' são contagens; qualquer outra
    // encerra a seção e volta a ser tratada como campo.
    if (secao !== "nenhuma" && /^[\d,]+x\s+/.test(linha)) {
      (secao === "monstros" ? monstros : itens).push(linha);
      continue;
    }

    const m = /^([^:]+):\s*(.*)$/.exec(linha);
    if (!m) continue;
    const rotulo = m[1].trim();
    const valor = m[2].trim();
    secao = "nenhuma";

    if (/^Session data$/i.test(rotulo)) {
      const intervalo = INTERVALO.exec(valor);
      if (!intervalo) throw new ErroDeParse(`Intervalo de sessão inválido: ${valor}`);
      inicio = relogioLocal(intervalo[1]);
      fim = relogioLocal(intervalo[2]);
    } else if (/^Session$/i.test(rotulo)) {
      duracaoExibidaSegundos = duracaoExibida(valor);
    } else if (rotulo in ROTULOS_TAXA) {
      taxas[ROTULOS_TAXA[rotulo]] = numeroTibia(valor);
    } else if (rotulo in ROTULOS_NUMERICOS) {
      numericos[ROTULOS_NUMERICOS[rotulo] as string] = numeroTibia(valor);
    } else {
      camposIgnorados[rotulo] = valor;
    }
  }

  if (!inicio || !fim) throw new ErroDeParse("Faltou a linha 'Session data: From ... to ...'");
  for (const chave of ["rawXpGain", "xpGain", "loot", "supplies", "damage", "healing"]) {
    if (!(chave in numericos)) throw new ErroDeParse(`Faltou o total '${chave}'`);
  }

  const loot = numericos.loot;
  const supplies = numericos.supplies;
  const balance = "balance" in numericos ? numericos.balance : loot - supplies;
  if (balance !== loot - supplies) {
    throw new ErroDeParse(
      `Balance inconsistente: texto diz ${balance}, mas Loot - Supplies = ${loot - supplies}`,
    );
  }

  const duracaoSegundos = segundosEntre(inicio, fim);
  if (duracaoSegundos <= 0) throw new ErroDeParse("Sessão com duração zero ou negativa");

  return {
    inicio,
    fim,
    duracaoSegundos,
    duracaoExibidaSegundos,
    rawXpGain: numericos.rawXpGain,
    xpGain: numericos.xpGain,
    loot,
    supplies,
    balance,
    damage: numericos.damage,
    healing: numericos.healing,
    monstrosMortos: lerContagens(monstros),
    itensLootados: lerContagens(itens),
    taxasExibidas: {
      rawXpPorHora: taxas.rawXpPorHora ?? null,
      xpPorHora: taxas.xpPorHora ?? null,
      damagePorHora: taxas.damagePorHora ?? null,
      healingPorHora: taxas.healingPorHora ?? null,
    },
    camposIgnorados,
  };
}
