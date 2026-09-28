import { Analisador } from "./analisador";

/**
 * Stash analyzer. Página estática: tudo acontece no navegador de quem usa —
 * o print é lido ali e não passa pelo servidor.
 */
export default function PaginaStash() {
  return (
    // `pt-16` no celular abre espaço para o botão do menu, que é `fixed`.
    <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-16 sm:px-6 sm:pb-14 lg:pt-14">
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Stash analyzer</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Mande prints do seu Supply Stash e veja o que serve para Delivery Task, para imbuement e
        quanto tudo vale no NPC.
      </p>
      <Analisador />
    </main>
  );
}
