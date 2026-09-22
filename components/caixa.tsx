import type { LootSeparado } from "@/lib/moedas";

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Quanto do loot já é dinheiro, e quanto ainda é mercadoria.
 *
 * Só gold, platinum e crystal coin caem direto no balance do personagem —
 * nenhum outro item do Tibia inteiro faz isso (`lib/moedas.ts`). O `Loot` do
 * jogo soma os dois, e os supplies você paga em dinheiro vivo; daí "já no
 * bolso" ser `moedas − supplies`, e não uma fatia do profit.
 *
 * Os dois números aparecem **juntos, sem alternar**. O que informa é a
 * DISTÂNCIA entre eles: um seletor esconderia metade da comparação e obrigaria
 * a ir e voltar para fazer a conta de cabeça.
 *
 * Serve a tela (acumulado da pasta) e o analyzer (uma sessão) — é a mesma
 * pergunta em duas escalas, então é o mesmo componente. Sem `"use client"`:
 * não tem estado nem evento, e assim funciona nos dois.
 */
export function Caixa({ s, titulo }: { s: LootSeparado; titulo: string }) {
  const total = s.moedas + s.itens;
  const fatiaEmMoeda = total > 0 ? s.moedas / total : 0;

  return (
    <section className="entra rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold">{titulo}</h2>
        {/* Com dado inconsistente a fração passa de 100% e vira estatística
            falsa ao lado do próprio aviso de que o dado não presta. Melhor não
            dizer nada do que dizer "1000% em moeda". */}
        {s.consistente && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {(fatiaEmMoeda * 100).toFixed(1)}% em moeda
          </span>
        )}
      </div>

      {s.consistente ? (
        // Trilho e preenchimento são passos do MESMO matiz, como no medidor de
        // meta — a paleta já traz isso em `--dado` / `--dado-trilho`.
        <div
          className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--dado-trilho))]"
          role="img"
          aria-label={`${num(s.moedas)} em moeda, ${num(s.itens)} em item`}
        >
          <span
            className="block h-full rounded-r-[4px] bg-[hsl(var(--dado))]"
            style={{ width: `${Math.min(100, fatiaEmMoeda * 100)}%` }}
          />
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-destructive">
          As moedas somam mais que o Loot. O dado está inconsistente — a separação abaixo não é
          confiável.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] text-muted-foreground">Já no bolso</div>
          <div
            className={`text-sm font-semibold tabular-nums ${s.caixa < 0 ? "text-destructive" : ""}`}
          >
            {num(s.caixa)}
          </div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            {num(s.moedas)} em moeda − {num(s.supplies)} de supplies
          </div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Ainda por vender</div>
          <div className="text-sm font-semibold tabular-nums">{num(s.itens)}</div>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            avaliação do jogo, que é referência de NPC — não preço de mercado
          </div>
        </div>
      </div>

      {s.consistente && s.caixa < 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Consumiu mais supply do que caiu de moeda: em dinheiro vivo ficou negativa, e só fica
          positiva depois de vender o loot.
        </p>
      )}
    </section>
  );
}
