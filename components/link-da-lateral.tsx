"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";

/**
 * Um link da lateral que sabe se é a página aberta.
 *
 * A lateral mora no layout, e layout não recebe `searchParams` nem sabe a rota:
 * quem sabe é o navegador. `useSearchParams` obriga um <Suspense> acima — a
 * lateral já está atrás de um, porque lê o cookie da sessão.
 *
 * `/hunts?pasta=3` só é ativo com `pasta=3`; `/hunts` sozinho só sem `pasta`.
 */
export function LinkDaLateral({
  href,
  base,
  seAtivo,
  seInativo,
  children,
}: {
  href: string;
  /** Classes em texto, e não uma função: quem chama é componente de servidor. */
  base: string;
  seAtivo: string;
  seInativo: string;
  children: React.ReactNode;
}) {
  const rota = usePathname();
  const busca = useSearchParams();
  const alvo = new URL(href, "http://x");
  const ativo = rota === alvo.pathname && (busca.get("pasta") ?? null) === alvo.searchParams.get("pasta");

  return (
    <Link href={href} aria-current={ativo ? "page" : undefined} className={`${base} ${ativo ? seAtivo : seInativo}`}>
      {children}
    </Link>
  );
}

/**
 * Grupo da lateral com setinha que recolhe.
 *
 * Começa aberto, e o que a pessoa escolher fica guardado no navegador — é
 * conveniência de quem usa, não dado da conta. O `try` cobre navegador que
 * bloqueia o armazenamento: aí o grupo só não lembra, e continua funcionando.
 */
export function GrupoDaLateral({
  id,
  titulo,
  acao,
  children,
}: {
  id: string;
  titulo: string;
  /** Botão ao lado do título, como o "+" de nova pasta. */
  acao?: React.ReactNode;
  children: React.ReactNode;
}) {
  const chave = `lootibia:grupo:${id}`;
  const [aberto, setAberto] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(chave) === "fechado") setAberto(false);
    } catch {}
  }, [chave]);

  function alternar() {
    setAberto((a) => {
      try {
        localStorage.setItem(chave, a ? "fechado" : "aberto");
      } catch {}
      return !a;
    });
  }

  return (
    <div>
      <div className="mb-1 flex items-center px-1">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={aberto}
          className="flex flex-1 items-center gap-1 rounded-md px-1 py-1 text-[10.5px] font-semibold uppercase tracking-[.09em] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform duration-150 ${aberto ? "rotate-90" : ""}`}
          />
          {titulo}
        </button>
        {acao}
      </div>
      {aberto && <div className="flex flex-col">{children}</div>}
    </div>
  );
}
