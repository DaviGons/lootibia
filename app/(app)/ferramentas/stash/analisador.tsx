"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { ATLAS, COMPRA_YASIR, IMBUEMENT, ITENS_DO_STASH } from "@/lib/dados/stash";
import { juntarPrints, type Leitura } from "@/lib/stash";

/**
 * O Stash analyzer inteiro roda no navegador: o print é lido aqui e nunca é
 * enviado a servidor nenhum. O trabalho pesado fica no Web Worker.
 */

interface Print {
  id: number;
  nome: string;
  bitmap: ImageBitmap;
  leitura: Leitura | null;
}

type Aba = "entregas" | "imbuement" | "todos";

const inteiro = new Intl.NumberFormat("pt-BR");

/** 1.234.567 → "1,23 mi". */
function curto(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} bi`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (n >= 1e4) return `${(n / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return inteiro.format(n);
}

/** O primeiro sprite do item, recortado do atlas por CSS. */
function Sprite({ item }: { item: number }) {
  const s = ITENS_DO_STASH[item][5][0];
  return (
    <span
      aria-hidden
      className="block h-8 w-8 shrink-0 [image-rendering:pixelated]"
      style={{
        backgroundImage: `url(${ATLAS.url})`,
        backgroundPosition: `-${(s % ATLAS.colunas) * ATLAS.lado}px -${Math.floor(s / ATLAS.colunas) * ATLAS.lado}px`,
      }}
    />
  );
}

export function Analisador() {
  const worker = useRef<Worker | null>(null);
  const [pronto, setPronto] = useState(false);
  const [falhaAoCarregar, setFalhaAoCarregar] = useState<string | null>(null);
  const [prints, setPrints] = useState<Print[]>([]);
  const [aba, setAba] = useState<Aba>("entregas");
  const [arrastando, setArrastando] = useState(false);
  const proximoId = useRef(1);
  const entrada = useRef<HTMLInputElement>(null);

  // O worker nasce com a página e recebe o atlas uma vez.
  useEffect(() => {
    const w = new Worker(new URL("./leitor.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    w.onmessage = (e: MessageEvent) => {
      if (e.data.tipo === "pronto") setPronto(true);
      if (e.data.tipo === "lido") {
        setPrints((ps) => ps.map((p) => (p.id === e.data.id ? { ...p, leitura: e.data.leitura } : p)));
      }
    };
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      w.postMessage({ tipo: "atlas", rgba: data, largura: c.width, altura: c.height }, [data.buffer]);
    };
    img.onerror = () => setFalhaAoCarregar("Não deu para carregar os sprites dos itens. Recarregue a página.");
    img.src = ATLAS.url;
    return () => w.terminate();
  }, []);

  const adicionar = useCallback(async (entrada: Iterable<File>) => {
    // Cópia ANTES do primeiro `await`: a FileList do <input> e a do arrastar
    // são vivas — o campo é limpo logo depois, e o navegador esvazia o
    // `dataTransfer` quando o evento termina. Sem a cópia, de vários arquivos
    // só o primeiro era lido.
    const arquivos = [...entrada];
    for (const f of arquivos) {
      if (!f.type.startsWith("image/")) continue;
      const bitmap = await createImageBitmap(f);
      const c = document.createElement("canvas");
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      const id = proximoId.current++;
      setPrints((ps) => [...ps, { id, nome: f.name || `Print ${id}`, bitmap, leitura: null }]);
      worker.current?.postMessage({ tipo: "print", id, rgba: data, largura: c.width, altura: c.height }, [data.buffer]);
    }
  }, []);

  // Ctrl+V em qualquer lugar da página.
  useEffect(() => {
    const colar = (e: ClipboardEvent) => {
      const arquivos = [...(e.clipboardData?.files ?? [])];
      if (arquivos.length) adicionar(arquivos);
    };
    window.addEventListener("paste", colar);
    return () => window.removeEventListener("paste", colar);
  }, [adicionar]);

  const resultado = useMemo(() => {
    const lidas = prints.map((p) => p.leitura).filter((l): l is Leitura => l !== null);
    const achados = lidas.map((l) =>
      l.slots
        .filter((s) => s.item !== null && s.quantidade.valor !== null)
        .map((s) => ({ item: s.item!, quantidade: s.quantidade.valor! })),
    );
    const { itens, divergentes } = juntarPrints(achados);
    // Slot cortado pela rolagem sem item não é falha de leitura: mostra pouco
    // demais para decidir. Fica à parte, em cinza, e a tela pede outro print.
    const naoReconhecidos = lidas.reduce((n, l) => n + l.slots.filter((s) => s.item === null && !s.parcial).length, 0);
    const cortados = lidas.reduce((n, l) => n + l.slots.filter((s) => s.item === null && s.parcial).length, 0);
    // Quantidade cortada ou ilegível só é pendência se o mesmo item não foi
    // lido inteiro em outro slot ou outro print — o Stash tem uma pilha por item.
    const lidos = new Set(itens.map((it) => it.item));
    const semQuantidade = lidas.flatMap((l) =>
      l.slots.filter((s) => s.item !== null && s.quantidade.valor === null && !lidos.has(s.item)),
    );
    // Item sem `npcvalue` não vale zero: vale "sem referência" — poção, por
    // exemplo, se compra e não se vende. Fica fora da soma, e a tela conta.
    const comValor = itens.filter((it) => ITENS_DO_STASH[it.item][1] !== null);
    const valorNpc = comValor.reduce((t, it) => t + ITENS_DO_STASH[it.item][1]! * it.quantidade, 0);
    const semReferencia = itens.length - comValor.length;
    return { itens, divergentes: new Set(divergentes), naoReconhecidos, cortados, semQuantidade, valorNpc, semReferencia, comValor: comValor.length };
  }, [prints]);

  const lendo = prints.some((p) => p.leitura === null);

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          adicionar(e.dataTransfer.files);
        }}
        onClick={() => entrada.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && entrada.current?.click()}
        className={`entra flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          arrastando ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/50"
        }`}
      >
        <ImagePlus aria-hidden className="h-6 w-6 text-primary" />
        <p className="text-sm font-medium">
          {prints.length ? "Adicionar outro print" : "Arraste, cole (Ctrl+V) ou escolha prints do seu Stash"}
        </p>
        <p className="text-xs text-muted-foreground">
          Janela do Stash aberta, interface a 100% ou 200%. Lista longa? Mande um print por
          rolagem. O print não sai do seu navegador.
        </p>
        <input
          ref={entrada}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) adicionar(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {falhaAoCarregar && <p className="text-sm text-destructive">{falhaAoCarregar}</p>}
      {!pronto && !falhaAoCarregar && <p className="text-xs text-muted-foreground">Carregando os sprites dos itens…</p>}

      {prints.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {prints.map((p) => (
            <li key={p.id}>
              <Miniatura print={p} aoRemover={() => setPrints((ps) => ps.filter((x) => x.id !== p.id))} />
            </li>
          ))}
        </ul>
      )}

      {prints.length > 0 && !lendo && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Numero rotulo="Itens reconhecidos" valor={inteiro.format(resultado.itens.length)} />
            <Numero
              rotulo="Não lidos"
              valor={inteiro.format(resultado.naoReconhecidos + resultado.semQuantidade.length)}
              detalhe={
                "vermelho: item; amarelo: quantidade cortada ou ilegível" +
                (resultado.cortados
                  ? `; ${resultado.cortados} na linha cortada pela rolagem (cinza): role a lista e mande outro print com ela inteira`
                  : "")
              }
            />
            <Numero
              rotulo="Valor de NPC"
              valor={resultado.comValor ? `${curto(resultado.valorNpc)} gp` : "—"}
              detalhe={
                resultado.comValor === 0
                  ? "nenhum destes itens é comprado por NPC"
                  : resultado.semReferencia
                    ? `referência de NPC, não de Market; ${resultado.semReferencia} sem referência ficaram de fora`
                    : "referência de NPC, não preço de Market"
              }
            />
          </div>

          <section className="entra rounded-xl border bg-card">
            <div className="flex gap-1 border-b p-2 text-[13px]">
              {(
                [
                  ["entregas", "Delivery Tasks"],
                  ["imbuement", "Imbuement"],
                  ["todos", "Todos"],
                ] as const
              ).map(([id, rotulo]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAba(id)}
                  aria-pressed={aba === id}
                  className={`rounded-lg px-3 py-1.5 transition-colors ${
                    aba === id ? "bg-primary/10 font-medium text-foreground" : "text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {rotulo}
                </button>
              ))}
            </div>
            <Lista aba={aba} itens={resultado.itens} divergentes={resultado.divergentes} />
          </section>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Sprites do cliente do Tibia e dados do TibiaWiki. Tibia e produtos relacionados são © CipSoft GmbH.
          </p>
        </>
      )}
    </div>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3.5">
      <div className="text-xs text-muted-foreground">{rotulo}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{valor}</div>
      {detalhe && <div className="mt-0.5 text-[11px] text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

/**
 * O recorte da janela do Stash, com cada slot marcado: verde reconhecido,
 * vermelho não reconhecido, amarelo com a quantidade ilegível.
 */
function Miniatura({ print, aoRemover }: { print: Print; aoRemover: () => void }) {
  const tela = useRef<HTMLCanvasElement>(null);
  const l = print.leitura;

  useEffect(() => {
    const c = tela.current;
    if (!c || !l?.janela) return;
    const j = l.janela;
    c.width = j.largura;
    c.height = j.altura;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(print.bitmap, j.x, j.y, j.largura, j.altura, 0, 0, j.largura, j.altura);
    ctx.lineWidth = 2 * l.escala;
    for (const s of l.slots) {
      const cortadoSemItem = s.item === null && s.parcial;
      ctx.strokeStyle = cortadoSemItem ? "#9ca3af" : s.item === null ? "#ef4444" : s.quantidade.valor === null ? "#f59e0b" : "#22c55e";
      ctx.setLineDash(cortadoSemItem ? [4 * l.escala, 3 * l.escala] : []);
      ctx.strokeRect(s.x - j.x - l.escala, s.y - j.y - l.escala, 34 * l.escala, 34 * l.escala);
    }
  }, [l, print.bitmap]);

  return (
    <div className="entra overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={print.nome}>
          {print.nome}
        </span>
        {l === null ? (
          <span className="text-muted-foreground">lendo…</span>
        ) : l.janela ? (
          <span className="tabular-nums text-muted-foreground">
            {l.slots.length} slots
            {l.slots.some((s) => s.parcial) && ` · ${l.slots.filter((s) => s.parcial).length} cortados pela rolagem`}
            {l.escala === 2 && " · 200%"}
          </span>
        ) : null}
        <button
          type="button"
          onClick={aoRemover}
          aria-label="Remover print"
          className="grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
      {l && !l.janela ? (
        <p className="p-3 text-xs text-destructive">
          Não achei a janela do Stash neste print. O título &quot;Stash&quot; precisa aparecer, com a interface a
          100% ou 200%, num print sem compressão (PNG).
        </p>
      ) : (
        <canvas ref={tela} className="block h-auto w-full [image-rendering:pixelated]" />
      )}
    </div>
  );
}

function Lista({
  aba,
  itens,
  divergentes,
}: {
  aba: Aba;
  itens: { item: number; quantidade: number }[];
  divergentes: Set<number>;
}) {
  const linhas = itens
    .filter(({ item }) => {
      const [, , flags, min] = ITENS_DO_STASH[item];
      if (aba === "entregas") return min > 0;
      if (aba === "imbuement") return (flags & IMBUEMENT) !== 0;
      return true;
    })
    .sort((a, b) => ITENS_DO_STASH[a.item][0].localeCompare(ITENS_DO_STASH[b.item][0]));

  if (linhas.length === 0) {
    return (
      <p className="p-5 text-sm text-muted-foreground">
        {aba === "entregas"
          ? "Nenhum item de Delivery Task nos prints."
          : aba === "imbuement"
            ? "Nenhum item de imbuement nos prints."
            : "Nenhum item reconhecido."}
      </p>
    );
  }

  return (
    <ul className="divide-y">
      {linhas.map(({ item, quantidade }) => {
        const [nome, npc, flags, min, max] = ITENS_DO_STASH[item];
        let detalhe: React.ReactNode;
        if (aba === "entregas") {
          // A task pede uma quantidade entre `min` e `max`, sorteada pelo jogo.
          const estado =
            quantidade >= max
              ? { texto: "dá para qualquer task", cor: "text-emerald-600 dark:text-emerald-400" }
              : quantidade >= min
                ? { texto: "dá, se a task pedir pouco", cor: "text-amber-600 dark:text-amber-400" }
                : { texto: `faltam ${inteiro.format(min - quantidade)}`, cor: "text-muted-foreground" };
          detalhe = (
            <>
              a task pede de {inteiro.format(min)} a {inteiro.format(max)} ·{" "}
              <span className={estado.cor}>{estado.texto}</span>
            </>
          );
        } else {
          const partes = [
            npc ? `${curto(npc * quantidade)} gp de NPC` : null,
            flags & COMPRA_YASIR ? "Yasir compra" : null,
            aba === "todos" && flags & IMBUEMENT ? "imbuement" : null,
          ].filter(Boolean);
          detalhe = partes.join(" · ");
        }
        return (
          <li key={item} className="flex items-center gap-3 px-4 py-2.5">
            <Sprite item={item} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{nome}</span>
              <span className="block text-[11px] text-muted-foreground">{detalhe}</span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {inteiro.format(quantidade)}
              {divergentes.has(item) && (
                <span className="ml-1 text-amber-600" title="Dois prints leram quantidades diferentes; ficou a maior.">
                  ?
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
