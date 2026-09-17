/**
 * Ver docs/bot-discord.md.
 *
 * Tipos e constantes do protocolo de Interactions do Discord.
 *
 * Existe para que nenhum número mágico escape para o resto do código: `type: 9`
 * não diz nada, `TipoDeResposta.MODAL` diz. Os valores vêm da referência oficial
 * (docs.discord.com/developers/interactions/receiving-and-responding) — não
 * inferir nem chutar (diretriz 14 vale para a API do Discord também).
 *
 * Os limites numéricos no fim do arquivo são os que a implementação PRECISA
 * respeitar; estourar qualquer um deles é `400` do Discord, não truncamento
 * silencioso.
 */

/** O que chegou: ping de verificação, slash command ou submit de modal. */
export const TipoDeInteracao = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

/**
 * O que respondemos.
 *
 * `DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE` é o "estou trabalhando": estende a
 * janela de 3 s para 15 min, e a resposta de verdade vai depois por `PATCH` no
 * webhook de follow-up.
 *
 * `MODAL` tem uma restrição que molda todo o desenho dos comandos: **precisa ser
 * a resposta inicial**. Não dá para adiar e abrir modal depois. Por isso todo
 * comando que abre modal responde na hora, e só o submit é que adia.
 */
export const TipoDeResposta = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7,
  MODAL: 9,
} as const;

/** Componentes. Só os três que o bot usa. */
export const TipoDeComponente = {
  ACTION_ROW: 1,
  BUTTON: 2,
  TEXT_INPUT: 4,
} as const;

/** Campo de modal: uma linha ou parágrafo. */
export const EstiloDeTexto = {
  CURTO: 1,
  PARAGRAFO: 2,
} as const;

/** Tipos de opção de slash command. Só o que o bot usa. */
export const TipoDeOpcao = {
  STRING: 3,
  BOOLEAN: 5,
} as const;

/**
 * Flag de mensagem efêmera: só quem chamou o comando enxerga.
 *
 * É bitfield — 1 << 6. Vai em `flags` do payload de resposta.
 */
export const EFEMERA = 1 << 6;

// ---------------------------------------------------------------------------
// Formato do que chega
// ---------------------------------------------------------------------------

export interface UsuarioDiscord {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface MembroDoServidor {
  user?: UsuarioDiscord;
}

export interface OpcaoDeComando {
  name: string;
  type: number;
  value?: string | number | boolean;
}

export interface CampoDeModal {
  type: number;
  custom_id: string;
  value: string;
}

export interface LinhaDeComponentes {
  type: number;
  components: CampoDeModal[];
}

export interface Interacao {
  id: string;
  application_id: string;
  type: number;
  token: string;
  /** Presente em comando e em submit de modal. */
  data?: {
    /** Nome do slash command (`addhunt`). Ausente em submit de modal. */
    name?: string;
    options?: OpcaoDeComando[];
    /** Identificador do modal que voltou. Ausente em slash command. */
    custom_id?: string;
    components?: LinhaDeComponentes[];
  };
  /** Em servidor vem `member.user`; em DM vem `user` na raiz. */
  member?: MembroDoServidor;
  user?: UsuarioDiscord;
}

// ---------------------------------------------------------------------------
// Leitura defensiva (diretriz 21: normalizar na borda)
// ---------------------------------------------------------------------------

/**
 * Quem disparou a interação.
 *
 * Em servidor o usuário vem em `member.user`; em mensagem direta, em `user` na
 * raiz. Confundir os dois é o bug clássico de bot que funciona em DM e quebra no
 * canal (ou o contrário).
 */
export function autorDaInteracao(i: Interacao): UsuarioDiscord | null {
  return i.member?.user ?? i.user ?? null;
}

/** Valor de uma opção de slash command, como string. Ausente vira `null`. */
export function opcaoTexto(i: Interacao, nome: string): string | null {
  const o = i.data?.options?.find((x) => x.name === nome);
  if (o?.value === undefined || o.value === null) return null;
  return String(o.value).trim() || null;
}

/** Valor booleano de uma opção. Ausente devolve o padrão informado. */
export function opcaoBooleana(i: Interacao, nome: string, padrao: boolean): boolean {
  const o = i.data?.options?.find((x) => x.name === nome);
  return typeof o?.value === "boolean" ? o.value : padrao;
}

/**
 * Valor de um campo de modal pelo `custom_id`.
 *
 * Os campos chegam aninhados em linhas de componentes, uma por campo. Campo
 * deixado em branco chega como string vazia, não some — por isso o `|| null`.
 */
export function campoDoModal(i: Interacao, customId: string): string | null {
  for (const linha of i.data?.components ?? []) {
    for (const campo of linha.components ?? []) {
      if (campo.custom_id === customId) return campo.value?.trim() || null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Limites da plataforma
// ---------------------------------------------------------------------------
//
// Conferidos na referência oficial (docs/bot-discord.md tem as fontes).
// Estourar qualquer um é `400` do Discord — a mensagem não sai pela metade.

export const LIMITES = {
  /** Campo de parágrafo em modal. A maior sessão real medida tem ~1.460. */
  MODAL_PARAGRAFO: 4000,
  /** Campo de linha única em modal. */
  MODAL_CURTO: 100,
  /** Título do modal. */
  MODAL_TITULO: 45,
  /** Valor de um campo de embed. É o que força o corte da lista de mobs. */
  EMBED_CAMPO_VALOR: 1024,
  /** Nome de um campo de embed. */
  EMBED_CAMPO_NOME: 256,
  /** Soma de tudo no embed: título, descrição, campos, rodapé. */
  EMBED_TOTAL: 6000,
  /** Campos por embed. */
  EMBED_CAMPOS: 25,
  /** Descrição do embed. */
  EMBED_DESCRICAO: 4096,
} as const;

// ---------------------------------------------------------------------------
// Construtores de resposta
// ---------------------------------------------------------------------------

export interface CampoDeEmbed {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  fields?: CampoDeEmbed[];
  footer?: { text: string };
}

/**
 * Cor da barra lateral dos embeds. Um só tom para tudo que o bot manda, porque
 * cor aqui é identidade visual, não semântica. Concretamente: o `--primary`
 * de `app/globals.css`, o mesmo laranja da lâmina da marca.
 */
export const COR = 0xeb6a33;

/**
 * Cor de erro — o `--destructive` da paleta. O usuário reconhece antes de ler.
 *
 * Os dois são quentes, o que normalmente seria problema. Medido: delta E 21,5
 * em visão normal e 14,6 sob deuteranopia, acima do limiar de ~11 em que duas
 * cores deixam de se distinguir. E a distinção aqui nunca é só a cor — o texto
 * do embed diz o que aconteceu.
 */
export const COR_ERRO = 0xd83731;

/** Resposta imediata em texto. `efemera` esconde de todo mundo menos de quem chamou. */
export function mensagem(texto: string, efemera = true) {
  return {
    type: TipoDeResposta.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: texto, ...(efemera ? { flags: EFEMERA } : {}) },
  };
}

/** Resposta imediata com embed. */
export function respostaEmbed(embed: Embed, efemera = true) {
  return {
    type: TipoDeResposta.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed], ...(efemera ? { flags: EFEMERA } : {}) },
  };
}

/**
 * "Estou trabalhando". Depois disto, a resposta de verdade vai por
 * `editarResposta`, e há 15 minutos para isso.
 *
 * A flag de efêmera precisa ser decidida AQUI: o follow-up não consegue mudar a
 * visibilidade de uma resposta já adiada.
 */
export function adiar(efemera = true) {
  return {
    type: TipoDeResposta.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    ...(efemera ? { data: { flags: EFEMERA } } : {}),
  };
}

export interface CampoDeEntrada {
  id: string;
  rotulo: string;
  estilo: number;
  obrigatorio?: boolean;
  tamanhoMaximo?: number;
  exemplo?: string;
  valor?: string;
}

/**
 * Abre um modal. Precisa ser a resposta INICIAL da interação — ver o comentário
 * de `TipoDeResposta`.
 */
export function modal(customId: string, titulo: string, campos: CampoDeEntrada[]) {
  return {
    type: TipoDeResposta.MODAL,
    data: {
      custom_id: customId,
      title: titulo.slice(0, LIMITES.MODAL_TITULO),
      components: campos.map((c) => ({
        type: TipoDeComponente.ACTION_ROW,
        components: [
          {
            type: TipoDeComponente.TEXT_INPUT,
            custom_id: c.id,
            label: c.rotulo,
            style: c.estilo,
            required: c.obrigatorio ?? false,
            ...(c.tamanhoMaximo ? { max_length: c.tamanhoMaximo } : {}),
            ...(c.exemplo ? { placeholder: c.exemplo } : {}),
            ...(c.valor ? { value: c.valor } : {}),
          },
        ],
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

const API = "https://discord.com/api/v10";

/**
 * Substitui a resposta adiada pelo conteúdo de verdade.
 *
 * Usa o token da interação, não o do bot: o token de interação já autoriza esta
 * chamada e vale 15 minutos. Por isso aqui não entra `Authorization` nenhuma —
 * o token do bot não precisa sair do processo para o comando responder.
 *
 * Erro aqui não pode derrubar o handler: a essa altura o `PATCH` é a última
 * coisa que acontece, e explodir só troca uma mensagem ruim por nenhuma. Loga e
 * segue.
 */
export async function editarResposta(
  applicationId: string,
  tokenDaInteracao: string,
  payload: { content?: string; embeds?: Embed[] },
): Promise<void> {
  const url = `${API}/webhooks/${applicationId}/${tokenDaInteracao}/messages/@original`;
  try {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      console.error(`[discord] follow-up ${r.status}: ${await r.text().catch(() => "")}`);
    }
  } catch (e) {
    console.error("[discord] follow-up falhou:", e);
  }
}
