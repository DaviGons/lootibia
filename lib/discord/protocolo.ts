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
  /** Sugestões de autocomplete. Não adia: ou responde em 3 s, ou some. */
  AUTOCOMPLETE: 8,
  MODAL: 9,
} as const;

/**
 * Componentes. Só os que o bot usa.
 *
 * `LABEL` é o que mudou desde a primeira versão deste arquivo. A referência de
 * componentes hoje diz, textualmente: *"Action Row with Text Inputs in modals
 * are now deprecated"* e *"Going forward all Text Inputs should be placed
 * inside a Label component"*. Conferido em 2026-09-21, não presumido do que
 * estava escrito aqui em setembro (diretriz 14).
 *
 * O `LABEL` é quem carrega o texto do campo agora — o `label` do próprio Text
 * Input está depreciado em favor de `label` + `description` da Label.
 */
export const TipoDeComponente = {
  ACTION_ROW: 1,
  BUTTON: 2,
  STRING_SELECT: 3,
  TEXT_INPUT: 4,
  LABEL: 18,
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
  /** Numa interação de autocomplete, marca a opção que o usuário está digitando. */
  focused?: boolean;
}

/**
 * Um componente como ele volta no submit do modal.
 *
 * `value` é de Text Input; `values` é de String Select (um array, mesmo quando
 * só se escolhe uma opção). Confundir os dois devolve `undefined` em silêncio.
 */
export interface CampoDeModal {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  /** Presente quando o componente veio embrulhado numa Label (type 18). */
  component?: CampoDeModal;
  /** Presente no formato legado, com Action Row. */
  components?: CampoDeModal[];
}

/**
 * Um item do array `data.components` do submit.
 *
 * Hoje são Labels (`component`, singular). No formato legado eram Action Rows
 * (`components`, plural). `componentesDoModal` achata os dois.
 */
export type LinhaDeComponentes = CampoDeModal;

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

/**
 * Numa interação de autocomplete, qual opção o usuário está digitando e o que
 * ele já escreveu.
 *
 * O Discord manda TODAS as opções do comando e marca uma com `focused`. Sem
 * olhar essa marca, um comando com dois campos autocompletáveis sugeriria
 * pastas enquanto a pessoa digita o nome do personagem.
 */
export function opcaoFocada(i: Interacao): { nome: string; texto: string } | null {
  const o = i.data?.options?.find((x) => x.focused);
  if (!o) return null;
  return { nome: o.name, texto: String(o.value ?? "").trim() };
}

/** Valor booleano de uma opção. Ausente devolve o padrão informado. */
export function opcaoBooleana(i: Interacao, nome: string, padrao: boolean): boolean {
  const o = i.data?.options?.find((x) => x.name === nome);
  return typeof o?.value === "boolean" ? o.value : padrao;
}

/**
 * Achata o `data.components` do submit, qualquer que seja o embrulho.
 *
 * São DOIS formatos, e o bot precisa entender os dois:
 *
 *   Label (atual):  { type: 18, component:  { type: 4, custom_id, value } }
 *   Action Row:     { type: 1,  components: [{ type: 4, custom_id, value }] }
 *
 * Repare no singular contra o plural. Um parser que só conhecesse
 * `components[]` — como este arquivo tinha até 2026-09-21 — devolveria `null`
 * para todo campo de um modal montado com Label, sem erro nenhum: o comando
 * responderia "cole o texto do Hunt Analyser" para quem acabou de colar.
 *
 * Trata o legado porque um modal aberto antes de um deploy pode ser submetido
 * depois dele. A janela é de minutos, mas existe.
 */
function componentesDoModal(i: Interacao): CampoDeModal[] {
  const saida: CampoDeModal[] = [];
  const visitar = (c: CampoDeModal | undefined) => {
    if (!c) return;
    if (c.custom_id) saida.push(c);
    if (c.component) visitar(c.component);
    for (const filho of c.components ?? []) visitar(filho);
  };
  for (const linha of i.data?.components ?? []) visitar(linha);
  return saida;
}

/**
 * Valor de um campo de texto do modal, pelo `custom_id`.
 *
 * Campo opcional deixado em branco chega como string vazia, não some da lista —
 * por isso o `|| null`.
 */
export function campoDoModal(i: Interacao, customId: string): string | null {
  const c = componentesDoModal(i).find((x) => x.custom_id === customId);
  return c?.value?.trim() || null;
}

/**
 * Opção escolhida num String Select do modal.
 *
 * O Discord devolve `values`, um array, mesmo quando `max_values` é 1. Aqui só
 * existem seletores de escolha única, então pega-se o primeiro; nada escolhido
 * vira `null`, que é o caso do "Sem pasta".
 */
export function selecaoDoModal(i: Interacao, customId: string): string | null {
  const c = componentesDoModal(i).find((x) => x.custom_id === customId);
  return c?.values?.[0]?.trim() || null;
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
  /** Componentes de topo num modal. Hoje, uma Label por campo. */
  MODAL_COMPONENTES: 5,
  /** Texto da Label que rotula o campo. */
  LABEL_TEXTO: 45,
  /** Descrição opcional da Label, abaixo (ou acima) do campo. */
  LABEL_DESCRICAO: 100,
  /** Opções num String Select. É o teto de pastas que o seletor comporta. */
  SELECT_OPCOES: 25,
  /** Texto do placeholder de um select. */
  SELECT_PLACEHOLDER: 150,
  /** `label`, `value` e `description` de uma opção de select. */
  OPCAO_TEXTO: 100,
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

/**
 * Sugestões de autocomplete.
 *
 * Não existe adiar aqui: ou a lista sai em 3 s, ou o campo fica sem sugestão.
 * Por isso quem chama é responsável por não deixar a busca demorar — e por
 * responder com lista vazia em vez de explodir, que é o que mantém o campo
 * utilizável (a pessoa ainda pode digitar o nome à mão).
 */
export function autocompletar(escolhas: { nome: string; valor: string }[]) {
  return {
    type: TipoDeResposta.AUTOCOMPLETE,
    data: {
      choices: escolhas.slice(0, LIMITES.SELECT_OPCOES).map((e) => ({
        name: e.nome.slice(0, LIMITES.OPCAO_TEXTO),
        value: e.valor.slice(0, LIMITES.OPCAO_TEXTO),
      })),
    },
  };
}

export interface OpcaoDeSelecao {
  valor: string;
  rotulo: string;
  descricao?: string;
  padrao?: boolean;
}

/**
 * Um campo do modal: texto livre ou escolha entre opções.
 *
 * `opcoes` presente vira String Select; ausente, Text Input. Quem chama não
 * precisa saber de tipo 3 contra tipo 4.
 */
export interface CampoDeEntrada {
  id: string;
  rotulo: string;
  /** Texto de apoio sob o rótulo. Vive na Label, não no campo. */
  descricao?: string;
  /** Só para texto: `EstiloDeTexto.CURTO` ou `PARAGRAFO`. */
  estilo?: number;
  obrigatorio?: boolean;
  tamanhoMaximo?: number;
  exemplo?: string;
  valor?: string;
  /** Presente ⇒ o campo vira seletor. Até `LIMITES.SELECT_OPCOES`. */
  opcoes?: OpcaoDeSelecao[];
}

/** Monta o componente interativo que vai dentro de uma Label. */
function componenteDoCampo(c: CampoDeEntrada) {
  if (c.opcoes) {
    return {
      type: TipoDeComponente.STRING_SELECT,
      custom_id: c.id,
      required: c.obrigatorio ?? false,
      // `min_values: 0` é o que permite não escolher nada. A documentação é
      // explícita: com `required` omitido ou true, `min_values` tem de ser >= 1.
      ...(c.obrigatorio ? {} : { min_values: 0 }),
      max_values: 1,
      ...(c.exemplo ? { placeholder: c.exemplo.slice(0, LIMITES.SELECT_PLACEHOLDER) } : {}),
      options: c.opcoes.slice(0, LIMITES.SELECT_OPCOES).map((o) => ({
        label: o.rotulo.slice(0, LIMITES.OPCAO_TEXTO),
        value: o.valor.slice(0, LIMITES.OPCAO_TEXTO),
        ...(o.descricao ? { description: o.descricao.slice(0, LIMITES.OPCAO_TEXTO) } : {}),
        ...(o.padrao ? { default: true } : {}),
      })),
    };
  }

  return {
    type: TipoDeComponente.TEXT_INPUT,
    custom_id: c.id,
    style: c.estilo ?? EstiloDeTexto.CURTO,
    required: c.obrigatorio ?? false,
    ...(c.tamanhoMaximo ? { max_length: c.tamanhoMaximo } : {}),
    ...(c.exemplo ? { placeholder: c.exemplo } : {}),
    ...(c.valor ? { value: c.valor } : {}),
  };
}

/**
 * Abre um modal. Precisa ser a resposta INICIAL da interação — ver o comentário
 * de `TipoDeResposta`.
 *
 * Cada campo vira uma **Label** (type 18), não uma Action Row: Action Row com
 * Text Input em modal está depreciada, e select em modal **só** funciona dentro
 * de Label. Ver o comentário de `TipoDeComponente`.
 *
 * O corte em `MODAL_COMPONENTES` não é defensivo à toa: o Discord recusa o
 * modal inteiro com `400` se passar de 5, e o comando morre sem mensagem útil.
 */
export function modal(customId: string, titulo: string, campos: CampoDeEntrada[]) {
  return {
    type: TipoDeResposta.MODAL,
    data: {
      custom_id: customId,
      title: titulo.slice(0, LIMITES.MODAL_TITULO),
      components: campos.slice(0, LIMITES.MODAL_COMPONENTES).map((c) => ({
        type: TipoDeComponente.LABEL,
        label: c.rotulo.slice(0, LIMITES.LABEL_TEXTO),
        ...(c.descricao ? { description: c.descricao.slice(0, LIMITES.LABEL_DESCRICAO) } : {}),
        component: componenteDoCampo(c),
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
