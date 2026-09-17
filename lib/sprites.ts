/**
 * Sprite de criatura, a partir do arquivo versionado em `lib/dados/criaturas.ts`.
 *
 * Nenhuma chamada de rede acontece aqui. Quem fala com a TibiaData é o script
 * `scripts/atualizar-criaturas.ts`, rodado à mão quando o jogo ganha criatura
 * nova (diretriz 15). O motivo está registrado lá: com o cache em memória
 * padrão do Next, instância serverless é efêmera e a lista seria rebuscada a
 * cada requisição.
 *
 * As imagens são GIF 64×64 em `static.tibia.com`, que **responde 403 para
 * quem não é navegador**. A URL vai crua para o `<img>` e quem busca é o
 * navegador do usuário — nada de `next/image`, cujo otimizador buscaria a
 * partir do servidor e levaria o mesmo 403.
 */

import { CRIATURAS } from "./dados/criaturas.ts";
import { variantesDeNome } from "./nomesDeCriatura.ts";

/**
 * Índice `chave -> URL`, montado uma vez por processo.
 *
 * Cada criatura entra sob todas as variantes do nome e sob o `race`, porque
 * o plural do inglês é ambíguo e o `race` resgata os irregulares. Dá ~2.600
 * chaves. Detalhes em `lib/nomesDeCriatura.ts`.
 */
const INDICE: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const [nome, race, imagem] of CRIATURAS) {
    for (const chave of variantesDeNome(nome)) if (!m.has(chave)) m.set(chave, imagem);
    if (race && !m.has(race)) m.set(race, imagem);
  }
  return m;
})();

/**
 * URL do sprite de um nome vindo do Hunt Analyser, ou `undefined`.
 *
 * `undefined` é caso normal, não erro: a biblioteca do tibia.com cobre ~718
 * criaturas, e boss e bicho de evento não estão lá. A tela mostra um marcador
 * no lugar.
 */
export function spriteDe(nome: string): string | undefined {
  for (const chave of variantesDeNome(nome)) {
    const url = INDICE.get(chave);
    if (url) return url;
  }
  return undefined;
}

/** Só para teste e diagnóstico: quantas chaves o índice tem. */
export function tamanhoDoIndice(): number {
  return INDICE.size;
}
