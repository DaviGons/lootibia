"use client";

import { useActionState, useState } from "react";
import { cadastrarPersonagem, type Resultado } from "@/app/hunts/pastas";
import {
  HORAS_NA_SEMANA,
  LEVEL_MAXIMO,
  faixaDoLevel,
  lerHorasPorSemana,
  levelDeXp,
  levelDepoisDe,
  preverLevel,
  ritmoFraco,
  xpParaLevel,
  xpPorHora,
  type Ritmo,
} from "@/lib/level";

export interface CharDaPrevisao {
  id: number;
  nome: string;
  vocacao: string | null;
  nivel: number | null;
  vistoEm: string | null;
  recente: Ritmo;
  todas: Ritmo;
  horasPorSemana: number | null;
}

type Janela = "recente" | "todas";

const CAMPO =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const duasCasas = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1.148.717.600 → "1,15 bi". Para leitura rápida; o número inteiro vai embaixo. */
function curto(n: number): string {
  if (n >= 1e9) return `${duasCasas.format(n / 1e9)} bi`;
  if (n >= 1e6) return `${umaCasa.format(n / 1e6)} mi`;
  if (n >= 1e3) return `${umaCasa.format(n / 1e3)} mil`;
  return inteiro.format(n);
}

/**
 * Data em UTC de propósito: o componente renderiza no servidor e no navegador,
 * e fuso diferente nos dois daria um dia de diferença — erro de hidratação por
 * uma previsão que, de qualquer jeito, não tem precisão de horas.
 */
function data(d: Date): string {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Um alvo razoável para começar: o próximo múltiplo de 50. */
function alvoInicial(nivel: number | null): string {
  return nivel ? String(Math.ceil((nivel + 1) / 50) * 50) : "";
}

export function PrevisaoDeLevel({
  chars,
  agora,
  truncado,
}: {
  chars: CharDaPrevisao[];
  agora: string;
  truncado: boolean;
}) {
  const [charId, setCharId] = useState(chars[0].id);
  const c = chars.find((x) => x.id === charId) ?? chars[0];

  const [alvo, setAlvo] = useState(alvoInicial(c.nivel));
  const [xpDigitada, setXpDigitada] = useState("");
  const [janela, setJanela] = useState<Janela>(c.recente.hunts > 0 ? "recente" : "todas");
  const [horasExtra, setHorasExtra] = useState(40);
  // `null` = usar as horas medidas nas hunts. Quem importou uma sessão ontem
  // aparece como "1 h por semana", e isso empurra a data para meses adiante;
  // o campo deixa a pessoa dizer quanto caça de verdade.
  const [horasDigitadas, setHorasDigitadas] = useState<string | null>(null);

  function trocarChar(id: number) {
    const novo = chars.find((x) => x.id === id);
    if (!novo) return;
    setCharId(id);
    setAlvo(alvoInicial(novo.nivel));
    setXpDigitada("");
    setHorasDigitadas(null);
    setJanela(novo.recente.hunts > 0 ? "recente" : "todas");
  }

  const ritmo = janela === "recente" ? c.recente : c.todas;
  const xph = xpPorHora(ritmo);

  // XP atual: a exata, se a pessoa colou uma que cabe no level; senão, o
  // começo do level — por isso a previsão sem ela é pessimista.
  const digitos = xpDigitada.replace(/\D/g, "");
  let erroXp: string | null = null;
  let xpAtual = c.nivel ? xpParaLevel(c.nivel) : 0;
  let exata = false;
  if (c.nivel && digitos) {
    const faixa = faixaDoLevel(c.nivel);
    const v = Number(digitos);
    if (v < faixa.de || v > faixa.ate) {
      erroXp = `Essa XP não é de level ${c.nivel}: vai de ${inteiro.format(faixa.de)} a ${inteiro.format(faixa.ate)}. Se você já upou, atualize o level.`;
    } else {
      xpAtual = v;
      exata = true;
    }
  }

  const alvoNum = Number(alvo);
  let erroAlvo: string | null = null;
  if (c.nivel && alvo !== "") {
    if (!Number.isInteger(alvoNum) || alvoNum <= c.nivel) erroAlvo = `O level alvo tem que ser maior que ${c.nivel}.`;
    else if (alvoNum > LEVEL_MAXIMO) erroAlvo = `Até level ${inteiro.format(LEVEL_MAXIMO)}.`;
  }

  const lidas = horasDigitadas === null ? null : lerHorasPorSemana(horasDigitadas);
  const erroHoras =
    lidas === "invalido" ? `Horas por semana: um número maior que 0 e até ${HORAS_NA_SEMANA}.` : null;
  const horasSemana = lidas === null ? c.horasPorSemana : lidas === "invalido" ? null : lidas;
  const horasSaoSuas = typeof lidas === "number";

  const previsao =
    c.nivel && !erroAlvo && alvo !== ""
      ? preverLevel({
          xpAtual,
          levelAlvo: alvoNum,
          xpPorHora: xph,
          horasPorSemana: horasSemana,
          agora: new Date(agora),
        })
      : null;

  return (
    <div className="flex flex-col gap-5">
      <section className="entra rounded-xl border bg-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Personagem</span>
            <select
              value={charId}
              onChange={(e) => trocarChar(Number(e.target.value))}
              className={`${CAMPO} h-[38px] cursor-pointer`}
            >
              {chars.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                  {x.nivel ? ` — lv ${x.nivel}` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Level alvo</span>
            <input
              type="number"
              inputMode="numeric"
              min={(c.nivel ?? 1) + 1}
              max={LEVEL_MAXIMO}
              step={1}
              value={alvo}
              onChange={(e) => setAlvo(e.target.value)}
              disabled={!c.nivel}
              className={CAMPO}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              XP exata <span className="font-normal">(opcional)</span>
            </span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="1.234.567.890"
              value={xpDigitada}
              onChange={(e) => setXpDigitada(e.target.value)}
              disabled={!c.nivel}
              className={CAMPO}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-medium text-muted-foreground">
              Horas de hunt por semana
              {horasDigitadas !== null && c.horasPorSemana !== null && (
                <button
                  type="button"
                  onClick={() => setHorasDigitadas(null)}
                  className="font-normal text-primary underline-offset-4 hover:underline"
                >
                  usar o medido ({umaCasa.format(c.horasPorSemana)} h)
                </button>
              )}
            </span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="10"
              value={horasDigitadas ?? (c.horasPorSemana !== null ? umaCasa.format(c.horasPorSemana) : "")}
              onChange={(e) => setHorasDigitadas(e.target.value)}
              disabled={!c.nivel}
              className={CAMPO}
            />
          </label>
        </div>

        {/* `key`: o recado da ação é deste char, e não pode sobrar ao trocar de char. */}
        <InfoDoChar key={c.id} char={c} />

        {erroAlvo && <p className="mt-3 text-xs text-destructive">{erroAlvo}</p>}
        {erroXp && <p className="mt-3 text-xs text-destructive">{erroXp}</p>}
        {erroHoras && <p className="mt-3 text-xs text-destructive">{erroHoras}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-3 border-t pt-4">
          <span className="text-xs font-medium text-muted-foreground">Ritmo de XP/h</span>
          <div className="inline-flex overflow-hidden rounded-lg border text-xs">
            {(["recente", "todas"] as const).map((j) => (
              <button
                key={j}
                type="button"
                onClick={() => setJanela(j)}
                aria-pressed={janela === j}
                className={`px-3 py-1.5 transition-colors ${
                  janela === j ? "bg-primary/15 font-medium text-foreground" : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {j === "recente" ? "Últimos 30 dias" : "Todas as hunts"}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            {xph
              ? `${curto(xph)}/h · Σ ${curto(ritmo.xp)} em ${umaCasa.format(ritmo.segundos / 3600)} h (${ritmo.hunts} ${ritmo.hunts === 1 ? "hunt" : "hunts"})`
              : "nenhuma hunt deste personagem nesta janela"}
          </span>
        </div>
        {xph !== null && ritmoFraco(ritmo) && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Pouca hunt para um ritmo confiável: uma sessão boa ou ruim muda muito a previsão.
          </p>
        )}
      </section>

      {!c.nivel ? null : xph === null ? (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          {c.todas.hunts === 0
            ? `Nenhuma hunt importada com ${c.nome}. Importe uma sessão escolhendo este personagem e a previsão aparece aqui.`
            : "Sem hunts nos últimos 30 dias. Troque para “Todas as hunts” para usar o histórico inteiro."}
        </p>
      ) : previsao ? (
        <PainelDoResultado
          nivel={c.nivel}
          alvo={alvoNum}
          xpAtual={xpAtual}
          exata={exata}
          previsao={previsao}
          xph={xph}
          horasSemana={horasSemana}
          horasSaoSuas={horasSaoSuas}
          horasExtra={horasExtra}
          setHorasExtra={setHorasExtra}
        />
      ) : null}

      {truncado && (
        <p className="text-xs text-muted-foreground">
          “Todas as hunts” considera as 1.000 sessões mais recentes da conta.
        </p>
      )}
    </div>
  );
}

function InfoDoChar({ char }: { char: CharDaPrevisao }) {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(cadastrarPersonagem, null);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>
        {[char.vocacao, char.nivel ? `level ${char.nivel}` : "level desconhecido"].filter(Boolean).join(" · ")}
        {char.vistoEm && ` · lido na TibiaData em ${new Date(char.vistoEm).toLocaleDateString("pt-BR", { timeZone: "UTC" })}`}
      </span>
      <form action={acao}>
        <input type="hidden" name="nome" value={char.nome} />
        <button
          disabled={enviando}
          className="text-primary underline-offset-4 hover:underline disabled:opacity-60"
        >
          {enviando ? "atualizando…" : "atualizar level"}
        </button>
      </form>
      {estado && !estado.ok && <span className="text-destructive">{estado.mensagem}</span>}
    </div>
  );
}

function PainelDoResultado({
  nivel,
  alvo,
  xpAtual,
  exata,
  previsao,
  xph,
  horasSemana,
  horasSaoSuas,
  horasExtra,
  setHorasExtra,
}: {
  nivel: number;
  alvo: number;
  xpAtual: number;
  exata: boolean;
  previsao: NonNullable<ReturnType<typeof preverLevel>>;
  xph: number;
  horasSemana: number | null;
  horasSaoSuas: boolean;
  horasExtra: number;
  setHorasExtra: (h: number) => void;
}) {
  const inicio = xpParaLevel(nivel);
  const fracao = (xpAtual - inicio) / (xpParaLevel(alvo) - inicio);

  return (
    <section className="entra flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Numero rotulo="XP faltando" valor={curto(previsao.xpFaltando)} detalhe={`${inteiro.format(previsao.xpFaltando)} XP`} />
        <Numero rotulo="Horas de hunt" valor={`${inteiro.format(Math.ceil(previsao.horas))} h`} detalhe={`a ${curto(xph)} de XP por hora`} />
        <Numero
          rotulo="Data prevista"
          valor={previsao.data ? data(previsao.data) : "—"}
          detalhe={
            previsao.semanas !== null && horasSemana
              ? `${inteiro.format(Math.ceil(previsao.semanas))} semanas a ${umaCasa.format(horasSemana)} h por semana${horasSaoSuas ? " (o seu número)" : " (medido)"}`
              : "diga quantas horas por semana você caça para ver a data"
          }
        />
      </div>

      <div>
        <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
          <span>lv {nivel}</span>
          <span>{umaCasa.format(fracao * 100)}%</span>
          <span>lv {alvo}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(fracao * 100, 0.5)}%` }} />
        </div>
      </div>

      {previsao.semanas !== null && horasSemana && (
        <Grafico xpAtual={xpAtual} xph={xph} horasPorSemana={horasSemana} semanas={previsao.semanas} alvo={alvo} />
      )}

      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <label htmlFor="horas-extra" className="text-xs font-medium text-muted-foreground">
          E se eu caçar mais
        </label>
        <input
          id="horas-extra"
          type="range"
          min={1}
          max={300}
          step={1}
          value={horasExtra}
          onChange={(e) => setHorasExtra(Number(e.target.value))}
          className="min-w-40 flex-1 accent-[hsl(var(--primary))]"
        />
        <span className="text-sm tabular-nums">
          {horasExtra} h → level <b>{levelDepoisDe(xpAtual, horasExtra, xph)}</b>
        </span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {exata
          ? "Com a XP exata, a conta parte do ponto em que você está. "
          : `Sem a XP exata, a conta parte do começo do level ${nivel}: a previsão pode estar até um level pessimista. A XP exata está na janela Skills do cliente. `}
        Mortes e troca de spot não entram: é o seu ritmo passado projetado adiante.
      </p>
    </section>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3.5">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{detalhe}</div>
    </div>
  );
}

/** Semanas mostradas no gráfico, no máximo. Previsão de 5 anos vira uma reta sem informação. */
const SEMANAS_NO_GRAFICO = 104;

/**
 * Level semana a semana, em SVG puro: um gráfico só não justifica uma
 * biblioteca de gráficos no bundle.
 */
function Grafico({
  xpAtual,
  xph,
  horasPorSemana,
  semanas,
  alvo,
}: {
  xpAtual: number;
  xph: number;
  horasPorSemana: number;
  semanas: number;
  alvo: number;
}) {
  const n = Math.max(2, Math.min(Math.ceil(semanas) + 1, SEMANAS_NO_GRAFICO));
  const pontos = Array.from({ length: n + 1 }, (_, w) => levelDeXp(xpAtual + w * horasPorSemana * xph));

  const L = 600;
  const A = 180;
  const m = { e: 44, d: 12, t: 12, b: 26 };
  const yMin = pontos[0];
  const yMax = Math.max(alvo, pontos[n]);
  const x = (w: number) => m.e + (w / n) * (L - m.e - m.d);
  const y = (lv: number) => m.t + (1 - (lv - yMin) / Math.max(1, yMax - yMin)) * (A - m.t - m.b);

  return (
    <figure>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label={`Level por semana, de ${yMin} a ${pontos[n]}`}>
        <line x1={m.e} x2={L - m.d} y1={y(alvo)} y2={y(alvo)} className="stroke-muted-foreground/50" strokeDasharray="4 4" />
        <text x={m.e - 6} y={y(alvo) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {alvo}
        </text>
        <text x={m.e - 6} y={y(yMin) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {yMin}
        </text>
        <polyline
          points={pontos.map((lv, w) => `${x(w)},${y(lv)}`).join(" ")}
          fill="none"
          className="stroke-primary"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        <text x={m.e} y={A - 6} className="fill-muted-foreground text-[11px]">
          hoje
        </text>
        <text x={L - m.d} y={A - 6} textAnchor="end" className="fill-muted-foreground text-[11px]">
          {n} semanas
        </text>
      </svg>
      {Math.ceil(semanas) + 1 > SEMANAS_NO_GRAFICO && (
        <figcaption className="mt-1 text-[11px] text-muted-foreground">
          O gráfico mostra os primeiros dois anos.
        </figcaption>
      )}
    </figure>
  );
}
