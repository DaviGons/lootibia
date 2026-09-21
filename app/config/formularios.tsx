"use client";

import { useActionState } from "react";
import { cadastrarPersonagem, salvarPrecoTc, type Resultado } from "@/app/hunts/pastas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Mensagem de retorno de uma ação. Verde some, vermelho fica. */
function Recado({ estado }: { estado: Resultado | null }) {
  if (!estado) return null;
  return (
    <p
      role="status"
      className={`mt-2 text-xs ${estado.ok ? "text-muted-foreground" : "text-destructive"}`}
    >
      {estado.mensagem}
    </p>
  );
}

export function CadastrarPersonagem() {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(
    cadastrarPersonagem,
    null,
  );

  return (
    <form action={acao}>
      <div className="flex flex-wrap gap-2">
        <Input
          name="nome"
          required
          placeholder="Nome do personagem no Tibia"
          autoComplete="off"
          autoCapitalize="words"
          className="min-w-0 flex-1"
        />
        <Button type="submit" disabled={enviando}>
          {enviando ? "Buscando…" : "Buscar"}
        </Button>
      </div>
      <Recado estado={estado} />
    </form>
  );
}

/**
 * Preço da TC de um mundo.
 *
 * Um formulário por mundo, cada um com o seu estado: um só para todos faria a
 * mensagem de erro de um aparecer do lado do outro.
 */
export function PrecoDoMundo({ mundo, atual }: { mundo: string; atual: number | null }) {
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(salvarPrecoTc, null);

  return (
    <form action={acao} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="mundo" value={mundo} />
      <Input
        name="preco_tc"
        defaultValue={atual ?? ""}
        inputMode="numeric"
        placeholder="15800"
        aria-label={`Preço da Tibia Coin em ${mundo}, em gold`}
        className="w-28 text-right tabular-nums"
      />
      <span className="text-xs text-muted-foreground">gp por TC</span>
      <Button type="submit" variant="outline" size="sm" disabled={enviando}>
        {enviando ? "Salvando…" : "Salvar"}
      </Button>
      <Recado estado={estado} />
    </form>
  );
}
