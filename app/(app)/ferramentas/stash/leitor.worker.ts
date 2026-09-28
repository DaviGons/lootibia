/**
 * O leitor de prints, fora da thread da tela.
 *
 * Preparar os ~4 mil sprites e varrer um print de 1920×1080 leva uma fração de
 * segundo, mas na thread principal isso congela a página enquanto roda. Aqui
 * dentro, a tela continua respondendo.
 *
 * Protocolo: `{ tipo: "atlas", rgba, largura, altura }` uma vez; depois
 * `{ tipo: "print", id, rgba, largura, altura }` por print. Responde
 * `{ tipo: "pronto" }` e `{ tipo: "lido", id, leitura }`.
 */

import { ATLAS, ITENS_DO_STASH } from "@/lib/dados/stash";
import { lerPrint, prepararSprites, type SpritePreparado } from "@/lib/stash";

// Tipado à mão: a lib "webworker" do TypeScript briga com a do DOM, que o
// resto do projeto usa.
const worker = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (m: unknown) => void;
};

let sprites: SpritePreparado[] | null = null;
// Print que chega antes do atlas espera aqui: sem isto, quem soltasse um print
// nos primeiros segundos ficava com "lendo…" para sempre.
const naFila: { id: number; rgba: Uint8ClampedArray; largura: number; altura: number }[] = [];

function ler(m: { id: number; rgba: Uint8ClampedArray; largura: number; altura: number }) {
  const leitura = lerPrint({ largura: m.largura, altura: m.altura, dados: m.rgba }, sprites!);
  worker.postMessage({ tipo: "lido", id: m.id, leitura });
}

worker.onmessage = (e: MessageEvent) => {
  const m = e.data;
  if (m.tipo === "atlas") {
    const donos: number[] = [];
    ITENS_DO_STASH.forEach((it, i) => it[5].forEach((s) => (donos[s] = i)));
    sprites = prepararSprites({ largura: m.largura, altura: m.altura, dados: m.rgba }, ATLAS.colunas, donos);
    worker.postMessage({ tipo: "pronto" });
    for (const p of naFila.splice(0)) ler(p);
  } else if (m.tipo === "print") {
    if (sprites) ler(m);
    else naFila.push(m);
  }
};
