/**
 * Ver docs/bot-discord.md e docs/hunt-analyser.md.
 *
 * Monta o embed do `/viewstats` a partir de um `ResumoDeHunts`.
 *
 * A regra que este arquivo herda e não pode afrouxar: **toda taxa é
 * `Σ total / Σ horas`**. Aqui isso é de graça, porque quem calcula é
 * `resumirHunts` — o embed só lê `resumo.porHora`. O perigo seria alguém, um dia,
 * "simplificar" somando os `/h` de cada sessão. Não existe nenhum `/h` por
 * sessão neste caminho, de propósito.
 *
 * O outro cuidado é limite de tamanho: **1.024 caracteres por campo e 6.000 no
 * embed inteiro**. Estourar é `400` do Discord, ou seja, a mensagem não sai —
 * não sai truncada. Por isso as listas são cortadas por medida do texto, não por
 * um "top 10" torcido para caber.
 *
 * Sem sprites: o Discord busca imagem de embed pelo servidor dele, e
 * `static.tibia.com` responde 403 para quem não é navegador (docs/tibia-apis.md).
 * Decidido em 2026-09-17 que o bot é texto puro.
 */

import type { ResumoDeHunts } from "../huntAgregado.ts";
import { LIMITES, COR, COR_ERRO, type Embed, type CampoDeEmbed } from "./protocolo.ts";
import { descreverJanela, type JanelaDeTempo } from "./janela.ts";

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

/** 1.284.512 — número cheio, em pt-BR. */
export function num(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

/**
 * 1.284 · 12 mil · 4,2 mi — mesma escala da tela (`compacto` em app/hunts/page).
 * Num embed a coluna é estreita e ninguém lê nove dígitos; o valor exato de
 * profit e loot continua aparecendo cheio nos campos principais.
 */
export function compacto(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000)
    return `${(n / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 10_000)
    return `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return num(n);
}

/** 12h30 — arredonda para o minuto. */
export function horas(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  // 59,7 min arredonda para 60: normaliza em vez de imprimir "3h60".
  return m === 60 ? `${h + 1}h00` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Sinal explícito no profit: -400 mil e 400 mil não podem parecer a mesma coisa. */
function comSinal(n: number): string {
  return n > 0 ? `+${compacto(n)}` : compacto(n);
}

// ---------------------------------------------------------------------------
// Listas que precisam caber
// ---------------------------------------------------------------------------

/**
 * Junta linhas até encher o campo e resume o resto em "+N outros".
 *
 * O corte é por medida do texto, não por contagem fixa: dez nomes curtos cabem,
 * dez nomes longos não. `maximo` limita a contagem por legibilidade (ninguém lê
 * 40 linhas num embed), mas quem manda no corte é o limite de caracteres.
 *
 * O rodapé "+N outros" é reservado ANTES de montar a lista, senão a última linha
 * entra e o rodapé é que não cabe.
 */
export function listaQueCabe(
  linhas: string[],
  maximo = 10,
  limite = LIMITES.EMBED_CAMPO_VALOR,
): string {
  if (linhas.length === 0) return "—";

  const candidatas = linhas.slice(0, maximo);
  const saida: string[] = [];
  let tamanho = 0;

  for (let i = 0; i < candidatas.length; i++) {
    const restantes = linhas.length - i - 1;
    const rodape = restantes > 0 ? `\n+${restantes} outros` : "";
    const custo = (saida.length === 0 ? 0 : 1) + candidatas[i].length;

    if (tamanho + custo + rodape.length > limite) break;

    saida.push(candidatas[i]);
    tamanho += custo;
  }

  const omitidas = linhas.length - saida.length;
  if (omitidas === 0) return saida.join("\n");
  if (saida.length === 0) return `${linhas.length} itens (não coube no limite do Discord)`;
  return `${saida.join("\n")}\n+${omitidas} outros`;
}

// ---------------------------------------------------------------------------
// O embed
// ---------------------------------------------------------------------------

export interface ContextoDoResumo {
  janela: JanelaDeTempo;
  /** Nome do personagem, se o comando filtrou por um. */
  personagem?: string | null;
  /** Nome de quem pediu, para o título quando a resposta é pública. */
  autor?: string | null;
}

/**
 * Embed de "nenhuma hunt no período". Caso comum, não erro: quem instala o bot
 * numa quarta-feira e pede "semana passada" cai aqui.
 */
function embedVazio(ctx: ContextoDoResumo): Embed {
  return {
    title: tituloDe(ctx),
    description:
      "Nenhuma hunt importada neste período.\n" +
      "Use `/addhunt` para colar o texto do Hunt Analyser.",
    color: COR,
    footer: { text: descreverJanela(ctx.janela) },
  };
}

function tituloDe(ctx: ContextoDoResumo): string {
  const quem = ctx.personagem ?? ctx.autor;
  return quem ? `Hunts de ${quem}` : "Hunts";
}

/**
 * Monta o embed completo.
 *
 * A ordem dos campos é a da tela: primeiro o dinheiro, depois a experiência,
 * depois o tempo, e só então as listas. Quem abre o embed quer saber se lucrou.
 */
export function embedDeResumo(resumo: ResumoDeHunts, ctx: ContextoDoResumo): Embed {
  if (resumo.hunts === 0) return embedVazio(ctx);

  // `porHora` é null só com zero horas, que zero hunts já descartou acima.
  // A checagem existe para o tipo, e o fallback nunca deve ser alcançado.
  const ph = resumo.porHora;

  const campos: CampoDeEmbed[] = [
    {
      name: "Profit",
      value: `**${comSinal(resumo.profit)}**\n${ph ? `${comSinal(ph.profit)}/h` : "—"}`,
      inline: true,
    },
    {
      name: "Loot",
      value: `**${compacto(resumo.loot)}**\n${ph ? `${compacto(ph.loot)}/h` : "—"}`,
      inline: true,
    },
    {
      name: "Supplies",
      value:
        `**${compacto(resumo.supplies)}**\n${ph ? `${compacto(ph.supplies)}/h` : "—"}` +
        (resumo.suppliesPorHunt !== null
          ? `\n${compacto(resumo.suppliesPorHunt)}/hunt`
          : ""),
      inline: true,
    },
    {
      name: "XP",
      value: `**${compacto(resumo.xp)}**\n${ph ? `${compacto(ph.xp)}/h` : "—"}`,
      inline: true,
    },
    {
      name: "XP Raw",
      value: `**${compacto(resumo.rawXp)}**\n${ph ? `${compacto(ph.rawXp)}/h` : "—"}`,
      inline: true,
    },
    {
      name: "Tempo",
      value: `**${horas(resumo.segundos)}**\n${resumo.hunts} ${resumo.hunts === 1 ? "hunt" : "hunts"}`,
      inline: true,
    },
  ];

  if (resumo.spotsMaisCacados.length > 0) {
    campos.push({
      name: "Hunts mais caçadas",
      value: listaQueCabe(
        resumo.spotsMaisCacados.map(
          (s) => `**${s.rotulo}** — ${horas(s.segundos)} · ${comSinal(s.profit)}`,
        ),
      ),
    });
  }

  if (resumo.monstrosMortos.length > 0) {
    const total = resumo.monstrosMortos.reduce((s, m) => s + m.quantidade, 0);
    campos.push({
      name: `Mobs mortos (${num(total)})`,
      value: listaQueCabe(
        resumo.monstrosMortos.map((m) => `${num(m.quantidade)}× ${m.nome}`),
      ),
    });
  }

  const embed: Embed = {
    title: tituloDe(ctx),
    color: COR,
    fields: campos.slice(0, LIMITES.EMBED_CAMPOS),
    footer: { text: rodape(resumo, ctx) },
  };

  return couberNoTotal(embed);
}

/**
 * Rodapé: o período, e o aviso de sessões sem rótulo.
 *
 * Sessão sem rótulo não entra em "hunts mais caçadas" — se o usuário não souber
 * disso, vai achar que o bot perdeu a hunt dele (docs/hunt-analyser.md, item 5).
 */
function rodape(resumo: ResumoDeHunts, ctx: ContextoDoResumo): string {
  const partes = [descreverJanela(ctx.janela)];
  if (resumo.huntsSemRotulo > 0) {
    const n = resumo.huntsSemRotulo;
    partes.push(`${n} ${n === 1 ? "hunt sem spot" : "hunts sem spot"}`);
  }
  return partes.join(" · ");
}

/** Tamanho que o Discord conta: título + descrição + campos + rodapé. */
export function tamanhoDoEmbed(e: Embed): number {
  return (
    (e.title?.length ?? 0) +
    (e.description?.length ?? 0) +
    (e.footer?.text.length ?? 0) +
    (e.fields ?? []).reduce((s, c) => s + c.name.length + c.value.length, 0)
  );
}

/**
 * Última linha de defesa contra o limite de 6.000.
 *
 * Os campos individuais já foram cortados em 1.024, mas 25 campos cheios somam
 * 25 mil. Na prática o `/viewstats` fica perto de 800 caracteres; isto existe
 * para o caso que não previmos, e derruba os campos do fim para o começo porque
 * as listas (mobs, spots) são o que menos importa quando falta espaço.
 */
function couberNoTotal(embed: Embed): Embed {
  const campos = [...(embed.fields ?? [])];
  while (campos.length > 0 && tamanhoDoEmbed({ ...embed, fields: campos }) > LIMITES.EMBED_TOTAL) {
    campos.pop();
  }
  return { ...embed, fields: campos };
}

/** Embed de erro. Sempre efêmero em quem chama — ver o handler. */
export function embedDeErro(titulo: string, detalhe?: string): Embed {
  return {
    title: titulo,
    ...(detalhe ? { description: detalhe.slice(0, LIMITES.EMBED_DESCRICAO) } : {}),
    color: COR_ERRO,
  };
}
