"use client";

import { useState } from "react";
import { apagarSessao } from "@/app/hunts/acoes";

/**
 * Apagar uma hunt pede confirmação, na própria linha.
 *
 * Era um clique só, e não tem volta: o cascade leva os monstros e os itens
 * junto, e o texto colado não fica guardado em lugar nenhum. Com o botão
 * aparecendo no hover, bastava um clique distraído — ou um clique induzido
 * por uma página que emoldurasse o site, antes dos headers de `frame-ancestors`.
 *
 * Mesmo padrão do "Apagar pasta" (`components/pasta-form.tsx`): "Apagar? não /
 * sim, apagar". Sem diálogo: a linha não está dentro de `<Link>` nenhum, e um
 * modal para uma pergunta de sim ou não seria peso à toa.
 */
export function ApagarSessao({ sessaoId }: { sessaoId: number }) {
  const [confirmando, setConfirmando] = useState(false);

  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => setConfirmando(true)}
        className="rounded-md px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
      >
        apagar
      </button>
    );
  }

  return (
    <form action={apagarSessao} className="flex items-center gap-2 px-2 py-1 text-xs">
      <input type="hidden" name="id" value={sessaoId} />
      <span className="text-muted-foreground">Apagar?</span>
      <button
        type="button"
        onClick={() => setConfirmando(false)}
        className="text-muted-foreground hover:text-foreground"
      >
        não
      </button>
      <button type="submit" className="font-medium text-destructive">
        sim, apagar
      </button>
    </form>
  );
}
