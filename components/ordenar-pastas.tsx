"use client";

import { useOptimistic, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { reordenarPastas } from "@/app/hunts/pastas";

/**
 * Sobe e desce uma pasta na lista.
 *
 * Botões, e não arrastar. Arrastar é mais bonito e **pior**: sem teclado não
 * existe, num toque de celular briga com a rolagem, e para leitor de tela é
 * invisível sem uma camada inteira de anúncios ao vivo. Uma seta é operável
 * por mouse, dedo, teclado e leitor de tela sem nada disso.
 *
 * O reposicionamento é otimista — a lista se move antes de o servidor
 * responder. Numa ação de organizar, esperar a ida e volta faz a interface
 * parecer travada justamente quando a pessoa está repetindo o gesto.
 */
export function OrdenarPastas({
  ids,
  atual,
}: {
  /** Todos os ids de pasta, na ordem em que estão hoje. */
  ids: number[];
  /** A pasta que estes botões movem. */
  atual: number;
}) {
  const [ordem, moverOtimista] = useOptimistic(ids);
  const [, iniciar] = useTransition();

  const i = ordem.indexOf(atual);
  const primeira = i <= 0;
  const ultima = i === ordem.length - 1;

  function mover(direcao: -1 | 1) {
    const destino = i + direcao;
    if (destino < 0 || destino >= ordem.length) return;

    const nova = [...ordem];
    [nova[i], nova[destino]] = [nova[destino], nova[i]];

    iniciar(async () => {
      moverOtimista(nova);
      // `[id, posição]` na sequência final. O servidor não precisa saber o que
      // trocou de lugar — só qual é a ordem agora.
      await reordenarPastas(nova.map((id, pos) => [id, pos]));
    });
  }

  // Uma pasta sozinha não tem para onde ir; dois botões inertes só ocupariam
  // espaço na linha.
  if (ordem.length < 2) return null;

  return (
    <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/pasta:opacity-100">
      <Seta
        aoClicar={() => mover(-1)}
        desativado={primeira}
        rotulo="Mover pasta para cima"
        icone={<ChevronUp className="h-3 w-3" />}
      />
      <Seta
        aoClicar={() => mover(1)}
        desativado={ultima}
        rotulo="Mover pasta para baixo"
        icone={<ChevronDown className="h-3 w-3" />}
      />
    </span>
  );
}

function Seta({
  aoClicar,
  desativado,
  rotulo,
  icone,
}: {
  aoClicar: () => void;
  desativado: boolean;
  rotulo: string;
  icone: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={desativado}
      aria-label={rotulo}
      title={rotulo}
      onClick={(e) => {
        // Os botões vivem dentro do <Link> da pasta; sem isto, reordenar
        // navegaria para ela.
        e.preventDefault();
        e.stopPropagation();
        aoClicar();
      }}
      className="grid h-4 w-4 place-items-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
    >
      {icone}
    </button>
  );
}
