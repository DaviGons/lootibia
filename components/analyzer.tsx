"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { spriteDe } from "@/lib/sprites";
import { detalheDaSessao, type DetalheDaSessao } from "@/app/hunts/detalhe";

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function horas(segundos: number): string {
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * O analyzer de uma sessão, como o do jogo mas com o que o jogo não mostra.
 *
 * O detalhe é buscado **ao abrir**, não junto da lista: uma sessão traz dezenas
 * de itens e a tela carrega até 500 sessões (ver `app/hunts/detalhe.ts`).
 *
 * Busca uma vez por sessão e guarda: reabrir não volta ao banco. Os números de
 * uma sessão encerrada não mudam — ela é um registro do passado.
 */
export function Analyzer({ sessaoId, spot }: { sessaoId: number; spot: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<DetalheDaSessao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // `showModal()` e não o atributo `open`: só ele ativa o backdrop e a
    // armadilha de foco.
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  async function abrir() {
    setAberto(true);
    if (dados) return; // já buscado; sessão encerrada não muda
    setErro(null);
    const r = await detalheDaSessao(sessaoId);
    if (r) setDados(r);
    else setErro("Não deu para ler esta sessão.");
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title="Ver analyzer desta sessão"
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <ScrollText className="h-3.5 w-3.5" />
        analyzer
      </button>

      <dialog
        ref={ref}
        onClose={() => setAberto(false)}
        onClick={(e) => {
          // Alvo ser o próprio <dialog> significa clique no backdrop.
          if (e.target === ref.current) setAberto(false);
        }}
        className="w-[min(46rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
      >
        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{spot ?? "Sessão sem spot"}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {dados
                  ? [
                      new Date(dados.inicio).toLocaleString("pt-BR"),
                      horas(dados.duracaoSegundos),
                      dados.personagem,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : erro
                    ? "—"
                    : "carregando…"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAberto(false)}
              className="shrink-0 rounded-lg border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Fechar
            </button>
          </div>

          {erro && <p className="text-sm text-destructive">{erro}</p>}

          {!dados && !erro && (
            <div className="space-y-3">
              <div className="h-20 animate-pulse rounded-lg bg-muted" />
              <div className="h-40 animate-pulse rounded-lg bg-muted" />
            </div>
          )}

          {dados && <Corpo d={dados} />}
        </div>
      </dialog>
    </>
  );
}

function Corpo({ d }: { d: DetalheDaSessao }) {
  const balance = d.loot - d.supplies;
  const h = d.duracaoSegundos / 3600;
  // `Σ total / Σ horas`, com uma sessão só — a mesma regra do resumo, e não a
  // taxa que o texto do jogo traz (que não se persiste, ver AGENTS.md).
  const porHora = (n: number) => (h > 0 ? n / h : 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
        <Numero rotulo="Profit" valor={balance} porHora={porHora(balance)} destaque />
        <Numero rotulo="Loot" valor={d.loot} porHora={porHora(d.loot)} />
        <Numero rotulo="Supplies" valor={d.supplies} porHora={porHora(d.supplies)} />
        <Numero rotulo="XP" valor={d.xp} porHora={porHora(d.xp)} />
        <Numero rotulo="XP Raw" valor={d.rawXp} porHora={porHora(d.rawXp)} />
        <Numero rotulo="Dano" valor={d.damage} porHora={porHora(d.damage)} />
        <Numero rotulo="Cura" valor={d.healing} porHora={porHora(d.healing)} />
        <Numero rotulo="Duração" texto={horas(d.duracaoSegundos)} />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Lista
          titulo="Monstros eliminados"
          total={d.monstros.reduce((s, m) => s + m.quantidade, 0)}
          itens={d.monstros}
          comSprite
          vazio="O texto não trouxe monstros."
        />
        <Lista
          titulo="Itens lootados"
          total={d.itens.length}
          sufixo="tipos"
          itens={d.itens}
          vazio="O texto não trouxe itens."
        />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Quantidades, não valores: nenhuma API pública traz preço de mercado do Tibia, então somar
        gold por item seria número inventado.
      </p>
    </>
  );
}

function Numero({
  rotulo,
  valor,
  porHora,
  texto,
  destaque,
}: {
  rotulo: string;
  valor?: number;
  porHora?: number;
  texto?: string;
  destaque?: boolean;
}) {
  const negativo = destaque && valor !== undefined && valor < 0;
  return (
    <div className="bg-card p-3">
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
      <div
        className={`mt-0.5 tabular-nums ${destaque ? "text-base font-semibold" : "text-sm font-medium"} ${
          negativo ? "text-destructive" : ""
        }`}
      >
        {texto ?? num(valor ?? 0)}
      </div>
      {porHora !== undefined && (
        <div className="text-[11px] tabular-nums text-muted-foreground">{num(porHora)}/h</div>
      )}
    </div>
  );
}

/**
 * `sufixo` existe por causa dos itens. Somar as quantidades deles dava 64.597
 * na sessão medida — número dominado por gold coin, que mistura moeda com gema
 * e não informa nada. Para monstros a soma é o total de mortes e faz sentido;
 * para itens, o que informa é quantos TIPOS caíram.
 */
function Lista({
  titulo,
  total,
  sufixo,
  itens,
  comSprite,
  vazio,
}: {
  titulo: string;
  total: number;
  sufixo?: string;
  itens: { nome: string; quantidade: number }[];
  comSprite?: boolean;
  vazio: string;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold">
        {titulo}{" "}
        <span className="font-normal tabular-nums text-muted-foreground">
          ({num(total)}
          {sufixo ? ` ${sufixo}` : ""})
        </span>
      </h3>
      {itens.length === 0 ? (
        <p className="text-xs text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-lg border p-2">
          {itens.map((it) => (
            <li
              key={it.nome}
              className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted/50"
            >
              {comSprite && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {spriteDe(it.nome) ? (
                    // <img> cru: static.tibia.com devolve 403 para quem não é
                    // navegador, então o otimizador da Vercel levaria o mesmo 403.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={spriteDe(it.nome)}
                      alt=""
                      width={24}
                      height={24}
                      loading="lazy"
                      decoding="async"
                      className="max-h-6 w-auto opacity-90"
                    />
                  ) : (
                    <span
                      aria-hidden
                      title="sem sprite na biblioteca do tibia.com"
                      className="h-5 w-5 rounded border border-dashed"
                    />
                  )}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-xs capitalize" title={it.nome}>
                {it.nome}
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums">
                {num(it.quantidade)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
