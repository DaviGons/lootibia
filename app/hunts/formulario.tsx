"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { importarSessao, type ResultadoImportacao } from "./acoes";

const CAMPO =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20";

// Seta nativa, como no seletor de pasta de `components/mover-sessao.tsx`:
// desenhar a própria exigiria `appearance-none` e um ícone de fundo, e a nativa
// já vem certa no claro e no escuro. `h-[38px]` casa a altura com a do <input>
// ao lado — sem isso os dois campos da mesma linha ficam desalinhados.
const SELETOR = `${CAMPO} h-[38px] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`;

export interface CharDoSeletor {
  id: number;
  nome: string;
}

export function FormularioImportacao({ chars }: { chars: CharDoSeletor[] }) {
  const [estado, acao, enviando] = useActionState<ResultadoImportacao | null, FormData>(
    importarSessao,
    null,
  );

  // Os horários do Hunt Analyser são relógio local sem fuso. Só o navegador
  // sabe qual é — o servidor precisa recebê-lo para converter em instante.
  const [fuso, setFuso] = useState("UTC");
  useEffect(() => {
    setFuso(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  return (
    <form action={acao} className="flex flex-col gap-4">
      <input type="hidden" name="fuso" value={fuso} />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Personagem</span>
          <select name="personagem_id" disabled={chars.length === 0} className={SELETOR}>
            <option value="">{chars.length === 0 ? "Nenhum cadastrado" : "Sem personagem"}</option>
            {chars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Opcional. Serve para separar os números por char.{" "}
            {chars.length === 0 ? (
              <>
                <Link href="/config" className="text-primary underline underline-offset-4">
                  Cadastre um
                </Link>{" "}
                para usar este campo.
              </>
            ) : (
              <Link href="/config" className="text-primary underline underline-offset-4">
                Gerenciar
              </Link>
            )}
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Nome do spot</span>
          <input name="rotulo" placeholder="Asura Palace" className={CAMPO} />
          <span className="text-xs text-muted-foreground">
            O Hunt Analyser não informa o local — sem isto, a sessão não entra em “hunts mais
            caçadas”.
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Texto do Hunt Analyser</span>
        <textarea
          name="texto"
          rows={10}
          spellCheck={false}
          placeholder={"Session data: From 2026-09-15, 19:34:12 to 2026-09-15, 21:25:10\nSession: 01:50h\nRaw XP Gain: 7,051,729\n…"}
          className={`${CAMPO} resize-y font-mono text-xs leading-relaxed`}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[transform,opacity,background-color] duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {enviando && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {enviando ? "Importando…" : "Importar sessão"}
        </button>
        <span className="text-xs text-muted-foreground">fuso detectado: {fuso}</span>
      </div>

      {estado && (
        <p
          role="status"
          className={`entra rounded-lg border px-3 py-2 text-sm ${
            estado.ok
              ? "border-primary/30 bg-primary/5"
              : "border-destructive/40 bg-destructive/5 text-destructive"
          }`}
        >
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
