/**
 * Meta de uma pasta, em Tibia Coin ou em gold.
 *
 * A pasta guarda **valor + unidade**, nunca o equivalente em gp. Se guardasse
 * gp, uma meta de "500 TC" viraria outro alvo no dia em que o preço da TC
 * mudasse. Guardando a unidade, 500 TC continuam 500 TC e o alvo em gold é
 * recalculado ao preço vigente.
 *
 * ## O que este módulo NÃO promete
 *
 * O profit foi acumulado ao longo de semanas, com a TC valendo coisas
 * diferentes em cada uma. Converter o total de hoje a um preço único é
 * aproximação, não contabilidade. Serve para responder "quanto falta", que é a
 * pergunta que a tela faz.
 */

export type UnidadeDaMeta = "tc" | "gp";

export interface Meta {
  readonly valor: number;
  readonly unidade: UnidadeDaMeta;
}

export interface ProgressoDaMeta {
  /** Alvo convertido para gold, ao preço informado. */
  readonly alvoEmGp: number;
  /** 0 a 1, limitado no teto. Use `fracaoCrua` para saber se passou. */
  readonly fracao: number;
  /** Sem teto: 1,4 quer dizer 40% além da meta. */
  readonly fracaoCrua: number;
  /** Quanto falta, na unidade da meta. Zero quando já bateu. */
  readonly falta: number;
  readonly bateu: boolean;
  /** Quantas hunts no ritmo atual, ou `null` se não dá para estimar. */
  readonly huntsRestantes: number | null;
}

/**
 * Converte a meta para gold.
 *
 * `precoTc` é gold por Tibia Coin, a estimativa do usuário — nenhuma das duas
 * APIs publica preço de mercado (diretriz 24). Sem preço configurado, meta em
 * TC não tem alvo em gold, e quem chama precisa lidar com isso.
 */
export function alvoEmGp(meta: Meta, precoTc: number | null): number | null {
  if (meta.unidade === "gp") return meta.valor;
  if (precoTc === null || precoTc <= 0) return null;
  return meta.valor * precoTc;
}

/**
 * Onde a pasta está em relação à meta.
 *
 * `profit` pode ser negativo — uma pasta de teste de setup costuma ser. Nesse
 * caso a fração é 0 e não um número negativo: barra de progresso não anda para
 * trás, e "-12% da meta" não quer dizer nada para quem lê.
 */
export function progressoDaMeta(
  meta: Meta,
  profit: number,
  precoTc: number | null,
  hunts = 0,
): ProgressoDaMeta | null {
  const alvo = alvoEmGp(meta, precoTc);
  if (alvo === null || alvo <= 0) return null;

  const fracaoCrua = profit / alvo;
  const fracao = Math.min(Math.max(fracaoCrua, 0), 1);
  const bateu = profit >= alvo;

  const faltaEmGp = Math.max(alvo - profit, 0);
  // Devolve na unidade em que a meta foi escrita: quem pediu 500 TC quer ler
  // "faltam 189 TC", não "faltam 2.986.200 gp".
  const falta =
    meta.unidade === "tc" && precoTc ? Math.ceil(faltaEmGp / precoTc) : faltaEmGp;

  return { alvoEmGp: alvo, fracao, fracaoCrua, falta, bateu, huntsRestantes: estimar(faltaEmGp, profit, hunts) };
}

/**
 * Quantas hunts faltam, no ritmo médio da própria pasta.
 *
 * Deliberadamente simples: `falta ÷ profit médio por hunt`. Não é previsão, é
 * régua — e é por isso que devolve `null` em vez de chutar quando o ritmo não
 * diz nada. Sem hunts não há média; com profit médio zero ou negativo, nenhuma
 * quantidade de hunts fecha a meta, e um número ali seria mentira.
 */
function estimar(faltaEmGp: number, profit: number, hunts: number): number | null {
  if (faltaEmGp === 0) return 0;
  if (hunts <= 0) return null;
  const porHunt = profit / hunts;
  if (porHunt <= 0) return null;
  return Math.ceil(faltaEmGp / porHunt);
}

/** `500 TC` · `1.200.000 gp` — para rótulo, sempre com a unidade junto. */
export function rotuloDaMeta(meta: Meta): string {
  return meta.unidade === "tc"
    ? `${meta.valor.toLocaleString("pt-BR")} TC`
    : `${meta.valor.toLocaleString("pt-BR")} gp`;
}
