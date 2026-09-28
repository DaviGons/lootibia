"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X } from "lucide-react";
import { FormularioImportacao, type CharDoSeletor } from "@/app/(app)/hunts/formulario";

/**
 * A importação de sessão, numa janela.
 *
 * Quem abre são dois botões em lugares que não se conhecem — "Adicionar nova
 * hunt" na lateral e "Importar sessão" no topo de /hunts. Em vez de um contexto
 * atravessando o layout, os dois disparam um evento no `window`, e a janela,
 * que mora na lateral (onde já estão os chars do seletor), escuta.
 */
const EVENTO = "lootibia:importar";

export function abrirImportacao() {
  window.dispatchEvent(new Event(EVENTO));
}

/** O item da lateral. Tem cara de link, mas abre a janela. */
export function BotaoNovaHunt() {
  return (
    <button
      type="button"
      onClick={abrirImportacao}
      data-fecha-gaveta
      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-primary transition-colors hover:bg-accent"
    >
      <Plus aria-hidden className="h-[14px] w-[14px] shrink-0" />
      Adicionar nova hunt
    </button>
  );
}

/** O botão principal do topo de /hunts. */
export function BotaoImportar() {
  return (
    <button
      type="button"
      onClick={abrirImportacao}
      className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-[filter] hover:brightness-110"
    >
      Importar sessão
    </button>
  );
}

/**
 * `<dialog>` nativo, por portal no `<body>`, com `stopPropagation` no próprio
 * diálogo: a lateral é cheia de `<Link>`, e evento do React borbulha pela
 * árvore de COMPONENTES, não pela do DOM — sem isso, um clique aqui dentro
 * chegaria a um link ancestral e viraria navegação.
 *
 * Depois de importar, a janela fica aberta com o recado de sucesso e o
 * formulário limpo: quem cola uma sessão costuma ter outra para colar.
 */
export function JanelaDeImportacao({ chars }: { chars: CharDoSeletor[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [montado, setMontado] = useState(false);
  // Remonta o formulário a cada abertura: o recado da importação anterior não
  // pode aparecer na próxima.
  const [vez, setVez] = useState(0);

  useEffect(() => setMontado(true), []);

  useEffect(() => {
    const abrir = () => {
      setVez((v) => v + 1);
      const d = ref.current;
      if (d && !d.open) d.showModal();
    };
    window.addEventListener(EVENTO, abrir);
    return () => window.removeEventListener(EVENTO, abrir);
  }, []);

  if (!montado) return null;

  const fechar = () => ref.current?.close();

  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby="titulo-importar"
      onClick={(e) => {
        e.stopPropagation();
        // Alvo ser o próprio <dialog> significa clique no fundo escuro.
        if (e.target === ref.current) fechar();
      }}
      className="w-[min(40rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="titulo-importar" className="text-sm font-semibold">
              Adicionar nova hunt
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cole o que o Hunt Analyser copiou.
            </p>
          </div>
          <button
            type="button"
            onClick={fechar}
            aria-label="Fechar"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        </div>
        <FormularioImportacao key={vez} chars={chars} />
      </div>
    </dialog>,
    document.body,
  );
}
