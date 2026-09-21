"use client";

import { useEffect, useState } from "react";

/**
 * A lateral: fixa no desktop, gaveta no celular.
 *
 * O conteúdo continua sendo renderizado no SERVIDOR — chega aqui por
 * `children`. Este componente só cuida do abre-e-fecha, que é a única parte
 * que precisa de estado no cliente. Transformar a lateral inteira em client
 * component obrigaria a mandar as pastas por prop serializada e arrastaria o
 * `lib/meta.ts` para o bundle do navegador sem necessidade.
 */
export function Gaveta({ children }: { children: React.ReactNode }) {
  const [aberta, setAberta] = useState(false);

  // Corpo travado enquanto aberta: senão o fundo rola junto com a gaveta,
  // que é o defeito clássico de menu em celular.
  useEffect(() => {
    if (!aberta) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [aberta]);

  useEffect(() => {
    if (!aberta) return;
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && setAberta(false);
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberta]);

  return (
    <>
      {/* O botão vive aqui, mas aparece no cabeçalho do <main> via `fixed` —
          assim a página não precisa saber que existe uma gaveta. */}
      <button
        type="button"
        onClick={() => setAberta(true)}
        aria-label="Abrir menu"
        aria-expanded={aberta}
        className="fixed left-3 top-3 z-30 grid h-9 w-9 place-items-center rounded-lg border bg-card text-foreground shadow-sm lg:hidden"
      >
        <span aria-hidden className="text-lg leading-none">
          ☰
        </span>
      </button>

      {aberta && (
        <div
          onClick={() => setAberta(false)}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] lg:hidden"
        />
      )}

      {/*
        Fecha ao clicar em qualquer link de dentro. A alternativa óbvia era
        observar a navegação com `usePathname` + `useSearchParams`, mas só o
        segundo detecta a troca de `?pasta=1` para `?pasta=2` — que é justamente
        o caso — e ele OBRIGA quem renderiza a lateral a envolvê-la num
        <Suspense>, sob pena de "blocking prerender client hook". Um ouvinte de
        clique não impõe nada a quem usa o componente.
      */}
      <div
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) setAberta(false);
        }}
        className={`z-50 transition-transform duration-200 max-lg:fixed max-lg:inset-y-0 max-lg:left-0 ${
          aberta ? "max-lg:translate-x-0" : "max-lg:-translate-x-full"
        }`}
      >
        {children}
      </div>
    </>
  );
}
