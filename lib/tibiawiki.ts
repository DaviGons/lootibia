/**
 * Cliente da TibiaWikiApi. Camada única, diretriz 15 — nenhum `fetch` solto.
 *
 * ## Só roda no SERVIDOR, e isso não é escolha
 *
 * `tibiawiki.dev` **não envia `Access-Control-Allow-Origin`** para origens
 * externas (verificado, `docs/tibia-apis.md`). O navegador bloqueia a resposta,
 * então quem chama tem de ser o servidor. É o oposto da TibiaData, que responde
 * `*` e por isso é buscada pelo navegador nos boostados do dia (diretriz 44).
 *
 * Isso, aliás, foi o motivo de o projeto não ser um SPA (diretriz 25).
 *
 * ## Uso previsto: uma chamada, numa ação de usuário
 *
 * Validar um nome de item quando alguém digita. Não é laço, não é carga em
 * massa — se um dia for, a diretriz 18 manda no máximo 2–3 simultâneas com
 * backoff, e job offline em vez de requisição de usuário.
 *
 * ## `404` com corpo vazio
 *
 * A TibiaWikiApi devolve `404` sem corpo para página inexistente (diretriz 16).
 * "Não existe" é **resposta**, não falha: `buscarItem` devolve `null`. O que
 * lança é a API estar fora do ar — aí a tela precisa dizer outra coisa.
 */

import { variantesDeTitulo } from "./nomesDeItem.ts";

const BASE = "https://tibiawiki.dev/api";
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";

/** Curto: isto roda dentro de uma ação de usuário que está esperando. */
const TIMEOUT_MS = 8000;

export class ErroDaTibiaWiki extends Error {}

export interface ItemDoWiki {
  /** Título da página, na grafia do wiki: `Wand of Inferno`. */
  readonly titulo: string;
  /**
   * `npcvalue` em gold, ou `null` quando ausente ou zero.
   *
   * Zero vira `null` de propósito: é o caso da great mana potion, que você
   * compra e não vende. "Zero" seria lido como "não vale nada", que é falso —
   * ausência de referência não é ausência de valor (diretriz 24).
   */
  readonly npcvalue: number | null;
}

/**
 * Busca um item pelo nome como o jogador digita.
 *
 * Tenta as variantes de `variantesDeTitulo` na ordem, porque a API é sensível a
 * caixa e `Wand Of Inferno` dá 404 enquanto `Wand of Inferno` dá 200. Cobertura
 * medida: 135 de 135 itens do banco (`scripts/conferir-itens.ts`).
 */
export async function buscarItem(nome: string): Promise<ItemDoWiki | null> {
  const variantes = variantesDeTitulo(nome);
  if (variantes.length === 0) return null;

  let algumaRespondeu = false;

  for (const titulo of variantes) {
    const controle = new AbortController();
    const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);
    let resposta: Response;
    try {
      resposta = await fetch(`${BASE}/items/${encodeURIComponent(titulo)}`, {
        signal: controle.signal,
        headers: { "User-Agent": UA },
      });
    } catch {
      continue; // esta variante não respondeu; tenta a próxima
    } finally {
      clearTimeout(relogio);
    }

    algumaRespondeu = true;
    if (resposta.status === 404) continue; // não é esta grafia
    if (!resposta.ok) continue;

    const texto = await resposta.text();
    let corpo: { name?: unknown; npcvalue?: unknown };
    try {
      corpo = JSON.parse(texto) as typeof corpo;
    } catch {
      continue; // 200 com corpo que não é JSON — não confiar no status sozinho
    }
    if (typeof corpo.name !== "string" || corpo.name === "") continue;

    return { titulo: corpo.name, npcvalue: emGold(corpo.npcvalue) };
  }

  // Nenhuma variante respondeu NADA: a API está fora, e isso é diferente de
  // "o item não existe". A tela precisa saber a diferença.
  if (!algumaRespondeu) throw new ErroDaTibiaWiki("Não deu para falar com o TibiaWiki.");
  return null;
}

/**
 * `npcvalue` chega como string (diretriz 21: todo escalar da TibiaWikiApi é
 * string), às vezes com separador de milhar. Zero e ausente viram `null`.
 */
function emGold(bruto: unknown): number | null {
  if (typeof bruto !== "string") return null;
  const n = Number(bruto.replace(/[.,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
