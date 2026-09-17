"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  importarSessao,
  gerarCodigoDeVinculo,
  type ResultadoImportacao,
  type ResultadoVinculo,
} from "./acoes";

const CAMPO =
  "w-full rounded-lg border bg-background px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20";

export function FormularioImportacao() {
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
          <input name="personagem" placeholder="Bubble" className={CAMPO} />
          <span className="text-xs text-muted-foreground">
            Opcional. Serve para separar os números por char.
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

/**
 * Gera o código que o `/cadastro` do bot do Discord consome.
 *
 * Vive fora do `<form>` de importação: um formulário aninhado dentro do outro
 * não é HTML válido, e o navegador desmonta a árvore em silêncio.
 *
 * O código aparece na tela e é digitado num modal do Discord — que ninguém mais
 * vê. É por isso que o bot não aceita o código como argumento de slash command:
 * argumento aparece no canal (ver docs/bot-discord.md, decisão 2).
 */
export function VinculoDiscord() {
  const [estado, setEstado] = useState<ResultadoVinculo | null>(null);
  const [gerando, comTransicao] = useTransition();

  // `useTransition` e não `useActionState`: a ação não lê campo nenhum, e um
  // `<form>` só para envolver um botão obrigaria a action a receber um FormData
  // que ela ignora.
  const gerar = () =>
    comTransicao(async () => {
      setEstado(await gerarCodigoDeVinculo());
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={gerar}
          disabled={gerando}
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-[transform,opacity,border-color] duration-200 hover:border-primary/40 active:scale-[0.98] disabled:opacity-50"
        >
          {gerando && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {gerando ? "Gerando…" : "Gerar código de vínculo"}
        </button>
        <span className="text-xs text-muted-foreground">
          Depois rode <code className="rounded bg-muted px-1">/cadastro</code> no Discord.
        </span>
      </div>

      {estado?.ok && estado.codigo && (
        <div className="entra rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          {/* Fonte monoespaçada e espaçamento largo: o código é transcrito à mão. */}
          <div className="font-mono text-xl font-semibold tracking-[0.2em]">{estado.codigo}</div>
          <p className="mt-1 text-xs text-muted-foreground">{estado.mensagem}</p>
        </div>
      )}

      {estado && !estado.ok && (
        <p
          role="status"
          className="entra rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {estado.mensagem}
        </p>
      )}
    </div>
  );
}
