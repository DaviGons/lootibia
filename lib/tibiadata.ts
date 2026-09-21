/**
 * Cliente da TibiaData. Camada única, diretriz 15 — nenhum `fetch` solto pelo
 * código.
 *
 * ## Quem chama o quê, e de onde
 *
 * | Função | Quem chama | Por quê ali |
 * |---|---|---|
 * | `buscarPersonagem` | servidor, numa ação de usuário | acontece ao cadastrar o char, não a cada página |
 * | `buscarDoDia` | **o navegador** | muda todo server save e não pode ser arquivo versionado |
 *
 * O caso do navegador não é preguiça. Boostado do dia e gente online mudam
 * rápido demais para virar arquivo (diretriz 33) e com frequência demais para
 * buscar no servidor a cada requisição (diretriz 17). A TibiaData responde
 * `Access-Control-Allow-Origin: *` — verificado, está em `docs/tibia-apis.md` —
 * então o navegador busca direto, o cache HTTP dele respeita o `max-age` de
 * 900 s que a API manda, e o nosso servidor não entra na conta.
 *
 * ## Nunca confiar só no status HTTP (diretriz 16)
 *
 * A TibiaData devolve `502 text/plain` para recurso inexistente — não 404 — e
 * `400` com JSON válido para erro de validação. A verdade está em
 * `information.status`. Por isso todo corpo é lido como texto antes de virar
 * JSON: `r.json()` num `text/plain` estoura com erro que não diz nada.
 */

const BASE = "https://api.tibiadata.com/v4";
const UA = "lootibia/0.1 (+https://lootibia.vercel.app)";

/** Timeout curto: isto roda dentro de uma ação de usuário que está esperando. */
const TIMEOUT_MS = 8000;

export interface PersonagemDaApi {
  readonly nome: string;
  readonly mundo: string;
  readonly vocacao: string;
  readonly nivel: number;
}

export interface MundoDaApi {
  readonly nome: string;
  readonly online: number;
  readonly status: string;
  readonly pvp: string;
}

export interface BoostadoDoDia {
  readonly nome: string;
  readonly imagem: string;
}

export interface DoDia {
  readonly criatura: BoostadoDoDia | null;
  readonly boss: BoostadoDoDia | null;
}

/**
 * O que deu errado, em português, pronto para a tela.
 *
 * `codigo` é o `information.status.error` da API quando existe. Ele carrega a
 * diferença entre "você pediu algo que não existe" e "eu estou com problema",
 * que o HTTP sozinho não conta — ver a tabela em `NaoEncontrado`.
 */
export class ErroDaTibiaData extends Error {
  readonly codigo?: number;

  // Campo declarado e atribuído à mão, e não `readonly codigo` na assinatura:
  // propriedade de parâmetro é sintaxe que o `--experimental-strip-types` do
  // Node recusa, e é com ele que os testes deste projeto rodam.
  constructor(mensagem: string, codigo?: number) {
    super(mensagem);
    this.codigo = codigo;
  }
}

/** `information.status.error` que significam "não existe", não "falhou". */
const ERRO_INEXISTENTE = new Set([
  11002, // the provided world does not exist
]);

/**
 * Interno: o recurso não existe. Não é erro, é resposta.
 *
 * Existe porque a TibiaData tem **três** formatos de resposta, e só o primeiro
 * é o documentado — os outros dois foram descobertos batendo na API de verdade:
 *
 * | Caso | HTTP | Corpo |
 * |---|---|---|
 * | achou | 200 | envelope completo, `information.status.http_code = 200` |
 * | **não existe** | **502** | `error code: 502` em **texto puro**, sem envelope |
 * | nome inválido | 422 | `{"message":"…"}` em JSON, **sem** envelope |
 * | mundo não existe | 200 | envelope com `status.error = 11002` |
 *
 * O 502 é o que a diretriz 16 avisa: *"devolve 502 text/plain para recurso
 * inexistente (não 404)"*. Tratar isso como falha faria "personagem não
 * encontrado" virar "a TibiaData está fora do ar".
 */
class NaoEncontrado extends Error {}

interface Envelope {
  information?: { status?: { http_code?: number; error?: number; message?: string } };
  /** Só nas respostas de validação (422), que não trazem envelope. */
  message?: string;
}

/**
 * Busca e valida o envelope. O `agente` só vai no servidor: definir
 * `User-Agent` no navegador é proibido pela própria plataforma, e o header
 * seria descartado com um aviso no console.
 */
async function pegar<T extends Envelope>(caminho: string, noNavegador: boolean): Promise<T> {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_MS);

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      signal: controle.signal,
      headers: noNavegador ? {} : { "User-Agent": UA },
    });
  } catch (e) {
    throw new ErroDaTibiaData(
      (e as Error)?.name === "AbortError"
        ? "A TibiaData demorou demais para responder."
        : "Não deu para falar com a TibiaData.",
    );
  } finally {
    clearTimeout(relogio);
  }

  const texto = await resposta.text();
  let corpo: T;
  try {
    corpo = JSON.parse(texto) as T;
  } catch {
    // Corpo que não é JSON. Com 502 isso é o "não existe" da tabela acima;
    // qualquer outro status é a API realmente mal.
    if (resposta.status === 502) throw new NaoEncontrado();
    throw new ErroDaTibiaData(`A TibiaData respondeu algo inesperado (HTTP ${resposta.status}).`);
  }

  // Resposta de validação: JSON sem envelope, só `message`. A frase vem em
  // inglês da API; repassar crua é melhor que engolir e dizer "erro".
  if (!corpo.information && typeof corpo.message === "string") {
    throw new ErroDaTibiaData(`A TibiaData recusou o nome: ${corpo.message}`);
  }

  const status = corpo.information?.status;
  if (status?.http_code !== 200) {
    // Envelope válido dizendo que o recurso não existe — o caso do mundo, que
    // não usa o 502 do personagem. Quarto formato de resposta desta API.
    if (status?.error !== undefined && ERRO_INEXISTENTE.has(status.error)) {
      throw new NaoEncontrado();
    }
    throw new ErroDaTibiaData(
      status?.message ?? `A TibiaData recusou (HTTP ${status?.http_code}).`,
      status?.error,
    );
  }
  return corpo;
}

/**
 * Dados do personagem. Roda no servidor, numa ação de usuário.
 *
 * Devolve `null` quando o personagem não existe, em vez de lançar: "não existe"
 * é resposta normal de uma busca, não falha. O que lança é a API estar fora do
 * ar — aí a tela precisa dizer outra coisa.
 */
export async function buscarPersonagem(nome: string): Promise<PersonagemDaApi | null> {
  let corpo: Envelope & { character?: { character?: Record<string, unknown> } };
  try {
    corpo = await pegar(`/character/${encodeURIComponent(nome.trim())}`, false);
  } catch (e) {
    if (e instanceof NaoEncontrado) return null; // o 502 da tabela acima
    throw e;
  }

  const c = corpo.character?.character;
  // Cinto e suspensório: o caminho normal do "não existe" é o 502 tratado
  // acima, mas um bloco vazio aqui também significa que não achou.
  if (!c || typeof c.name !== "string" || c.name === "") return null;

  return {
    nome: c.name,
    mundo: typeof c.world === "string" ? c.world : "",
    vocacao: typeof c.vocation === "string" ? c.vocation : "",
    nivel: typeof c.level === "number" ? c.level : 0,
  };
}

/** Estado do mundo. Chamado do navegador (`noNavegador`), muda a cada 60 s. */
export async function buscarMundo(nome: string, noNavegador = true): Promise<MundoDaApi | null> {
  let corpo: Envelope & { world?: Record<string, unknown> };
  try {
    corpo = await pegar(`/world/${encodeURIComponent(nome.trim())}`, noNavegador);
  } catch (e) {
    if (e instanceof NaoEncontrado) return null;
    throw e;
  }
  const w = corpo.world;
  if (!w || typeof w.name !== "string") return null;
  return {
    nome: w.name,
    online: typeof w.players_online === "number" ? w.players_online : 0,
    status: typeof w.status === "string" ? w.status : "",
    pvp: typeof w.pvp_type === "string" ? w.pvp_type : "",
  };
}

function boostado(bloco: unknown): BoostadoDoDia | null {
  if (!bloco || typeof bloco !== "object") return null;
  const b = bloco as { name?: unknown; image_url?: unknown };
  if (typeof b.name !== "string" || b.name === "") return null;
  return { nome: b.name, imagem: typeof b.image_url === "string" ? b.image_url : "" };
}

/**
 * Criatura e boss boostados. São duas chamadas porque são dois endpoints.
 *
 * `Promise.allSettled` e não `all`: se a lista de bosses cair, a criatura ainda
 * aparece. Faixa decorativa não derruba a página por causa de meia informação.
 */
export async function buscarDoDia(noNavegador = true): Promise<DoDia> {
  const [criaturas, bosses] = await Promise.allSettled([
    pegar<Envelope & { creatures?: { boosted?: unknown } }>("/creatures", noNavegador),
    pegar<Envelope & { boostable_bosses?: { boosted?: unknown } }>("/boostablebosses", noNavegador),
  ]);

  return {
    criatura: criaturas.status === "fulfilled" ? boostado(criaturas.value.creatures?.boosted) : null,
    boss: bosses.status === "fulfilled" ? boostado(bosses.value.boostable_bosses?.boosted) : null,
  };
}
