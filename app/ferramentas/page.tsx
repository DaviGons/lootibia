import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Topo } from "./topo";

/**
 * A caixa de ferramentas. Cresce uma entrada por ferramenta; a ordem é a de
 * utilidade, não a de chegada.
 */
const FERRAMENTAS = [
  {
    href: "/ferramentas/level",
    titulo: "Prever level",
    descricao: "Quando você chega ao level que quer, no ritmo real das suas hunts.",
    icone: TrendingUp,
  },
] as const;

export default function PaginaFerramentas() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Topo />
      <h1 className="mb-2 text-2xl font-semibold tracking-tight">Ferramentas</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Calculadoras que usam as hunts que você já importou.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {FERRAMENTAS.map(({ href, titulo, descricao, icone: Icone }) => (
          <li key={href}>
            <Link
              href={href}
              className="entra flex h-full gap-3 rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              <Icone className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
              <span>
                <span className="block text-sm font-semibold">{titulo}</span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {descricao}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
