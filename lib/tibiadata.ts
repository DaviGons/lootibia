/**
 * Cliente único da TibiaData API (diretriz 15). Nenhum `fetch` para a
 * api.tibiadata.com deve existir fora daqui.
 *
 * Hoje serve a uma coisa só: o sprite de cada criatura. Duas descobertas
 * moldaram o desenho (ver docs/tibia-apis.md):
 *
 * 1. `/v4/creatures` devolve as ~718 criaturas em UMA chamada, cada uma com
 *    `name`, `race` e `image_url`. Não existe motivo para chamar
 *    `/v4/creature/{race}` por monstro.
 *
 * 2. O nome do Hunt Analyser NÃO casa com o `race`. O jogo escreve
 *    "betrayed wraith" e o race é "wraith" — nenhuma slugificação chega lá.
 *    O que casa é o NOME, depois de normalizar plural dos dois lados:
 *    "betrayed wraith" ↔ "Betrayed Wraiths". Ver `normalizarNomeDeCriatura`.
 *
 * 3. `static.tibia.com` responde 403 para cliente que não é navegador. A URL
 *    precisa ir para o `<img>` e ser buscada PELO NAVEGADOR — nada de
 *    otimização de imagem da Vercel, que buscaria do servidor e levaria 403.
 */

import { cacheLife } from "next/cache";
import { normalizarNomeDeCriatura } from "./nomesDeCriatura.ts";

export { normalizarNomeDeCriatura };

const BASE = "https://api.tibiadata.com/v4";
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";

interface CriaturaDaLista {
  name: string;
  race: string;
  image_url: string;
}

/**
 * Mapa `nome normalizado -> URL do sprite`, para o `<img>` do navegador.
 *
 * Objeto simples, não Map, porque o valor atravessa a fronteira do cache.
 *
 * Sprite é decoração: qualquer falha devolve mapa vazio e a tela segue igual,
 * sem sprite. Nada aqui pode derrubar a página.
 */
export async function spritesDeCriaturas(): Promise<Record<string, string>> {
  "use cache";
  // A lista só muda quando o jogo ganha criatura nova, ou seja, a cada
  // atualização. Bem acima do TTL de 900 s que a API pede (diretriz 17).
  cacheLife("days");

  try {
    const r = await fetch(`${BASE}/creatures`, { headers: { "User-Agent": UA } });

    // Diretriz 16: não confiar só no status. A TibiaData devolve 502 em
    // text/plain para recurso inexistente e 400 com JSON para erro de
    // validação — o corpo pode nem ser JSON.
    const texto = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(texto);
    } catch {
      return {};
    }

    const corpo = json as {
      creatures?: { creature_list?: CriaturaDaLista[] };
      information?: { status?: { http_code?: number } };
    };
    if (corpo.information?.status?.http_code !== 200) return {};

    const lista = corpo.creatures?.creature_list ?? [];
    const mapa: Record<string, string> = {};
    for (const c of lista) {
      if (c?.name && c?.image_url) mapa[normalizarNomeDeCriatura(c.name)] = c.image_url;
    }
    return mapa;
  } catch {
    return {};
  }
}
