"use client";

import { useRef, useTransition } from "react";
import { moverSessao } from "@/app/hunts/pastas";

/**
 * Arquiva a sessão numa pasta, na própria linha da tabela.
 *
 * Um `<select>` e não um menu: ele mostra **onde a sessão está** e permite
 * trocar no mesmo gesto. Um botão "mover" precisaria abrir algo para depois
 * revelar a mesma lista, e a coluna deixaria de responder "em que pasta isto
 * está?" — que é metade da razão de a coluna existir.
 *
 * Envia ao mudar, sem botão de confirmar. A ação é reversível num segundo
 * gesto e não destrói nada: pedir confirmação para arquivar seria atrito sem
 * contrapartida.
 */
export function MoverSessao({
  sessaoId,
  pastaId,
  pastas,
}: {
  sessaoId: number;
  pastaId: number | null;
  pastas: { id: number; nome: string }[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const [enviando, iniciar] = useTransition();

  if (pastas.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  return (
    <form ref={form} action={moverSessao}>
      <input type="hidden" name="sessao_id" value={sessaoId} />
      <select
        name="pasta_id"
        defaultValue={pastaId ?? ""}
        disabled={enviando}
        aria-label="Pasta desta sessão"
        // `requestSubmit` e não `submit`: o primeiro dispara o fluxo normal do
        // formulário, que é o que a server action escuta.
        onChange={() => iniciar(() => form.current?.requestSubmit())}
        className="w-full max-w-[11rem] cursor-pointer truncate rounded-md border border-transparent bg-transparent py-1 text-xs text-muted-foreground transition-colors hover:border-input hover:text-foreground focus:border-input focus:text-foreground disabled:opacity-50"
      >
        <option value="">Sem pasta</option>
        {pastas.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </select>
    </form>
  );
}
