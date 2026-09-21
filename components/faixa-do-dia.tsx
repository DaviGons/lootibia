"use client";

import { useEffect, useState } from "react";
import { buscarDoDia, type DoDia } from "@/lib/tibiadata";
import type { ParadaDoRashid } from "@/lib/rashid";

/**
 * O que muda todo server save: criatura e boss boostados, e onde o Rashid está.
 *
 * ## Por que o Rashid vem pronto e os boostados não
 *
 * O Rashid é função pura do dia de Tibia — o servidor calcula com
 * `lib/rashid.ts` e manda por prop. Zero rede.
 *
 * Os boostados vêm da TibiaData, e **quem busca é o navegador**, não nós.
 * Guardar num arquivo versionado não serve, porque mudam diariamente
 * (diretriz 33); buscar no servidor a cada requisição desperdiça o `max-age`
 * de 900 s que a API manda (diretriz 17). Como ela responde
 * `Access-Control-Allow-Origin: *`, o navegador busca direto e o cache HTTP
 * dele faz o trabalho. Nosso servidor não entra na conta.
 *
 * A faixa some se a busca falhar. É informação ambiente — nada aqui justifica
 * uma mensagem de erro na cara de quem só queria ver o profit.
 */
export function FaixaDoDia({ rashid, mundo }: { rashid: ParadaDoRashid; mundo?: string | null }) {
  const [dia, setDia] = useState<DoDia | null>(null);

  useEffect(() => {
    let vivo = true;
    buscarDoDia()
      .then((d) => vivo && setDia(d))
      .catch(() => {
        /* faixa decorativa não vira erro de página */
      });
    return () => {
      vivo = false;
    };
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground sm:px-6">
      {dia?.criatura && <Item rotulo="Criatura" nome={dia.criatura.nome} imagem={dia.criatura.imagem} />}
      {dia?.boss && <Item rotulo="Boss" nome={dia.boss.nome} imagem={dia.boss.imagem} />}

      <span className="flex items-center gap-2">
        <span aria-hidden className="text-base leading-none">
          📍
        </span>
        <span>
          <span className="block text-[10px] uppercase tracking-wider opacity-75">Rashid</span>
          <span className="font-medium text-foreground">{rashid.cidade}</span>
          {rashid.onde && <span className="opacity-80"> · {rashid.onde}</span>}
        </span>
      </span>

      {mundo && <Online mundo={mundo} />}

      <span className="ml-auto hidden opacity-80 sm:inline">
        vira no server save · 10:00 de Berlim
      </span>
    </div>
  );
}

function Item({ rotulo, nome, imagem }: { rotulo: string; nome: string; imagem: string }) {
  return (
    <span className="flex items-center gap-2">
      {/* `static.tibia.com` responde 403 para quem não é navegador, então a URL
          vai crua e quem busca é o navegador do usuário. Nada de next/image,
          cujo otimizador buscaria do servidor e levaria o mesmo 403. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {imagem && <img src={imagem} alt="" width={22} height={22} className="h-[22px] w-[22px] object-contain [image-rendering:pixelated]" />}
      <span>
        <span className="block text-[10px] uppercase tracking-wider opacity-75">{rotulo}</span>
        <span className="font-medium text-foreground">{nome}</span>
      </span>
    </span>
  );
}

/**
 * Gente online no mundo. Também do navegador, e por um motivo mais forte: o
 * TTL é de 60 s, curto demais para qualquer cache nosso valer a pena.
 */
function Online({ mundo }: { mundo: string }) {
  const [n, setN] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    import("@/lib/tibiadata")
      .then((m) => m.buscarMundo(mundo))
      .then((w) => vivo && w && setN(w.online))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [mundo]);

  if (n === null) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      <span>
        <span className="font-medium text-foreground">{n.toLocaleString("pt-BR")}</span> online em{" "}
        {mundo}
      </span>
    </span>
  );
}
