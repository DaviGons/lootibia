import type { LootSeparado } from "@/lib/moedas";

const num = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * De onde vem o profit: o que já é dinheiro e o que ainda é mercadoria.
 *
 * ## Escrito para quem nunca ouviu falar disso
 *
 * O painel aparece logo abaixo de um profit enorme e positivo, e a primeira
 * coisa que ele mostra pode ser um número NEGATIVO. Sem explicação isso parece
 * erro de conta, e quem vê vai perguntar — que é exatamente o que não se quer.
 *
 * Três coisas resolvem isso, e todas ficam SEMPRE visíveis:
 *
 * 1. **A soma.** `caixa + itens = profit`, sempre — é álgebra, não coincidência:
 *    `(moedas − supplies) + (loot − moedas) = loot − supplies`. Dizer isso na
 *    tela transforma "dois números que se contradizem" em "duas parcelas do
 *    mesmo número". `lib/moedas.test.ts` trava a invariante, inclusive com
 *    profit negativo — a tela promete a conta, então ela tem de fechar.
 * 2. **O porquê**, em UMA frase, sem jargão: só três moedas caem direto no
 *    balance do personagem. Uma frase, e não um parágrafo — a versão anterior
 *    explicava também por que a parcela ficava negativa, e isso era dizer em
 *    prosa o que a sub-nota `moeda − supplies` já mostra com os dois números
 *    lado a lado. Quando o número se explica, o texto só atrapalha.
 * 3. **Rótulos que dizem o que é**, não como se chama: "já caiu na sua conta"
 *    em vez de "líquido", "ainda precisa vender" em vez de "a realizar".
 *
 * ## Duas escalas, um componente
 *
 * Serve o acumulado da pasta e uma sessão só — é a mesma pergunta. Sem
 * `"use client"`: não tem estado nem evento, e assim roda nos dois lugares.
 */
export function Caixa({ s, titulo }: { s: LootSeparado; titulo: string }) {
  const loot = s.moedas + s.itens;
  const fatiaEmMoeda = loot > 0 ? s.moedas / loot : 0;

  return (
    <section className="entra rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-xs font-semibold">{titulo}</h2>
        {/* Com dado inconsistente a fração passa de 100% e vira estatística
            falsa ao lado do próprio aviso de que o dado não presta. */}
        {s.consistente && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {(fatiaEmMoeda * 100).toFixed(1)}% do loot veio em moeda
          </span>
        )}
      </div>

      {s.consistente ? (
        // Trilho e preenchimento são passos do MESMO matiz, como no medidor de
        // meta — a paleta já traz isso em `--dado` / `--dado-trilho`.
        <div
          className="h-2.5 overflow-hidden rounded-full bg-[hsl(var(--dado-trilho))]"
          role="img"
          aria-label={`${num(s.moedas)} do loot em moeda, ${num(s.itens)} em item`}
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

      {/* A conta, explícita. É o que impede o painel de parecer contraditório. */}
      <div className="mt-4 grid items-start gap-x-3 gap-y-4 sm:grid-cols-[1fr_auto_1fr_auto_auto]">
        <Parcela
          rotulo="Já caiu na sua conta"
          valor={s.caixa}
          nota={`${num(s.moedas)} de moeda − ${num(s.supplies)} de supplies`}
          alerta={s.caixa < 0}
        />
        <Operador sinal="+" />
        <Parcela
          rotulo="Ainda precisa vender"
          valor={s.itens}
          nota="avaliação do jogo, não preço de mercado"
        />
        <Operador sinal="=" />
        <Parcela rotulo="Profit" valor={s.profit} destaque />
      </div>

      {/* Uma linha, e é o cálculo. `max-w-prose` porque num monitor largo um
          parágrafo solto atravessa 1.600 px e deixa de ser lido.
          Não há frase para o caixa negativo: a sub-nota da parcela já mostra
          `moeda − supplies` com o segundo maior que o primeiro. Explicar em
          prosa o que os números dizem sozinhos é ruído. */}
      <p className="mt-4 max-w-prose border-t pt-3 text-[11px] leading-relaxed text-muted-foreground">
        Moeda — <b className="text-foreground">gold</b>, <b className="text-foreground">platinum</b>{" "}
        e <b className="text-foreground">crystal coin</b> — cai direto no balance. Menos os
        supplies, dá o que já está na conta; o resto do loot é item.
      </p>
    </section>
  );
}

function Parcela({
  rotulo,
  valor,
  nota,
  alerta,
  destaque,
}: {
  rotulo: string;
  valor: number;
  nota?: string;
  alerta?: boolean;
  destaque?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{rotulo}</div>
      <div
        className={`tabular-nums ${destaque ? "text-base font-semibold" : "text-sm font-semibold"} ${
          alerta ? "text-destructive" : ""
        }`}
      >
        {num(valor)}
      </div>
      {nota && <div className="text-[11px] leading-relaxed text-muted-foreground">{nota}</div>}
    </div>
  );
}

/**
 * O `+` e o `=` entre as parcelas. Some no celular, onde as parcelas empilham e
 * um sinal solto no meio da coluna confundiria em vez de explicar — lá quem faz
 * o mesmo trabalho é o rótulo "Profit" fechando a lista.
 */
function Operador({ sinal }: { sinal: string }) {
  return (
    <div aria-hidden className="hidden self-center text-sm text-muted-foreground sm:block">
      {sinal}
    </div>
  );
}
