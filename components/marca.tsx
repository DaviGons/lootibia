/**
 * A marca na tela. Lê a geometria de `lib/marca.ts`, a mesma que o gerador de
 * favicon e de imagens sociais usa — mexer no desenho é mexer num lugar só.
 *
 * O punho é `currentColor`: em `text-foreground` a espada acompanha as letras
 * nos dois temas, sem variante escura e clara para manter.
 */

import { CAIXA_ICONE, CAIXA_MARCA, CONTORNOS, ESPADA, HASTES, ICONE, PINGOS } from "@/lib/marca";

/**
 * Wordmark completo. `altura` em px; a largura sai da proporção 396:112.
 *
 * Fica com `role="img"` e `aria-label`, porque para o leitor de tela isto é o
 * nome do produto, não um enfeite — é o `<h1>` da página.
 */
export function Marca({ altura = 22, className }: { altura?: number; className?: string }) {
  return (
    <svg
      viewBox={CAIXA_MARCA}
      height={altura}
      // Largura explícita, e não deduzida da viewBox: SVG embutido sem `width`
      // assume 100% e estoura o contêiner. Arredondada para não despejar 14
      // casas decimais no HTML.
      width={Math.round((altura * 396 * 100) / 112) / 100}
      role="img"
      aria-label="lootibia"
      className={className}
    >
      <g fill="currentColor" fillRule="evenodd">
        {HASTES.map(([x, y, w, h]) => (
          <rect key={`h${x}-${y}`} x={x} y={y} width={w} height={h} />
        ))}
        {PINGOS.map(([cx, cy, r]) => (
          <circle key={`p${cx}`} cx={cx} cy={cy} r={r} />
        ))}
        {CONTORNOS.map((d) => (
          <path key={d.slice(0, 12)} d={d} />
        ))}
        <rect
          x={ESPADA.cabo[0]}
          y={ESPADA.cabo[1]}
          width={ESPADA.cabo[2]}
          height={ESPADA.cabo[3]}
          rx={ESPADA.cabo[4]}
        />
        <rect
          x={ESPADA.guarda[0]}
          y={ESPADA.guarda[1]}
          width={ESPADA.guarda[2]}
          height={ESPADA.guarda[3]}
          rx={ESPADA.guarda[4]}
        />
      </g>
      <path d={ESPADA.lamina} className="fill-primary" />
    </svg>
  );
}

/**
 * A espada sozinha, sem o tile de fundo — para quando já existe superfície
 * atrás dela. Decorativa: quem usa junto do wordmark não quer o leitor de tela
 * anunciando duas vezes.
 */
export function Espada({ altura = 20, className }: { altura?: number; className?: string }) {
  return (
    <svg
      viewBox={CAIXA_ICONE}
      height={altura}
      width={altura}
      aria-hidden="true"
      className={className}
    >
      <g fill="currentColor">
        <rect
          x={ICONE.cabo[0]}
          y={ICONE.cabo[1]}
          width={ICONE.cabo[2]}
          height={ICONE.cabo[3]}
          rx={ICONE.cabo[4]}
        />
        <rect
          x={ICONE.guarda[0]}
          y={ICONE.guarda[1]}
          width={ICONE.guarda[2]}
          height={ICONE.guarda[3]}
          rx={ICONE.guarda[4]}
        />
      </g>
      <path d={ICONE.lamina} className="fill-primary" />
    </svg>
  );
}
