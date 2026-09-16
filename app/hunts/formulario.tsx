"use client";

import { useActionState, useEffect, useState } from "react";
import { importarSessao, type ResultadoImportacao } from "./acoes";

export function FormularioImportacao() {
  const [estado, acao, enviando] = useActionState<ResultadoImportacao | null, FormData>(
    importarSessao,
    null,
  );

  // Os horários do Hunt Analyser são relógio local sem fuso. Só o navegador
  // sabe qual é — o servidor precisa receber para converter em instante.
  const [fuso, setFuso] = useState("UTC");
  useEffect(() => {
    setFuso(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  return (
    <form action={acao} className="flex flex-col gap-3">
      <input type="hidden" name="fuso" value={fuso} />

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Nome do spot</span>
        <input
          name="rotulo"
          placeholder="Asura Palace"
          className="rounded border px-3 py-2 bg-transparent"
        />
        <span className="text-xs opacity-60">
          O Hunt Analyser não informa o local — sem isto, a sessão não entra em “hunts mais
          caçadas”.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Texto do Hunt Analyser</span>
        <textarea
          name="texto"
          rows={12}
          placeholder={"Session data: From 2026-09-15, 19:34:12 to 2026-09-15, 21:25:10\nSession: 01:50h\n..."}
          className="rounded border px-3 py-2 font-mono text-xs bg-transparent"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={enviando}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {enviando ? "Importando…" : "Importar sessão"}
        </button>
        <span className="text-xs opacity-60">fuso detectado: {fuso}</span>
      </div>

      {estado && (
        <p className={`text-sm ${estado.ok ? "text-green-600" : "text-red-600"}`}>
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
