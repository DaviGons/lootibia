"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus } from "lucide-react";
import { criarPasta, editarPasta, apagarPasta, type Resultado } from "@/app/hunts/pastas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { UnidadeDaMeta } from "@/lib/meta";

export interface PastaEditavel {
  id: number;
  nome: string;
  meta_valor: number | null;
  meta_unidade: UnidadeDaMeta | null;
}

/**
 * `<dialog>` nativo, sem biblioteca, renderizado por PORTAL no `<body>`.
 *
 * Ele já traz de graça o que um `<div>` com `position:fixed` exigiria escrever
 * à mão: foco preso dentro, Esc fechando, o resto da página marcado como inerte
 * para leitor de tela, e o `::backdrop`. Nada disso é detalhe de acabamento —
 * é o que separa um modal utilizável de um que prende quem navega por teclado.
 *
 * ## O portal não é preciosismo: sem ele, apagar pasta NÃO FUNCIONA
 *
 * `EditarPasta` é renderizado no slot `acao` de `ItemDaLateral`, que fica
 * **dentro do `<Link>` da pasta**. Sem portal, este `<dialog>` e o `<form>` que
 * ele envolve nascem dentro de um `<a href>` — HTML inválido, e pior: todo
 * clique lá dentro borbulha até a âncora e vira navegação.
 *
 * Medido em 2026-09-23: clicar em "Apagar pasta" levava a página para
 * `/hunts?pasta=N`. A confirmação até aparecia por um instante, porque o estado
 * do React atualizava — e a navegação acontecia em paralelo, destruindo o
 * diálogo antes de dar para clicar em "sim, apagar". O sintoma era "clico e ele
 * sai da pasta sem apagar nada".
 *
 * O botão de editar disfarçava o problema com `preventDefault`, um remendo por
 * botão — e por isso só ele funcionava.
 *
 * **O portal sozinho NÃO basta**, e isso também foi medido: depois de portar,
 * o clique continuava navegando. Evento do React borbulha pela árvore de
 * COMPONENTES, não pela do DOM — o `<Link>` segue sendo ancestral do
 * `EditarPasta` em React, mesmo com o `<dialog>` pendurado no `<body>`. Por isso
 * o `onClick` abaixo começa com `stopPropagation`: uma barreira, no lugar certo,
 * em vez de um `preventDefault` por botão que alguém vai esquecer no próximo.
 */
function Modal({
  aberto,
  aoFechar,
  titulo,
  children,
}: {
  aberto: boolean;
  aoFechar: () => void;
  titulo: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // `showModal()` e não o atributo `open`: só ele ativa o backdrop e a
    // armadilha de foco. O atributo abre o diálogo "inline", sem nada disso.
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  // `createPortal` precisa do `document`, que não existe no SSR. Esperar a
  // montagem não custa nada aqui: o diálogo só importa depois de um clique.
  const [montado, setMontado] = useState(false);
  useEffect(() => setMontado(true), []);
  if (!montado) return null;

  return createPortal(
    <dialog
      ref={ref}
      onClose={aoFechar}
      onClick={(e) => {
        // `stopPropagation` PRIMEIRO, e ele é metade do conserto de apagar pasta.
        //
        // O portal tira este diálogo de dentro do `<a>` no DOM, mas evento do
        // React borbulha pela árvore de COMPONENTES, não pela do DOM: sem isto,
        // o clique continua chegando no `onClick` do `<Link>` que envolve
        // `EditarPasta`, e a página navega no meio da confirmação. Medido.
        e.stopPropagation();
        // Clicar fora fecha. O alvo ser o próprio <dialog> significa que o
        // clique caiu no backdrop, não num filho.
        if (e.target === ref.current) aoFechar();
      }}
      className="w-[min(26rem,calc(100vw-2rem))] rounded-xl border bg-card p-0 text-foreground backdrop:bg-black/50 backdrop:backdrop-blur-[2px]"
    >
      <div className="p-5">
        <h2 className="mb-4 text-sm font-semibold">{titulo}</h2>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}

/** Campos compartilhados por criar e editar. */
function Campos({ pasta }: { pasta?: PastaEditavel }) {
  const [unidade, setUnidade] = useState<UnidadeDaMeta>(pasta?.meta_unidade ?? "tc");

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="nome">Nome</Label>
        <Input
          id="nome"
          name="nome"
          required
          maxLength={60}
          defaultValue={pasta?.nome}
          placeholder="Roshamuul até 900"
          autoComplete="off"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="meta_valor">Meta (opcional)</Label>
        <div className="flex gap-2">
          <Input
            id="meta_valor"
            name="meta_valor"
            inputMode="numeric"
            defaultValue={pasta?.meta_valor ?? ""}
            placeholder="500"
            className="min-w-0 flex-1 tabular-nums"
          />
          {/* Um `select` de duas opções em vez de rádios: cabe na linha do
              valor, que é onde a unidade faz sentido ser lida. */}
          <select
            name="meta_unidade"
            value={unidade}
            onChange={(e) => setUnidade(e.target.value as UnidadeDaMeta)}
            aria-label="Unidade da meta"
            className="rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="tc">TC</option>
            <option value="gp">gp</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Em branco = pasta sem meta. Em TC, o alvo em gold é recalculado ao preço que você
          configurou para o mundo.
        </p>
      </div>
    </div>
  );
}

function Recado({ estado }: { estado: Resultado | null }) {
  if (!estado || estado.ok) return null;
  return (
    <p role="alert" className="mt-3 text-xs text-destructive">
      {estado.mensagem}
    </p>
  );
}

export function NovaPasta() {
  const [aberto, setAberto] = useState(false);
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(criarPasta, null);

  // Fecha sozinho quando deu certo. Manter aberto obrigaria a fechar à mão um
  // diálogo que já fez o que tinha de fazer.
  useEffect(() => {
    if (estado?.ok) setAberto(false);
  }, [estado]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Nova pasta"
        aria-label="Nova pasta"
        className="ml-auto grid h-5 w-5 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Nova pasta">
        <form action={acao}>
          <Campos />
          <Recado estado={estado} />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={enviando}>
              {enviando ? "Criando…" : "Criar pasta"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function EditarPasta({ pasta }: { pasta: PastaEditavel }) {
  const [aberto, setAberto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [estado, acao, enviando] = useActionState<Resultado | null, FormData>(editarPasta, null);

  useEffect(() => {
    if (estado?.ok) setAberto(false);
  }, [estado]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // O botão vive dentro do <Link> da pasta; sem isto, editar navegaria.
          e.preventDefault();
          e.stopPropagation();
          setAberto(true);
        }}
        title={`Editar "${pasta.nome}"`}
        aria-label={`Editar pasta ${pasta.nome}`}
        className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover/pasta:opacity-100"
      >
        <Pencil className="h-3 w-3" />
      </button>

      <Modal aberto={aberto} aoFechar={() => setAberto(false)} titulo="Editar pasta">
        <form action={acao}>
          <input type="hidden" name="id" value={pasta.id} />
          <Campos pasta={pasta} />
          <Recado estado={estado} />
          <div className="mt-5 flex items-center gap-2">
            {/* Apagar fica longe do Salvar, e pede confirmação. As hunts
                sobrevivem — `on delete set null` —, mas a pasta não volta. */}
            {confirmando ? (
              <span className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Apagar?</span>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  não
                </button>
                <button
                  type="submit"
                  formAction={apagarPasta}
                  className="font-medium text-destructive"
                >
                  sim, apagar
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmando(true)}
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Apagar pasta
              </button>
            )}

            <span className="ml-auto flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={enviando}>
                {enviando ? "Salvando…" : "Salvar"}
              </Button>
            </span>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Apagar a pasta não apaga as hunts: elas voltam para “Sem pasta”.
          </p>
        </form>
      </Modal>
    </>
  );
}
