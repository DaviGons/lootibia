"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Gem, Plus } from "lucide-react";
import { adicionarDropExtra, apagarDropExtra } from "@/app/hunts/extras";
import type { Resultado } from "@/app/hunts/pastas";
import type { TotalDeExtras } from "@/lib/extras";
import { tituloDeItem } from "@/lib/nomesDeItem";
import type { UnidadeDaMeta } from "@/lib/meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export interface DropNaTela {
  id: number;
  item: string;
  valor: number;
  unidade: UnidadeDaMeta;
}

/**
 * Os drops que o usuário avaliou à mão, somados **à parte do profit**.
 *
 * ## Por que fora do profit
 *
 * Decisão do Davi em 2026-09-23. O resto do app vale porque os números saíram
 * do texto do jogo e podem ser conferidos contra ele; um extra é estimativa de
 * quem anotou. Somar tudo num total só apagaria essa fronteira. O painel diz
 * "não entra no profit" na cara, uma vez, para ninguém precisar deduzir.
 *
 * ## O que ele resolve
 *
 * O `Loot` do Hunt Analyser avalia item por referência de NPC, que é ruim
 * justamente para rare. Anotar "Falcon Coif, 30kk" é o usuário corrigindo essa
 * avaliação onde ela mais erra.
 */
export function DropsExtras({
  drops,
  total,
  pastaId,
  precoTc,
}: {
  drops: DropNaTela[];
  total: TotalDeExtras;
  /** Pasta aberta; o drop novo nasce nela. `null` = "Sem pasta". */
  pastaId: number | null;
  precoTc: number | null;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <section className="entra rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold">
          Drops extras{" "}
          <span className="font-normal text-muted-foreground">— não entram no profit</span>
        </h2>
        <button
          type="button"
          onClick={() => setAberto(true)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          anotar drop
        </button>
      </div>

      {drops.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Caiu um rare que o jogo subestima? Anote quanto ele vale de verdade — o Hunt Analyser
          avalia item por referência de NPC.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xl font-semibold tabular-nums">{num(total.gp)}</span>
            <span className="text-[11px] text-muted-foreground">
              {total.contados} {total.contados === 1 ? "drop" : "drops"}
              {/* Um total que esconde parcela é pior que nenhum total. */}
              {total.semPreco > 0 && (
                <>
                  {" · "}
                  <span className="text-destructive">
                    {total.semPreco} em TC fora da conta, sem preço configurado
                  </span>
                </>
              )}
            </span>
          </div>

          <ul className="mt-3 divide-y border-t pt-1">
            {drops.map((d) => (
              <li key={d.id} className="group/drop flex items-center gap-2 py-2">
                <Gem aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {/* `tituloDeItem` e nao o `capitalize` do CSS: a convenção do
                    wiki mantém preposição em minúscula, e `capitalize` escreveria
                    "Wand Of Inferno" — grafia que o próprio wiki responde 404. */}
                <span className="min-w-0 flex-1 truncate text-xs" title={d.item}>
                  {tituloDeItem(d.item)}
                </span>
                <span className="shrink-0 text-xs font-medium tabular-nums">
                  {num(d.valor)} {d.unidade === "tc" ? "TC" : "gp"}
                </span>
                <form action={apagarDropExtra} className="shrink-0">
                  <input type="hidden" name="id" value={d.id} />
                  <button
                    aria-label={`Apagar ${d.item}`}
                    className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/drop:opacity-100"
                  >
                    apagar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}

      <Formulario
        aberto={aberto}
        aoFechar={() => setAberto(false)}
        pastaId={pastaId}
        precoTc={precoTc}
      />
    </section>
  );
}

/**
 * `<dialog>` nativo, por PORTAL no `<body>`.
 *
 * O portal aqui é prevenção, não conserto: em 2026-09-23 o diálogo de editar
 * pasta ficava dentro do `<Link>` da pasta e apagar não funcionava, porque o
 * clique virava navegação. Este painel não está dentro de âncora nenhuma hoje,
 * mas nasce fora do fluxo do documento para que mover ele de lugar um dia não
 * traga o problema de volta.
 */
function Formulario({
  aberto,
  aoFechar,
  pastaId,
  precoTc,
}: {
  aberto: boolean;
  aoFechar: () => void;
  pastaId: number | null;
  precoTc: number | null;
}) {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(
    adicionarDropExtra,
    null,
  );
  const [unidade, setUnidade] = useState<UnidadeDaMeta>("gp");
  const ref = useRef<HTMLDialogElement>(null);
  const [montado, setMontado] = useState(false);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  useEffect(() => {
    if (estado?.ok) aoFechar();
  }, [estado, aoFechar]);

  if (!montado) return null;

  return createPortal(
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === ref.current) aoFechar();
      }}
      className="w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5">
        <h2 className="text-sm font-semibold">Anotar drop</h2>
        <p className="mb-4 mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          O nome é conferido no TibiaWiki, em inglês. Não entra no profit: soma à parte.
        </p>

        <form action={acao} className="flex flex-col gap-4">
          <input type="hidden" name="pasta_id" value={pastaId ?? ""} />

          <div className="grid gap-1.5">
            <Label htmlFor="item">Item</Label>
            <Input
              id="item"
              name="item"
              required
              maxLength={80}
              placeholder="Falcon Coif"
              autoComplete="off"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="valor">Quanto vale</Label>
            <div className="flex gap-2">
              <Input
                id="valor"
                name="valor"
                required
                inputMode="numeric"
                placeholder={unidade === "tc" ? "500" : "30000000"}
                className="min-w-0 flex-1 tabular-nums"
              />
              <select
                name="unidade"
                value={unidade}
                onChange={(e) => setUnidade(e.target.value as UnidadeDaMeta)}
                aria-label="Unidade do valor"
                className="rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="gp">gp</option>
                <option value="tc">TC</option>
              </select>
            </div>
            {unidade === "tc" && precoTc === null && (
              <p className="text-[11px] leading-relaxed text-destructive">
                Sem preço de TC configurado para o seu mundo, este drop fica fora da soma. Dá para
                anotar assim mesmo — e configurar depois em /config.
              </p>
            )}
          </div>

          {estado && !estado.ok && (
            <p role="alert" className="text-xs text-destructive">
              {estado.mensagem}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={enviando}>
              {enviando ? "Conferindo…" : "Anotar"}
            </Button>
          </div>
        </form>
      </div>
    </dialog>,
    document.body,
  );
}
